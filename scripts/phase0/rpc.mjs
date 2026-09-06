// Minimal JSON-RPC client with a global rate limiter and an ordered failover.
//
// The public Robinhood Chain endpoint answers 429 aggressively and times out on
// wide eth_getLogs ranges, so every Phase 0 script funnels through here rather
// than through a library that would fan out concurrent requests.
//
// Which endpoint answers first is a terms question before it is a reliability
// one. Robinhood's Terms of Service (docs/terms-review.md) make the public RPC
// a "Service", bind every Service to "testing, experimentation, evaluation, and
// development purposes" (s2.4) and say the RPC is "not intended for
// production-grade" use (s2.1) - while the chain itself is expressly NOT a
// Service. A third-party endpoint is therefore outside the Terms entirely, and
// it goes first. Robinhood's own stays as the fallback: a capture that cannot be
// re-read must not be lost to a third party's outage, and a fallback that is
// used only when the first endpoint fails is the smallest use of the Service
// that keeps the record complete.
//
//   RHC_RPC_URLS=https://a,https://b   ordered list, tried left to right
//   RHC_RPC_URL=https://a              one endpoint, no failover (kept for compatibility)

/**
 * The endpoint of last resort, and the one the Terms are about.
 *
 * Robinhood's own RPC is a "Service" under terms that bind it to testing and development
 * (docs/terms-review.md §2.4(a)), so a production read tries a third party first. It is never
 * dropped, because it is the only endpoint that has always answered.
 */
import { readFileSync } from 'node:fs'

const OPERATOR_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
/**
 * Used only when the committed probe cannot be read at all - a checkout without data/, which is
 * how a published package or a bare script directory would run this.
 */
const FALLBACK_RPC_URLS = ['https://rpc-robinhood.blockmachine.io', OPERATOR_RPC_URL]

/**
 * The failover order, DERIVED from the last probe rather than written down.
 *
 * It was written down, and it went stale in exactly the way this repository keeps recording. The
 * list named pocket.network first, with a comment saying it was chosen for a 2,000,000-block
 * eth_getLogs that "no other third-party endpoint comes close" to. Measured on 2026-09-06:
 * pocket accepts ZERO blocks of eth_getLogs, and ordofi accepts 100,000 - so the endpoint was
 * first for a capability it no longer has, and the best third party for the watcher's own scan
 * was two places down the list. The set is not stable; the probe is
 * (.github/workflows/probe-rpc-endpoints.yml, daily), so the order is read from it.
 *
 * Ordering: reachable third parties on this chain, widest eth_getLogs span first - that is the
 * capability that decides whether the watcher's announcement scan works at all - then Robinhood's
 * own, last, for the terms reason above.
 *
 * `head` must be a real block number, not just `reachable`: lb.routeme.sh answers eth_chainId and
 * refuses eth_blockNumber with a rate-limit notice, so it passes a reachability test and fails
 * every actual call.
 *
 * And only the best two third parties. Failover is sequential with a 25 s request timeout, so a
 * total outage costs 25 s per candidate - seven of them would put 175 s between the watcher's
 * thirty-second tick and any answer at all, which is worse than the redundancy is worth.
 */
const MAX_THIRD_PARTY_ENDPOINTS = 2

function probedRpcUrls() {
  try {
    const probe = JSON.parse(readFileSync(new URL('../../data/rpc-endpoints.observed.json', import.meta.url), 'utf8'))
    const usable = (probe.endpoints ?? [])
      .filter((e) => e.reachable && e.chainId === probe.chainId && Number(e.head) > 0 && e.url && e.url !== OPERATOR_RPC_URL)
      .sort((a, b) => (b.widestLogSpan ?? 0) - (a.widestLogSpan ?? 0))
      .slice(0, MAX_THIRD_PARTY_ENDPOINTS)
      .map((e) => e.url)
    if (usable.length === 0) return FALLBACK_RPC_URLS
    return [...usable, OPERATOR_RPC_URL]
  } catch {
    return FALLBACK_RPC_URLS
  }
}

const DEFAULT_RPC_URLS = probedRpcUrls()
/**
 * Only entries that are actually http(s) URLs survive. A bare API key pasted
 * here instead of a full URL is the plausible mistake - set-rpc.sh accepts one
 * and builds the URL around it, so the same value can look correct on a machine
 * and be useless to a collector - and without this it produced "Invalid URL" on
 * every call with no fallback, quietly breaking five scheduled jobs. A rejected
 * entry is named on stderr; if nothing survives, the built-in order is used.
 */
