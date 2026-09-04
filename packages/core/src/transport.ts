import { fallback, http, type HttpTransportConfig, type Transport } from 'viem'

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

/**
 * Is this error the endpoint saying "not now"?
 *
 * Structural first: the HTTP status, viem's error code, and JSON-RPC's own
 * -32005 (limit exceeded), which is what reaches us when a 429 carries a
 * well-formed JSON-RPC body - viem returns the parsed error and drops the
 * status in that case.
 *
 * The text fallback deliberately reads `details` and `shortMessage` only.
 * viem's `message` embeds the serialised request body, so a bare "429" test on
 * it would fire on any calldata, address or block number that happened to
 * contain those digits, and retry a genuine error a dozen times as throttling.
 */
const isRateLimited = (error: unknown): boolean => {
  const candidate = error as {
    code?: number
    status?: number
    details?: string
    shortMessage?: string
  }
  if (candidate?.code === 429 || candidate?.status === 429 || candidate?.code === -32005) return true
  const text = `${candidate?.details ?? ''} ${candidate?.shortMessage ?? ''}`
  return /too many requests|rate limit/i.test(text)
}

export function throttledHttp(url: string, options: ThrottledHttpOptions = {}): Transport {
  // Four, not a dozen: Ponder wraps every call in its own nine-attempt retry
  // loop above this transport, so the attempts multiply. Four here is already
  // forty logical attempts under a sustained rate limit.
  const { minGapMs = 80, maxGapMs = 2_000, maxRetries = 4, onThrottle, ...httpConfig } = options

  return (config) => {
    // retryCount 0: viem's retry would fire concurrently with the queue below;
    // this transport does its own, and Ponder does more on top.
    //
    // The timeout is forced from httpConfig. viem resolves a transport's timeout
    // as caller-supplied first, then config, and Ponder always calls a custom
    // transport with timeout 10 000 - which would silently discard whatever
    // ponder.config.ts asked for.
    const timeout = httpConfig.timeout ?? (config as { timeout?: number }).timeout
    const inner = http(url, { ...httpConfig, retryCount: 0 })({ ...config, timeout })

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
            // Grow from a floor of 25 ms, not from the current gap: with
            // minGapMs 0 the gap starts at 0 and 0 x 1.6 never leaves it.
            gapMs = Math.min(maxGapMs, Math.max(minGapMs, Math.max(gapMs, 25) * 1.6))
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

/**
 * The throttled transport over several endpoints, tried in order.
 *
 * Which endpoint comes first is a terms question before it is a reliability
 * one (docs/terms-review.md): Robinhood's public RPC is a "Service" under its
 * Terms, bound to "testing, experimentation, evaluation, and development"
 * purposes and "not intended for production-grade" use, while the chain itself
 * is expressly not a Service. So a third-party endpoint goes first and
 * Robinhood's own answers only when it fails. viem's `fallback` moves to the
 * next transport on an error; each inner transport has already retried its own
 * rate limits by then, and `retryCount: 0` keeps the outer layer from
 * multiplying those retries again. `rank: false` keeps the order as given.
 */
export function failoverHttp(urls: readonly string[], options: ThrottledHttpOptions = {}): Transport {
  const [first, ...rest] = urls
  if (!first) throw new Error('failoverHttp: no RPC endpoint configured')
  if (rest.length === 0) return throttledHttp(first, options)
  return fallback(
    urls.map((url) => throttledHttp(url, options)),
    { rank: false, retryCount: 0 },
  )
}
