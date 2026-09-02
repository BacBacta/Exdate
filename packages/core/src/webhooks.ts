/**
 * Signed webhooks: the catalogue, the signature scheme and the retry schedule.
 *
 * This module is pure and does no I/O, so the same code signs on the way out
 * and verifies on the way in - a consumer running {@link verifySignature}
 * against a delivery is running the exact function that produced it.
 *
 * The scheme is HMAC-SHA256 over `${timestamp}.${body}`, carried in one header:
 *
 *     exdate-signature: t=1788373934,v1=6c1f...9a
 *
 * The timestamp is inside the signed material, so a captured delivery cannot be
 * replayed with a fresh one, and `verifySignature` enforces a tolerance window.
 * The body is signed as the exact bytes sent: verify before parsing the JSON,
 * never after re-serialising it.
 */

const encoder = new TextEncoder()

export const WEBHOOK_SIGNATURE_HEADER = 'exdate-signature'
export const WEBHOOK_EVENT_HEADER = 'exdate-event'
export const WEBHOOK_EVENT_ID_HEADER = 'exdate-event-id'
export const WEBHOOK_DELIVERY_HEADER = 'exdate-delivery'
/** How far apart the sender's and receiver's clocks may be, in seconds. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

export type WebhookEventType =
  | 'multiplier.scheduled'
  | 'multiplier.applied'
  | 'feed.stale'
  | 'feed.resumed'
  | 'pause.changed'
  | 'dividend.pending'
  | 'dividend.reconciled'

/**
 * What each event means, in the words the API serves it with. `trigger` says
 * what exdate observed - never what it inferred - because two of these have no
 * on-chain event behind them at all.
 */
export const WEBHOOK_EVENTS: readonly {
  type: WebhookEventType
  summary: string
  trigger: string
}[] = [
  {
    type: 'multiplier.scheduled',
    summary: 'A multiplier change is announced and not yet in effect.',
    trigger: 'a UIMultiplierUpdated log whose effectiveAt is still in the future. The observed lead is about nine minutes.',
  },
  {
    type: 'multiplier.applied',
    summary: 'The multiplier read on chain has changed.',
    trigger:
      'uiMultiplier() differs from the previous poll. Nothing is emitted on chain when a change takes effect, so this is an observation by the poller, not a log.',
  },
  {
    type: 'feed.stale',
    summary: 'A Chainlink feed has gone past its heartbeat.',
    trigger: 'the age of the latest round crossed the 86 400 s heartbeat between two polls.',
  },
  {
    type: 'feed.resumed',
    summary: 'A Chainlink feed is publishing again.',
    trigger: 'a fresh round arrived for a feed that was stale.',
  },
  {
    type: 'pause.changed',
    summary: 'A token flipped oraclePaused().',
    trigger: 'oraclePaused() differs from the previous poll. The first observation of a paused token is a baseline and is not sent.',
  },
  {
    type: 'dividend.pending',
    summary: 'The issuer declared a distribution that the multiplier has not reflected.',
    trigger:
      'a new row in GET /rhj/corporate-actions with no multiplier step paired to it. On a fresh database the whole outstanding backlog arrives at once, flagged `backlog: true`.',
  },
  {
    type: 'dividend.reconciled',
    summary: 'A declared distribution has been matched to a multiplier step and priced.',
    trigger: 'a reconciliation row reached matched or anomaly, carrying the observed haircut.',
  },
]

/**
 * The `data` of each event type - the wire contract, declared once.
 *
 * The sender is typed against this map, so a payload that drifts from what the
 * SDK tells consumers to expect is a compile error rather than a surprise in
 * production. Bigints are decimal strings and anything unobserved is null, the
 * same rules the REST API follows.
 */
