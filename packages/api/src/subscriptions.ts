import type { WebhookEndpoint, WebhookEventType } from '@exdate/core'
import { WEBHOOK_EVENTS } from '@exdate/core'

/**
 * Self-service webhook subscriptions.
 *
 * Endpoints configured by the operator live in `EXDATE_WEBHOOK_ENDPOINTS` and
 * never in a table the API serves. A subscription made through the API is the
 * same thing - a URL and a secret that must never be served - so it lives in a
 * store the host injects (a file on the machine, see the indexer) and only the
 * caller who holds the secret can read it back. The outbox route goes on
 * publishing a host and never a URL.
 *
 * What is refused, and why:
 *   - anything but https, because a signed body over http is a body anyone on
 *     the path can read;
 *   - loopback, link-local and private addresses, because a public API that
 *     will POST to an address of the caller's choosing is otherwise a way to
 *     reach whatever sits next to it (an operator running a private instance
 *     can allow them);
 *   - more than a few subscriptions per host, and more than a few signups per
 *     client per hour, because a subscription costs the operator one request
 *     per event for as long as it stands.
 */
export interface WebhookSubscription {
  id: string
  url: string
  secret: string
  /** Null means every event type. */
  events: WebhookEventType[] | null
  description: string | null
  createdAt: string
  /** The client address the request came from, kept for abuse handling; never served. */
  createdFrom: string
  revokedAt: string | null
}

export interface SubscriptionStore {
  list(): Promise<WebhookSubscription[]>
  /** Rejects a duplicate id. */
  create(subscription: WebhookSubscription): Promise<void>
  /** False when the id is unknown or already revoked. */
  revoke(id: string, at: string): Promise<boolean>
}

/** For tests and for a process that does not care to persist; nothing survives a restart. */
export class MemorySubscriptionStore implements SubscriptionStore {
  private readonly rows = new Map<string, WebhookSubscription>()
  async list() {
    return [...this.rows.values()]
  }
  async create(subscription: WebhookSubscription) {
    if (this.rows.has(subscription.id)) throw new Error(`duplicate subscription id ${subscription.id}`)
    this.rows.set(subscription.id, { ...subscription })
  }
  async revoke(id: string, at: string) {
    const row = this.rows.get(id)
    if (!row || row.revokedAt) return false
    row.revokedAt = at
    return true
  }
}

export interface SubscriptionPolicy {
  /** Accept loopback and private addresses: for an operator's own instance only. */
  allowPrivate?: boolean
  /** Active subscriptions the instance will hold in all. */
  maxTotal?: number
  /** Active subscriptions per host: one consumer does not need many. */
  maxPerHost?: number
  /** Signups per client address per hour. */
  signupsPerHourPerClient?: number
  /** Length of the free-text description. */
  maxDescriptionLength?: number
}

export const DEFAULT_SUBSCRIPTION_POLICY: Required<SubscriptionPolicy> = {
  allowPrivate: false,
  maxTotal: 500,
  maxPerHost: 5,
  signupsPerHourPerClient: 5,
  maxDescriptionLength: 200,
}

/** The header a subscriber presents its secret in. Not `Authorization`, which carries API keys. */
export const SUBSCRIPTION_SECRET_HEADER = 'x-exdate-subscription-secret'

const EVENT_TYPES = new Set<string>(WEBHOOK_EVENTS.map((event) => event.type))

