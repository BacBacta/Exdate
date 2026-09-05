import {
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  verifySignature,
} from '@exdate/core/webhooks'
import type { AnyWebhookEnvelope, VerificationFailure, WebhookEventType } from '@exdate/core/webhooks'
import type {
  CalendarResponse,
  ChainsResponse,
  EventsResponse,
  HealthResponse,
  PendingView,
  ReconciliationsResponse,
  StatusResponse,
  TokenResponse,
  TokenView,
  TokensResponse,
  WebhookCatalogue,
  WebhookOutboxResponse,
  WebhookSubscriptionCreated,
  WebhookSubscriptionStatus,
  WebhookTestResult,
  YieldLedger,
  MeResponse,
} from './types.js'

export * from './types.js'
export {
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  signBody,
  verifySignature,
  webhookEventId,
} from '@exdate/core/webhooks'
export type {
  AnyWebhookEnvelope,
  VerificationFailure,
  WebhookData,
  WebhookDataFor,
  WebhookEnvelope,
  WebhookEventType,
} from '@exdate/core/webhooks'

/**
 * The exdate client.
 *
 * A thin, typed layer over the REST API and the webhook verifier - nothing is
 * computed here. Every number a method returns traces back to a log, a view
 * call or the issuer's own feed, and the shapes keep the API's two rules: a
 * bigint is a decimal string, and anything unobserved is `null`.
 *
 * The webhook verifier is not a reimplementation: it is the same function the
 * sender signs with, imported from `@exdate/core/webhooks`, which has no
 * dependencies of its own.
 */

export interface ClientOptions {
  /** The host the indexer runs on, e.g. `http://localhost:42069`. A trailing slash is fine. */
  baseUrl: string
  /** Sent as `Authorization: Bearer …`. Without it the anonymous quota applies. */
  apiKey?: string
  /** Chain key or id. Defaults to `robinhood`; every route accepts either. */
  chain?: string | number
  /** Injected for tests, proxies, or a runtime whose fetch needs options. */
  fetch?: typeof globalThis.fetch
  /** Sent on every request. */
  headers?: Record<string, string>
  /** Per-request timeout. Defaults to 15 s; pass 0 to disable. */
  timeoutMs?: number
}

/**
 * A non-2xx answer, or a body that was not JSON.
 *
 * `status` and `body` are kept so a caller can tell "this token does not exist"
 * (404) from "the indexer is down" without parsing a message.
 */
export class ExdateError extends Error {
  readonly status: number
  readonly url: string
  readonly body: unknown

  constructor(message: string, options: { status: number; url: string; body: unknown }) {
    super(message)
    this.name = 'ExdateError'
    this.status = options.status
    this.url = options.url
    this.body = options.body
  }

  /** True when the chain or the token is unknown to this deployment. */
  get isNotFound(): boolean {
    return this.status === 404
  }
}

type Query = Record<string, string | number | undefined>

/**
 * Spelled out rather than inferred: a declaration build must be able to name
 * every type here without reaching into core's private module paths, and a
 * consumer reading the SDK's types should see the routes, not the plumbing.
 */
export interface ExdateClient {
  /** The configured chain, resolved the way every route resolves it. */
  readonly chain: string
  health(): Promise<HealthResponse>
  chains(): Promise<ChainsResponse>
  /** Every token: multiplier, any scheduled change, and feed state. */
  tokens(): Promise<TokensResponse>
  /** One token plus its full announcement history. Throws a 404 ExdateError if unknown. */
  token(address: string): Promise<TokenResponse>
  /** The same, but `null` instead of throwing when the token is unknown. */
  tokenOrNull(address: string): Promise<TokenResponse | null>
  /** Every multiplier announcement, newest first. */
  events(): Promise<EventsResponse>
  /** Declared corporate actions against the multiplier steps they produced. */
  reconciliations(query?: { token?: string; status?: string }): Promise<ReconciliationsResponse>
  /**
   * The distribution ledger for one token: per-payment gross, received and
   * haircut. Not a rate - see `notComputed` in the response for what it
   * refuses to compute and why.
   */
  yield(address: string): Promise<YieldLedger>
  /** What is owed and has not arrived: announced on chain, or declared and absent. */
  pending(address: string): Promise<PendingView>
  /** Feed health across every chain, plus how many tokens have no feed at all. */
  status(): Promise<StatusResponse>
  /** Upcoming issuer actions, and changes genuinely pending on chain. */
  calendar(): Promise<CalendarResponse>
  /** The caller's tier and what is left of its quota; not counted against it. */
  me(): Promise<MeResponse>
  webhooks: {
    /** The event catalogue, the signing scheme and the retry schedule. */
    catalogue(): Promise<WebhookCatalogue>
    /** The outbox: what was noticed, and what each delivery did. */
    events(query?: { type?: string; status?: string; limit?: number }): Promise<WebhookOutboxResponse>
    subscribe(input: SubscribeInput): Promise<WebhookSubscriptionCreated>
    subscription(id: string, secret: string): Promise<WebhookSubscriptionStatus>
    unsubscribe(id: string, secret: string): Promise<WebhookSubscriptionStatus>
    test(id: string, secret: string): Promise<WebhookTestResult>
    verify: typeof verifyWebhook
    parse: typeof parseWebhook
    fromRequest: typeof webhookFromRequest
  }
}

