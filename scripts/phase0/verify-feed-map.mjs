// Corroborate the token -> feed map by behaviour, using addresses only.
//
// `data/token-feed-map.json` is derived from the feed's display name. That is
// the one place exdate identifies a token by symbol, and no first-party link
// exists to replace it: the token contract exposes no address-shaped view at
// all (scripts/phase0/probe-oracle-link.mjs), Chainlink's directory carries no
// token address, and the issuer's API publishes no feed.
//
// What does exist is a testable consequence. Chainlink documents the feed as
//
//     Token Price = Underlying Equity Market Price x Multiplier
//
// with the multiplier "read from the Robinhood token contract via uiMultiplier()".
// So at the instant a token's multiplier steps, ITS feed - and no other - must
// jump by the same ratio, on top of whatever the equity was doing. Both sides of
// that test are addresses: the step comes from the token's own logs, the jump
// from the aggregator's own rounds.
//
//   node scripts/phase0/verify-feed-map.mjs [--out data/feed-map-verification.json]
//
// It also runs two cheaper checks that stand on their own:
//   - every ticker in the issuer's registry is unique, so a ticker resolves to
//     exactly one address (Chainlink states one contract per ticker);
//   - each aggregator's own on-chain description() matches the directory name
//     the map was built from, so the mapping does not rest on a JSON file alone.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { rpc, SELECTOR, decodeLatestRoundData } from './rpc.mjs'

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'data/feed-map-verification.json'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const map = read('data/token-feed-map.json')
const registry = read('data/robinhood-assets.snapshot.json')
const observed = read('data/multiplier-events.observed.json')

const GET_ROUND_DATA = '0x9a6fc8f5'
const word = (n) => n.toString(16).padStart(64, '0')
const MASK64 = (1n << 64n) - 1n
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest'])

/** ABI-decode a single dynamic string return value. */
function decodeString(hex) {
  const body = hex.slice(2)
  const length = Number(BigInt(`0x${body.slice(64, 128)}`))
  const bytes = body.slice(128, 128 + length * 2)
  return Buffer.from(bytes, 'hex').toString('utf8')
}

// --- 1. is a ticker even a unique key? ---------------------------------------
const bySymbol = new Map()
for (const asset of registry.assets) {
  const list = bySymbol.get(asset.tokenSymbol) ?? []
  list.push(asset.deployments?.[0]?.contractAddress)
  bySymbol.set(asset.tokenSymbol, list)
}
const duplicateTickers = [...bySymbol.entries()].filter(([, addresses]) => addresses.length > 1)
console.log(`# registry: ${registry.assets.length} assets, ${bySymbol.size} distinct tickers`)
console.log(
  duplicateTickers.length === 0
    ? '  every ticker resolves to exactly one contract address'
    : `  AMBIGUOUS: ${duplicateTickers.map(([symbol]) => symbol).join(', ')}`,
)

// --- 2. does each aggregator say on chain what the directory says it is? -----
console.log('\n# aggregator description() read on chain')
const descriptions = []
for (const pair of map.pairs) {
  let description = null
  try {
    description = decodeString(await call(pair.feedProxy, SELECTOR.description))
  } catch (error) {
    console.log(`  ${pair.symbol}: description() failed - ${error.message.slice(0, 60)}`)
  }
  // Three forms are in use on chain - "Robinhood AAPL / USD", "RHAMD / USD" and
  // "Robinhood SGOV-USD" - so the test is that the ticker appears as a word,
  // optionally behind the RH prefix, rather than any single spelling.
  const mentionsTicker =
    description !== null &&
    new RegExp(`(^|[^A-Z])(RH)?${pair.symbol}([^A-Z0-9]|$)`).test(description.toUpperCase())
  descriptions.push({ symbol: pair.symbol, feedProxy: pair.feedProxy, description, mentionsTicker })
  if (!mentionsTicker) console.log(`  MISMATCH ${pair.symbol}: on-chain description is ${description}`)
}
console.log(
  `  ${descriptions.filter((row) => row.mentionsTicker).length}/${descriptions.length} aggregators name their ticker on chain`,
)

// --- 3. the behavioural test -------------------------------------------------
//
// For each observed multiplier step on a token that has a mapped feed, read the
// feed's own rounds around the instant and measure the jump.
const feedByToken = new Map(map.pairs.map((pair) => [pair.token.toLowerCase(), pair]))

async function roundAt(feed, phase, aggregatorRound) {
  try {
    const round = decodeLatestRoundData(await call(feed, GET_ROUND_DATA + word((phase << 64n) | aggregatorRound)))
    return round.updatedAt === 0n ? null : round
  } catch {
    return null
  }
}

