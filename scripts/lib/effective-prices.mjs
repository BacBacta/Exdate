// The issuer's quote at the instant a multiplier change takes effect.
//
// Why this exists: the reconciliation prices a dividend from the Chainlink round in
// force at effectiveAt. That covers 35 of 194 tokens, and the round can be hours
// old - SGOV's was 15 hours stale. The issuer quotes all 194 tokens, refreshes every
// 15 s, and publishes the raw underlying price, which is exactly the input the
// reconciliation needs (verified: scripts/phase0/check-quote-basis.mjs, SGOV decides
// it at 1 bps against 51.7).
//
// The quote is only useful AT the instant of the step, and it cannot be read back
// afterwards - the endpoint serves the present and nothing else. So something has
// to be there when it happens. What makes that possible is exdate's own finding:
// UIMultiplierUpdated fires about nine minutes BEFORE the change takes effect,
// carrying effectiveAt.
//
// Two things run this logic and they must not drift apart, which is why it is one
// module: the one-shot capture (scripts/capture-effective-prices.mjs) that GitHub's
// schedule fires and that hands unfinished work to the next run through the state
// file, and the persistent watcher (scripts/watch-effective-prices.mjs) that runs
// on a machine and is simply always there. Measured 2026-09-04: GitHub's */5 cron
// fires every 7 to 25 minutes in practice, so the one-shot alone catches roughly
// one step in four. The watcher is the answer; the one-shot is the fallback and,
// once the watcher exists, its watchdog.
//
// Plain ESM with no dependencies, because the GitHub job runs it on a bare `node`
// with no install step. Tested in packages/core/test/effective-prices.test.mjs.

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

export const UI_MULTIPLIER_UPDATED = '0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055'
export const DEFAULT_OUT = 'data/effective-prices.observed.json'

/** Offsets around effectiveAt to sample, in seconds. The nearest one wins later. */
export const SAMPLE_OFFSETS = [-30, 0, 30]
/** Past this, a capture is no longer worth attempting: the price has moved on and the row stays unpriced. */
export const GIVE_UP_AFTER_SECONDS = 3600
/** How close a quote must be to effectiveAt to count as the price at that instant. See packages/core/src/quotes.ts. */
export const TOLERANCE_SECONDS = 120
/**
 * A quote already this close to an offset's target makes another one at the same
 * offset redundant. A run that resumes another's work, or a watcher tick that
 * follows another, would otherwise re-quote every past offset at once.
 */
const OFFSET_ALREADY_COVERED_SECONDS = 10

export const NOTE =
  "The issuer's own quote at the instant each multiplier change took effect. The quote is the raw underlying price (verified in data/issuer-quote-basis.json), which is the reconciliation's input, and it covers all 194 tokens rather than the 35 with a Chainlink feed. It cannot be read back later: /rhj/prices serves only the present."

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const iso = (ms) => new Date(ms).toISOString()
export const hex = (n) => '0x' + BigInt(n).toString(16)
export const keyOf = (token, effectiveAt) => `${token.toLowerCase()}:${effectiveAt}`

const read = (root, path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))

/** Token address -> issuer ticker, from the committed registry. Symbols are only used to ask the issuer for a quote. */
export function loadSymbolMap(root, chainId = '4663') {
  const registry = read(root, 'data/robinhood-assets.snapshot.json')
  const assets = registry.assets ?? registry
  const symbolByToken = new Map()
  for (const asset of assets) {
    for (const d of asset.deployments ?? []) {
      if (String(d.chainId) === chainId) symbolByToken.set(d.contractAddress.toLowerCase(), asset.tokenSymbol)
    }
  }
  return symbolByToken
}

/** The committed state: every step ever announced, with whatever quotes were caught. */
export function loadState(root, out = DEFAULT_OUT) {
  let state
  try {
    state = read(root, out)
  } catch {
    state = { steps: [] }
  }
  const captures = state.steps ?? []
  const byKey = new Map(captures.map((c) => [keyOf(c.token, c.effectiveAt), c]))
  return { state, captures, byKey }
}

/** UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp), all unindexed. */
export function decodeAnnouncement(log) {
  const data = log.data.slice(2)
  const effectiveSeconds = Number(BigInt('0x' + data.slice(128, 192)))
  return {
    token: log.address.toLowerCase(),
    oldMultiplier: BigInt('0x' + data.slice(0, 64)).toString(),
    newMultiplier: BigInt('0x' + data.slice(64, 128)).toString(),
    effectiveSeconds,
    effectiveAt: iso(effectiveSeconds * 1000),
  }
}

/**
 * The issuer answers `local_rate_limited` with HTTP 200, so a status check is not
 * enough. A failed quote is reported, never guessed.
 */