export function createClient(options: ClientOptions): ExdateClient {
  const base = options.baseUrl.replace(/\/+$/, '')
  const chain = String(options.chain ?? 'robinhood')
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  const url = (path: string, query?: Query) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) search.set(key, String(value))
    }
    const suffix = search.size > 0 ? `?${search}` : ''
    return `${base}${path}${suffix}`
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    extra: { query?: Query; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const target = url(path, extra.query)
    const response = await doFetch(target, {
      method,
      headers: {
        accept: 'application/json',
        ...(extra.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        ...options.headers,
        ...extra.headers,
      },
      ...(extra.body !== undefined ? { body: JSON.stringify(extra.body) } : {}),
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    })
    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // Left as text: an HTML error page from a proxy is more useful in the
      // error than a parse failure that hides it.
    }
    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : response.statusText
      throw new ExdateError(`${response.status} ${detail}`, { status: response.status, url: target, body })
    }
    if (typeof body === 'string') {
      throw new ExdateError('response was not JSON', { status: response.status, url: target, body })
    }
    return body as T
  }
  const get = <T,>(path: string, query?: Query) => request<T>('GET', path, { query })
  /** The subscription secret travels in its own header: `Authorization` carries API keys. */
  const owned = (secret: string) => ({ [SUBSCRIPTION_SECRET_HEADER]: secret })

  return {
    /** The configured chain, resolved the way every route resolves it. */
    chain,

    health: () => get<HealthResponse>('/v1/health'),
    chains: () => get<ChainsResponse>('/v1/chains'),

    /** Every token: multiplier, any scheduled change, and feed state. */
    tokens: () => get<TokensResponse>(`/v1/${chain}/tokens`),
    /** One token plus its full announcement history. Throws a 404 ExdateError if unknown. */
    token: (address: string) => get<TokenResponse>(`/v1/${chain}/tokens/${address}`),
    /** The same, but `null` instead of throwing when the token is unknown. */
    async tokenOrNull(address: string): Promise<TokenResponse | null> {
      try {
        return await get<TokenResponse>(`/v1/${chain}/tokens/${address}`)
      } catch (error) {
        if (error instanceof ExdateError && error.isNotFound) return null
        throw error
      }
    },

    /** Every multiplier announcement, newest first. */
    events: () => get<EventsResponse>(`/v1/${chain}/events`),

    /** Declared corporate actions against the multiplier steps they produced. */
    reconciliations: (query?: { token?: string; status?: string }) =>
      get<ReconciliationsResponse>(`/v1/${chain}/reconciliations`, query),

    /**
     * The distribution ledger for one token: per-payment gross, received and
     * haircut. Not a rate - see `notComputed` in the response for what it
     * refuses to compute and why.
     */
    yield: (address: string) => get<YieldLedger>(`/v1/${chain}/tokens/${address}/yield`),

    /** What is owed and has not arrived: announced on chain, or declared and absent. */
    pending: (address: string) => get<PendingView>(`/v1/${chain}/tokens/${address}/pending`),

    /** Feed health across every chain, plus how many tokens have no feed at all. */
    status: () => get<StatusResponse>('/v1/status'),
    /** Upcoming issuer actions, and changes genuinely pending on chain. */
    calendar: () => get<CalendarResponse>('/v1/calendar'),
    /** The caller's tier and what is left of its quota; not counted against it. */
    me: () => get<MeResponse>('/v1/me'),

    webhooks: {
      /** The event catalogue, the signing scheme and the retry schedule. */
      catalogue: () => get<WebhookCatalogue>('/v1/webhooks'),
      /** The outbox: what was noticed, and what each delivery did. */
      events: (query?: { type?: string; status?: string; limit?: number }) =>
        get<WebhookOutboxResponse>(`/v1/${chain}/webhooks/events`, query),
      /**
       * Subscribe an https endpoint. The answer carries the secret ONCE: it signs
       * every delivery and is what reads, tests and revokes the subscription.
       * Throws a 501 ExdateError on an instance that keeps no subscription store.
       */
      subscribe: (input: SubscribeInput) => request<WebhookSubscriptionCreated>('POST', '/v1/webhooks/subscriptions', { body: input }),
      /** The subscription and what the outbox did for it. 404 for a wrong secret and an unknown id alike. */
      subscription: (id: string, secret: string) =>
        request<WebhookSubscriptionStatus>('GET', `/v1/webhooks/subscriptions/${id}`, { headers: owned(secret) }),
      /** Revoke. Deliveries stop with the next poll; the record stays, marked revoked. */
      unsubscribe: (id: string, secret: string) =>
        request<WebhookSubscriptionStatus>('DELETE', `/v1/webhooks/subscriptions/${id}`, { headers: owned(secret) }),
      /** Replay the most recent recorded event to the endpoint, signed with the secret, and report what it answered. */
      test: (id: string, secret: string) =>
        request<WebhookTestResult>('POST', `/v1/webhooks/subscriptions/${id}/test`, { query: { chain }, headers: owned(secret) }),
      verify: verifyWebhook,
      parse: parseWebhook,
      fromRequest: webhookFromRequest,
    },
  }
}