export interface WebhookData {
  'multiplier.scheduled': {
    currentMultiplier: string
    newMultiplier: string
    stepBps: number | null
    effectiveAt: string
    secondsUntilEffective: number
    announcedAt: string | null
    announcedTx: string | null
    announcementCount: number | null
    source: string
  }
  'multiplier.applied': {
    previousMultiplier: string
    currentMultiplier: string
    stepBps: number
    effectiveAt: string
    observedAtBlock: string
    /** Why this is an observation and not a log. */
    basis: string
  }
  'feed.stale': FeedTransitionData
  'feed.resumed': FeedTransitionData
  'pause.changed': {
    paused: boolean
    previousPaused: boolean | null
    at: string
    block: string
    effect: string
  }
  'dividend.pending': {
    actionId: string
    type: string
    issuerStatus: string
    /**
     * True when this row was already outstanding the first time exdate looked -
     * a fresh database emits its whole current backlog at once (37 rows on
     * 2026-09-02). Real events, but not news: a consumer starting up can ignore
     * them and act only on `backlog: false`.
     */
    backlog: boolean
    processDate: string | null
    /** Always true. The issuer's scheduling day is neither the ex-date nor the payable date. */
    processDateIsNotExDate: true
    grossPerUnderlyingShare: string | null
    currency: 'USD'
    source: string
  }
  'dividend.reconciled': {
    actionId: string
    processDate: string | null
    grossPerUnderlyingShare: string | null
    effectiveAt: string
    lagDays: number | null
    observedStepBps: number | null
    expectedStepBps: number | null
    /** The measured haircut. Null when the token has no feed to price the step. */
    impliedHaircutBps: number | null
    status: string
    confidence: string
    note: string | null
    priceSource: string | null
  }
}

export interface FeedTransitionData {
  feed: string
  previousStatus: string | null
  status: string
  roundId: string
  answer: string
  decimals: number
  updatedAt: string
  ageSeconds: number | null
  beyondHeartbeat: boolean | null
  /** Always true: Chainlink publishes the token price, multiplier included. */
  answerIncludesMultiplier: true
}

export type WebhookDataFor<T extends WebhookEventType> = WebhookData[T]

/**
 * The body of every delivery. `data` is event-specific; everything around it is
 * the same shape for all seven types, so a consumer can route on `type` without
 * a per-event parser.
 */
export interface WebhookEnvelope<T extends WebhookEventType = WebhookEventType> {
  id: string
  type: T
  chainId: number
  /** When exdate observed it, ISO 8601. Not when it happened on chain. */
  observedAt: string
  token: { address: string; symbol: string } | null
  data: WebhookData[T]
}

/**
 * Every envelope, as a union discriminated on `type` - so narrowing on the type
 * narrows `data` with it.
 */
export type AnyWebhookEnvelope = { [T in WebhookEventType]: WebhookEnvelope<T> }[WebhookEventType]

const isEventType = (value: string): value is WebhookEventType =>
  WEBHOOK_EVENTS.some((event) => event.type === value)

/**
 * The identity of an event, and its idempotency key.
 *
 * Deterministic on purpose: the same real-world occurrence reached by two paths
 * - the live indexer and the poller both see a schedule - produces the same id,
 * so the second insert is a no-op instead of a duplicate delivery. Consumers
 * should treat it the same way and key their own bookkeeping on it.
 */
export function webhookEventId(type: WebhookEventType, chainId: number, subject: string): string {
  return `${type}:${chainId}:${subject.toLowerCase()}`
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

/** The value of the `exdate-signature` header for a body and a timestamp. */
export async function signBody(input: {
  secret: string
  /** Seconds since the epoch. Signed, so it cannot be rewritten in transit. */
  timestamp: number | bigint
  /** The exact bytes of the request body. */
  body: string
}): Promise<string> {
  const timestamp = Number(input.timestamp)
  if (!Number.isFinite(timestamp)) throw new Error('timestamp must be finite')
  if (input.secret.length === 0) throw new Error('signing secret is empty')
  return `t=${timestamp},v1=${await hmacSha256(input.secret, `${timestamp}.${input.body}`)}`
}

export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  const parts = header.split(',').map((part) => part.trim())
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of parts) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const key = part.slice(0, index)
    const value = part.slice(index + 1)
    if (key === 't') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return null
      timestamp = parsed
    } else if (key === 'v1') signatures.push(value)
  }
  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

/** Compare two hex digests without leaking their difference through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type VerificationFailure =
  | 'malformed_header'
  | 'timestamp_outside_tolerance'
  | 'signature_mismatch'

/**
 * Verify a delivery. Returns the failure reason rather than throwing, so a
 * consumer can log which check failed without inspecting the secret.
 *
 * `secrets` accepts several so a secret can be rotated: sign with the new one,
 * accept both for as long as deliveries may still be in flight.
 */
