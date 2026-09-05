// What the record said, and when — an index derived from git, not a second write path.
//
//   node scripts/build-history.mjs            # rebuild data/history/*.jsonl
//   node scripts/build-history.mjs --check    # rebuild into memory and diff; exit 1 on drift
//
// The question this answers is "what did exdate publish at time T", and the brief that asked for
// it assumed the answer had to be captured going forward or lost. It does not: `data/` has been
// committed on every change since 2026-09-02, so `git show <commit>:data/reconciliations.observed.json`
// already returns the AAPL haircut as it stood 24 hours ago - 3601 bps at price 305.1711, the
// rounding from before the 2026-09-05 audit's F08 fix. What git does not give is a way to ask the
// question without knowing which commit to look in, and no record of WHICH published claim moved.
//
// So this derives rather than captures. Two consequences, and both are the reason for the choice:
// a derived index cannot drift from the record the way a parallel write path can - the failure this
// project measured four times on 2026-09-05 - and it is reproducible, so `--check` is a real test
// rather than a promise. Nothing here is appended by hand and nothing is authoritative but git.
//
// Only PUBLISHED claims are indexed - the figures that reach a page, the API or the token list -
// not every field of every file. An index of everything would be a second copy of the repository;
// an index of what was claimed is a record of what someone could have read and acted on.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const root = new URL('../', import.meta.url).pathname
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

/** A comparable scalar, or undefined to leave the field out of this revision. */
const join = (value) => (Array.isArray(value) ? value.join('+') : value ?? null)
const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : value)

/**
 * One entry per dataset: where it lives, and which claims to follow.
 *
 * `claims` turns a parsed file into a Map of key -> {field: value}. The key must be stable across
 * revisions - it is what makes a change a change rather than a removal and an addition - so it is
 * built from an address and an instant, never from an array index or a symbol.
 */
const DATASETS = [
  {
    name: 'reconciliations',
    path: 'data/reconciliations.observed.json',
    // Which indexed fields are copied from the issuer rather than measured by exdate. The index
    // inherits the carve-out of the file it indexes: DATA-LICENSE.md excludes the issuer's columns
    // from exdate's CC BY 4.0 grant, and a reader of the index alone could not otherwise tell.
    issuerFields: ['rate'],
    claims: (file) =>
      new Map(
        (file.rows ?? file.reconciliations ?? []).map((row) => [
          `${lower(row.token)}:${row.change?.effectiveAt ?? row.processDate ?? 'none'}:${row.actionId ?? 'none'}`,
          {
            status: row.status,
            impliedHaircutBps: row.impliedHaircutBps ?? null,
            receivedPerShare: row.receivedPerShare ?? null,
            rate: row.rate ?? null,
            priceValue: row.price?.value ?? null,
            priceSource: row.price?.source ?? null,
            feedCorroboratedBy: join(row.feed?.corroboratedBy),
          },
        ]),
      ),
  },
  {
    name: 'multiplier-events',
    path: 'data/multiplier-events.observed.json',
    issuerFields: [],
    claims: (file) =>
      new Map(
        (file.events ?? []).map((event) => [
          `${lower(event.token)}:${event.effectiveAt}`,
          { newMultiplier: event.newMultiplier, stepBps: event.stepBps, block: event.block, tx: event.tx },
        ]),
      ),
  },
  {
    name: 'token-feed-map',
    path: 'data/token-feed-map.json',
    claims: (file) =>
      new Map(
        (file.pairs ?? []).map((pair) => [
          lower(pair.token),
          { feedProxy: lower(pair.feedProxy), corroboratedBy: join(pair.corroboratedBy), verified: pair.verified },
        ]),
      ),
  },
  {
    name: 'multiplier-state-verification',
    path: 'data/multiplier-state-verification.json',
    claims: (file) =>
      new Map(
        (file.steps ?? []).map((step) => [
          `${lower(step.token)}:${step.effectiveAt}`,
          {
            transitionObserved: step.transitionObserved,
            stateAfter: step.stateAfter ?? null,
            witnessesAnswering: step.witnessesAnswering ?? null,
          },
        ]),
      ),
  },
  {
    name: 'session-share',
    path: 'data/session-share.observed.json',
    claims: (file) =>
      new Map([
        [
          'off-hours-share',
          {
            sufficient: file.sufficient ?? null,
            offHours: file.transferShare?.offHours ?? null,
            provableOffHours: file.provableTradeShare?.offHours ?? null,
            sampleCount: file.sampleCount ?? null,
          },
        ],
      ]),
  },
  {
    name: 'primary-flows',
    path: 'data/primary-flows.observed.json',
    claims: (file) =>
      new Map(
        (file.windows ?? []).map((window) => [
          `window:${window.fromBlock}`,
          { netCreated: window.netCreated, mints: window.mints, burns: window.burns, incomplete: window.incomplete },
        ]),
      ),
  },
]