export async function quote(symbol, { fetchImpl = fetch, sleepImpl = sleep, now = Date.now } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleepImpl(700 * attempt)
    try {
      const response = await fetchImpl(`https://api.robinhood.com/rhj/prices/${symbol}`, { headers: { accept: 'application/json' } })
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
        capturedAt: iso(now()),
        isTradingHalt: q.isTradingHalt ?? null,
      }
    } catch {
      // retried, then reported as a miss
    }
  }
  return null
}

/** Records one quote against a capture, keeping them ordered and never duplicating a generatedAt. */
export function record(capture, q) {
  if (!q) return false
  capture.quotes ??= []
  if (capture.quotes.some((existing) => existing.generatedAt === q.generatedAt)) return false
  const distance = Math.round((Date.parse(q.generatedAt) - Date.parse(capture.effectiveAt)) / 1000)
  capture.quotes.push({ ...q, distanceSeconds: distance })
  capture.quotes.sort((a, b) => Math.abs(a.distanceSeconds) - Math.abs(b.distanceSeconds))
  return true
}

/** Seconds between effectiveAt and the nearest quote caught, or Infinity when none was. */
export function closestDistance(capture) {
  return capture.quotes?.length ? Math.min(...capture.quotes.map((q) => Math.abs(q.distanceSeconds))) : Infinity
}

/**
 * Finds announcements in the last `lookbackBlocks` and adds any new step to the
 * state. A quote taken now on a fresh announcement is the "before" price -
 * context, never the reconciliation input - and only worth taking while the
 * instant is still reachable: a quote days after the fact says nothing about that
 * instant and would only invite being read as if it did.
 */
/** Does this error mean "that range is too wide" rather than "that query is wrong"? */
const isRangeError = (message) =>
  /range|too many|limit|exceed|max(imum)?|larger than|query returned more|response size/i.test(String(message))

/**
 * One eth_getLogs, split in half as many times as the endpoint demands.
 *
 * Caps differ per provider and change without notice - Robinhood's own takes
 * 2 000 000 blocks, blockmachine 10 000, ordofi 10 000, and a keyed provider
 * has its own - so the span is discovered from the refusal rather than
 * configured. A range that fails at a single block is a real error and is
 * raised, not swallowed.
 */
export async function getLogsPaged({ rpc, from, to, topics = [UI_MULTIPLIER_UPDATED], log = () => {} }) {
  try {
    return await rpc('eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(to), topics }])
  } catch (error) {
    if (from >= to || !isRangeError(error.message)) throw error
    const middle = Math.floor((from + to) / 2)
    log(`# blocks ${from}..${to} refused (${String(error.message).slice(0, 80)}); splitting`)
    const left = await getLogsPaged({ rpc, from, to: middle, topics, log })
    const right = await getLogsPaged({ rpc, from: middle + 1, to, topics, log })
    return [...left, ...right]
  }
}

export async function scanAnnouncements({
  rpc,
  lookbackBlocks,
  /** First block to scan. Omitted means a cold start: head - lookbackBlocks. */
  fromBlock,
  captures,
  byKey,
  symbolByToken,
  now = Date.now,
  quoteImpl = quote,
  log = () => {},
}) {
  const head = Number(await rpc('eth_blockNumber', []))
  // Where to start. `fromBlock` is what the caller already scanned, so a running
  // watcher asks only for the blocks that appeared since its last tick - about
  // 200 at ten blocks a second, against the 900 000 of a cold start.
  //
  // What this buys is compatibility, not billing: a provider charges per call
  // (Alchemy publishes eth_getLogs at 60 compute units flat), so the steady-state
  // cost is one call either way. What changes is that a 900 000-block query is
  // refused by almost every keyed provider, and by two of the three third-party
  // endpoints measured here - so rescanning the whole lookback every thirty
  // seconds quietly made the watcher unusable anywhere but Robinhood's own RPC,
  // which is the one place the Terms say not to put it.
  const from = Math.max(1, fromBlock ?? head - lookbackBlocks)
  if (from > head) return { changed: false, found: [], head }
  const logs = await getLogsPaged({ rpc, from, to: head, log })
  log(`# scanned blocks ${from}..${head} for announcements: ${logs.length} log(s)`)

  let changed = false
  const found = []
  for (const raw of logs) {
    const { token, oldMultiplier, newMultiplier, effectiveSeconds, effectiveAt } = decodeAnnouncement(raw)
    const key = keyOf(token, effectiveAt)
    if (byKey.has(key)) continue
    const block = await rpc('eth_getBlockByNumber', [raw.blockNumber, false])
    const capture = {
      token,
      symbol: symbolByToken.get(token) ?? null,
      effectiveAt,
      announcedAt: iso(Number(BigInt(block.timestamp)) * 1000),
      announcedTx: raw.transactionHash,
      oldMultiplier,
      newMultiplier,
      quotes: [],
    }
    byKey.set(key, capture)
    captures.push(capture)
    found.push(capture)
    changed = true
    const secondsAway = Math.round((effectiveSeconds * 1000 - now()) / 1000)
    log(`# new announcement ${capture.symbol ?? token} effective ${effectiveAt} (${secondsAway}s away)`)
    if (capture.symbol && secondsAway > -GIVE_UP_AFTER_SECONDS && record(capture, await quoteImpl(capture.symbol))) changed = true
  }
  return { changed, found, head }
}

/** The steps still worth sampling, soonest first: not given up, not yet sampled at the instant, not out of reach. */
export function pendingCaptures(captures, nowMs) {
  return captures
    .filter((c) => c.symbol && !c.givenUp)
    .filter((c) => {
      if (closestDistance(c) <= Math.max(...SAMPLE_OFFSETS)) return false // already sampled at the instant
      return Date.parse(c.effectiveAt) + GIVE_UP_AFTER_SECONDS * 1000 > nowMs // still worth trying
    })
    .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt))
}