/** The last round at or before `target`, and the first one after it. */
async function roundsAround(feed, target) {
  const latest = decodeLatestRoundData(await call(feed, SELECTOR.latestRoundData))
  const phase = latest.roundId >> 64n
  let lo = 1n
  let hi = latest.roundId & MASK64
  let before = null
  while (lo <= hi) {
    const mid = (lo + hi) / 2n
    const round = await roundAt(feed, phase, mid)
    if (!round) {
      lo = mid + 1n
      continue
    }
    if (round.updatedAt <= target) {
      before = round
      lo = mid + 1n
    } else {
      hi = mid - 1n
    }
  }
  if (!before) return { before: null, after: null, atPhaseFloor: true, phase }
  const aggregatorRound = before.roundId & MASK64
  return {
    before,
    after: await roundAt(feed, phase, aggregatorRound + 1n),
    atPhaseFloor: aggregatorRound === 1n,
    phase,
  }
}

console.log('\n# multiplier steps against the feed the map assigns')
const bps = (ratio) => (ratio - 1) * 10_000
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]
}
const results = []

/**
 * How much this feed moves between two ordinary rounds, in bps.
 *
 * Without it there is no way to say whether a jump means anything: 20 bps is
 * loud on SGOV, whose underlying is a treasury ETF, and invisible on TSLA. The
 * sample is taken from the rounds BEFORE the step, so the step itself cannot
 * inflate its own noise floor.
 */
async function noiseFloorBps(feed, phase, aggregatorRound, samples = 12) {
  const moves = []
  const gaps = []
  let previous = null
  for (let i = 0n; i < BigInt(samples) + 1n; i++) {
    if (aggregatorRound - i < 1n) break
    const round = await roundAt(feed, phase, aggregatorRound - i)
    if (!round) break
    if (previous !== null) {
      moves.push(Math.abs(bps(Number(previous.answer) / Number(round.answer))))
      gaps.push(Number(previous.updatedAt - round.updatedAt))
    }
    previous = round
  }
  // The cadence matters as much as the size: these feeds publish on the
  // heartbeat when the deviation threshold never trips, so "the next round" can
  // legitimately be 24 hours later. Measuring the usual gap is what makes a
  // 24-hour gap ordinary and a 3-day one a weekend.
  return { medianBps: median(moves), medianGapSeconds: median(gaps), samples: moves.length }
}

for (const event of observed.events) {
  const pair = feedByToken.get(event.token.toLowerCase())
  if (!pair) continue
  const effectiveAt = BigInt(Math.floor(Date.parse(event.effectiveAt) / 1000))
  const stepRatio = Number(BigInt(event.newMultiplier)) / Number(BigInt(event.oldMultiplier))
  const { before, after, atPhaseFloor, phase } = await roundsAround(pair.feedProxy, effectiveAt)

  const row = {
    symbol: pair.symbol,
    token: pair.token,
    feedProxy: pair.feedProxy,
    effectiveAt: event.effectiveAt,
    expectedStepBps: Number(bps(stepRatio).toFixed(4)),
    before: before
      ? { answer: before.answer.toString(), updatedAt: new Date(Number(before.updatedAt) * 1000).toISOString() }
      : null,
    after: after
      ? { answer: after.answer.toString(), updatedAt: new Date(Number(after.updatedAt) * 1000).toISOString() }
      : null,
    atPhaseFloor,
  }

  if (before && after) {
    row.observedJumpBps = Number(bps(Number(after.answer) / Number(before.answer)).toFixed(4))
    row.residualBps = Number((row.observedJumpBps - row.expectedStepBps).toFixed(4))
    row.gapSeconds = Number(after.updatedAt - before.updatedAt)
    const noise = await noiseFloorBps(pair.feedProxy, phase, before.roundId & MASK64)
    row.noiseBps = noise.medianBps === null ? null : Number(noise.medianBps.toFixed(4))
    row.noiseSamples = noise.samples
    row.medianGapSeconds = noise.medianGapSeconds
    row.gapRatio =
      noise.medianGapSeconds ? Number((row.gapSeconds / noise.medianGapSeconds).toFixed(2)) : null
    row.signalToNoise =
      row.noiseBps && row.noiseBps > 0 ? Number((Math.abs(row.expectedStepBps) / row.noiseBps).toFixed(1)) : null

    // A step is readable when it is loud against this feed's own round-to-round
    // movement and the round after it is the ordinary next one - at most a
    // weekend, not a session away.
    row.decisive = row.signalToNoise !== null && row.signalToNoise >= 3 && (row.gapRatio ?? 99) <= 4
    // The tolerance grows with the gap, because the equity leg drifts for as
    // long as the feed was silent, and that leg is not observable from here.
    row.toleranceBps = Number(
      Math.max(3 * (row.noiseBps ?? 0) * (row.gapRatio ?? 1), 0.1 * Math.abs(row.expectedStepBps)).toFixed(4),
    )
    row.agrees = row.decisive === true && Math.abs(row.residualBps) <= row.toleranceBps
  }
  results.push(row)

  const verdict =
    row.observedJumpBps === undefined
      ? 'no rounds'
      : row.decisive
        ? row.agrees
          ? 'AGREES'
          : 'DISAGREES'
        : `inconclusive (S/N ${row.signalToNoise ?? '?'}, gap x${row.gapRatio ?? '?'} the usual)`
  console.log(
    `  ${pair.symbol.padEnd(6)} ${event.effectiveAt}  expected ${row.expectedStepBps.toFixed(2).padStart(9)} bps` +
      `  observed ${(row.observedJumpBps ?? 0).toFixed(2).padStart(9)} bps  ${verdict}`,
  )
}

