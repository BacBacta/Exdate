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
import { RateLimiter, clientIp, presentedKey, type Caller, type LimitsConfig } from './limits.js'
import {
  DEFAULT_SUBSCRIPTION_POLICY,
  SUBSCRIPTION_SECRET_HEADER,
  SignupWindow,
  newSecret,
  newSubscriptionId,
  secretsMatch,
  serializeSubscription,
  serializeSubscriptionCreated,
  serializeSubscriptionStatus,
  validateSubscriptionEvents,
  validateSubscriptionUrl,
  type DeliveryTally,
  type SubscriptionPolicy,
  type SubscriptionStore,
  type TestDeliveryResult,
  type WebhookSubscription,
} from './subscriptions.js'
import type { Repository } from './types.js'

export * from './types.js'
export * from './serialize.js'
export * from './limits.js'
export * from './subscriptions.js'

export interface ApiOptions {
  repository: Repository
  /** Injected so responses are deterministic under test. */
  now?: () => bigint
  /**
   * How many webhook endpoints deliveries go to. The endpoints themselves
   * carry secrets and are never served; the count is what tells an operator
   * whether silence means "nothing happened" or "nobody is listening". A
   * function, because self-service subscriptions change it while the process
   * runs.
   */
  webhookEndpointsConfigured?: number | (() => number)
  /**
   * Where self-service subscriptions are kept. Absent, the subscription
   * routes answer 501 and the catalogue says self-service is off; the
   * operator's own endpoints in EXDATE_WEBHOOK_ENDPOINTS are unaffected.
   */
  subscriptions?: SubscriptionStore
  subscriptionPolicy?: SubscriptionPolicy
  /** Injected so the test delivery can be observed without a network. */
  fetchImpl?: typeof fetch
  /** API keys and quotas; absent means open at the default anonymous rate. See limits.ts. */
  limits?: LimitsConfig
  /** Milliseconds, injected so quota windows are deterministic under test. */
  nowMs?: () => number
  /**
   * The peer address of a request when no proxy header names the client.
   * Depends on the server adapter, so the host injects it; without it every
   * anonymous caller behind the same silence shares one quota.
   */
  clientAddress?: (request: Request) => string | null
}

/** What /v1/me tells a caller about itself. Never the key. */
export interface MeResponse {
  tier: Caller['tier']
  label: string | null
  limitPerMinute: number
  remaining: number
  resetAt: string
  keysConfigured: number
}

