import {
  CHAINS,
  MATCH_WINDOW_DAYS,
  REGISTRY_GENERATED_AT,
  SCANNED_AT,
  SCAN_FROM_BLOCK,
  SCAN_THROUGH_BLOCK,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  buildPendingView,
  buildYieldLedger,
  feedHealth,
  resolveChain,
} from '@exdate/core'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  serializeCorporateAction,
  serializeMultiplierEvent,
  serializeReconciliation,
  serializeToken,
  serializeWebhookEvent,
} from './serialize.js'
import type { Repository } from './types.js'

export * from './types.js'
export * from './serialize.js'

export interface ApiOptions {
  repository: Repository
  /** Injected so responses are deterministic under test. */
  now?: () => bigint
  /**
   * How many webhook endpoints the process was started with. The endpoints
   * themselves carry secrets and are never served; the count is what tells an
   * operator whether silence means "nothing happened" or "nobody is listening".
   */
  webhookEndpointsConfigured?: number
}

export function createApi({
  repository,
  now = () => BigInt(Math.floor(Date.now() / 1000)),
  webhookEndpointsConfigured = 0,
}: ApiOptions) {
  const app = new Hono()

  app.use('/v1/*', cors())

  // Ponder reserves /health and /ready for its own liveness probes.
  app.get('/v1/health', (c) => c.json({ ok: true, registryGeneratedAt: REGISTRY_GENERATED_AT }))

  /**
   * The webhook contract: what can be sent, how it is signed, how it is retried.
   *
   * Served rather than only documented so a consumer can verify a delivery
   * against the live scheme - the header names and the tolerance are the same
   * constants the sender uses.
   */
  app.get('/v1/webhooks', (c) =>
    c.json({
      events: WEBHOOK_EVENTS,
      signature: {
        algorithm: 'HMAC-SHA256',
        header: WEBHOOK_SIGNATURE_HEADER,
        format: 't=<unix seconds>,v1=<hex digest>',
        signedMaterial: '`${t}.${rawRequestBody}`',
        toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS,
        verify: 'verifySignature() in @exdate/core - the same function that signs',
        note: 'verify the raw bytes before parsing the JSON; a re-encoded body will not match.',
      },
      headers: {
        event: WEBHOOK_EVENT_HEADER,
        eventId: WEBHOOK_EVENT_ID_HEADER,
        delivery: WEBHOOK_DELIVERY_HEADER,
      },
      idempotency: {
        key: WEBHOOK_EVENT_ID_HEADER,
        note: 'event ids are deterministic, so a redelivery or a second observation of the same occurrence carries the id you already have.',
      },
      retries: { scheduleSeconds: WEBHOOK_RETRY_SCHEDULE_SECONDS, maxAttempts: WEBHOOK_MAX_ATTEMPTS },
      endpointsConfigured: webhookEndpointsConfigured,
    }),
  )

  app.get('/v1/chains', (c) =>
    c.json({
      chains: Object.values(CHAINS).map((chain) => ({
        key: chain.key,
        chainId: chain.id,
        name: chain.name,
        issuer: chain.issuer,
        explorerUrl: chain.explorerUrl,
      })),
    }),
  )

  /** `:chain` accepts either the key ("robinhood") or the id ("4663"). */
  const unknownChain = { error: 'unknown chain', supported: Object.keys(CHAINS) }

  app.get('/v1/:chain/tokens', async (c) => {
    const chain = resolveChain(c.req.param('chain'))
    if (!chain) return c.json(unknownChain, 404)
    const nowSeconds = now()
    const rows = await repository.tokens(chain.id)
    return c.json({
      chainId: chain.id,
      count: rows.length,
      polled: rows.filter((row) => row.uiMultiplier !== null).length,
      tokens: rows.map((row) => serializeToken(row, { nowSeconds, explorerUrl: chain.explorerUrl })),
    })
  })

  app.get('/v1/:chain/tokens/:address', async (c) => {
    const chain = resolveChain(c.req.param('chain'))
    if (!chain) return c.json(unknownChain, 404)
    const address = c.req.param('address')
    const row = await repository.token(chain.id, address)
    if (!row) return c.json({ error: 'unknown token', chainId: chain.id, address }, 404)
    const nowSeconds = now()
    const events = await repository.multiplierEvents(chain.id, address)
    return c.json({
      token: serializeToken(row, { nowSeconds, explorerUrl: chain.explorerUrl }),
      events: events.map((event) => serializeMultiplierEvent(event, nowSeconds)),
    })
  })

  /**
   * The distribution ledger for one token: every observed multiplier step and
   * every declared action, each with its own gross, received and haircut. No
   * rate is computed from it - see `notComputed` in the response for why.
   */
  app.get('/v1/:chain/tokens/:address/yield', async (c) => {
    const chain = resolveChain(c.req.param('chain'))
    if (!chain) return c.json(unknownChain, 404)
    const address = c.req.param('address')
    const row = await repository.token(chain.id, address)
    if (!row) return c.json({ error: 'unknown token', chainId: chain.id, address }, 404)
    const [rows, events] = await Promise.all([
      repository.reconciliations(chain.id, address),
      repository.multiplierEvents(chain.id, address),
    ])
    return c.json(
      buildYieldLedger({
        token: {
          chainId: row.chainId,
          address: row.address,
          symbol: row.symbol,
          decimals: row.decimals,
          issuer: row.issuer,
          uiMultiplier: row.uiMultiplier,
          sampledAt: row.sampledAt,
          feedProxy: row.feedProxy,
          feedVerified: row.feedVerified,
        },
        reconciliations: rows,
        events,
        scan: { fromBlock: SCAN_FROM_BLOCK, throughBlock: SCAN_THROUGH_BLOCK, scannedAt: SCANNED_AT },
        nowSeconds: now(),
        matchWindowDays: MATCH_WINDOW_DAYS,
      }),
    )
  })

  /**
   * What is owed and has not arrived, for one token: the change already
   * announced on chain, and every dividend the issuer has declared that the
   * multiplier has not yet reflected - including the ones the issuer's own feed
   * marks completed.
   */
  app.get('/v1/:chain/tokens/:address/pending', async (c) => {
    const chain = resolveChain(c.req.param('chain'))
    if (!chain) return c.json(unknownChain, 404)
    const address = c.req.param('address')
    const row = await repository.token(chain.id, address)
    if (!row) return c.json({ error: 'unknown token', chainId: chain.id, address }, 404)
    const [rows, events] = await Promise.all([
      repository.reconciliations(chain.id, address),
      repository.multiplierEvents(chain.id, address),
    ])
    return c.json(
      buildPendingView({
        token: {
          chainId: row.chainId,
          address: row.address,
          symbol: row.symbol,
          decimals: row.decimals,
          issuer: row.issuer,
          uiMultiplier: row.uiMultiplier,
          newUIMultiplier: row.newUIMultiplier,
          effectiveAt: row.effectiveAt,
          oraclePaused: row.oraclePaused,
          sampledAt: row.sampledAt,
          feedProxy: row.feedProxy,
          feedVerified: row.feedVerified,
          feedDecimals: row.feedDecimals,
          feedAnswer: row.feedAnswer,
          feedUpdatedAt: row.feedUpdatedAt,
        },
        reconciliations: rows,
        events,
        nowSeconds: now(),
        matchWindowDays: MATCH_WINDOW_DAYS,
      }),
    )
  })

  app.get('/v1/:chain/events', async (c) => {
    const chain = resolveChain(c.req.param('chain'))
    if (!chain) return c.json(unknownChain, 404)
    const nowSeconds = now()
    const events = await repository.multiplierEvents(chain.id)
    return c.json({
      chainId: chain.id,
      count: events.length,
      events: events.map((event) => serializeMultiplierEvent(event, nowSeconds)),
    })
  })

  /**
   * Every declared corporate action against the multiplier step it produced.
   *
   * `?status=` filters; `?token=` narrows to one address. The counts are always
   * returned in full so that a filtered view cannot read as the whole picture.
   */
  app.get('/v1/:chain/reconciliations', async (c) => {
    const chain = resolveChain(c.req.param('chain'))
    if (!chain) return c.json(unknownChain, 404)
    const all = await repository.reconciliations(chain.id)
    const token = c.req.query('token')
    const status = c.req.query('status')
    const rows = all.filter(
      (row) =>
        (token === undefined || row.token?.toLowerCase() === token.toLowerCase()) &&
        (status === undefined || row.status === status),
    )
    const tally = (value: string) => all.filter((row) => row.status === value).length
    return c.json({
      chainId: chain.id,
      counts: {
        total: all.length,
        matched: tally('matched'),
        anomaly: tally('anomaly'),
        pending: tally('pending'),
        unmatched: tally('unmatched'),
        unsupportedActionType: tally('unsupported_action_type'),
      },
      returned: rows.length,
      reconciliations: rows.map(serializeReconciliation),
    })
  })

  /**
   * Feed health for every token that has a feed, plus an explicit count of the
   * ones that do not. A caller must be able to see that most Stock Tokens have
   * no oracle at all rather than infer it from a short list.
   */
  /**
   * The outbox: what exdate has noticed, and what came of each delivery.
   *
   * Events are recorded whether or not an endpoint is configured, so this is a
   * usable event log on its own - and the honest answer to "did you send it?".
   */
  app.get('/v1/:chain/webhooks/events', async (c) => {
    const chain = resolveChain(c.req.param('chain'))
    if (!chain) return c.json(unknownChain, 404)
    const [events, deliveries] = await Promise.all([
      repository.webhookEvents(chain.id),
      repository.webhookDeliveries(chain.id),
    ])
    const type = c.req.query('type')
    const status = c.req.query('status')
    const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500)

    const byEvent = new Map<string, typeof deliveries>()
    for (const delivery of deliveries) {
      const bucket = byEvent.get(delivery.eventId)
      if (bucket) bucket.push(delivery)
      else byEvent.set(delivery.eventId, [delivery])
    }

    const filtered = events.filter(
      (event) =>
        (type === undefined || event.type === type) &&
        (status === undefined || (byEvent.get(event.id) ?? []).some((row) => row.status === status)),
    )
    const tally = (value: string) => deliveries.filter((row) => row.status === value).length
    return c.json({
      chainId: chain.id,
      counts: {
        events: events.length,
        deliveries: deliveries.length,
        queued: tally('queued'),
        delivered: tally('delivered'),
        failed: tally('failed'),
      },
      endpointsConfigured: webhookEndpointsConfigured,
      returned: Math.min(filtered.length, limit),
      events: filtered
        .slice(0, limit)
        .map((event) => serializeWebhookEvent(event, byEvent.get(event.id) ?? [])),
    })
  })

  app.get('/v1/status', async (c) => {
    const nowSeconds = now()
    const chains = await Promise.all(
      Object.values(CHAINS).map(async (chain) => {
        const rows = await repository.tokens(chain.id)
        const withFeed = rows.filter((row) => row.feedProxy !== null)
        const feeds = withFeed.map((row) => {
          const health = feedHealth({
            updatedAt: row.feedUpdatedAt ?? undefined,
            nowSeconds,
            oraclePaused: row.oraclePaused ?? undefined,
          })
          return {
            symbol: row.symbol,
            token: row.address,
            feed: row.feedProxy,
            verified: row.feedVerified,
            status: health.status,
            // `?? null`: JSON.stringify drops an undefined key, and a missing
            // field reads as "not part of the shape" rather than "not observed".
            ageSeconds: health.ageSeconds ?? null,
            beyondHeartbeat: health.beyondHeartbeat ?? null,
            updatedAt:
              row.feedUpdatedAt === null ? null : new Date(Number(row.feedUpdatedAt) * 1000).toISOString(),
          }
        })
        const tally = (status: string) => feeds.filter((feed) => feed.status === status).length
        return {
          chainId: chain.id,
          name: chain.name,
          tokens: rows.length,
          tokensWithFeed: withFeed.length,
          tokensWithoutFeed: rows.length - withFeed.length,
          live: tally('live'),
          stale: tally('stale'),
          paused: tally('paused'),
          unknown: tally('unknown'),
          feeds,
        }
      }),
    )
    return c.json({ observedAt: new Date(Number(nowSeconds) * 1000).toISOString(), chains })
  })

  /**
   * Upcoming corporate actions from the issuer, plus multiplier changes that
   * are genuinely pending on chain. Two different horizons: the issuer's list
   * runs weeks ahead, the on-chain schedule about nine minutes.
   */
  app.get('/v1/calendar', async (c) => {
    const nowSeconds = now()
    const chains = await Promise.all(
      Object.values(CHAINS).map(async (chain) => {
        const [actions, rows] = await Promise.all([
          repository.corporateActions(chain.id),
          repository.tokens(chain.id),
        ])
        const upcoming = actions
          .filter((action) => action.status === 'CORPORATE_ACTION_STATUS_IN_PROGRESS')
          .sort((a, b) => (a.processDate ?? '').localeCompare(b.processDate ?? ''))
        const scheduledOnchain = rows
          .filter(
            (row) =>
              row.effectiveAt !== null &&
              row.newUIMultiplier !== null &&
              row.uiMultiplier !== null &&
              row.effectiveAt > nowSeconds &&
              row.newUIMultiplier !== row.uiMultiplier,
          )
          .map((row) => serializeToken(row, { nowSeconds, explorerUrl: chain.explorerUrl }))
        return {
          chainId: chain.id,
          upcomingCorporateActions: upcoming.map(serializeCorporateAction),
          scheduledMultiplierUpdates: scheduledOnchain,
        }
      }),
    )
    return c.json({ observedAt: new Date(Number(nowSeconds) * 1000).toISOString(), chains })
  })

  return app
}
