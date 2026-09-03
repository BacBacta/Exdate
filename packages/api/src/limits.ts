/**
 * API keys and per-minute quotas, in front of every route but /v1/health.
 *
 * The operator hands out keys in `EXDATE_API_KEYS`:
 *
 *   EXDATE_API_KEYS="k_live_abc:acme:600,k_live_def:curator-x:6000"
 *
 * as `key:label:requestsPerMinute`; the quota is optional and falls back to
 * `EXDATE_KEY_RPM` (default 600). Callers without a key share an anonymous
 * quota per IP, `EXDATE_ANON_RPM` (default 60). No key means the API is open
 * at the anonymous rate; an unknown key is refused, never silently downgraded,
 * because a paying caller must find out about a typo from a 401, not from a
 * quota that looks smaller than promised.
 *
 * Counting is a fixed one-minute window per identity, in memory: one process
 * serves this API and the dataset is a few hundred rows, so a shared store
 * would be machinery for a problem this deployment does not have. The clock
 * is injectable so the window is testable.
 */

export interface ApiKey {
  key: string
  label: string
  requestsPerMinute: number
}

export interface LimitsConfig {
  keys: ApiKey[]
  anonymousRequestsPerMinute: number
}

export interface LimitsEnv {
  EXDATE_API_KEYS?: string
  EXDATE_ANON_RPM?: string
  EXDATE_KEY_RPM?: string
}

const positiveInt = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** Parses the operator's environment. A malformed entry throws at boot rather than admitting nobody. */
export function limitsFromEnv(env: LimitsEnv): LimitsConfig {
  const defaultRpm = positiveInt(env.EXDATE_KEY_RPM, 600)
  const keys: ApiKey[] = []
  for (const raw of (env.EXDATE_API_KEYS ?? '').split(',')) {
    const entry = raw.trim()
    if (!entry) continue
    const [key, label, rpm] = entry.split(':')
    if (!key || key.length < 16) throw new Error(`EXDATE_API_KEYS: a key must be at least 16 characters: "${entry}"`)
    if (!label) throw new Error(`EXDATE_API_KEYS: "${key.slice(0, 6)}…" has no label`)
    const requestsPerMinute = rpm === undefined ? defaultRpm : positiveInt(rpm, 0)
    if (requestsPerMinute <= 0) throw new Error(`EXDATE_API_KEYS: "${label}" has a quota that is not a positive integer`)
    if (keys.some((k) => k.key === key)) throw new Error(`EXDATE_API_KEYS: "${label}" repeats a key`)
    keys.push({ key, label, requestsPerMinute })
  }
  return { keys, anonymousRequestsPerMinute: positiveInt(env.EXDATE_ANON_RPM, 60) }
}

export interface Caller {
  tier: 'anonymous' | 'key'
  /** The key's label, or the IP for an anonymous caller. Never the key itself. */
  id: string
  label: string | null
  requestsPerMinute: number
}

export type Decision =
  | { ok: true; caller: Caller; limit: number; remaining: number; resetAt: number }
  | { ok: false; status: 401; error: string }
  | { ok: false; status: 429; caller: Caller; limit: number; resetAt: number; retryAfterSeconds: number }

const WINDOW_MS = 60_000

export class RateLimiter {
  readonly #config: LimitsConfig
  readonly #now: () => number
  readonly #byKey: Map<string, ApiKey>
  readonly #windows = new Map<string, { start: number; count: number }>()

  constructor(config: LimitsConfig, now: () => number = () => Date.now()) {
    this.#config = config
    this.#now = now
    this.#byKey = new Map(config.keys.map((k) => [k.key, k]))
  }

  /** Who is calling, from the presented key (if any) and the client address. */
  identify(presentedKey: string | null, ip: string): Caller | null {
    if (presentedKey) {
      const key = this.#byKey.get(presentedKey)
      if (!key) return null
      return { tier: 'key', id: `key:${key.label}`, label: key.label, requestsPerMinute: key.requestsPerMinute }
    }
    return { tier: 'anonymous', id: `ip:${ip}`, label: null, requestsPerMinute: this.#config.anonymousRequestsPerMinute }
  }

  /** Counts one request against the caller's window and says whether it fits. */
  take(presentedKey: string | null, ip: string): Decision {
    const caller = this.identify(presentedKey, ip)
    if (!caller) return { ok: false, status: 401, error: 'unknown API key' }
    const now = this.#now()
    let window = this.#windows.get(caller.id)
    if (!window || now - window.start >= WINDOW_MS) {
      window = { start: now, count: 0 }
      this.#windows.set(caller.id, window)
    }
    const resetAt = window.start + WINDOW_MS
    if (window.count >= caller.requestsPerMinute) {
      return {
        ok: false,
        status: 429,
        caller,
        limit: caller.requestsPerMinute,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      }
    }
    window.count++
    return { ok: true, caller, limit: caller.requestsPerMinute, remaining: caller.requestsPerMinute - window.count, resetAt }
  }

  /** What a caller has left, without spending a request: for the /v1/me route. */
  peek(presentedKey: string | null, ip: string): Decision {
    const caller = this.identify(presentedKey, ip)
    if (!caller) return { ok: false, status: 401, error: 'unknown API key' }
    const now = this.#now()
    const window = this.#windows.get(caller.id)
    const live = window && now - window.start < WINDOW_MS ? window : { start: now, count: 0 }
    return {
      ok: true,
      caller,
      limit: caller.requestsPerMinute,
      remaining: Math.max(0, caller.requestsPerMinute - live.count),
      resetAt: live.start + WINDOW_MS,
    }
  }

  /** Forgets windows that ended, so a long-running process does not keep every IP it ever saw. */
  sweep(): void {
    const now = this.#now()
    for (const [id, window] of this.#windows) if (now - window.start >= WINDOW_MS) this.#windows.delete(id)
  }
}

/** `Authorization: Bearer <key>` or `X-Api-Key: <key>`; the bearer wins when both are sent. */
export function presentedKey(headers: { get(name: string): string | null | undefined }): string | null {
  const auth = headers.get('authorization')
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim())
    if (match) return match[1]!
  }
  const header = headers.get('x-api-key')
  return header ? header.trim() : null
}

/** The client address as a reverse proxy reports it, else what the socket says. */
export function clientIp(headers: { get(name: string): string | null | undefined }, socketAddress: string | null): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]!.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')
  if (real) return real.trim()
  return socketAddress ?? 'unknown'
}
