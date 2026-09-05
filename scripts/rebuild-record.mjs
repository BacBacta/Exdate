// Rebuild everything that is derived from the record, in the one order that is correct.
//
//   node scripts/rebuild-record.mjs            # full: re-reads prices, for a daily run
//   node scripts/rebuild-record.mjs --offline  # pure: no network, for an hourly run
//
// Four files in data/ and one generated module are functions of the others, and until
// the 2026-09-05 data audit each was rebuilt by whichever workflow happened to touch
// its input. The result was measured: the map, the token list, the reconciliation file
// and the API disagreed about 6 token -> feed pairings of 35, and DELL read
// "traded-price" on the token list while its own page said "ticker only" (F03). A
// reader cannot tell which surface is current, so they must not be able to differ.
//
// The order is the dependency order and is not negotiable:
//
//   token-feed-map.json ─┬─> reconciliations.observed.json ─> (nothing)
//                        ├─> generated/registry.ts ──────────> the indexer and the API
//                        └─> exdate.tokenlist.json ─────────> wallets and aggregators
//   multiplier-events.observed.json ─> all three
//   corporate-actions.archive.json ──> reconciliations, registry, token list
//
// --offline exists because the reconciliation rebuild is the only step that reads the
// network, and reading it hourly is both wasteful and a way for a transient failure to
// rewrite a published haircut. Offline it is stamped instead: the corroboration block
// is re-derived from the map and nothing else is touched. The registry and the token
// list are pure either way.
import { spawnSync } from 'node:child_process'

const offline = process.argv.includes('--offline')
const steps = [
  {
    what: offline
      ? "restamp each reconciliation's feed block from the map"
      : 'rebuild the reconciliations, re-reading the price at each step',
    argv: offline ? ['scripts/build-reconciliations.mjs', '--stamp'] : ['scripts/build-reconciliations.mjs'],
  },
  { what: 'regenerate the registry the indexer and the API compile in', argv: ['scripts/generate-registry.mjs'] },
  { what: 'rebuild the published token list', argv: ['scripts/build-token-list.mjs'] },
]

for (const step of steps) {
  console.error(`# ${step.what}`)
  const run = spawnSync(process.execPath, step.argv, { stdio: 'inherit' })
  if (run.status !== 0) {
    console.error(`# ${step.argv[0]} exited ${run.status ?? 'on a signal'}; stopping rather than leaving the record half-rebuilt`)
    process.exit(run.status ?? 1)
  }
}

console.error(`# record rebuilt${offline ? ' (offline)' : ''}`)
