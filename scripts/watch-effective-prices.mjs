// Be there when a multiplier changes - as a process that stays alive.
//
// The one-shot capture on GitHub's schedule was meant to run every five minutes
// and wait four. Measured on its first morning, GitHub fired it every 7 to 25
// minutes, so a step landing at a random instant was caught roughly one time in
// four. A nine-minute lead needs something that is simply always there, and a
// scheduler cannot promise that. This is that something: a loop on a machine.
//
// Every tick it scans the last day of blocks for UIMultiplierUpdated,
// samples any pending step at effectiveAt-30s, 0 and +30s when those instants
// fall inside the tick, closes out what the clock has put out of reach, and - only
// when something changed - writes the state file, sends the notices, commits and
// pushes. Every six hours it commits a heartbeat even when nothing happened, so
// the watchdog on GitHub (capture-effective-prices.yml in watchdog mode) can tell
// a quiet day from a dead process.
//
// It also carries the second trigger: a window predicted from the issuer's own
// declared processDate, so a landing whose announcement this process was not alive
// to see is still priced. The announcement gives an instant nine minutes ahead;
// the declaration gives a window days ahead. Only the first is an observation, and
// the two never share a field.
//
// It shares one file with that watchdog. Each owns its own field - `watcher` here,
// `watchdog` there - and the steps are merged by key before every write, so
// neither erases what the other recorded. Same logic as the one-shot, from the
// same module (scripts/lib/effective-prices.mjs), so the two cannot drift.
//
//   node scripts/watch-effective-prices.mjs
//
// Needs: a clone on a branch it may push to, a deploy key with write access, and
// optionally the alert sinks from .env.example. EXDATE_WATCH_PUSH=false runs it
// without pushing, for a trial.
import { hostname } from 'node:os'
import { spawn } from 'node:child_process'
import { rpc } from './phase0/rpc.mjs'
import {
  DEFAULT_OUT,
  closeOut,
  iso,
  keyOf,
  loadState,
  loadSymbolMap,
  mergePredicted,
  sampleCaptures,
  samplePredictedFromRecord,
  scanAnnouncements,
  sleep,
  summarize,
  tickOutcome,
  writeState,
} from './lib/effective-prices.mjs'
import { commitAndPush } from './lib/git.mjs'
import { send, sinksFromEnv } from './lib/alert.mjs'

const root = new URL('../', import.meta.url)
const cwd = new URL('.', root).pathname
const OUT = process.env.EXDATE_CAPTURE_OUT || DEFAULT_OUT
/** Seconds between scans. Thirty is far inside the nine-minute lead and gentle on the RPC. */
const TICK_MS = Number(process.env.EXDATE_WATCH_TICK_MS || 30_000)
/** About a day at 0.1 s/block: a step missed during a long outage is still recorded, with its reason. Known steps are skipped by key. */
const LOOKBACK_BLOCKS = Number(process.env.EXDATE_WATCH_LOOKBACK_BLOCKS || 900_000)
/** A heartbeat commit this often even when nothing happened. The watchdog treats older than seven hours as dead. */
const HEARTBEAT_MS = Number(process.env.EXDATE_WATCH_HEARTBEAT_MS || 6 * 3_600_000)
const PUSH = process.env.EXDATE_WATCH_PUSH !== 'false'
const AUTHOR = { name: 'exdate-watcher', email: 'noreply@users.noreply.github.com' }
const METHOD =
  "A persistent process scans for UIMultiplierUpdated every 30 s - it fires about nine minutes before the change - and samples the quote at effectiveAt-30s, effectiveAt and effectiveAt+30s. It also samples across a window predicted from the issuer's own declared processDate, so a landing whose announcement was missed is still priced. It commits what it caught, and a heartbeat every six hours, so the record shows both the captures and that something was watching."
