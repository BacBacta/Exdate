import { afterEach, describe, expect, it, vi } from 'vitest'
import { throttledHttp } from '../src/transport.js'

/**
 * The transport is what stands between the indexer and an endpoint that rejects
 * roughly half of all eth_getLogs calls. If it stops absorbing those, Ponder
 * deactivates the provider and collapses its sync range to the 25-block floor,
 * from which the backfill never recovers - so the behaviour is pinned here
 * rather than left to a manual run.
 *
 * These tests drive the real transport and stub `fetch`, so they exercise the
 * queue and the retry loop rather than a stand-in.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

const jsonResponse = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const tooManyRequests = () => new Response('Too Many Requests', { status: 429 })

const connect = (options?: Parameters<typeof throttledHttp>[1]) =>
  throttledHttp('http://rpc.test', { minGapMs: 0, ...options })({} as never)

describe('absorbing rate limits', () => {
  it('retries a rejected request and returns the eventual success', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return calls <= 3 ? tooManyRequests() : jsonResponse('0x1237')
    }) as typeof fetch

    const transport = connect()
    await expect(transport.request({ method: 'eth_chainId', params: [] })).resolves.toBe('0x1237')
    expect(calls).toBe(4)
  })

  it('reports every absorbed rejection to the caller-supplied hook', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return calls <= 2 ? tooManyRequests() : jsonResponse('0x0')
    }) as typeof fetch

    const seen: { method: string; attempt: number }[] = []
    const transport = connect({
      onThrottle: ({ method, attempt }) => seen.push({ method, attempt }),
    })
    await transport.request({ method: 'eth_getLogs', params: [] })

    expect(seen.map((entry) => entry.attempt)).toEqual([1, 2])
    expect(seen.every((entry) => entry.method === 'eth_getLogs')).toBe(true)
  })

  it('gives up after maxRetries instead of retrying forever', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return tooManyRequests()
    }) as typeof fetch

    const transport = connect({ maxRetries: 2 })
    await expect(transport.request({ method: 'eth_getLogs', params: [] })).rejects.toBeDefined()
    expect(calls).toBe(3) // the first attempt plus two retries
  })
})

describe('errors that are not rate limits', () => {
  it('surfaces a range error immediately rather than retrying it', async () => {
    // "exceeds limit of 10000" is the endpoint saying the query is too wide.
    // Retrying it unchanged can only waste the budget, and Ponder needs to see
    // it to narrow its own range.
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'logs matched by query exceeds limit of 10000' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const transport = connect({ maxRetries: 5 })
    await expect(transport.request({ method: 'eth_getLogs', params: [] })).rejects.toBeDefined()
    expect(calls).toBe(1)
  })

  it('surfaces a timeout immediately', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'log query timed out' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const transport = connect({ maxRetries: 5 })
    await expect(transport.request({ method: 'eth_getLogs', params: [] })).rejects.toBeDefined()
    expect(calls).toBe(1)
  })
})

describe('serialisation', () => {
  it('never has two requests in flight at once', async () => {
    // The endpoint tolerates parallel eth_blockNumber but not parallel
    // eth_getLogs, and the indexer mixes both through one transport.
    let inFlight = 0
    let peak = 0
    globalThis.fetch = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return jsonResponse('0x1')
    }) as typeof fetch

    const transport = connect()
    await Promise.all(
      Array.from({ length: 8 }, () => transport.request({ method: 'eth_blockNumber', params: [] })),
    )
    expect(peak).toBe(1)
  })

  it('keeps serving after one request in the queue fails', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      // Fail the second request outright with a non-retryable error.
      if (calls === 2) {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return jsonResponse('0x2')
    }) as typeof fetch

    const transport = connect()
    const results = await Promise.allSettled([
      transport.request({ method: 'eth_blockNumber', params: [] }),
      transport.request({ method: 'eth_blockNumber', params: [] }),
      transport.request({ method: 'eth_blockNumber', params: [] }),
    ])
    expect(results.map((entry) => entry.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })

  it('honours a minimum gap between requests', async () => {
    const startedAt: number[] = []
    globalThis.fetch = vi.fn(async () => {
      startedAt.push(Date.now())
      return jsonResponse('0x3')
    }) as typeof fetch

    const transport = connect({ minGapMs: 40 })
    await Promise.all(
      Array.from({ length: 3 }, () => transport.request({ method: 'eth_blockNumber', params: [] })),
    )
    expect(startedAt).toHaveLength(3)
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(35)
    expect(startedAt[2]! - startedAt[1]!).toBeGreaterThanOrEqual(35)
  })
})