export async function verifySignature(input: {
  secret: string | readonly string[]
  header: string | null | undefined
  body: string
  nowSeconds: number | bigint
  toleranceSeconds?: number
}): Promise<{ valid: true } | { valid: false; reason: VerificationFailure }> {
  const { header, body } = input
  if (!header) return { valid: false, reason: 'malformed_header' }
  const parsed = parseSignatureHeader(header)
  if (!parsed) return { valid: false, reason: 'malformed_header' }

  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS
  const now = Number(input.nowSeconds)
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { valid: false, reason: 'timestamp_outside_tolerance' }
  }

  const secrets = typeof input.secret === 'string' ? [input.secret] : input.secret
  const message = `${parsed.timestamp}.${body}`
  let matched = false
  for (const secret of secrets) {
    if (secret.length === 0) continue
    const expected = await hmacSha256(secret, message)
    // No early exit: every candidate is compared so the loop takes the same
    // shape whichever secret matches.
    for (const signature of parsed.signatures) {
      if (timingSafeEqual(expected, signature)) matched = true
    }
  }
  return matched ? { valid: true } : { valid: false, reason: 'signature_mismatch' }
}

export interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  /** Undefined means every event type. */
  events?: WebhookEventType[]
}

/**
 * Read the endpoint list from configuration.
 *
 * Endpoints carry secrets, so they are configured out of band (a JSON array in
 * `EXDATE_WEBHOOK_ENDPOINTS`) and never stored in a table this API can serve.
 * Anything malformed throws at boot rather than silently sending nothing: a
 * webhook that was never configured looks exactly like one that never fired.
 */
export function parseWebhookEndpoints(raw: string | undefined | null): WebhookEndpoint[] {
  if (!raw || raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('EXDATE_WEBHOOK_ENDPOINTS is not valid JSON')
  }
  if (!Array.isArray(parsed)) throw new Error('EXDATE_WEBHOOK_ENDPOINTS must be a JSON array')

  const seen = new Set<string>()
  return parsed.map((entry, index) => {
    const row = entry as Partial<WebhookEndpoint>
    const id = row.id ?? `endpoint-${index}`
    if (typeof row.url !== 'string' || row.url === '') throw new Error(`webhook endpoint ${id} has no url`)
    let url: URL
    try {
      url = new URL(row.url)
    } catch {
      throw new Error(`webhook endpoint ${id} has an invalid url`)
    }
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !localhost) {
      throw new Error(`webhook endpoint ${id} must use https (http is allowed for localhost only)`)
    }
    if (typeof row.secret !== 'string' || row.secret.length < 16) {
      throw new Error(`webhook endpoint ${id} needs a secret of at least 16 characters`)
    }
    if (seen.has(id)) throw new Error(`duplicate webhook endpoint id ${id}`)
    seen.add(id)
    const events = row.events
    if (events !== undefined) {
      if (!Array.isArray(events)) throw new Error(`webhook endpoint ${id} has a non-array events list`)
      for (const event of events) {
        if (typeof event !== 'string' || !isEventType(event)) {
          throw new Error(`webhook endpoint ${id} subscribes to unknown event ${String(event)}`)
        }
      }
    }
    return { id, url: row.url, secret: row.secret, ...(events ? { events: events as WebhookEventType[] } : {}) }
  })
}

export function endpointWants(endpoint: WebhookEndpoint, type: WebhookEventType): boolean {
  return endpoint.events === undefined || endpoint.events.includes(type)
}

/**
 * Backoff between delivery attempts, in seconds: 30 s, 2 min, 10 min, 30 min,
 * 2 h, 6 h, 12 h. After the last one the delivery is marked failed and left in
 * the table - a consumer that was down for a day should see what it missed, not
 * find an empty queue.
 */
export const WEBHOOK_RETRY_SCHEDULE_SECONDS: readonly number[] = [30, 120, 600, 1_800, 7_200, 21_600, 43_200]

export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_SECONDS.length + 1

/** Seconds to wait after `attempt` failures, or null when there are none left. */
export function nextAttemptDelaySeconds(attempt: number): number | null {
  if (attempt < 1) throw new Error('attempt is 1-based')
  return WEBHOOK_RETRY_SCHEDULE_SECONDS[attempt - 1] ?? null
}
