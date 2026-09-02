import { describe, expect, it } from 'vitest'
import { ExdateError, createClient, underlyingSharesPerToken } from '../src/index.js'
import type { TokenView } from '../src/index.js'

/**
 * The client is thin, so what is pinned here is the contract around it: which
 * URL each call builds, and what happens when the API says no. A 404 for an
 * unknown token must reach the caller as a 404 and never as an empty result -
 * "no data" and "no such token" are different answers.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Records every URL asked for and replies with whatever the test queued. */
const spy = (reply: (url: string) => Response) => {
  const calls: string[] = []
  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    return reply(url)
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

describe('url building', () => {
  it('addresses the configured chain and trims a trailing slash', async () => {
    const { calls, fetch } = spy(() => json({ chainId: 4663, count: 0, polled: 0, tokens: [] }))
    const client = createClient({ baseUrl: 'https://api.exdate.xyz/', fetch })
    await client.tokens()
    expect(calls).toEqual(['https://api.exdate.xyz/v1/robinhood/tokens'])
  })

  it('accepts a chain id as readily as a key', async () => {
    const { calls, fetch } = spy(() => json({}))
    await createClient({ baseUrl: 'https://api.exdate.xyz', chain: 4663, fetch }).events()
    expect(calls[0]).toBe('https://api.exdate.xyz/v1/4663/events')
  })

  it('builds every documented route', async () => {
    const { calls, fetch } = spy(() => json({}))
    const client = createClient({ baseUrl: 'http://localhost:42069', fetch })
    const address = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
    await client.health()
    await client.chains()
    await client.token(address)
    await client.yield(address)
    await client.pending(address)
    await client.status()
    await client.calendar()
    await client.webhooks.catalogue()
    await client.webhooks.events()
    expect(calls.map((url) => url.replace('http://localhost:42069', ''))).toEqual([
      '/v1/health',
      '/v1/chains',
      `/v1/robinhood/tokens/${address}`,
      `/v1/robinhood/tokens/${address}/yield`,
      `/v1/robinhood/tokens/${address}/pending`,
      '/v1/status',
      '/v1/calendar',
      '/v1/webhooks',
      '/v1/robinhood/webhooks/events',
    ])
  })

  it('passes filters through and omits the ones not given', async () => {
    const { calls, fetch } = spy(() => json({}))
    const client = createClient({ baseUrl: 'https://api.exdate.xyz', fetch })
    await client.reconciliations({ status: 'matched' })
    await client.reconciliations({ token: '0xAbC', status: undefined })
    await client.webhooks.events({ type: 'dividend.reconciled', limit: 10 })
    expect(calls[0]).toBe('https://api.exdate.xyz/v1/robinhood/reconciliations?status=matched')
    expect(calls[1]).toBe('https://api.exdate.xyz/v1/robinhood/reconciliations?token=0xAbC')
    expect(calls[2]).toBe(
      'https://api.exdate.xyz/v1/robinhood/webhooks/events?type=dividend.reconciled&limit=10',
    )
  })
})

describe('failures', () => {
  const client = (reply: (url: string) => Response) =>
    createClient({ baseUrl: 'https://api.exdate.xyz', fetch: spy(reply).fetch })

  it('raises the API error with its status and body', async () => {
    const c = client(() => json({ error: 'unknown token', chainId: 4663, address: '0x1' }, 404))
    const error = await c.token('0x1').catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ExdateError)
    expect(error.status).toBe(404)
    expect(error.isNotFound).toBe(true)
    expect(error.message).toContain('unknown token')
    expect(error.body).toMatchObject({ error: 'unknown token' })
  })

  it('turns only a 404 into null, and only where asked', async () => {
    const missing = client(() => json({ error: 'unknown token' }, 404))
    expect(await missing.tokenOrNull('0x1')).toBeNull()

    const broken = client(() => json({ error: 'database is down' }, 500))
    await expect(broken.tokenOrNull('0x1')).rejects.toBeInstanceOf(ExdateError)
  })

  it('does not pretend an HTML error page is a response', async () => {
    const c = client(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    const error = await c.status().catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ExdateError)
    expect(error.status).toBe(502)
    expect(error.body).toContain('502 Bad Gateway')
  })

  it('rejects a 200 that is not JSON rather than returning a string', async () => {
    // The issuer's own API answers `local_rate_limited` with HTTP 200; a proxy
    // in front of exdate can do the same.
    const c = client(() => new Response('local_rate_limited', { status: 200 }))
    await expect(c.tokens()).rejects.toThrow(/not JSON/)
  })
})

describe('request options', () => {
  it('sends the caller-supplied headers', async () => {
    let seen: RequestInit['headers']
    const fetch = (async (_input: unknown, init?: RequestInit) => {
      seen = init?.headers
      return json({})
    }) as typeof globalThis.fetch
    await createClient({ baseUrl: 'https://api.exdate.xyz', fetch, headers: { 'x-api-key': 'k' } }).status()
    expect(seen).toMatchObject({ accept: 'application/json', 'x-api-key': 'k' })
  })

  it('times out by default and can be told not to', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const fetch = (async (_input: unknown, init?: RequestInit) => {
      signals.push(init?.signal)
      return json({})
    }) as typeof globalThis.fetch
    await createClient({ baseUrl: 'https://a.test', fetch }).status()
    await createClient({ baseUrl: 'https://a.test', fetch, timeoutMs: 0 }).status()
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(signals[1]).toBeUndefined()
  })
})

describe('underlyingSharesPerToken', () => {
  const token = (current: string | null) =>
    ({ multiplier: { current } }) as unknown as TokenView

  it('reads the ERC-8056 identity off a token', () => {
    // SGOV on 2026-09-02, after three dividends.
    expect(underlyingSharesPerToken(token('1005101770003214918'))).toBeCloseTo(1.00510177, 8)
  })

  it('returns null for a token that has not been polled, never 1.0', () => {
    expect(underlyingSharesPerToken(token(null))).toBeNull()
  })
})
