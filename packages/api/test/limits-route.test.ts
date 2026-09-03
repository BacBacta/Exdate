import { describe, expect, it } from 'vitest'
import { createApi } from '../src/index.js'
import { limitsFromEnv } from '../src/limits.js'
import type { Repository } from '../src/types.js'

/** No route in these tests reads data; the repository can refuse everything. */
const repository = new Proxy({} as Repository, {
  get: () => () => Promise.reject(new Error('not needed')),
})

const KEY = 'k_live_0123456789abcdef'
const api = (nowMs: () => number) =>
  createApi({
    repository,
    limits: limitsFromEnv({ EXDATE_API_KEYS: `${KEY}:acme:2`, EXDATE_ANON_RPM: '1' }),
    nowMs,
    clientAddress: () => '10.0.0.1',
  })

describe('keys and quotas at the routes', () => {
  it('leaves /v1/health open and uncounted', async () => {
    const app = api(() => 0)
    for (let i = 0; i < 5; i++) expect((await app.request('/v1/health')).status).toBe(200)
    const me = await (await app.request('/v1/me')).json()
    expect(me).toMatchObject({ tier: 'anonymous', label: null, limitPerMinute: 1, remaining: 1, keysConfigured: 1 })
  })

  it('counts anonymous callers per IP and answers 429 with the three headers', async () => {
    const app = api(() => 0)
    const first = await app.request('/v1/webhooks', { headers: { 'x-forwarded-for': '9.9.9.9' } })
    expect(first.status).toBe(200)
    expect(first.headers.get('x-ratelimit-limit')).toBe('1')
    expect(first.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(first.headers.get('x-ratelimit-reset')).toBe('60')
    const second = await app.request('/v1/webhooks', { headers: { 'x-forwarded-for': '9.9.9.9' } })
    expect(second.status).toBe(429)
    expect(second.headers.get('retry-after')).toBe('60')
    expect(await second.json()).toEqual({ error: 'rate limited', limitPerMinute: 1, retryAfterSeconds: 60 })
    // another address is another quota
    expect((await app.request('/v1/webhooks', { headers: { 'x-forwarded-for': '8.8.8.8' } })).status).toBe(200)
  })

  it('gives a key its own quota and reports it on /v1/me without spending', async () => {
    let now = 0
    const app = api(() => now)
    const auth = { authorization: `Bearer ${KEY}` }
    expect((await app.request('/v1/webhooks', { headers: auth })).status).toBe(200)
    const me = await (await app.request('/v1/me', { headers: auth })).json()
    expect(me).toMatchObject({ tier: 'key', label: 'acme', limitPerMinute: 2, remaining: 1 })
    expect((await app.request('/v1/webhooks', { headers: { 'x-api-key': KEY } })).status).toBe(200)
    expect((await app.request('/v1/webhooks', { headers: auth })).status).toBe(429)
    now = 60_000
    expect((await app.request('/v1/webhooks', { headers: auth })).status).toBe(200)
  })

  it('refuses an unknown key with 401 rather than falling back to anonymous', async () => {
    const app = api(() => 0)
    const response = await app.request('/v1/webhooks', { headers: { authorization: 'Bearer k_live_not_a_real_key_00' } })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unknown API key' })
    expect((await app.request('/v1/me', { headers: { 'x-api-key': 'nope_nope_nope_nope' } })).status).toBe(401)
  })

  it('is open at the anonymous rate when no key is configured', async () => {
    const app = createApi({ repository, nowMs: () => 0 })
    const me = await (await app.request('/v1/me')).json()
    expect(me).toMatchObject({ tier: 'anonymous', limitPerMinute: 60, remaining: 60, keysConfigured: 0 })
  })
})
