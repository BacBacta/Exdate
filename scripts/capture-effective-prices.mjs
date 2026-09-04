// Capture the issuer's own quote at the instant a multiplier change takes effect.
//
// Why this exists: the reconciliation prices a dividend from the Chainlink round in
// force at effectiveAt. That covers 35 of 194 tokens, and the round can be hours
// old - SGOV's was 15 hours stale. The issuer quotes all 194 tokens, refreshes every
// 15 s, and publishes the raw underlying price, which is exactly the input the
// reconciliation needs (verified: scripts/phase0/check-quote-basis.mjs, SGOV decides
// it at 1 bps against 51.7).
//
// The quote is only useful AT the instant of the step, and it cannot be read back
// afterwards - the endpoint serves the present and nothing else. So the capture has
// to be there when it happens. What makes that possible is exdate's own finding:
// UIMultiplierUpdated fires about nine minutes BEFORE the change takes effect,
// carrying effectiveAt. This script watches for that announcement and comes back at
// the right second.
//
// Each run is short and hands unfinished work to the next through the state file, so
// nothing depends on one long-lived process or on a schedule firing on time.
//
//   node scripts/capture-effective-prices.mjs
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { rpc, hex } from './phase0/rpc.mjs'

const root = new URL('../', import.meta.url)
const OUT = process.env.EXDATE_CAPTURE_OUT ?? 'data/effective-prices.observed.json'
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))

const UI_MULTIPLIER_UPDATED = '0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055'

/** How long one run may stay alive waiting for an effectiveAt. Just under the schedule interval. */
const RUN_BUDGET_MS = Number(process.env.EXDATE_CAPTURE_BUDGET_MS ?? 240_000)
/** How far back to look for announcements. Wider than the schedule, so a delayed run still catches one. */
const LOOKBACK_BLOCKS = Number(process.env.EXDATE_CAPTURE_LOOKBACK_BLOCKS ?? 900_000) // ~15 min at 0.1 s/block
/** Offsets around effectiveAt to sample, in seconds. The nearest one wins later. */
const SAMPLE_OFFSETS = [-30, 0, 30]
/** Past this, a capture is no longer worth attempting: the price has moved on and the row stays unpriced. */
const GIVE_UP_AFTER_SECONDS = 3600
/** How close a quote must be to effectiveAt to count as the price at that instant. See packages/core/src/quotes.ts. */
const TOLERANCE_SECONDS = 120

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const nowMs = () => Date.now()
const iso = (ms) => new Date(ms).toISOString()

const registry = read('data/robinhood-assets.snapshot.json')
const assets = registry.assets ?? registry
const symbolByToken = new Map()
for (const asset of assets) {
  for (const d of asset.deployments ?? []) {
    if (String(d.chainId) === '4663') symbolByToken.set(d.contractAddress.toLowerCase(), asset.tokenSymbol)
  }
}

let state
try {
  state = read(OUT)
} catch {
  state = { steps: [] }
}
const captures = state.steps ?? []
const keyOf = (token, effectiveAt) => `${token.toLowerCase()}:${effectiveAt}`
const byKey = new Map(captures.map((c) => [keyOf(c.token, c.effectiveAt), c]))

/**
 * The issuer answers `local_rate_limited` with HTTP 200, so a status check is not
 * enough. A failed quote is reported, never guessed.
 */
async function quote(symbol) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(700 * attempt)
    try {
      const response = await fetch(`https://api.robinhood.com/rhj/prices/${symbol}`, { headers: { accept: 'application/json' } })
      const text = await response.text()
      if (text.includes('local_rate_limited')) continue
      const q = JSON.parse(text).quotes?.[0]
      if (!q?.bid || !q?.ask) continue
      const mid = ((Number(q.bid) + Number(q.ask)) / 2).toFixed(6)
      return {
        bid: q.bid,
        ask: q.ask,
        mid,
        /** The issuer's own timestamp for the quote; the cache is 15 s, so this is the truth, not capturedAt. */
        generatedAt: q.generatedAt,
        capturedAt: iso(nowMs()),
        isTradingHalt: q.isTradingHalt ?? null,
      }
    } catch {
      // retried, then reported as a miss
    }
  }
  return null
}

/** Records one quote against a capture, keeping them ordered and never duplicating a generatedAt. */
function record(capture, q) {
  if (!q) return false
  capture.quotes ??= []
  if (capture.quotes.some((existing) => existing.generatedAt === q.generatedAt)) return false
  const distance = Math.round((Date.parse(q.generatedAt) - Date.parse(capture.effectiveAt)) / 1000)
  capture.quotes.push({ ...q, distanceSeconds: distance })
  capture.quotes.sort((a, b) => Math.abs(a.distanceSeconds) - Math.abs(b.distanceSeconds))
  return true
}