/** The header a subscription secret travels in; the same string the API serves in its catalogue. */
export const SUBSCRIPTION_SECRET_HEADER = 'x-exdate-subscription-secret'

export interface SubscribeInput {
  /** https only, on a public host. */
  url: string
  /** Omitted means every event type. */
  events?: WebhookEventType[]
  description?: string
}

export interface VerifyInput {
  /** One secret, or several while rotating. */
  secret: string | readonly string[]
  /** The value of the `exdate-signature` header. */
  header: string | null | undefined
  /** The RAW request body. Not a re-serialised object: the bytes are what is signed. */
  body: string
  /** Defaults to the current clock. */
  nowSeconds?: number
  /** Defaults to 300 s, the window the sender advertises. */
  toleranceSeconds?: number
}

/** Verify a delivery. Returns the reason on failure rather than throwing. */
export function verifyWebhook(input: VerifyInput) {
  return verifySignature({
    secret: input.secret,
    header: input.header,
    body: input.body,
    nowSeconds: input.nowSeconds ?? Math.floor(Date.now() / 1000),
    ...(input.toleranceSeconds === undefined ? {} : { toleranceSeconds: input.toleranceSeconds }),
  })
}

export type ParsedWebhook =
  | { ok: true; event: AnyWebhookEnvelope }
  | { ok: false; reason: VerificationFailure | 'invalid_json' }

/**
 * Verify, then parse into an envelope discriminated on `type` - so narrowing on
 * the type narrows `data` with it.
 *
 * Verification happens first, on the raw body, and a body that fails is never
 * parsed: an unverified payload should not reach application code at all.
 */
export async function parseWebhook(input: VerifyInput): Promise<ParsedWebhook> {
  const result = await verifyWebhook(input)
  if (!result.valid) return { ok: false, reason: result.reason }
  try {
    return { ok: true, event: JSON.parse(input.body) as AnyWebhookEnvelope }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

/**
 * The same, straight from a Fetch API `Request` - the shape most runtimes hand
 * a webhook handler.
 *
 * Reads the body itself, because verification needs the exact bytes: a handler
 * that calls `request.json()` first has already lost them.
 */
export async function webhookFromRequest(
  request: Request,
  options: { secret: string | readonly string[]; nowSeconds?: number; toleranceSeconds?: number },
): Promise<ParsedWebhook> {
  const body = await request.text()
  return parseWebhook({
    secret: options.secret,
    header: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
    body,
    ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
    ...(options.toleranceSeconds === undefined ? {} : { toleranceSeconds: options.toleranceSeconds }),
  })
}

/** Header names a consumer may want without importing the constants. */
export const WEBHOOK_HEADERS = {
  signature: WEBHOOK_SIGNATURE_HEADER,
  event: WEBHOOK_EVENT_HEADER,
  eventId: WEBHOOK_EVENT_ID_HEADER,
} as const

/**
 * Underlying shares per raw token, the ERC-8056 identity, for a `TokenView`.
 *
 * The one calculation this package does, because every consumer needs it and
 * getting it backwards is the classic mistake. Returns null when the token has
 * not been polled - never a default of 1.0.
 */
export function underlyingSharesPerToken(token: TokenView): number | null {
  const current = token.multiplier.current
  return current === null ? null : Number(current) / 1e18
}
