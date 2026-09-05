// Confirm every multiplier step against the chain's own state, not just its log.
//
// The gap this closes is the one ERC-8056 leaves open, and it is the project's
// oldest documented limitation: UIMultiplierUpdated fires ONCE, at announcement,
// carrying a future effectiveAt. Nothing is emitted when the change actually
// takes effect - verified here and in Base's own B20 changelog. Until now exdate
// derived the application from the clock, which is inference, and said so.
//
// It is no longer inference. Robinhood's own endpoint keeps no archive, but a
// public third-party one does (data/rpc-endpoints.observed.json), so
// `uiMultiplier()` can be read at the block before effectiveAt and at the block
// itself. Two reads per step turn "the log said it would" into "the state says
// it did", at a named block, with the transition observed.
//
// Three things are checked per step, and each can fail on its own:
//
//   before   uiMultiplier() at effectiveBlock-1 equals the log's oldMultiplier
//   after    uiMultiplier() at effectiveBlock   equals the log's newMultiplier
//   pending  at the ANNOUNCEMENT block, uiMultiplier() is still old while
//            newUIMultiplier() already carries the new value - the retrospective
//            trap in "Known traps", observed rather than reasoned about
//
// A step whose reads fail is reported as unconfirmed with the error. Nothing is
// filled in, and a disagreement is published as a disagreement: if the state
// ever contradicted the log, that would be the most important row in the file.
//
//   node scripts/verify-multiplier-history.mjs
//   RHC_RPC_URL_ARCHIVE=https://… node scripts/verify-multiplier-history.mjs
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { makeRpc, SELECTOR, hex } from './phase0/rpc.mjs'