export function createApi({
  repository,
  now = () => BigInt(Math.floor(Date.now() / 1000)),
  webhookEndpointsConfigured = 0,
  subscriptions,
  subscriptionPolicy,
  fetchImpl = globalThis.fetch,
  limits = { keys: [], anonymousRequestsPerMinute: 60 },
  nowMs = () => Date.now(),
  clientAddress = () => null,
}: ApiOptions) {
  const app = new Hono<{ Variables: { caller: Caller } }>()
  const limiter = new RateLimiter(limits, nowMs)
  const endpointsConfigured = () =>
    typeof webhookEndpointsConfigured === 'function' ? webhookEndpointsConfigured() : webhookEndpointsConfigured
  const policy = { ...DEFAULT_SUBSCRIPTION_POLICY, ...subscriptionPolicy }
  const signups = new SignupWindow(policy.signupsPerHourPerClient, nowMs)

  app.use('/v1/*', cors())

  /**
   * Keys and quotas, on everything but the liveness route. The headers are
   * the usual three, so a client library can back off without reading the
   * body; a refusal is JSON like every other answer.
   */
  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/health') return next()
    const key = presentedKey(c.req.raw.headers)
    const ip = clientIp(c.req.raw.headers, clientAddress(c.req.raw))
    const decision = c.req.path === '/v1/me' ? limiter.peek(key, ip) : limiter.take(key, ip)
    if (!decision.ok) {
      if (decision.status === 401) return c.json({ error: decision.error }, 401)
      c.header('Retry-After', String(decision.retryAfterSeconds))
      c.header('X-RateLimit-Limit', String(decision.limit))
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', String(Math.ceil(decision.resetAt / 1000)))
      return c.json(
        { error: 'rate limited', limitPerMinute: decision.limit, retryAfterSeconds: decision.retryAfterSeconds },
        429,
      )
    }
    c.set('caller', decision.caller)
    c.header('X-RateLimit-Limit', String(decision.limit))
    c.header('X-RateLimit-Remaining', String(decision.remaining))
    c.header('X-RateLimit-Reset', String(Math.ceil(decision.resetAt / 1000)))
    await next()
  })

  app.get('/v1/me', (c) => {
    const key = presentedKey(c.req.raw.headers)
    const ip = clientIp(c.req.raw.headers, clientAddress(c.req.raw))
    const decision = limiter.peek(key, ip)
    if (!decision.ok) return c.json({ error: 'unknown API key' }, 401)
    const body: MeResponse = {
      tier: decision.caller.tier,
      label: decision.caller.label,
      limitPerMinute: decision.limit,
      remaining: decision.remaining,
      resetAt: new Date(decision.resetAt).toISOString(),
      keysConfigured: limits.keys.length,
    }
    return c.json(body)
  })

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
      endpointsConfigured: endpointsConfigured(),
      /**
       * How to subscribe without the operator: null when this instance keeps
       * no store for it. The limits are stated so a refusal is not a surprise.
       */
      selfService: subscriptions
        ? {
            create: 'POST /v1/webhooks/subscriptions',
            body: { url: 'https://…', events: 'optional array of event types; all of them when omitted', description: 'optional, free text' },
            secretHeader: SUBSCRIPTION_SECRET_HEADER,
            manage: 'GET or DELETE /v1/webhooks/subscriptions/:id, with the secret in that header',
            test: 'POST /v1/webhooks/subscriptions/:id/test replays the most recent recorded event, signed with the subscription secret',
            limits: {
              activePerHost: policy.maxPerHost,
              signupsPerHourPerClient: policy.signupsPerHourPerClient,
              httpsOnly: true,
              publicHostsOnly: !policy.allowPrivate,
            },
          }
        : null,
    }),
  )

  /**
   * Self-service subscriptions. The secret is shown once, at creation, and
   * from then on identifies the subscriber: the same secret that signs the
   * deliveries reads the subscription back, revokes it and asks for a test.
   * A wrong secret and an unknown id answer alike, so the ids do not
   * enumerate.
   */
  const notEnabled = { error: 'self-service subscriptions are not enabled on this instance', see: 'GET /v1/webhooks' }
  const findOwned = async (c: { req: { param(name: string): string; raw: Request } }): Promise<WebhookSubscription | null> => {
    const presented = c.req.raw.headers.get(SUBSCRIPTION_SECRET_HEADER)
    const rows = await subscriptions!.list()
    const row = rows.find((candidate) => candidate.id === c.req.param('id'))
    return row && secretsMatch(presented, row.secret) ? row : null
  }
  const unknownSubscription = { error: 'unknown subscription, or wrong secret', secretHeader: SUBSCRIPTION_SECRET_HEADER }

  app.post('/v1/webhooks/subscriptions', async (c) => {
    if (!subscriptions) return c.json(notEnabled, 501)
    let body: Record<string, unknown>
    try {
      const parsed: unknown = await c.req.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return c.json({ error: 'body must be a JSON object' }, 400)
      body = parsed as Record<string, unknown>
    } catch {
      return c.json({ error: 'body must be JSON' }, 400)
    }
    const url = validateSubscriptionUrl(body.url, policy)
    if (!url.ok) return c.json({ error: url.error }, 400)
    const events = validateSubscriptionEvents(body.events)
    if (!events.ok) return c.json({ error: events.error }, 400)
    const description = body.description === undefined || body.description === null ? null : body.description
    if (description !== null && (typeof description !== 'string' || description.length > policy.maxDescriptionLength)) {
      return c.json({ error: `description must be a string of at most ${policy.maxDescriptionLength} characters` }, 400)
    }
    const client = clientIp(c.req.raw.headers, clientAddress(c.req.raw))
    if (!signups.take(client)) {
      c.header('Retry-After', '3600')
      return c.json({ error: `at most ${policy.signupsPerHourPerClient} signups per hour per client` }, 429)
    }
    const active = (await subscriptions.list()).filter((row) => row.revokedAt === null)
    if (active.length >= policy.maxTotal) return c.json({ error: 'this instance holds as many subscriptions as it will' }, 503)
    if (active.filter((row) => new URL(row.url).host === url.url.host).length >= policy.maxPerHost) {
      return c.json({ error: `at most ${policy.maxPerHost} active subscriptions per host; revoke one first` }, 409)
    }
    const subscription: WebhookSubscription = {
      id: newSubscriptionId(),
      url: url.url.toString(),
      secret: newSecret(),
      events: events.events,
      description,
      createdAt: new Date(Number(now()) * 1000).toISOString(),
      createdFrom: client,
      revokedAt: null,
    }
    await subscriptions.create(subscription)
    return c.json(serializeSubscriptionCreated(subscription), 201)
  })

  app.get('/v1/webhooks/subscriptions/:id', async (c) => {
    if (!subscriptions) return c.json(notEnabled, 501)
    const row = await findOwned(c)
    if (!row) return c.json(unknownSubscription, 404)
    // What the outbox did for this endpoint, across every chain, as counts.
    const tally: DeliveryTally = { queued: 0, delivered: 0, failed: 0, lastDeliveredAt: null }
    for (const chain of Object.values(CHAINS)) {
      for (const delivery of await repository.webhookDeliveries(chain.id)) {
        if (delivery.endpointId !== row.id) continue
        if (delivery.status === 'queued') tally.queued++
        else if (delivery.status === 'delivered') tally.delivered++
        else if (delivery.status === 'failed') tally.failed++
        if (delivery.deliveredAt !== null) {
          const at = new Date(Number(delivery.deliveredAt) * 1000).toISOString()
          if (tally.lastDeliveredAt === null || at > tally.lastDeliveredAt) tally.lastDeliveredAt = at
        }
      }
    }
    return c.json(serializeSubscriptionStatus(row, tally))
  })

  app.delete('/v1/webhooks/subscriptions/:id', async (c) => {
    if (!subscriptions) return c.json(notEnabled, 501)
    const row = await findOwned(c)
    if (!row) return c.json(unknownSubscription, 404)
    const at = new Date(Number(now()) * 1000).toISOString()
    const revoked = await subscriptions.revoke(row.id, at)
    const tally: DeliveryTally = { queued: 0, delivered: 0, failed: 0, lastDeliveredAt: null }
    return c.json({ ...serializeSubscriptionStatus({ ...row, revokedAt: row.revokedAt ?? at }, tally), revokedNow: revoked })
  })

  /**
   * A test delivery: the most recent event actually recorded, signed with
   * this subscription's secret and sent now, so a subscriber sees a real
   * payload of a real type reach its handler before the next event does.
   */
  app.post('/v1/webhooks/subscriptions/:id/test', async (c) => {
    if (!subscriptions) return c.json(notEnabled, 501)
    const row = await findOwned(c)
    if (!row) return c.json(unknownSubscription, 404)
    if (row.revokedAt) return c.json({ error: 'subscription is revoked' }, 409)
    const chain = resolveChain(c.req.query('chain') ?? 'robinhood')
    if (!chain) return c.json(unknownChain, 404)
    const event = (await repository.webhookEvents(chain.id)).find(
      (candidate) => row.events === null || (row.events as string[]).includes(candidate.type),
    )
    if (!event) return c.json({ error: 'nothing recorded yet that this subscription would receive; there is nothing to replay' }, 409)
    const sentAt = now()
    const delivery = `test|${row.id}|${event.id}`
    const { signBody } = await import('@exdate/core')
    const signature = await signBody({ secret: row.secret, timestamp: sentAt, body: event.payload })
    const report = (result: TestDeliveryResult) => c.json(result)
    try {
      const response = await fetchImpl(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'exdate-webhooks/1',
          [WEBHOOK_EVENT_HEADER]: event.type,
          [WEBHOOK_EVENT_ID_HEADER]: event.id,
          [WEBHOOK_DELIVERY_HEADER]: delivery,
          [WEBHOOK_SIGNATURE_HEADER]: signature,
        },
        body: event.payload,
        signal: AbortSignal.timeout(10_000),
      })
      return report({
        ok: response.ok,
        eventId: event.id,
        type: event.type,
        delivery,
        responseStatus: response.status,
        error: response.ok ? null : `HTTP ${response.status}`,
        sentAt: new Date(Number(sentAt) * 1000).toISOString(),
      })
    } catch (error) {
      return report({
        ok: false,
        eventId: event.id,
        type: event.type,
        delivery,
        responseStatus: null,
        error: (error as Error).message.slice(0, 200),
        sentAt: new Date(Number(sentAt) * 1000).toISOString(),
      })
    }
  })

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
      endpointsConfigured: endpointsConfigured(),
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
