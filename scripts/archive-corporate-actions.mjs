// Keep every corporate action the issuer has ever published.
//
// `GET /rhj/corporate-actions` is a WINDOW, not a history: it returns 43 rows
// and nothing before 2026-08-05. `limit` is the only request field it accepts
// (`limit=500` returns the same 43), so there is no pagination and no date
// filter to reach further back. Everything that falls out of that window is
// gone from every first-party source - which is exactly what happened to the
// five July actions behind CRWD, SGOV, MU, ORCL and DELL, whose multiplier
// steps are on chain and will never have a declared rate to reconcile against.
//
// This script is the answer to that: it merges the live window into a committed
// archive, keyed on (issuer id, processDate), and records when each row was
// first and last seen and every status it has been through. Run it on a
// schedule - daily is ample against a month-deep window - and the erosion stops
// costing anything from that day on.
//
//   node scripts/archive-corporate-actions.mjs [--dry-run]
//
// The archive is committed to git, so the dataset survives a wiped database and
// is publishable on its own.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const ENDPOINT = 'https://api.robinhood.com/rhj/corporate-actions?limit=500'
const ARCHIVE = 'data/corporate-actions.archive.json'
const SNAPSHOT = 'data/robinhood-corporate-actions.snapshot.json'
const DRY_RUN = process.argv.includes('--dry-run')

const isoDate = (date) =>
  date ? `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}` : null

/** One action is (id, processDate): the issuer's id names a monthly series. */
const keyOf = (row) => `${row.id}:${isoDate(row.processDate) ?? 'undated'}`

const now = new Date().toISOString()

const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
const text = await response.text()
if (!response.ok) throw new Error(`GET ${ENDPOINT}: HTTP ${response.status}`)
let live
try {
  live = JSON.parse(text)
} catch {
  // The issuer answers `local_rate_limited` with HTTP 200. Refusing to write is
  // the whole point: an archive that swallows a bad read prunes itself.
  throw new Error(`response was not JSON: ${text.slice(0, 120)}`)
}
const rows = live.corpActions ?? []
if (rows.length === 0) throw new Error('the endpoint returned no actions; refusing to write an empty window')

const archive = existsSync(ARCHIVE)
  ? JSON.parse(readFileSync(ARCHIVE, 'utf8'))
  : {
      note: '',
      source: 'robinhood:/rhj/corporate-actions',
      firstArchivedAt: now,
      lastArchivedAt: now,
      actions: [],
    }

// Seed from the committed snapshot the first time, so nothing observed before
// this script existed is lost by starting from an empty file.
if (archive.actions.length === 0 && existsSync(SNAPSHOT)) {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  const seedRows = snapshot.corpActions ?? snapshot.actions ?? []
  // The snapshot carries no timestamp of its own, so the sighting is dated by
  // the file rather than invented: git knows when it was committed.
  const seenAt = snapshot.fetchedAt ?? snapshot.generatedAt ?? statSync(SNAPSHOT).mtime.toISOString()
  for (const row of seedRows) {
    archive.actions.push({ ...row, firstSeenAt: seenAt, lastSeenAt: seenAt, seenCount: 1, statusHistory: [] })
  }
  console.error(`# seeded ${seedRows.length} row(s) from ${SNAPSHOT}`)
}

const byKey = new Map(archive.actions.map((row) => [keyOf(row), row]))

let added = 0
let updated = 0
for (const row of rows) {
  const key = keyOf(row)
  const existing = byKey.get(key)
  if (!existing) {
    byKey.set(key, { ...row, firstSeenAt: now, lastSeenAt: now, seenCount: 1, statusHistory: [] })
    added++
    continue
  }
  // A row can legitimately change: IN_PROGRESS becomes COMPLETED, and a rate can
  // be corrected. Both are kept - the archive records what the issuer said and
  // when, not only what it says now.
  if (existing.status !== row.status) {
    existing.statusHistory = [
      ...(existing.statusHistory ?? []),
      { status: existing.status, until: now },
    ]
    updated++
  }
  const rateChanged = JSON.stringify(existing.details) !== JSON.stringify(row.details)
  if (rateChanged) {
    existing.detailsHistory = [...(existing.detailsHistory ?? []), { details: existing.details, until: now }]
    updated++
  }
  Object.assign(existing, row, {
    firstSeenAt: existing.firstSeenAt,
    lastSeenAt: now,
    seenCount: (existing.seenCount ?? 1) + 1,
    statusHistory: existing.statusHistory,
    ...(existing.detailsHistory ? { detailsHistory: existing.detailsHistory } : {}),
  })
}

/** In the window today, or fallen out of it and only in the archive. */
const liveKeys = new Set(rows.map(keyOf))
const actions = [...byKey.values()].sort((a, b) => (isoDate(a.processDate) ?? '').localeCompare(isoDate(b.processDate) ?? ''))
for (const row of actions) row.inWindow = liveKeys.has(keyOf(row))

const dates = actions.map((row) => isoDate(row.processDate)).filter(Boolean).sort()
const output = {
  note:
    'Every corporate action the issuer has published while exdate was watching. GET /rhj/corporate-actions is a window about a month deep with no pagination and no date filter, so a row that falls out of it is unrecoverable from any first-party source. Keyed on (issuer id, processDate): the id alone names a monthly series. Refresh with node scripts/archive-corporate-actions.mjs.',
  source: 'robinhood:/rhj/corporate-actions',
  firstArchivedAt: archive.firstArchivedAt ?? now,
  lastArchivedAt: now,
  windowRows: rows.length,
  archivedRows: actions.length,
  beyondWindow: actions.filter((row) => !row.inWindow).length,
  earliestProcessDate: dates[0] ?? null,
  latestProcessDate: dates.at(-1) ?? null,
  actions,
}

console.error(
  `# window ${rows.length} rows (${dates[0]} to ${dates.at(-1)}) | archive ${actions.length} rows, ${output.beyondWindow} beyond the window | +${added} new, ${updated} change(s)`,
)
if (DRY_RUN) {
  console.error('# --dry-run: nothing written')
} else {
  writeFileSync(ARCHIVE, `${JSON.stringify(output, null, 2)}\n`)
  console.error(`# wrote ${ARCHIVE}`)
}
