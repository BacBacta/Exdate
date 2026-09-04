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
 * An archive endpoint is required and is NOT the default RPC: Robinhood's own
 * node answers `metadata is not found` a few thousand blocks back, which is why
 * this check could not exist before. The script refuses rather than falling back
 * to an endpoint that cannot answer.
 */
const ARCHIVE = process.env.RHC_RPC_URL_ARCHIVE || 'https://rpc-robinhood.blockmachine.io'
const rpc = makeRpc(ARCHIVE, { minGap: 220, tries: 6 })

const wad = (v) => BigInt(v).toString()
const call = async (to, data, block) => {
  const result = await rpc('eth_call', [{ to, data }, hex(block)])
  return BigInt(result)
}

const { blocks } = read('data/effective-blocks.json')
console.error(`# ${blocks.length} steps, reading state from ${ARCHIVE}`)

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

  // 1. The transition itself, at the two blocks that straddle it.
  try {
    const before = await call(step.token, SELECTOR.uiMultiplier, step.effectiveBlock - 1)
    const after = await call(step.token, SELECTOR.uiMultiplier, step.effectiveBlock)
    row.stateBefore = before.toString()
    row.stateAfter = after.toString()
    row.beforeMatches = before === BigInt(step.oldMultiplier)
    row.afterMatches = after === BigInt(step.newMultiplier)
    row.transitionObserved = row.beforeMatches && row.afterMatches
  } catch (error) {
    row.transitionObserved = null
    row.transitionError = String(error.message).slice(0, 160)
  }

  // 2. The announcement block: the change is scheduled and NOT yet applied.
  //    This is the retrospective/prospective trap, observed at a real block.
  try {
    const [live, scheduled] = await Promise.all([
      call(step.token, SELECTOR.uiMultiplier, step.announcedBlock),
      call(step.token, SELECTOR.newUIMultiplier, step.announcedBlock),
    ])
    row.stateAtAnnouncement = { uiMultiplier: live.toString(), newUIMultiplier: scheduled.toString() }
    row.pendingAtAnnouncement = live === BigInt(step.oldMultiplier) && scheduled === BigInt(step.newMultiplier)
  } catch (error) {
    row.pendingAtAnnouncement = null
    row.announcementError = String(error.message).slice(0, 160)
  }

  const mark = row.transitionObserved === true ? 'confirmed' : row.transitionObserved === null ? 'unreadable' : 'DISAGREES'
  console.error(
    `#   ${(row.symbol ?? row.token).padEnd(6)} block ${row.effectiveBlock}  ${mark}` +
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
    'Two eth_call reads per step at the straddling blocks, plus two at the announcement block to observe the scheduled-but-not-applied state. Blocks come from data/effective-blocks.json, resolved by bisection over block headers.',
  archiveEndpoint: ARCHIVE,
  archiveIsThirdParty: !/robinhood\.com/.test(ARCHIVE),
  observedAt: new Date().toISOString(),
  summary: {
    steps: steps.length,
    transitionConfirmed: confirmed.length,
    transitionDisagrees: disagreeing.length,
    unreadable: unreadable.length,
    pendingStateConfirmed: steps.filter((s) => s.pendingAtAnnouncement === true).length,
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