/**
 * A shallow checkout cannot answer this, and must say so.
 *
 * `actions/checkout` clones at depth 1 by default, so `git log` sees one commit and the index
 * rebuilds as a truncated version of itself. The first CI run of this check reported "the committed
 * index is not what git yields", which is true and useless: it sends a reader hunting for drift
 * that does not exist. A check has to fail for the reason that is actually true - the same lesson
 * as the probe that answered without a credential and the one that matched its own filename.
 */
function refuseIfShallow() {
  if (git('rev-parse', '--is-shallow-repository').trim() !== 'true') return
  console.error('# this is a shallow checkout: git log sees one commit, so the index cannot be rebuilt or checked.')
  console.error('# in CI, give actions/checkout `with: { fetch-depth: 0 }`; locally, `git fetch --unshallow`.')
  process.exit(1)
}

/** Every commit that touched a path, oldest first, with the commit date git recorded. */
function revisions(path) {
  const log = git('log', '--reverse', '--format=%H\t%cI', '--', path).trim()
  return log ? log.split('\n').map((line) => { const [commit, at] = line.split('\t'); return { commit, at } }) : []
}

function buildOne(dataset) {
  const lines = []
  let previous = new Map()
  let revision = 0
  for (const { commit, at } of revisions(dataset.path)) {
    let claims
    try {
      claims = dataset.claims(JSON.parse(git('show', `${commit}:${dataset.path}`)))
    } catch (error) {
      // A commit where the file was not valid JSON, or the shape predates a rename. Recorded as a
      // gap rather than skipped silently: an index that quietly omits a revision is worse than one
      // that says it could not read it.
      lines.push(JSON.stringify({ observedAt: at, commit: commit.slice(0, 7), dataset: dataset.name, unreadable: String(error.message).slice(0, 120) }))
      continue
    }
    revision += 1
    for (const [key, now] of claims) {
      const before = previous.get(key)
      if (!before) {
        lines.push(JSON.stringify({ observedAt: at, commit: commit.slice(0, 7), dataset: dataset.name, key, revision, change: 'first', to: now }))
        continue
      }
      const moved = Object.keys(now).filter((field) => JSON.stringify(now[field]) !== JSON.stringify(before[field]))
      for (const field of moved) {
        lines.push(JSON.stringify({ observedAt: at, commit: commit.slice(0, 7), dataset: dataset.name, key, revision, change: 'changed', field, from: before[field] ?? null, to: now[field] ?? null }))
      }
    }
    for (const key of previous.keys()) {
      if (!claims.has(key)) {
        lines.push(JSON.stringify({ observedAt: at, commit: commit.slice(0, 7), dataset: dataset.name, key, revision, change: 'withdrawn' }))
      }
    }
    previous = claims
  }
  return lines.join('\n') + (lines.length ? '\n' : '')
}

/**
 * Replay the index up to an instant: what the record claimed at time T.
 *
 *   node scripts/build-history.mjs --as-of 2026-09-04T22:00:00Z --dataset reconciliations
 *
 * Deliberately NOT an API route. The hosted API compiles its data in at image build and rebuilds
 * only on code changes, so a route reading this file would answer with whatever history the last
 * code deploy happened to carry - a surface that silently lies about the recent past, which is the
 * failure this whole index exists to make visible. The index is committed and served as a file
 * like every other dataset; this replay is the reference reader for it.
 */
function asOf(datasetName, instant, keyFilter) {
  const path = new URL(`data/history/${datasetName}.jsonl`, `file://${root}`).pathname
  if (!existsSync(path)) throw new Error(`no index for ${datasetName}; run node scripts/build-history.mjs`)
  const cutoff = Date.parse(instant)
  if (Number.isNaN(cutoff)) throw new Error(`not a date: ${instant}`)
  const state = new Map()
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line)
    if (Date.parse(entry.observedAt) > cutoff || !entry.key) continue
    if (entry.change === 'first') state.set(entry.key, { ...entry.to, _observedAt: entry.observedAt, _commit: entry.commit })
    else if (entry.change === 'withdrawn') state.delete(entry.key)
    else if (entry.change === 'changed') {
      const row = state.get(entry.key)
      if (row) Object.assign(row, { [entry.field]: entry.to, _observedAt: entry.observedAt, _commit: entry.commit })
    }
  }
  return keyFilter ? new Map([...state].filter(([key]) => key.includes(keyFilter))) : state
}