const configured = (process.env.RHC_RPC_URLS || process.env.RHC_RPC_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)
const usable = configured.filter((u) => {
  try {
    const { protocol, host } = new URL(u)
    if ((protocol === 'http:' || protocol === 'https:') && host) return true
  } catch {
    /* not a URL at all */
  }
  // The host is safe to print; a key lives in the path, so nothing else is.
  console.error(`# RHC_RPC_URLS: ignoring an entry that is not an http(s) URL (${u.length} characters). A bare API key is not an endpoint - give the whole https://… URL.`)
  return false
})
if (configured.length > 0 && usable.length === 0) {
  console.error('# RHC_RPC_URLS held nothing usable; falling back to the built-in endpoints')
}
const RPC_URLS = usable.length ? usable : DEFAULT_RPC_URLS
const RPC_URL = RPC_URLS[0]
/** A request that hangs would block the failover behind it, so none may. Wide scans measured under 5 s. */
const REQUEST_TIMEOUT_MS = Number(process.env.RHC_RPC_TIMEOUT_MS || 25_000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A limiter per endpoint. Robinhood Chain and Base rate-limit differently and
 * have no reason to queue behind each other, so the pacing state belongs to the
 * URL rather than to the module.
 */
export function makeRpc(url, defaults = {}) {
  let lastCallAt = 0
  return async function call(method, params, options = {}) {
    const { minGap = 350, tries = 8 } = { ...defaults, ...options }
    for (let attempt = 0; attempt < tries; attempt++) {
      const wait = minGap - (Date.now() - lastCallAt)
      if (wait > 0) await sleep(wait)
      lastCallAt = Date.now()

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.status === 429) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      const body = await res.json()
      if (body.error) {
        if (/rate|too many/i.test(body.error.message ?? '')) {
          await sleep(1500 * (attempt + 1))
          continue
        }
        throw new Error(`${method}: ${body.error.message}`)
      }
      return body.result
    }
    throw new Error(`${method}: still rate limited after ${tries} attempts`)
  }
}

/**
 * The endpoints in order, each with its own limiter. A call moves to the next
 * endpoint on ANY failure from the current one - a network error, a timeout,
 * exhausted retries, or an RPC error - because a third party's quirk must never
 * cost a reading. A revert that is real reverts on every endpoint and surfaces
 * as the last one's error, at the price of one extra call.
 */
export function makeFailoverRpc(urls, defaults = {}) {
  const clients = urls.map((url) => ({ url, call: makeRpc(url, defaults) }))
  if (clients.length === 0) throw new Error('no RPC endpoint configured')
  return async function call(method, params, options = {}) {
    const failures = []
    for (const client of clients) {
      try {
        return await client.call(method, params, options)
      } catch (error) {
        failures.push(`${new URL(client.url).host}: ${String(error.message).slice(0, 140)}`)
      }
    }
    throw new Error(`${method} failed on every endpoint - ${failures.join(' | ')}`)
  }
}

export const rpc = makeFailoverRpc(RPC_URLS)

export const hex = (n) => '0x' + BigInt(n).toString(16)
export const RPC_URL_IN_USE = RPC_URL
export const RPC_URLS_IN_USE = RPC_URLS

// Function selectors used by the Phase 0 scripts.
export const SELECTOR = {
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  uiMultiplier: '0xa60bf13d',
  newUIMultiplier: '0xdc767007',
  effectiveAt: '0x97a4064f',
  oraclePaused: '0x7706ba52',
  totalSupplyUI: '0x9bea6429',
  latestRoundData: '0xfeaf968c',
  description: '0x7284e416',
}

// Event topic0 values.
export const TOPIC = {
  UIMultiplierUpdated: '0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055',
  TransferWithScaledUI: '0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802',
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
}

export function decodeString(returnData) {
  const words = returnData.slice(2)
  const length = Number(BigInt('0x' + words.slice(64, 128)))
  return Buffer.from(words.slice(128, 128 + length * 2), 'hex').toString('utf8')
}

export function decodeUIMultiplierUpdated(data) {
  const words = data.slice(2)
  return {
    oldMultiplier: BigInt('0x' + words.slice(0, 64)),
    newMultiplier: BigInt('0x' + words.slice(64, 128)),
    effectiveAt: BigInt('0x' + words.slice(128, 192)),
  }
}

export function decodeLatestRoundData(data) {
  const words = data.slice(2)
  let answer = BigInt('0x' + words.slice(64, 128))
  if (answer >= 2n ** 255n) answer -= 2n ** 256n // int256
  return {
    roundId: BigInt('0x' + words.slice(0, 64)),
    answer,
    startedAt: BigInt('0x' + words.slice(128, 192)),
    updatedAt: BigInt('0x' + words.slice(192, 256)),
  }
}
