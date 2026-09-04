// Capture the issuer's own quote at the instant a multiplier change takes effect -
// the one-shot form, for GitHub's schedule.
//
// The logic is scripts/lib/effective-prices.mjs, shared with the persistent
// watcher (scripts/watch-effective-prices.mjs); the header there says why the
// quote matters and why something has to be present when it is published. This
// file is what the schedule runs: it scans once, waits for an effectiveAt only
// inside its own budget, and hands the rest to the next run through the state
// file, so nothing depends on one process staying alive or on GitHub firing on
// time.
//
// Measured 2026-09-04: GitHub's */5 cron fires every 7 to 25 minutes in
// practice. Against a nine-minute lead and a four-minute budget that caught about
// one step in four, so the budget is now nine minutes, inside the job's timeout.
// That doubles the odds and does not make them good: the watcher on a machine
// is the answer, and once it runs this job becomes its watchdog.
//
//   node scripts/capture-effective-prices.mjs
//
//   EXDATE_CAPTURE_MODE=capture    scan and sample on every run (default)
//   EXDATE_CAPTURE_MODE=watchdog   check the watcher's heartbeat in the state
//                                  file; capture only while it is stale, and say
//                                  so through the alert sinks on each transition
import { rpc } from './phase0/rpc.mjs'
import {
  DEFAULT_OUT,
  closeOut,
  iso,
  loadState,
  loadSymbolMap,
  pendingCaptures,
  sampleCaptures,
  scanAnnouncements,
  writeState,
} from './lib/effective-prices.mjs'
import { send, sinksFromEnv } from './lib/alert.mjs'

const root = new URL('../', import.meta.url)
const OUT = process.env.EXDATE_CAPTURE_OUT || DEFAULT_OUT
const MODE = process.env.EXDATE_CAPTURE_MODE || 'capture'
/**
 * How long one run may stay alive waiting for an effectiveAt. Nine minutes: the
 * announcement lead, inside the job's timeout. The concurrency group queues the
 * next scheduled run behind a waiting one rather than overlapping it.
 */
const RUN_BUDGET_MS = Number(process.env.EXDATE_CAPTURE_BUDGET_MS || 540_000)
/**
 * How far back to look for announcements: about a day at 0.1 s/block, far wider
 * than any gap between runs, so a step this run is too late for is at least
 * recorded with its reason. Steps already on record are skipped by key, and a
 * topic-only query over this range answers in well under a second.
 */
const LOOKBACK_BLOCKS = Number(process.env.EXDATE_CAPTURE_LOOKBACK_BLOCKS || 900_000)
/** In watchdog mode: a heartbeat older than this means the watcher is not running. It commits one every six hours. */
const STALE_AFTER_MS = Number(process.env.EXDATE_WATCHDOG_STALE_MS || 7 * 3_600_000)
const METHOD =
  "A run scans for UIMultiplierUpdated, which fires about nine minutes before the change, and returns to sample the quote at effectiveAt-30s, effectiveAt and effectiveAt+30s. Work beyond a run's budget is handed to the next run through this file."

const log = (line) => console.error(line)
const { state, captures, byKey } = loadState(root, OUT)
const symbolByToken = loadSymbolMap(root)

// --- watchdog: is the process that should be doing this alive? --------------
let watchdogPatch = {}
if (MODE === 'watchdog') {
  const heartbeatAt = state.watcher?.heartbeatAt ?? null
  const age = heartbeatAt ? Date.now() - Date.parse(heartbeatAt) : Infinity
  const stale = age > STALE_AFTER_MS
  const was = state.watchdog?.stale ?? null
  const sinks = sinksFromEnv()
  const describe = heartbeatAt ? `last heartbeat ${heartbeatAt} (${Math.round(age / 60_000)} min ago)` : 'no heartbeat on record'

  if (stale !== was) {
    // A transition, either way, is worth one message and one line in the file.
    const text = stale
      ? `exdate watcher is silent: ${describe}. The GitHub job is capturing in its place until it returns.`
      : `exdate watcher is back: ${describe}. The GitHub job is standing down.`
    log(`# ${text}`)
    let alerted = false
    try {
      alerted = await send(sinks, text, { log })
    } catch (error) {
      log(`# alert failed: ${error.message}`)
    }
    watchdogPatch = {
      watchdog: { checkedAt: iso(Date.now()), stale, heartbeatAt, alertedAt: alerted ? iso(Date.now()) : (state.watchdog?.alertedAt ?? null) },
    }
    if (!stale) {
      await writeState(root, OUT, { previous: state, captures, method: state.method, patch: watchdogPatch })
      process.exit(0)
    }
  } else if (!stale) {
    log(`# watcher alive: ${describe}; nothing to do`)
    process.exit(0)
  } else {
    log(`# watcher still silent: ${describe}; capturing in its place`)
  }
}

// --- 1. find announcements ---------------------------------------------------
const scanned = await scanAnnouncements({ rpc, lookbackBlocks: LOOKBACK_BLOCKS, captures, byKey, symbolByToken, log })

// --- 2. capture at effectiveAt, waiting only within this run's budget ---------
const sampled = await sampleCaptures({ pending: pendingCaptures(captures, Date.now()), deadline: Date.now() + RUN_BUDGET_MS, log })

// --- 3. close out anything the clock has put out of reach ---------------------
const closed = closeOut(captures, Date.now())

const changed = scanned.changed || sampled || closed || Object.keys(watchdogPatch).length > 0
if (!changed) {
  log('# nothing to record')
  process.exit(0)
}

const written = await writeState(root, OUT, { previous: state, captures, method: MODE === 'watchdog' ? (state.method ?? METHOD) : METHOD, patch: watchdogPatch })
log(`# wrote ${OUT}: ${written.summary.steps} step(s), ${written.summary.withQuoteAtEffect} with a quote within ${written.toleranceSeconds} s of effect`)
