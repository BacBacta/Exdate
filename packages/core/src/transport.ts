import { http, type HttpTransportConfig, type Transport } from 'viem'

/**
 * A transport built for the Robinhood Chain public RPC specifically.
 *
 * Measured on 2026-09-02, and the shape of it matters:
 *
 *  - `eth_blockNumber` survives 25 back-to-back calls, and even 8 in parallel,
 *    with zero rejections.
 *  - `eth_getLogs` is rejected roughly half the time *at any pacing*. Serialised
 *    with a 150 ms gap, 1 to 4 of every 8 calls still came back HTTP 429. The
 *    limiter is cost-based, not rate-based, so slowing down does not fix it.
 *
 * A plain rate limiter therefore cannot help. What does work is retrying: the
 * Phase 0 scripts pushed hundreds of `eth_getLogs` through this endpoint by
 * retrying with escalating backoff. This transport does the same underneath an
 * indexer, so the indexer sees a slow success instead of a failure.
 *
 * That distinction is not cosmetic. Ponder reacts to a 429 by deactivating the
 * provider and shrinking its block range, and it sizes each sync round from the
 * duration of the previous one. A surfaced 429 collapses the range to its 25
 * block floor and the backfill never recovers.
 */
export interface ThrottledHttpOptions extends HttpTransportConfig {
  /** Minimum gap between two requests, ms. Grows on rejection. */
  minGapMs?: number
  /** Upper bound for the adaptive gap, ms. */
  maxGapMs?: number
  /** How many times to retry one request before giving up. */
  maxRetries?: number
  /** Called on every absorbed rejection, for logging. */
  onThrottle?: (info: { method: string; attempt: number; delayMs: number }) => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isRateLimited = (error: unknown): boolean => {
  const candidate = error as { code?: number; status?: number; details?: string; message?: string }
  if (candidate?.code === 429 || candidate?.status === 429) return true
  const text = `${candidate?.details ?? ''} ${candidate?.message ?? ''}`
  return /too many requests|rate limit|429/i.test(text)
}

export function throttledHttp(url: string, options: ThrottledHttpOptions = {}): Transport {
  const { minGapMs = 80, maxGapMs = 2_000, maxRetries = 12, onThrottle, ...httpConfig } = options

  return (config) => {
    // retryCount 0: this transport owns retrying, and viem's own retry would
    // fire concurrently with the queue below.
    const inner = http(url, { ...httpConfig, retryCount: 0 })(config)

    let gapMs = minGapMs
    // A single promise chain, so exactly one request is ever in flight. The
    // endpoint tolerates parallelism on cheap methods but not on eth_getLogs,
    // and the indexer mixes both.
    let tail: Promise<unknown> = Promise.resolve()
    let lastStartedAt = 0

    const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
      const result = tail.then(async () => {
        const wait = gapMs - (Date.now() - lastStartedAt)
        if (wait > 0) await sleep(wait)
        lastStartedAt = Date.now()
        return run()
      })
      // Keep the chain alive even when a link rejects.
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    }

    return {
      ...inner,
      async request(body: { method: string; params?: unknown }, reqOptions?: unknown) {
        let lastError: unknown
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await enqueue(() =>
              (inner.request as (b: unknown, o?: unknown) => Promise<unknown>)(body, reqOptions),
            )
            // Ease off gradually once the endpoint is answering again.
            gapMs = Math.max(minGapMs, gapMs * 0.9)
            return response
          } catch (error) {
            lastError = error
            if (!isRateLimited(error) || attempt === maxRetries) throw error
            gapMs = Math.min(maxGapMs, Math.max(minGapMs, gapMs * 1.6))
            // Exponential with jitter, so a burst of rejected requests does not
            // resynchronise and collide again on the next attempt.
            const delayMs = Math.min(maxGapMs * 4, 150 * 2 ** attempt) * (0.5 + Math.random())
            onThrottle?.({ method: body.method, attempt: attempt + 1, delayMs })
            await sleep(delayMs)
          }
        }
        throw lastError
      },
    } as ReturnType<Transport>
  }
}
