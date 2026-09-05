import { webhookDeliveries, webhookEvents } from 'ponder:schema'
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDataFor,
  type WebhookEndpoint,
  type WebhookEnvelope,
  type WebhookEventType,
  endpointWants,
  nextAttemptDelaySeconds,
  parseWebhookEndpoints,
  signBody,
  webhookEventId,
} from '@exdate/core'
import type { Context } from 'ponder:registry'
import type { Address } from 'viem'
import { subscriptionStore } from './subscriptions.js'

/**
 * The webhook outbox: enqueue here, deliver from the poll cycle.
 *
 * Delivery is not attempted at the moment an event is noticed. An indexing
 * function that awaits an HTTP round trip to someone else's server holds up the
 * whole cycle, and a consumer that hangs would stall indexing - so events are
 * written to a table and drained at the START of the next poll, exactly like
 * the reconciliation pass and for the same reason: Ponder buffers writes made
 * inside a handler, so a `db.sql` read cannot see rows written earlier in it.
 * The cost is up to one poll interval of latency, about a minute at the default
 * 600-block interval, against a nine-minute announcement lead.
 */

/**
 * Only the store is needed, so both the poll handler and the log handler can
 * enqueue - the live indexer and the poller notice a schedule by different
 * routes and must be able to record the same event.
 */
type WebhookContext = { db: Context<'Poll:block'>['db'] }

/**
 * Endpoints are configuration, not data: they carry secrets, so they live in an
 * env var and never in a table the API can serve. Parsed once, at import, so a
 * malformed list stops the process at boot - silence from a typo is
 * indistinguishable from silence because nothing happened.
 */
export const endpoints: WebhookEndpoint[] = parseWebhookEndpoints(process.env.EXDATE_WEBHOOK_ENDPOINTS)

/**
 * Everything deliveries go to, at this moment: the operator's endpoints plus
 * every self-service subscription not revoked. Read at each call rather than
 * once, because a subscription made a minute ago must receive the next event.
 */
export function currentEndpoints(): WebhookEndpoint[] {
  return [...endpoints, ...(subscriptionStore?.activeEndpoints() ?? [])]
}

const DELIVERY_TIMEOUT_MS = Number(process.env.EXDATE_WEBHOOK_TIMEOUT_MS ?? 10_000)
/** Cap per cycle so a large backlog cannot stretch one poll indefinitely. */
const MAX_DELIVERIES_PER_POLL = Number(process.env.EXDATE_WEBHOOK_MAX_PER_POLL ?? 20)

const deliveryId = (eventId: string, endpointId: string) => `${eventId}|${endpointId}`

export interface EnqueueInput<T extends WebhookEventType = WebhookEventType> {
  chainId: number
  type: T
  /** What makes this occurrence unique within its type - usually `${token}:${instant}`. */
  subject: string
  token: { address: Address; symbol: string } | null
  /** Typed against the published contract in @exdate/core, so drift is a compile error. */
  data: WebhookDataFor<T>
  /** Observation time in seconds, from the block being polled. */
  now: bigint
  block?: bigint
}

/**
 * Record an occurrence once and fan it out to every subscribed endpoint.
 *
 * Returns false when the event was already known, which is the normal case for
 * anything both the live indexer and the poller can see. Nothing is sent from
 * here.
 */
