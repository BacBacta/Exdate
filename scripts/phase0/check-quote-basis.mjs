// Is the issuer's /rhj/prices quote the UNDERLYING equity price, or the token price?
//
// The whole point of pricing a dividend from the issuer's own quote instead of a
// Chainlink round is that it works for all 194 tokens rather than 35. It is only
// correct if the quote is the underlying price: Chainlink publishes
// P_token = P_equity x multiplier, so a quote that already included the multiplier
// would have to be divided, and one that does not must be used as it is. Getting
// this backwards silently corrupts every haircut by the size of the multiplier.
//
// The two hypotheses are only distinguishable where the multiplier has actually
// moved, and only where the token's own price noise is smaller than that move.
// SGOV is the one token that satisfies both: 51 bps away from 1.0, and a treasury
// ETF whose price barely moves. Everything else is reported and left inconclusive.
//
//   node scripts/phase0/check-quote-basis.mjs
import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { rpc } from './rpc.mjs'

const root = new URL('../../', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const feedMap = read('data/token-feed-map.json')
const events = read('data/multiplier-events.observed.json').events
const movedTokens = new Set(events.map((e) => e.token.toLowerCase()))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The issuer answers `local_rate_limited` with HTTP 200, so parse defensively and retry. */
async function quote(symbol) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(900 * attempt)
    try {
      const response = await fetch(`https://api.robinhood.com/rhj/prices/${symbol}`, { headers: { accept: 'application/json' } })
      const text = await response.text()
      if (text.includes('local_rate_limited')) continue
      const q = JSON.parse(text).quotes?.[0]
      if (q?.bid && q?.ask) return q
    } catch {
      // retried below
    }
  }
  return null
}

const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest'], { minGap: 120, tries: 8 })
const now = Math.floor(Date.now() / 1000)
const rows = []

for (const pair of feedMap.pairs) {
  const q = await quote(pair.symbol)
  if (!q) {
    console.error(`# ${pair.symbol.padEnd(6)} no quote`)
    continue
  }
  const [roundData, decimalsHex, multiplierHex] = await Promise.all([
    call(pair.feedProxy, '0xfeaf968c'), // latestRoundData()
    call(pair.feedProxy, '0x313ce567'), // decimals()
    call(pair.token, '0xa60bf13d'), // uiMultiplier()
  ])
  const answer = BigInt('0x' + roundData.slice(2 + 64, 2 + 128))
  const updatedAt = Number(BigInt('0x' + roundData.slice(2 + 192, 2 + 256)))
  const decimals = Number(BigInt(decimalsHex))
  const multiplier = Number(BigInt(multiplierHex)) / 1e18
  const chainlinkToken = Number(answer) / 10 ** decimals
  const mid = (Number(q.bid) + Number(q.ask)) / 2
  const bps = (x) => Math.round(x * 10_000 * 10) / 10

  rows.push({
    symbol: pair.symbol,
    token: pair.token,
    feed: pair.feedProxy,
    quoteMid: mid.toFixed(6),
    quoteGeneratedAt: q.generatedAt,
    isTradingHalt: q.isTradingHalt ?? null,
    chainlinkTokenPrice: chainlinkToken.toFixed(8),
    chainlinkUpdatedAt: new Date(updatedAt * 1000).toISOString(),
    chainlinkAgeSeconds: now - updatedAt,
    multiplier: multiplier.toFixed(18),
    multiplierBps: bps(multiplier - 1),
    /** Error if the quote is taken as the underlying price: |quote x multiplier - chainlink|. */
    errorIfUnderlyingBps: bps(Math.abs((mid * multiplier - chainlinkToken) / chainlinkToken)),
    /** Error if the quote is taken as the token price: |quote - chainlink|. */
    errorIfTokenPriceBps: bps(Math.abs((mid - chainlinkToken) / chainlinkToken)),
    multiplierHasMoved: movedTokens.has(pair.token.toLowerCase()),
  })
}

/**
 * A token can only decide the question when its multiplier is further from 1.0
 * than the noise between two prices sampled at different instants. Empirically
 * that noise runs to tens of basis points on an equity, so the bar is set at a
 * multiplier of at least 40 bps - which SGOV alone clears today.
 */
const DECISIVE_MULTIPLIER_BPS = 40
const decisive = rows.filter((r) => Math.abs(r.multiplierBps) >= DECISIVE_MULTIPLIER_BPS)
const agreeUnderlying = decisive.filter((r) => r.errorIfUnderlyingBps < r.errorIfTokenPriceBps)
const median = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)

const verdict =
  decisive.length === 0
    ? 'inconclusive: no token has a multiplier far enough from 1.0 to separate the hypotheses'
    : agreeUnderlying.length === decisive.length
      ? 'underlying: on every token able to decide, quote x multiplier matches the feed and the bare quote does not'
      : agreeUnderlying.length === 0
        ? 'token price: on every token able to decide, the bare quote matches the feed'
        : 'contested: the decisive tokens disagree'

const out = {
  note:
    'Which price the issuer quote actually is, decided against the Chainlink feed. Chainlink publishes P_token = P_equity x multiplier, so only a token whose multiplier is far from 1.0 can tell the two apart, and only if its own price noise is smaller than that distance.',
  method: `error as underlying = |quote x multiplier - chainlink| / chainlink; error as token price = |quote - chainlink| / chainlink; a token decides only when |multiplier - 1| >= ${DECISIVE_MULTIPLIER_BPS} bps`,
  checkedAt: new Date().toISOString(),
  decisiveMultiplierBps: DECISIVE_MULTIPLIER_BPS,
  verdict,
  decisiveTokens: decisive.map((r) => r.symbol),
  summary: {
    feedsChecked: rows.length,
    tokensWhoseMultiplierMoved: rows.filter((r) => r.multiplierHasMoved).length,
    decisiveTokens: decisive.length,
    decisiveAgreeingUnderlying: agreeUnderlying.length,
    medianErrorIfUnderlyingBps: median(rows.map((r) => r.errorIfUnderlyingBps)),
    medianErrorIfTokenPriceBps: median(rows.map((r) => r.errorIfTokenPriceBps)),
    medianChainlinkAgeSeconds: median(rows.map((r) => r.chainlinkAgeSeconds)),
    /** Under a minute means the market is open and the two sources are comparable. */
    feedsFresherThanFiveMinutes: rows.filter((r) => r.chainlinkAgeSeconds < 300).length,
  },
  rows: rows.sort((a, b) => Math.abs(b.multiplierBps) - Math.abs(a.multiplierBps)),
}

await writeFile(new URL('data/issuer-quote-basis.json', root), JSON.stringify(out, null, 2) + '\n')
console.error(`# verdict: ${verdict}`)
console.error(`# decisive: ${decisive.map((r) => `${r.symbol} (mult ${r.multiplierBps} bps, underlying ${r.errorIfUnderlyingBps} bps vs token ${r.errorIfTokenPriceBps} bps)`).join(', ') || 'none'}`)
console.error(`# median Chainlink age ${out.summary.medianChainlinkAgeSeconds}s, ${out.summary.feedsFresherThanFiveMinutes}/${rows.length} fresher than 5 min`)
console.error('# wrote data/issuer-quote-basis.json')