// --- 1. find announcements ---------------------------------------------------
const head = Number(await rpc('eth_blockNumber', []))
const from = Math.max(1, head - LOOKBACK_BLOCKS)
const logs = await rpc('eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(head), topics: [UI_MULTIPLIER_UPDATED] }])
console.error(`# scanned blocks ${from}..${head} for announcements: ${logs.length} log(s)`)

let changed = false
for (const log of logs) {
  // UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp), all unindexed
  const data = log.data.slice(2)
  const oldMultiplier = BigInt('0x' + data.slice(0, 64)).toString()
  const newMultiplier = BigInt('0x' + data.slice(64, 128)).toString()
  const effectiveSeconds = Number(BigInt('0x' + data.slice(128, 192)))
  const token = log.address.toLowerCase()
  const effectiveAt = iso(effectiveSeconds * 1000)
  const key = keyOf(token, effectiveAt)
  if (byKey.has(key)) continue
  const block = await rpc('eth_getBlockByNumber', [log.blockNumber, false])
  const capture = {
    token,
    symbol: symbolByToken.get(token) ?? null,
    effectiveAt,
    announcedAt: iso(Number(BigInt(block.timestamp)) * 1000),
    announcedTx: log.transactionHash,
    oldMultiplier,
    newMultiplier,
    quotes: [],
  }
  byKey.set(key, capture)
  captures.push(capture)
  changed = true
  const secondsAway = Math.round((effectiveSeconds * 1000 - nowMs()) / 1000)
  console.error(`# new announcement ${capture.symbol ?? token} effective ${effectiveAt} (${secondsAway}s away)`)
  // A quote now is the "before" price: context, never the reconciliation input. Only
  // worth taking while the instant is still reachable - a quote days after the fact
  // says nothing about that instant and would only invite being read as if it did.
  if (capture.symbol && secondsAway > -GIVE_UP_AFTER_SECONDS && record(capture, await quote(capture.symbol))) changed = true
}

// --- 2. capture at effectiveAt, waiting only within this run's budget ---------
const deadline = nowMs() + RUN_BUDGET_MS
const pending = captures
  .filter((c) => c.symbol && !c.givenUp)
  .filter((c) => {
    const effective = Date.parse(c.effectiveAt)
    const closest = c.quotes?.length ? Math.min(...c.quotes.map((q) => Math.abs(q.distanceSeconds))) : Infinity
    if (closest <= Math.max(...SAMPLE_OFFSETS)) return false // already sampled at the instant
    return effective + GIVE_UP_AFTER_SECONDS * 1000 > nowMs() // still worth trying
  })
  .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt))

for (const capture of pending) {
  const effective = Date.parse(capture.effectiveAt)
  for (const offset of SAMPLE_OFFSETS) {
    const at = effective + offset * 1000
    if (at > deadline) {
      console.error(`# ${capture.symbol} +${offset}s falls beyond this run; the next run picks it up`)
      break
    }
    const wait = at - nowMs()
    if (wait > 0) {
      console.error(`# waiting ${Math.round(wait / 1000)}s for ${capture.symbol} at effectiveAt${offset >= 0 ? '+' : ''}${offset}s`)
      await sleep(wait)
    }
    const q = await quote(capture.symbol)
    if (record(capture, q)) {
      changed = true
      // The recorded quote's own distance, not the closest so far: the list is kept sorted.
      const recorded = capture.quotes.find((existing) => existing.generatedAt === q.generatedAt)
      console.error(`#   ${capture.symbol} mid=${q.mid} generatedAt=${q.generatedAt} distance=${recorded.distanceSeconds}s`)
    }
  }
}

// --- 3. close out anything the clock has put out of reach ---------------------
// The issuer serves the present only, so an instant an hour gone is gone. Saying so
// once is the honest end state; retrying forever would keep a row looking pending.
for (const capture of captures) {
  if (capture.givenUp) continue
  const closest = capture.quotes?.length ? Math.min(...capture.quotes.map((q) => Math.abs(q.distanceSeconds))) : Infinity
  if (closest <= TOLERANCE_SECONDS) continue
  if (Date.parse(capture.effectiveAt) + GIVE_UP_AFTER_SECONDS * 1000 >= nowMs()) continue
  capture.givenUp = true
  capture.givenUpReason = capture.symbol
    ? 'no quote within two minutes of effectiveAt, and the issuer publishes no history, so this instant is unrecoverable'
    : 'no symbol in the registry for this token, so no quote could be requested'
  changed = true
}

if (!changed) {
  console.error('# nothing to record')
  process.exit(0)
}

captures.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
const withQuote = captures.filter((c) => c.quotes?.some((q) => Math.abs(q.distanceSeconds) <= TOLERANCE_SECONDS))
await writeFile(
  new URL(OUT, root),
  JSON.stringify(
    {
      note:
        "The issuer's own quote at the instant each multiplier change took effect. The quote is the raw underlying price (verified in data/issuer-quote-basis.json), which is the reconciliation's input, and it covers all 194 tokens rather than the 35 with a Chainlink feed. It cannot be read back later: /rhj/prices serves only the present.",
      method:
        "A run scans for UIMultiplierUpdated, which fires about nine minutes before the change, and returns to sample the quote at effectiveAt-30s, effectiveAt and effectiveAt+30s. Work beyond a run's budget is handed to the next run through this file.",
      lastRunAt: iso(nowMs()),
      toleranceSeconds: TOLERANCE_SECONDS,
      summary: {
        steps: captures.length,
        withQuoteAtEffect: withQuote.length,
        givenUp: captures.filter((c) => c.givenUp).length,
      },
      steps: captures,
    },
    null,
    2,
  ) + '\n',
)
console.error(`# wrote ${OUT}: ${captures.length} step(s), ${withQuote.length} with a quote within ${TOLERANCE_SECONDS} s of effect`)