const flag = (name) => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1] }
if (flag('--as-of')) {
  const dataset = flag('--dataset') ?? 'reconciliations'
  const rows = asOf(dataset, flag('--as-of'), flag('--key'))
  console.log(JSON.stringify({ dataset, asOf: flag('--as-of'), claims: Object.fromEntries(rows) }, null, 2))
  process.exit(0)
}

/**
 * The index is only worth having if replaying it returns what the file actually held. So --check
 * does not merely rebuild: for every revision of every dataset it replays the index to that
 * instant and compares the claims, field by field, against `git show` at that commit. A test that
 * only re-derived the index from git would pass even if the replay logic were wrong in both
 * directions at once.
 */
function replayMatchesGit(dataset) {
  const problems = []
  for (const { commit, at } of revisions(dataset.path)) {
    let expected
    try {
      expected = dataset.claims(JSON.parse(git('show', `${commit}:${dataset.path}`)))
    } catch {
      continue // an unreadable revision is recorded in the index as a gap; nothing to compare
    }
    const replayed = asOf(dataset.name, at)
    for (const [key, want] of expected) {
      const got = replayed.get(key)
      if (!got) { problems.push(`${commit.slice(0, 7)} ${key}: missing from the replay`); continue }
      for (const field of Object.keys(want)) {
        if (JSON.stringify(got[field] ?? null) !== JSON.stringify(want[field] ?? null)) {
          problems.push(`${commit.slice(0, 7)} ${key}.${field}: replay ${JSON.stringify(got[field] ?? null)}, git ${JSON.stringify(want[field] ?? null)}`)
        }
      }
    }
    for (const key of replayed.keys()) {
      if (!expected.has(key)) problems.push(`${commit.slice(0, 7)} ${key}: in the replay, not in the file`)
    }
    if (problems.length > 5) break
  }
  return problems
}

const check = process.argv.includes('--check')
refuseIfShallow()
let drift = 0
for (const dataset of DATASETS) {
  const out = new URL(`data/history/${dataset.name}.jsonl`, `file://${root}`).pathname
  const built = buildOne(dataset)
  const changes = built ? built.trimEnd().split('\n').length : 0
  if (check) {
    const held = existsSync(out) ? readFileSync(out, 'utf8') : ''
    if (held !== built) {
      console.error(`FAIL ${dataset.name}: the committed index is not what git yields (${held.length} bytes held, ${built.length} rebuilt)`)
      drift++
      continue
    }
    const problems = replayMatchesGit(dataset)
    if (problems.length) {
      console.error(`FAIL ${dataset.name}: replaying the index does not return what the file held`)
      for (const problem of problems.slice(0, 5)) console.error(`       ${problem}`)
      drift++
    } else {
      console.error(`ok   ${dataset.name}: ${changes} entries, reproducible from git and replaying to every revision`)
    }
    continue
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, built)
  console.error(`# ${dataset.name}: ${changes} entries -> data/history/${dataset.name}.jsonl`)
}

// A manifest beside the lines, because JSONL carries no header: what each dataset indexes, which
// of its fields are the issuer's, and how to read the whole thing back.
if (!check) {
  const manifest = {
    note: "What the record claimed, and when. Derived from git rather than captured: every entry is a change between two commits of a file in data/, so this index cannot drift from the record and can be rebuilt and checked. Replay it with: node scripts/build-history.mjs --as-of <iso> --dataset <name>",
    generatedFrom: 'git history of the files below; nothing here is written by hand',
    reproduce: 'node scripts/build-history.mjs --check',
    datasets: DATASETS.map((dataset) => ({
      name: dataset.name,
      indexes: dataset.path,
      file: `data/history/${dataset.name}.jsonl`,
      /** Fields copied from the issuer, excluded from exdate's CC BY 4.0 grant (DATA-LICENSE.md). */
      issuerFields: dataset.issuerFields ?? [],
    })),
  }
  const out = new URL('data/history/index.json', `file://${root}`).pathname
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
  console.error('# manifest -> data/history/index.json')
}

if (check && drift) {
  console.error('\n# run: node scripts/build-history.mjs')
  process.exit(1)
}
