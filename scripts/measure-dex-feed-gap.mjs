// How far the traded price sits from the oracle a lending market liquidates against.
//
// The two prices quote the same thing. A pool trades the raw ERC-20, and Chainlink
// publishes P_token = P_equity x multiplier, which is that same raw token, so they are
// directly comparable and nothing is unwound from either - the trap rule 5 exists for.
//
// The gap matters because the feed is 24/5 and freezes outside market hours while the
// chain does not stop. A curator liquidating against a frozen feed carries exactly this
// distance, and it is widest when the feed is stalest. Nobody publishes it.
//
//   node scripts/measure-dex-feed-gap.mjs
import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { rpc } from './phase0/rpc.mjs'
import { classifyMarketSession } from './lib/market-session.mjs'

const root = new URL('../', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const OUT = 'data/dex-feed-gap.observed.json'

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const HEARTBEAT_SECONDS = 86_400
const SEL = { slot0: '0x3850c7bd', liquidity: '0x1a686502', latestRoundData: '0xfeaf968c', decimals: '0x313ce567' }
const Q192 = 1n << 192n
const USDG_DECIMALS = 6

const pad = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0')
const word = (n) => BigInt(n).toString(16).padStart(64, '0')
const aggregate3 = (calls) => {
  const tuples = calls.map(({ target, callData }) => {
    const bytes = callData.slice(2)
    const length = bytes.length / 2
    return pad(target) + word(1) + word(0x60) + word(length) + bytes.padEnd(Math.ceil(length / 32) * 64, '0')
  })
  const offsets = []
  let offset = BigInt(calls.length * 32)
  for (const t of tuples) {
    offsets.push(word(offset))
    offset += BigInt(t.length / 2)
  }
  return `0x82ad56cb${word(0x20)}${word(calls.length)}${offsets.join('')}${tuples.join('')}`
}
const decodeAggregate3 = (result) => {
  const hex = result.slice(2)
  const at = (o) => Number(BigInt('0x' + hex.slice(o * 2, o * 2 + 64)))
  const start = at(0)
  const length = at(start)
  const base = start + 32
  const out = []
  for (let i = 0; i < length; i++) {
    const tuple = base + at(base + i * 32)
    const bytes = tuple + at(tuple + 32)
    const size = at(bytes)
    out.push({ success: at(tuple) === 1, returnData: '0x' + hex.slice((bytes + 32) * 2, (bytes + 32 + size) * 2) })
  }
  return out
}
async function batched(calls, size = 400) {
  const out = []
  for (let i = 0; i < calls.length; i += size) {
    const result = await rpc('eth_call', [{ to: MULTICALL3, data: aggregate3(calls.slice(i, i + size)) }, 'latest'], {
      minGap: 150,
      tries: 8,
    })
    out.push(...decodeAggregate3(result))
  }
  return out
}

const dex = read('data/dex-pools.json')
const feedMap = read('data/token-feed-map.json')
const registry = read('data/robinhood-assets.snapshot.json')
const assets = registry.assets ?? registry
const nameByToken = new Map()
const decimalsByToken = new Map()
for (const asset of assets) {
  for (const d of asset.deployments ?? []) {
    if (String(d.chainId) !== '4663') continue
    nameByToken.set(d.contractAddress.toLowerCase(), asset.tokenName.replace(/\s*[•·-]\s*Robinhood Token$/i, '').trim())
    decimalsByToken.set(d.contractAddress.toLowerCase(), asset.tokenDecimals ?? 18)
  }
}
const feedByToken = new Map(feedMap.pairs.map((p) => [p.token.toLowerCase(), p]))

// Re-read every pool now: the committed prices date from discovery, and a gap has to be
// measured at one instant on both sides or it is measuring the delay between two reads.
const pools = dex.pools
const poolCalls = pools.flatMap((p) => [
  { target: p.pool, callData: SEL.slot0 },
  { target: p.pool, callData: SEL.liquidity },
])
const feeds = [...new Set(pools.map((p) => feedByToken.get(p.token.toLowerCase())?.feedProxy).filter(Boolean))]
const feedCalls = feeds.flatMap((feed) => [
  { target: feed, callData: SEL.latestRoundData },
  { target: feed, callData: SEL.decimals },
])
const observedAt = Math.floor(Date.now() / 1000)
const [poolAnswers, feedAnswers] = [await batched(poolCalls), await batched(feedCalls)]

const feedState = new Map()
feeds.forEach((feed, i) => {
  const [round, dec] = [feedAnswers[i * 2], feedAnswers[i * 2 + 1]]
  if (!round?.success || round.returnData.length < 322) return
  feedState.set(feed.toLowerCase(), {
    answer: BigInt('0x' + round.returnData.slice(2 + 64, 2 + 128)),
    updatedAt: Number(BigInt('0x' + round.returnData.slice(2 + 192, 2 + 256))),
    decimals: dec?.success ? Number(BigInt(dec.returnData)) : 8,
  })
})

/** Deepest pool per token: a thin pool prints a price no size can trade at. */
const bestByToken = new Map()
pools.forEach((pool, i) => {
  const [slot0, liquidity] = [poolAnswers[i * 2], poolAnswers[i * 2 + 1]]
  if (!slot0?.success || slot0.returnData.length < 130) return
  const sqrtPriceX96 = BigInt('0x' + slot0.returnData.slice(2, 66))
  const depth = liquidity?.success ? BigInt(liquidity.returnData) : 0n
  if (sqrtPriceX96 === 0n || depth === 0n) return
  const key = pool.token.toLowerCase()
  const decimals = decimalsByToken.get(key) ?? 18
  const scale = 10n ** BigInt(18 + decimals - USDG_DECIMALS)
  const squared = sqrtPriceX96 * sqrtPriceX96
  const priceWad = pool.stockIsToken0 ? (squared * scale) / Q192 : (Q192 * scale) / squared
  const current = bestByToken.get(key)
  if (!current || depth > current.liquidity) {
    bestByToken.set(key, { pool: pool.pool, feeTier: pool.feeTier, liquidity: depth, priceWad, symbol: pool.symbol })
  }
})

/**
 * Every mapped feed's price this instant, so a token's own feed can be ranked against
 * all the others. That ranking is the second kind of evidence for a pairing no
 * first-party statement supports: see corroborateFeedByPrice in packages/core.
 */
const priceByFeed = new Map()
for (const [feed, state] of feedState) priceByFeed.set(feed, state.answer * 10n ** BigInt(18 - state.decimals))

const MINIMUM_SEPARATION = 3
const SEPARATION_FLOOR_BPS = 0.01
const bpsBetween = (a, b) => (b <= 0n ? null : Math.abs(Number(((a - b) * 1_000_000n) / b) / 100))

/** Mirrors packages/core/src/pools.ts corroborateFeedByPrice, which is where it is tested. */
function corroborate(tradedWad, ownFeed) {
  const assigned = priceByFeed.get(ownFeed)
  if (!assigned) return null
  const ownBps = bpsBetween(tradedWad, assigned)
  if (ownBps === null) return null
  const others = [...priceByFeed.entries()]
    .filter(([feed]) => feed !== ownFeed)
    .map(([, price]) => bpsBetween(tradedWad, price))
    .filter((v) => v !== null)
  if (others.length === 0) return { ownBps, nearestOtherBps: null, separation: null, corroborates: false, refusal: 'no_other_feeds' }
  const nearestOtherBps = Math.min(...others)
  const separation = nearestOtherBps / Math.max(ownBps, SEPARATION_FLOOR_BPS)
  const refusal = nearestOtherBps < ownBps ? 'not_closest' : separation < MINIMUM_SEPARATION ? 'insufficient_separation' : null
  return { ownBps, nearestOtherBps, separation, corroborates: refusal === null, refusal }
}

let previous
try {
  previous = read(OUT)
} catch {
  previous = { history: [], corroboration: {} }
}
const tally = previous.corroboration ?? {}

const rows = []
for (const [token, best] of bestByToken) {
  const pair = feedByToken.get(token)
  const state = pair ? feedState.get(pair.feedProxy.toLowerCase()) : undefined
  const feedPriceWad = state ? state.answer * 10n ** BigInt(18 - state.decimals) : null
  const deviation = feedPriceWad && feedPriceWad > 0n ? Number(((best.priceWad - feedPriceWad) * 1_000_000n) / feedPriceWad) / 100 : null
  const age = state ? observedAt - state.updatedAt : null
  const evidence = pair ? corroborate(best.priceWad, pair.feedProxy.toLowerCase()) : null
  if (evidence) {
    const entry = (tally[token] ??= { symbol: best.symbol, feed: pair.feedProxy, samples: 0, corroborating: 0, separations: [] })
    entry.samples++
    if (evidence.corroborates) entry.corroborating++
    if (evidence.separation !== null && Number.isFinite(evidence.separation)) {
      entry.separations.push(Math.round(evidence.separation * 10) / 10)
      // Keep the distribution bounded; the median is what the verdict reports.
      if (entry.separations.length > 48) entry.separations.shift()
    }
    entry.lastRefusal = evidence.refusal
  }
  rows.push({
    symbol: best.symbol,
    name: nameByToken.get(token) ?? best.symbol,
    token,
    pool: best.pool,
    feeTier: best.feeTier,
    liquidity: best.liquidity.toString(),
    tradedPrice: (Number(best.priceWad) / 1e18).toFixed(4),
    feed: pair?.feedProxy ?? null,
    feedPrice: feedPriceWad === null ? null : (Number(feedPriceWad) / 1e18).toFixed(4),
    feedAgeSeconds: age,
    beyondHeartbeat: age === null ? null : age > HEARTBEAT_SECONDS,
    /** Signed: positive means the traded price is above the oracle. */
    deviationBps: deviation === null ? null : Math.round(deviation * 100) / 100,
    /** Stated because a gap on a token with no feed cannot be measured, only noted. */
    hasFeed: Boolean(pair),
    /** Does this price identify the feed it is mapped to, among all the others? */
    identifiesItsFeed: evidence ? evidence.corroborates : null,
    separationFromNearestOtherFeed: evidence?.separation === null || evidence === null ? null : Math.round(evidence.separation * 10) / 10,
    corroborationRefusal: evidence?.refusal ?? null,
  })
}

const measured = rows.filter((r) => r.deviationBps !== null)
const abs = measured.map((r) => Math.abs(r.deviationBps)).sort((a, b) => a - b)
const median = abs.length ? abs[Math.floor(abs.length / 2)] : null
const ages = measured.map((r) => r.feedAgeSeconds).sort((a, b) => a - b)
const at = new Date(observedAt * 1000)
const session = classifyMarketSession(at)

const summary = {
  tokensQuotable: rows.length,
  withFeed: measured.length,
  withoutFeed: rows.length - measured.length,
  medianAbsDeviationBps: median,
  maxAbsDeviationBps: abs.at(-1) ?? null,
  medianFeedAgeSeconds: ages.length ? ages[Math.floor(ages.length / 2)] : null,
  feedsBeyondHeartbeat: measured.filter((r) => r.beyondHeartbeat).length,
}

/**
 * The snapshot answers "how far apart are they right now". The series answers the
 * question that is actually worth money: how much wider the gap runs when the feed is
 * frozen than when the market is open. One sample cannot say that, so each run appends
 * its summary with the market session it fell in - the same classifier, and the same
 * discipline, as the off-hours transfer share.
 */
const history = previous.history ?? []
const last = history.at(-1)
// A duplicate fire adds nothing: two reads a few seconds apart are one observation.
if (!last || Date.parse(at.toISOString()) - Date.parse(last.observedAt) > 60_000) {
  history.push({ observedAt: at.toISOString(), session, ...summary })
}

const bySession = {}
for (const sample of history) {
  const bucket = (bySession[sample.session] ??= { samples: 0, medians: [] })
  bucket.samples++
  if (sample.medianAbsDeviationBps !== null) bucket.medians.push(sample.medianAbsDeviationBps)
}
const middle = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
const sessions = Object.fromEntries(
  Object.entries(bySession).map(([name, b]) => [name, { samples: b.samples, medianAbsDeviationBps: middle(b.medians) }]),
)

await writeFile(
  new URL(OUT, root),
  JSON.stringify(
    {
      note:
        'Distance between the price a Stock Token trades at on chain and the Chainlink answer a lending market liquidates against. Both quote the raw token, so nothing is unwound from either. Positive means the traded price is above the oracle.',
      method:
        'The deepest USDG pool per token, read in the same instant as every feed, through one Multicall3 batch each. A pool with no liquidity is skipped rather than ranked last: its price is whatever the last trade left behind. Each run appends its summary to the history, labelled with the market session, so the difference between an open market and a frozen feed becomes measurable rather than asserted.',
      observedAt: at.toISOString(),
      session,
      heartbeatSeconds: HEARTBEAT_SECONDS,
      summary,
      /** Per session, once there are enough samples to mean anything. One sample is a reading, not a rate. */
      bySession: sessions,
      /**
       * Accumulated evidence that each pool price identifies the feed its token is
       * mapped to. Read by scripts/corroborate-feed-map.mjs, which turns a run of
       * agreements into a corroborated pairing - never a single reading.
       */
      corroboration: Object.fromEntries(
        Object.entries(tally).map(([token, entry]) => [
          token,
          {
            ...entry,
            medianSeparation: entry.separations.length
              ? [...entry.separations].sort((a, b) => a - b)[Math.floor(entry.separations.length / 2)]
              : null,
          },
        ]),
      ),
      history,
      tokens: rows.sort((a, b) => Math.abs(b.deviationBps ?? -1) - Math.abs(a.deviationBps ?? -1)),
    },
    null,
    2,
  ) + '\n',
)
const identifying = rows.filter((r) => r.identifiesItsFeed === true).length
console.error(`# ${session}: ${rows.length} tokens quotable on chain, ${measured.length} of them with a feed to compare against`)
console.error(`# ${identifying}/${measured.length} prices identify the feed they are mapped to at this reading`)
console.error(`# median |gap| ${median} bps, widest ${abs.at(-1)} bps, median feed age ${Math.round((ages[Math.floor(ages.length / 2)] ?? 0) / 60)} min`)
for (const row of rows.slice(0, 6)) {
  console.error(`#   ${row.symbol.padEnd(6)} traded ${String(row.tradedPrice).padStart(11)}  feed ${String(row.feedPrice ?? '-').padStart(11)}  ${row.deviationBps === null ? 'no feed' : String(row.deviationBps).padStart(8) + ' bps'}  feed age ${row.feedAgeSeconds === null ? '-' : Math.round(row.feedAgeSeconds / 60) + ' min'}`)
}
console.error(`# wrote ${OUT}`)