/** Alert once per streak of failed ticks, not once per failure. */
const FAILURES_BEFORE_ALERT = 20
/**
 * How often a predicted window's quotes are committed when nothing else changed.
 *
 * They are written to the file on every tick regardless - that is what makes them survive a crash -
 * but a window is 22 minutes wide and sampled once a minute, so committing each one would put
 * twenty-odd commits on the branch per declared dividend. A push every five minutes keeps the
 * record off one machine's disk without that.
 */
const PREDICTED_COMMIT_MS = Number(process.env.EXDATE_WATCH_PREDICTED_COMMIT_MS || 5 * 60_000)
/**
 * The reconciliation record, which carries the declared dates and every landing already observed.
 *
 * Overridable so the predicted path can be rehearsed against a fixture: a window opens for about
 * twenty minutes a day, so without this the only way to exercise it here is to wait for one. This
 * repository's own history says a path that has only been read is not a path that works.
 */
const DECLARED = process.env.EXDATE_WATCH_DECLARED || 'data/reconciliations.observed.json'

if (!(TICK_MS >= 5_000)) throw new Error(`EXDATE_WATCH_TICK_MS must be at least 5000 ms, got ${TICK_MS}`)
if (!(HEARTBEAT_MS >= TICK_MS)) throw new Error(`EXDATE_WATCH_HEARTBEAT_MS must be at least one tick, got ${HEARTBEAT_MS}`)

const log = (line) => console.error(`${iso(Date.now())} ${line}`)
const sinks = sinksFromEnv()
const symbolByToken = loadSymbolMap(root)
const startedAt = iso(Date.now())

let { captures, byKey, state } = loadState(root, OUT)
/** Predicted windows and the quotes caught in them, keyed on token:processDate. */
const predicted = state.predicted ?? {}
/**
 * The head of the last successful scan. Null means a cold start, which scans the
 * whole lookback so an outage loses nothing; after that only the blocks that
 * appeared since. Deliberately in memory and not on disk: a restart SHOULD
 * re-scan wide, because a restart is exactly when something may have been
 * missed.
 */
let scannedThrough = null
let scans = 0
let lastHeartbeatAt = 0
let failureStreak = 0
let alertedOnStreak = false
let lastPredictedCommitAt = 0

/**
 * Takes whatever the file on disk holds that memory does not: steps another
 * writer added, and the notice fields notify.mjs writes back. Memory wins on a
 * step it already has, since this process is the one sampling it.
 */
function mergeFromDisk() {
  const disk = loadState(root, OUT)
  for (const step of disk.captures) {
    const key = keyOf(step.token, step.effectiveAt)
    const mine = byKey.get(key)
    if (!mine) {
      byKey.set(key, step)
      captures.push(step)
      continue
    }
    for (const field of ['announcedNotifiedAt', 'announcedNotSentReason', 'appliedNotifiedAt']) {
      if (step[field] !== undefined && mine[field] === undefined) mine[field] = step[field]
    }
  }
  mergePredicted(predicted, disk.state?.predicted)
  return disk.state
}

async function persist() {
  const previous = mergeFromDisk()
  await writeState(root, OUT, {
    previous,
    captures,
    method: METHOD,
    // The heartbeat is a claim that a watcher is running on this host, and the
    // watchdog on GitHub treats its absence as a dead machine. A trial run - one
    // that cannot push - is not that, so it does not make the claim. Written the
    // other way round once, a three-minute test in a container replaced the real
    // machine's heartbeat in the committed record with its own hostname, tick
    // and lookback, and only a diff caught it.
    patch: PUSH
      ? {
          predicted,
          watcher: {
            heartbeatAt: iso(Date.now()),
            startedAt,
            host: hostname(),
            scans,
            tickSeconds: TICK_MS / 1000,
            lookbackBlocks: LOOKBACK_BLOCKS,
          },
        }
      : { predicted },
  })
}

/** notify.mjs reads the file, sends, and writes its delivery record back; memory is re-synced from it afterwards. */
function notify() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL('notify.mjs', import.meta.url).pathname], { cwd, stdio: 'inherit' })
    child.on('exit', () => resolve())
    child.on('error', () => resolve())
  })
}