export async function enqueueWebhook<T extends WebhookEventType>(
  context: WebhookContext,
  input: EnqueueInput<T>,
): Promise<boolean> {
  const id = webhookEventId(input.type, input.chainId, input.subject)
  const envelope: WebhookEnvelope<T> = {
    id,
    type: input.type,
    chainId: input.chainId,
    observedAt: new Date(Number(input.now) * 1000).toISOString(),
    token: input.token ? { address: input.token.address, symbol: input.token.symbol } : null,
    data: input.data,
  }
  // Serialised once, here: the stored bytes are the signed bytes. Re-encoding
  // before signing is the classic way to produce a delivery that fails its own
  // verifier over key order or whitespace.
  const payload = JSON.stringify(envelope)

  const inserted = await context.db
    .insert(webhookEvents)
    .values({
      id,
      chainId: input.chainId,
      type: input.type,
      token: input.token?.address ?? null,
      payload,
      createdAt: input.now,
      createdBlock: input.block ?? null,
    })
    .onConflictDoNothing()
  if (!inserted) return false

  for (const endpoint of currentEndpoints()) {
    if (!endpointWants(endpoint, input.type)) continue
    await context.db
      .insert(webhookDeliveries)
      .values({
        id: deliveryId(id, endpoint.id),
        chainId: input.chainId,
        eventId: id,
        type: input.type,
        endpointId: endpoint.id,
        host: new URL(endpoint.url).host,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: input.now,
        lastAttemptAt: null,
        deliveredAt: null,
        responseStatus: null,
        error: null,
      })
      .onConflictDoNothing()
  }
  return true
}

/**
 * Attempt every delivery that is due, oldest first.
 *
 * Reads committed state, so it drains what previous cycles enqueued. Returns
 * how many were attempted; a cycle with no endpoints configured does no work
 * and no reads.
 */
export async function deliverDueWebhooks(context: WebhookContext, now: bigint): Promise<number> {
  const live = currentEndpoints()
  if (live.length === 0) return 0
  const byId = new Map(live.map((endpoint) => [endpoint.id, endpoint]))

  const rows = (await context.db.sql.select().from(webhookDeliveries))
    .filter((row) => row.status === 'queued' && row.nextAttemptAt <= now)
    .sort((a, b) => Number(a.nextAttemptAt - b.nextAttemptAt))
    .slice(0, MAX_DELIVERIES_PER_POLL)
  if (rows.length === 0) return 0

  const events = new Map(
    (await context.db.sql.select().from(webhookEvents)).map((event) => [event.id, event]),
  )

  let attempted = 0
  for (const row of rows) {
    const endpoint = byId.get(row.endpointId)
    const event = events.get(row.eventId)
    // An endpoint removed from the configuration leaves its queued rows behind.
    // They are not deleted - the operator should be able to see what was not
    // sent - but nothing is attempted for an endpoint that no longer exists.
    if (!endpoint || !event) continue

    const attempts = row.attempts + 1
    const result = await attemptDelivery(endpoint, event.payload, event.type, row.id, now)
    attempted++

    if (result.ok) {
      await context.db.update(webhookDeliveries, { id: row.id }).set({
        status: 'delivered',
        attempts,
        lastAttemptAt: now,
        deliveredAt: now,
        responseStatus: result.status,
        error: null,
      })
      continue
    }

    const delay = nextAttemptDelaySeconds(attempts)
    await context.db.update(webhookDeliveries, { id: row.id }).set({
      status: delay === null ? 'failed' : 'queued',
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: delay === null ? row.nextAttemptAt : now + BigInt(delay),
      responseStatus: result.status ?? null,
      error: result.error.slice(0, 200),
    })
    if (delay === null) {
      console.warn(
        `[exdate] webhook ${row.type} to ${row.host} gave up after ${WEBHOOK_MAX_ATTEMPTS} attempts: ${result.error.slice(0, 120)}`,
      )
    }
  }
  return attempted
}

async function attemptDelivery(
  endpoint: WebhookEndpoint,
  payload: string,
  type: string,
  delivery: string,
  now: bigint,
): Promise<{ ok: true; status: number } | { ok: false; status?: number; error: string }> {
  try {
    const signature = await signBody({ secret: endpoint.secret, timestamp: now, body: payload })
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'exdate-webhooks/1',
        [WEBHOOK_EVENT_HEADER]: type,
        [WEBHOOK_EVENT_ID_HEADER]: delivery.split('|')[0] ?? '',
        [WEBHOOK_DELIVERY_HEADER]: delivery,
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
      body: payload,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    if (response.ok) return { ok: true, status: response.status }
    return { ok: false, status: response.status, error: `HTTP ${response.status}` }
  } catch (error) {
    // The URL and the signature are deliberately not in the message: this string
    // is stored and served by the API.
    return { ok: false, error: (error as Error).message }
  }
}