const decisive = results.filter((row) => row.decisive)
console.log(
  `\n  ${results.length} step(s) on tokens with a mapped feed; ${decisive.length} decisive, ${decisive.filter((row) => row.agrees).length} agreeing`,
)

// --- 4. the negative control -------------------------------------------------
//
// A feed jumping by the right amount only means something if the OTHER feeds do
// not. For each decisive step, the same measurement is run against all 35
// mapped feeds; the assigned one should be the unique closest match.
/**
 * The negative control, and why it is preserved rather than recomputed.
 *
 * A feed jumping by the right amount only means something if the OTHER feeds do not,
 * so each decisive step is measured against all 35 mapped feeds. That is ~35 binary
 * searches over round history per step, which is why it is behind a flag - and the
 * 2026-09-05 audit found the consequence: the documented command, without the flag,
 * rewrote the file with `crossChecks: []` and silently deleted the only evidence that
 * SGOV's feed was uniquely closest (F05). A block that was measured is kept unless
 * this run measures it again.
 */
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null
let crossChecks = previous?.crossChecks ?? []
let crossChecksCarriedOver = crossChecks.length > 0
if (process.argv.includes('--cross-check')) {
  crossChecks = []
  crossChecksCarriedOver = false
  for (const row of decisive) {
    console.log(`\n# cross-check: every mapped feed at ${row.symbol}'s step of ${row.effectiveAt}`)
    const target = BigInt(Math.floor(Date.parse(row.effectiveAt) / 1000))
    const ranked = []
    for (const candidate of map.pairs) {
      const { before, after } = await roundsAround(candidate.feedProxy, target)
      if (!before || !after) continue
      const jump = bps(Number(after.answer) / Number(before.answer))
      ranked.push({
        symbol: candidate.symbol,
        feedProxy: candidate.feedProxy,
        jumpBps: Number(jump.toFixed(4)),
        residualBps: Number((jump - row.expectedStepBps).toFixed(4)),
      })
    }
    ranked.sort((a, b) => Math.abs(a.residualBps) - Math.abs(b.residualBps))
    const winner = ranked[0]
    const assignedRank = ranked.findIndex((entry) => entry.feedProxy === row.feedProxy) + 1
    crossChecks.push({
      symbol: row.symbol,
      effectiveAt: row.effectiveAt,
      expectedStepBps: row.expectedStepBps,
      assignedRank,
      feedsMeasured: ranked.length,
      ranked: ranked.slice(0, 5),
    })
    for (const entry of ranked.slice(0, 5)) {
      console.log(
        `    ${entry.symbol === row.symbol ? '>' : ' '} ${entry.symbol.padEnd(6)} jump ${entry.jumpBps.toFixed(2).padStart(9)} bps  residual ${entry.residualBps.toFixed(2).padStart(9)} bps`,
      )
    }
    console.log(
      `    the assigned feed ranks ${assignedRank} of ${ranked.length}${assignedRank === 1 ? ' - uniquely closest' : ''}`,
    )
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  note: 'Corroboration of data/token-feed-map.json. No first-party address-level link exists; see scripts/phase0/verify-feed-map.mjs for what each check does and does not prove.',
  registry: {
    assets: registry.assets.length,
    distinctTickers: bySymbol.size,
    duplicateTickers: duplicateTickers.map(([symbol, addresses]) => ({ symbol, addresses })),
  },
  descriptions,
  steps: results,
  crossChecks,
  /** True when crossChecks was measured by an earlier run and carried forward, not by this one. */
  crossChecksCarriedOver,
}
writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`)
console.log(`\nwrote ${OUT}`)