const root = new URL('../', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const OUT = process.env.EXDATE_HISTORY_OUT || 'data/multiplier-state-verification.json'

/**
 * Archive endpoints, plural. One is required and it is NOT the default RPC:
 * Robinhood's own node answers `metadata is not found` a few thousand blocks back,
 * which is why this check could not exist before.
 *
 * Every endpoint that can answer is asked, rather than one (audit 2026-09-05, F04).
 * The set of third parties serving archive state changes without notice - pocket
 * had it one morning and not that evening, ordofi gained it the same day and had
 * lost it again by the audit - so a file that rests on whichever endpoint happened
 * to be named rests on one witness, and cannot say so. Asking all of them makes the
 * witness count a measurement: it is 1 on a bad day and says 1, and a disagreement
 * between two endpoints becomes the most important row in the file rather than a
 * fact nobody could have seen.
 *
 * Candidates come from data/rpc-endpoints.observed.json - the ones the probe found
 * reaching the oldest step - with blockmachine appended because it is the one that
 * has answered throughout. Override with RHC_RPC_URLS_ARCHIVE (comma-separated) or
 * the older single-valued RHC_RPC_URL_ARCHIVE.
 */
const KNOWN_ARCHIVE = 'https://rpc-robinhood.blockmachine.io'
function archiveCandidates() {
  const configured = process.env.RHC_RPC_URLS_ARCHIVE || process.env.RHC_RPC_URL_ARCHIVE
  if (configured) return [...new Set(configured.split(',').map((url) => url.trim()).filter(Boolean))]
  let probed = []
  try {
    const observed = read('data/rpc-endpoints.observed.json')
    const rows = Object.values(observed).find((value) => Array.isArray(value) && value.some((row) => row?.url))
    probed = (rows ?? []).filter((row) => row.reachesOldestStep === true).map((row) => row.url)
  } catch {
    // No probe on disk is not a reason to read nothing.
  }
  return [...new Set([...probed, KNOWN_ARCHIVE])]
}

const ARCHIVES = archiveCandidates()
const hostOf = (url) => new URL(url).host
const rpcFor = new Map(ARCHIVES.map((url) => [url, makeRpc(url, { minGap: 220, tries: 4 })]))

const wad = (v) => BigInt(v).toString()
const call = async (url, to, data, block) => {
  const result = await rpcFor.get(url)('eth_call', [{ to, data }, hex(block)])
  return BigInt(result)
}

const { blocks } = read('data/effective-blocks.json')
console.error(`# ${blocks.length} steps, reading state from ${ARCHIVES.length} endpoint(s): ${ARCHIVES.map(hostOf).join(', ')}`)

const steps = []
for (const step of blocks) {
  const row = {
    token: step.token,
    symbol: step.symbol,
    effectiveAt: step.effectiveAt,
    announcedBlock: step.announcedBlock,
    effectiveBlock: step.effectiveBlock,
    declaredOldMultiplier: wad(step.oldMultiplier),
    declaredNewMultiplier: wad(step.newMultiplier),
  }

  // Each endpoint is asked the same four questions, and answers for itself.
  //
  //   1. the transition, at the two blocks that straddle it
  //   2. the announcement block, where the change is scheduled and NOT yet applied -
  //      the retrospective/prospective trap, observed at a real block
  row.witnesses = []
  for (const url of ARCHIVES) {
    const witness = { host: hostOf(url), isThirdParty: !/robinhood\.com/.test(url) }
    try {
      const before = await call(url, step.token, SELECTOR.uiMultiplier, step.effectiveBlock - 1)
      const after = await call(url, step.token, SELECTOR.uiMultiplier, step.effectiveBlock)
      witness.stateBefore = before.toString()
      witness.stateAfter = after.toString()
      witness.beforeMatches = before === BigInt(step.oldMultiplier)
      witness.afterMatches = after === BigInt(step.newMultiplier)
      witness.transitionObserved = witness.beforeMatches && witness.afterMatches
    } catch (error) {
      witness.transitionObserved = null
      witness.transitionError = String(error.message).slice(0, 160)
    }
    try {
      const [live, scheduled] = await Promise.all([
        call(url, step.token, SELECTOR.uiMultiplier, step.announcedBlock),
        call(url, step.token, SELECTOR.newUIMultiplier, step.announcedBlock),
      ])
      witness.stateAtAnnouncement = { uiMultiplier: live.toString(), newUIMultiplier: scheduled.toString() }
      witness.pendingAtAnnouncement = live === BigInt(step.oldMultiplier) && scheduled === BigInt(step.newMultiplier)
    } catch (error) {
      witness.pendingAtAnnouncement = null
      witness.announcementError = String(error.message).slice(0, 160)
    }
    row.witnesses.push(witness)
  }

  // The row states what the endpoints that could answer say. A witness that could
  // not read the height is silent, not a vote: `unreadable` means NOBODY answered.
  // Two witnesses reading different state at one block is the loudest thing this
  // file can report, so it gets its own flag rather than being averaged away.
  const answered = row.witnesses.filter((w) => w.transitionObserved !== null)
  const distinctStates = new Set(answered.map((w) => `${w.stateBefore}:${w.stateAfter}`))
  row.witnessesAsked = row.witnesses.length
  row.witnessesAnswering = answered.length
  row.witnessesDisagree = distinctStates.size > 1
  const spokesman = answered.find((w) => w.transitionObserved === true) ?? answered[0]
  if (spokesman) {
    row.stateBefore = spokesman.stateBefore
    row.stateAfter = spokesman.stateAfter
    row.beforeMatches = spokesman.beforeMatches
    row.afterMatches = spokesman.afterMatches
    row.transitionObserved = row.witnessesDisagree ? false : spokesman.transitionObserved
  } else {
    row.transitionObserved = null
    row.transitionError = row.witnesses[0]?.transitionError ?? 'no archive endpoint answered'
  }
  const pending = row.witnesses.filter((w) => w.pendingAtAnnouncement !== null)
  row.stateAtAnnouncement = pending[0]?.stateAtAnnouncement
  row.pendingAtAnnouncement = pending.length ? pending.every((w) => w.pendingAtAnnouncement) : null

  const mark = row.transitionObserved === true ? 'confirmed' : row.transitionObserved === null ? 'unreadable' : 'DISAGREES'
  console.error(
    `#   ${(row.symbol ?? row.token).padEnd(6)} block ${row.effectiveBlock}  ${mark}` +
      `  (${row.witnessesAnswering}/${row.witnessesAsked} witnesses)` +
      (row.transitionObserved === false ? `  state ${row.stateBefore} -> ${row.stateAfter}` : ''),
  )
  steps.push(row)
}

const confirmed = steps.filter((s) => s.transitionObserved === true)
const disagreeing = steps.filter((s) => s.transitionObserved === false)
const unreadable = steps.filter((s) => s.transitionObserved === null)

const result = {
  note:
    "Every multiplier step confirmed against the chain's own state. ERC-8056 emits UIMultiplierUpdated once, at announcement, carrying a future effectiveAt, and emits NOTHING when the change takes effect - so until an archive endpoint was found, the application was derived from the clock rather than observed. Reading uiMultiplier() at the block before effectiveAt and at the block itself makes the transition a measurement.",
  method:
    'Four eth_call reads per step per endpoint: the two straddling blocks, plus two at the announcement block to observe the scheduled-but-not-applied state. Every archive endpoint that answers is asked and recorded under witnesses[]; a step reads `unreadable` only when none answered, and `witnessesDisagree` when two of them read different state at one block. Blocks come from data/effective-blocks.json, resolved by bisection over block headers.',
  archiveEndpoints: ARCHIVES.map(hostOf),
  archiveEndpoint: ARCHIVES[0],
  archiveIsThirdParty: ARCHIVES.every((url) => !/robinhood\.com/.test(url)),
  observedAt: new Date().toISOString(),
  summary: {
    steps: steps.length,
    transitionConfirmed: confirmed.length,
    transitionDisagrees: disagreeing.length,
    unreadable: unreadable.length,
    pendingStateConfirmed: steps.filter((s) => s.pendingAtAnnouncement === true).length,
    endpointsAsked: ARCHIVES.length,
    /** The weakest step: how many independent endpoints back the least-witnessed row. */
    minWitnessesPerStep: steps.length ? Math.min(...steps.map((s) => s.witnessesAnswering)) : 0,
    stepsWithTwoOrMoreWitnesses: steps.filter((s) => s.witnessesAnswering >= 2).length,
  },
  steps,
}

await writeFile(new URL(OUT, root), JSON.stringify(result, null, 2) + '\n')
console.error(
  `# wrote ${OUT}: ${confirmed.length}/${steps.length} transitions confirmed in state, ` +
    `${result.summary.pendingStateConfirmed} pending states observed at announcement` +
    (disagreeing.length ? `, ${disagreeing.length} DISAGREE` : '') +
    (unreadable.length ? `, ${unreadable.length} unreadable` : ''),
)