async function publish(message) {
  if (!PUSH) {
    log(`# push disabled; would commit: ${message}`)
    return
  }
  const result = await commitAndPush({ cwd, paths: [OUT], message, author: AUTHOR, rewrite: persist, log })
  if (result.committed) log(`# pushed ${result.sha}: ${message}`)
}

/** One line naming what is being sampled now, for the commit message. */
function predictedSummary() {
  const entries = Object.values(predicted)
  const quotes = entries.reduce((n, e) => n + (e.quotes?.length ?? 0), 0)
  return `${entries.length} window(s), ${quotes} quote(s)`
}

async function tick() {
  const scanned = await scanAnnouncements({
    rpc,
    lookbackBlocks: LOOKBACK_BLOCKS,
    fromBlock: scannedThrough === null ? undefined : scannedThrough + 1,
    captures,
    byKey,
    symbolByToken,
    log,
  })
  scannedThrough = scanned.head
  const pending = pendingCaptures(captures, Date.now())
  const sampled = await sampleCaptures({ pending, deadline: Date.now() + TICK_MS, log })
  const predictedChanged = await samplePredictedFromRecord({ root, declared: DECLARED, captures, byKey, predicted, deadline: Date.now() + TICK_MS, log })
  const closed = closeOut(captures, Date.now())
  scans++

  const outcome = tickOutcome({
    changed: scanned.changed || sampled || closed,
    predictedChanged,
    heartbeatDue: Date.now() - lastHeartbeatAt >= HEARTBEAT_MS,
    predictedCommitDue: Date.now() - lastPredictedCommitAt >= PREDICTED_COMMIT_MS,
  })
  if (!outcome.persist) return
  await persist()
  if (!outcome.publish) return

  if (outcome.publish === 'capture') {
    await notify()
    mergeFromDisk()
    await persist()
  }
  const s = summarize(captures)
  await publish(
    {
      capture: `Capture issuer quotes at effect: ${s.steps} steps, ${s.withQuoteAtEffect} priced at effect, ${s.givenUp} unrecoverable`,
      heartbeat: `Watcher heartbeat: ${scans} scans since ${startedAt}, ${s.steps} steps on record`,
      predicted: `Capture issuer quotes in a predicted landing window: ${predictedSummary()}`,
    }[outcome.publish],
  )
  if (predictedChanged) lastPredictedCommitAt = Date.now()
  // Any commit proves the process is alive, so any commit postpones the next heartbeat - the
  // heartbeat exists to make a quiet day distinguishable from a dead machine, not to count itself.
  lastHeartbeatAt = Date.now()
}

log(`# watching ${symbolByToken.size} tokens from ${hostname()}; tick ${TICK_MS / 1000}s, lookback ${LOOKBACK_BLOCKS} blocks, ${sinks.length} sink(s), push ${PUSH ? 'on' : 'off'}`)
process.on('SIGTERM', () => {
  log('# stopping')
  process.exit(0)
})

for (;;) {
  const began = Date.now()
  try {
    await tick()
    if (failureStreak >= FAILURES_BEFORE_ALERT && alertedOnStreak) {
      await send(sinks, `exdate watcher on ${hostname()}: recovered after ${failureStreak} failed scans`, { log }).catch(() => {})
    }
    failureStreak = 0
    alertedOnStreak = false
  } catch (error) {
    failureStreak++
    log(`# tick failed (${failureStreak}): ${String(error.message).split('\n')[0]}`)
    if (failureStreak >= FAILURES_BEFORE_ALERT && !alertedOnStreak) {
      alertedOnStreak = true
      await send(sinks, `exdate watcher on ${hostname()}: ${failureStreak} consecutive scans failed - last error: ${String(error.message).split('\n')[0]}`, { log }).catch(() => {})
    }
  }
  const elapsed = Date.now() - began
  if (elapsed < TICK_MS) await sleep(TICK_MS - elapsed)
}