/**
 * Samples each pending step at effectiveAt-30s, effectiveAt and effectiveAt+30s,
 * waiting for each instant only while it falls before `deadline`. What falls beyond
 * is left for whoever runs next - the next scheduled run, or the next watcher tick.
 */
export async function sampleCaptures({ pending, deadline, now = Date.now, sleepImpl = sleep, quoteImpl = quote, log = () => {} }) {
  let changed = false
  for (const capture of pending) {
    const effective = Date.parse(capture.effectiveAt)
    for (const offset of SAMPLE_OFFSETS) {
      if (capture.quotes?.some((q) => Math.abs(q.distanceSeconds - offset) <= OFFSET_ALREADY_COVERED_SECONDS)) continue
      const at = effective + offset * 1000
      if (at > deadline) {
        log(`# ${capture.symbol} ${offset >= 0 ? '+' : ''}${offset}s falls beyond this run; the next one picks it up`)
        break
      }
      const wait = at - now()
      if (wait > 0) {
        log(`# waiting ${Math.round(wait / 1000)}s for ${capture.symbol} at effectiveAt${offset >= 0 ? '+' : ''}${offset}s`)
        await sleepImpl(wait)
      }
      const q = await quoteImpl(capture.symbol)
      if (record(capture, q)) {
        changed = true
        // The recorded quote's own distance, not the closest so far: the list is kept sorted.
        const recorded = capture.quotes.find((existing) => existing.generatedAt === q.generatedAt)
        log(`#   ${capture.symbol} mid=${q.mid} generatedAt=${q.generatedAt} distance=${recorded.distanceSeconds}s`)
      }
    }
  }
  return changed
}

/**
 * Closes out anything the clock has put out of reach. The issuer serves the
 * present only, so an instant an hour gone is gone. Saying so once is the honest
 * end state; retrying forever would keep a row looking pending.
 */
export function closeOut(captures, nowMs) {
  let changed = false
  for (const capture of captures) {
    if (capture.givenUp) continue
    if (closestDistance(capture) <= TOLERANCE_SECONDS) continue
    if (Date.parse(capture.effectiveAt) + GIVE_UP_AFTER_SECONDS * 1000 >= nowMs) continue
    capture.givenUp = true
    capture.givenUpReason = capture.symbol
      ? 'no quote within two minutes of effectiveAt, and the issuer publishes no history, so this instant is unrecoverable'
      : 'no symbol in the registry for this token, so no quote could be requested'
    changed = true
  }
  return changed
}

export function summarize(captures) {
  return {
    steps: captures.length,
    withQuoteAtEffect: captures.filter((c) => closestDistance(c) <= TOLERANCE_SECONDS).length,
    givenUp: captures.filter((c) => c.givenUp).length,
  }
}

/**
 * Writes the state file in its published shape. Fields the writer does not own -
 * the watcher's heartbeat, the watchdog's last alert - are carried through from
 * `previous`, so the one-shot and the watcher can share one file without either
 * erasing what the other recorded.
 */
export async function writeState(root, out, { previous, captures, method, patch = {}, now = Date.now }) {
  captures.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
  const { steps: _steps, note: _note, method: _method, lastRunAt: _last, toleranceSeconds: _tol, summary: _sum, ...carried } =
    previous ?? {}
  const state = {
    note: NOTE,
    // Named in the file rather than only in the licence: every quote below is the
    // issuer's, and DATA-LICENSE.md carves the issuer's content out of exdate's own
    // CC BY 4.0 grant. A reader must be able to tell the two apart from the file
    // itself (audit 2026-09-05, F06).
    source: 'robinhood:/rhj/prices',
    exdateObserves: 'which quote was captured, when, and how far from effectiveAt it landed; the refusal and its reason when none was',
    method: method ?? previous?.method ?? null,
    lastRunAt: iso(now()),
    toleranceSeconds: TOLERANCE_SECONDS,
    summary: summarize(captures),
    ...carried,
    ...patch,
    steps: captures,
  }
  await writeFile(new URL(out, root), JSON.stringify(state, null, 2) + '\n')
  return state
}
