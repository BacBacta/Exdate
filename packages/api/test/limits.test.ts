import { describe, expect, it } from 'vitest'
import { RateLimiter, clientIp, limitsFromEnv, presentedKey } from '../src/limits.js'

const headers = (entries: Record<string, string>) => ({ get: (name: string) => entries[name.toLowerCase()] ?? null })

describe('limitsFromEnv', () => {
  it('reads keys with their labels and quotas, and the anonymous quota', () => {
    const config = limitsFromEnv({
      EXDATE_API_KEYS: 'k_live_0123456789abcdef:acme:600, k_live_fedcba9876543210:curator',
      EXDATE_ANON_RPM: '30',
      EXDATE_KEY_RPM: '1200',
    })
    expect(config.anonymousRequestsPerMinute).toBe(30)
    expect(config.keys).toEqual([
      { key: 'k_live_0123456789abcdef', label: 'acme', requestsPerMinute: 600 },
      { key: 'k_live_fedcba9876543210', label: 'curator', requestsPerMinute: 1200 },
    ])
  })

  it('defaults to open at 60 anonymous requests a minute', () => {
    expect(limitsFromEnv({})).toEqual({ keys: [], anonymousRequestsPerMinute: 60 })
  })

  it('refuses a short key, a missing label, a bad quota and a repeated key', () => {
    expect(() => limitsFromEnv({ EXDATE_API_KEYS: 'short:acme' })).toThrow(/at least 16/)
    expect(() => limitsFromEnv({ EXDATE_API_KEYS: 'k_live_0123456789abcdef' })).toThrow(/no label/)
    expect(() => limitsFromEnv({ EXDATE_API_KEYS: 'k_live_0123456789abcdef:acme:lots' })).toThrow(/positive integer/)
    expect(() =>
      limitsFromEnv({ EXDATE_API_KEYS: 'k_live_0123456789abcdef:acme,k_live_0123456789abcdef:other' }),
    ).toThrow(/repeats/)
  })
})

describe('RateLimiter', () => {
  const config = limitsFromEnv({ EXDATE_API_KEYS: 'k_live_0123456789abcdef:acme:3', EXDATE_ANON_RPM: '2' })

  it('counts a keyed caller against its own quota and resets after a minute', () => {
    let now = 1_000_000
    const limiter = new RateLimiter(config, () => now)
    const key = 'k_live_0123456789abcdef'
    expect(limiter.take(key, '1.1.1.1')).toMatchObject({ ok: true, remaining: 2, limit: 3, caller: { tier: 'key', label: 'acme' } })
    limiter.take(key, '1.1.1.1')
    expect(limiter.take(key, '1.1.1.1')).toMatchObject({ ok: true, remaining: 0 })
    const refused = limiter.take(key, '1.1.1.1')
    expect(refused).toMatchObject({ ok: false, status: 429, limit: 3, retryAfterSeconds: 60 })
    now += 60_000
    expect(limiter.take(key, '1.1.1.1')).toMatchObject({ ok: true, remaining: 2 })
  })

  it('gives anonymous callers a quota per IP and never mixes two IPs', () => {
    const limiter = new RateLimiter(config, () => 0)
    expect(limiter.take(null, '1.1.1.1')).toMatchObject({ ok: true, remaining: 1, caller: { tier: 'anonymous', id: 'ip:1.1.1.1' } })
    expect(limiter.take(null, '1.1.1.1')).toMatchObject({ ok: true, remaining: 0 })
    expect(limiter.take(null, '1.1.1.1')).toMatchObject({ ok: false, status: 429 })
    expect(limiter.take(null, '2.2.2.2')).toMatchObject({ ok: true, remaining: 1 })
  })

  it('refuses an unknown key outright rather than treating it as anonymous', () => {
    const limiter = new RateLimiter(config, () => 0)
    expect(limiter.take('k_live_not_a_real_key_00', '1.1.1.1')).toEqual({ ok: false, status: 401, error: 'unknown API key' })
  })

  it('peeks without spending, and sweeps windows that ended', () => {
    let now = 0
    const limiter = new RateLimiter(config, () => now)
    limiter.take(null, '1.1.1.1')
    expect(limiter.peek(null, '1.1.1.1')).toMatchObject({ ok: true, remaining: 1 })
    expect(limiter.peek(null, '1.1.1.1')).toMatchObject({ ok: true, remaining: 1 })
    now = 60_001
    limiter.sweep()
    expect(limiter.peek(null, '1.1.1.1')).toMatchObject({ ok: true, remaining: 2 })
  })
})

describe('request headers', () => {
  it('reads the bearer token first, then X-Api-Key', () => {
    expect(presentedKey(headers({ authorization: 'Bearer k_live_0123456789abcdef' }))).toBe('k_live_0123456789abcdef')
    expect(presentedKey(headers({ authorization: 'bearer   k_live_0123456789abcdef ' }))).toBe('k_live_0123456789abcdef')
    expect(presentedKey(headers({ 'x-api-key': ' k_live_0123456789abcdef ' }))).toBe('k_live_0123456789abcdef')
    expect(presentedKey(headers({ authorization: 'Basic abc', 'x-api-key': 'k_live_0123456789abcdef' }))).toBe('k_live_0123456789abcdef')
    expect(presentedKey(headers({}))).toBeNull()
  })

  it('takes the first hop of X-Forwarded-For, then X-Real-IP, then the socket', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }), '127.0.0.1')).toBe('9.9.9.9')
    expect(clientIp(headers({ 'x-real-ip': '8.8.8.8' }), '127.0.0.1')).toBe('8.8.8.8')
    expect(clientIp(headers({}), '127.0.0.1')).toBe('127.0.0.1')
    expect(clientIp(headers({}), null)).toBe('unknown')
  })
})