/**
 * Hosts a public instance must not be told to POST to. Literal addresses are
 * checked here; a name that resolves to one of them is not, which is why the
 * policy is a floor and an operator's own network still wants a firewall.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    )
  }
  if (host.includes(':')) {
    // IPv6: loopback, unspecified, link-local, unique-local, and v4-mapped forms.
    if (host === '::1' || host === '::') return true
    if (/^fe[89ab]/i.test(host) || /^f[cd]/i.test(host)) return true
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host)
    if (mapped) return isPrivateHost(mapped[1]!)
    return false
  }
  return false
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string }

export function validateSubscriptionUrl(raw: unknown, policy: { allowPrivate?: boolean } = {}): UrlCheck {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, error: 'url is required' }
  if (raw.length > 2048) return { ok: false, error: 'url is longer than 2048 characters' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'url is not a valid URL' }
  }
  if (url.username || url.password) return { ok: false, error: 'url must not carry credentials' }
  if (url.hash) return { ok: false, error: 'url must not carry a fragment' }
  const privateHost = isPrivateHost(url.hostname)
  if (url.protocol !== 'https:' && !(policy.allowPrivate && url.protocol === 'http:' && privateHost)) {
    return { ok: false, error: 'url must use https' }
  }
  if (privateHost && !policy.allowPrivate) return { ok: false, error: 'url must resolve to a public host' }
  return { ok: true, url }
}

export type EventsCheck = { ok: true; events: WebhookEventType[] | null } | { ok: false; error: string }

export function validateSubscriptionEvents(raw: unknown): EventsCheck {
  if (raw === undefined || raw === null) return { ok: true, events: null }
  if (!Array.isArray(raw)) return { ok: false, error: 'events must be an array of event types' }
  const events: WebhookEventType[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || !EVENT_TYPES.has(entry)) {
      return { ok: false, error: `unknown event type ${JSON.stringify(entry)}; see GET /v1/webhooks` }
    }
    if (!events.includes(entry as WebhookEventType)) events.push(entry as WebhookEventType)
  }
  if (events.length === 0) return { ok: false, error: 'events must name at least one type, or be omitted for all of them' }
  return { ok: true, events }
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const random = (n: number) => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)))

/** `whsec_` and 64 hex characters: 256 bits, and recognisable in a config file. */
export const newSecret = () => `whsec_${random(32)}`
export const newSubscriptionId = () => `sub_${random(12)}`

/** Constant-time on equal lengths; a length mismatch is a mismatch. */
export function secretsMatch(presented: string | null | undefined, expected: string): boolean {
  if (typeof presented !== 'string' || presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/** The endpoint the outbox delivers to, for an active subscription. */
export function subscriptionEndpoint(subscription: WebhookSubscription): WebhookEndpoint {
  return {
    id: subscription.id,
    url: subscription.url,
    secret: subscription.secret,
    ...(subscription.events ? { events: subscription.events } : {}),
  }
}

/** What a subscriber is told about its subscription. Never the secret. */
export function serializeSubscription(subscription: WebhookSubscription) {
  return {
    id: subscription.id,
    url: subscription.url,
    host: new URL(subscription.url).host,
    events: subscription.events,
    description: subscription.description,
    createdAt: subscription.createdAt,
    revokedAt: subscription.revokedAt,
    status: subscription.revokedAt ? ('revoked' as const) : ('active' as const),
  }
}

/** The one answer that carries the secret: the reply to the subscription itself. */
export function serializeSubscriptionCreated(subscription: WebhookSubscription) {
  return {
    ...serializeSubscription(subscription),
    secret: subscription.secret,
    note: 'the secret is shown once: it signs every delivery and is what reads, tests and revokes this subscription.',
    secretHeader: SUBSCRIPTION_SECRET_HEADER,
    verify: 'verifySignature() in @exdate/sdk, over the raw body, with this secret',
  }
}

export interface DeliveryTally {
  queued: number
  delivered: number
  failed: number
  lastDeliveredAt: string | null
}

/** The subscription with what the outbox did for it. */
export function serializeSubscriptionStatus(subscription: WebhookSubscription, deliveries: DeliveryTally) {
  return { ...serializeSubscription(subscription), deliveries }
}

/** A test delivery: the most recent recorded event, replayed now. */
export interface TestDeliveryResult {
  ok: boolean
  eventId: string
  type: string
  delivery: string
  responseStatus: number | null
  error: string | null
  sentAt: string
}

/** Signups per client per hour, in memory: a restart forgives, which is fine for a floor. */
export class SignupWindow {
  private readonly seen = new Map<string, number[]>()
  constructor(
    private readonly perHour: number,
    private readonly nowMs: () => number,
  ) {}
  take(client: string): boolean {
    const now = this.nowMs()
    const recent = (this.seen.get(client) ?? []).filter((at) => now - at < 3_600_000)
    if (recent.length >= this.perHour) {
      this.seen.set(client, recent)
      return false
    }
    recent.push(now)
    this.seen.set(client, recent)
    return true
  }
}
