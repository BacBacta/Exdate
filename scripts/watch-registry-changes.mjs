// Record what the issuer changes about an asset, so a real transition exists before a handler does.
//
//   node scripts/watch-registry-changes.mjs
//
// The roadmap's chantier 2 is "corporate actions beyond dividends", and the facts refuse it today:
// all 45 archived actions are CASH_DIVIDEND, the only detail field ever seen is `cashDividend`, and
// all 194 assets are ASSET_STATUS_ACTIVE. Zero mergers, zero ticker changes, zero delistings. A
// handler written against an imagined payload is untestable code that looks like coverage.
//
// So this is 2a and nothing else: watch the registry, record every transition, and let the record
// decide when a handler is worth writing. It is cheap - one committed file, diffed against the
// snapshot a collector already refreshes daily - and it is the only thing that can turn "we have
// never seen a ticker change" into "here is one, on this date, in this shape".
//
// It observes the fields whose change means something happened to the ASSET, not to its price:
// the ticker, the name, the ISIN, the status, the tradability flags, the decimals, and the set of
// deployed addresses. The multiplier is deliberately NOT among them - it moves on every dividend,
// it is measured everywhere else in this repository, and including it would bury a real transition
// under a hundred routine ones.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const OUT = 'data/registry-changes.observed.json'
const SNAPSHOT = 'data/robinhood-assets.snapshot.json'

const snapshot = JSON.parse(readFileSync(new URL(SNAPSHOT, root), 'utf8'))
const assets = snapshot.assets ?? []
if (!snapshot.fetchedAt) {
  console.error(`# ${SNAPSHOT} has no fetchedAt; refusing to date a transition from a snapshot that cannot date itself`)
  process.exit(1)
}
// A read that failed must never be recorded as 194 delistings. The snapshot writer refuses to
// write an empty registry, but this reads whatever is on disk, so it checks again.
if (assets.length === 0) {
  console.error(`# ${SNAPSHOT} holds no assets; refusing to record every token as removed`)
  process.exit(1)
}

const held = (() => {
  try {
    return JSON.parse(readFileSync(new URL(OUT, root), 'utf8'))
  } catch {
    return null
  }
})()

/**
 * What is watched, and why each one is here.
 *
 * `tradingCapabilities` is flattened to a stable string rather than compared as an object: it is
 * three sessions x two lot sizes, and a reader wants "overnight fractional stopped being tradable",
 * not a JSON diff.
 */
const shapeOf = (asset) => ({
  tokenSymbol: asset.tokenSymbol ?? null,
  tokenName: asset.tokenName ?? null,
  isin: asset.isin ?? null,
  status: asset.status ?? null,
  tokenDecimals: asset.tokenDecimals ?? null,
  deployments: (asset.deployments ?? [])
    .map((deployment) => `${deployment.chainId}:${String(deployment.contractAddress).toLowerCase()}`)
    .sort()
    .join(','),
  tradingCapabilities: Object.entries(asset.tradingCapabilities ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([session, lots]) =>
      Object.entries(lots ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([lot, status]) => `${session}.${lot}=${status}`)
        .join(' '),
    )
    .join(' '),
})

const current = new Map(assets.map((asset) => [asset.id, shapeOf(asset)]))
const previous = new Map(Object.entries(held?.assets ?? {}))

const at = snapshot.fetchedAt
const transitions = [...(held?.transitions ?? [])]
const note = (row) => transitions.push({ observedAt: at, ...row })

// A first run establishes the baseline and records no transitions: 194 assets appearing at once is
// the watcher starting, not the issuer listing 194 tokens. The same distinction pauseTransition()
// makes for a token already paused the first time exdate looks.
const baseline = previous.size === 0

if (!baseline) {
  for (const [id, shape] of current) {
    const before = previous.get(id)
    if (!before) {
      note({ kind: 'added', id, symbol: shape.tokenSymbol, to: shape })
      continue
    }
    for (const field of Object.keys(shape)) {
      if (before[field] === shape[field]) continue
      // tradingCapabilities is six flags flattened into one string, so reporting the whole string
      // makes a reader diff two 250-character lines by eye to find that overnight fractional
      // stopped trading. The changed flags are named instead; every other field is one value and
      // reports as itself.
      if (field === 'tradingCapabilities') {
        const parse = (value) => new Map(String(value ?? '').split(' ').filter(Boolean).map((pair) => pair.split('=')))
        const wasFlags = parse(before[field])
        const nowFlags = parse(shape[field])
        for (const flag of new Set([...wasFlags.keys(), ...nowFlags.keys()])) {
          const was = wasFlags.get(flag) ?? null
          const now = nowFlags.get(flag) ?? null
          if (was === now) continue
          note({ kind: 'changed', id, symbol: shape.tokenSymbol, field: `tradingCapabilities.${flag}`, from: was, to: now })
        }
        continue
      }
      note({
        kind: 'changed',
        id,
        symbol: shape.tokenSymbol,
        field,
        from: before[field],
        to: shape[field],
      })
    }
  }
  for (const [id, before] of previous) {
    if (!current.has(id)) note({ kind: 'removed', id, symbol: before.tokenSymbol, from: before })
  }
}

const added = transitions.filter((row) => row.kind === 'added').length
const removed = transitions.filter((row) => row.kind === 'removed').length
const byField = {}
for (const row of transitions) {
  if (row.kind !== 'changed') continue
  byField[row.field] = (byField[row.field] ?? 0) + 1
}

const out = {
  note: "What the issuer changed about an asset, not about its price. The multiplier is deliberately absent: it moves on every dividend and is measured everywhere else here, and including it would bury a real transition under a hundred routine ones. A first run records the baseline and no transitions - 194 assets appearing at once is this watcher starting, not the issuer listing 194 tokens.",
  watches: ['tokenSymbol', 'tokenName', 'isin', 'status', 'tokenDecimals', 'deployments', 'tradingCapabilities'],
  source: snapshot.source ?? 'robinhood:/rhj/assets',
  /** Dated from the snapshot's own read, never from this run: the transition happened when the issuer changed it. */
  observedAt: at,
  firstObservedAt: held?.firstObservedAt ?? at,
  summary: {
    assets: current.size,
    transitions: transitions.length,
    added,
    removed,
    changedByField: Object.fromEntries(Object.entries(byField).sort(([a], [b]) => a.localeCompare(b))),
    /**
     * What chantier 2 is waiting for. Zero here is the finding, not a gap: it is why no merger,
     * ticker-change or delisting handler exists, and it is what would change if one should.
     */
    everSeenTradabilityChange: Object.keys(byField).some((field) => field.startsWith('tradingCapabilities.')),
    everSeenTickerChange: (byField.tokenSymbol ?? 0) > 0,
    everSeenStatusChange: (byField.status ?? 0) > 0,
    everSeenDelisting: removed > 0,
  },
  transitions,
  assets: Object.fromEntries([...current].sort(([a], [b]) => a.localeCompare(b))),
}

// Unchanged means unchanged: the file keeps its own date rather than being rewritten daily to say
// the same thing, so a commit here means the issuer moved.
const withoutRunFields = (value) => {
  const { observedAt: _at, ...rest } = value ?? {}
  return JSON.stringify(rest)
}
if (held !== null && withoutRunFields(held) === withoutRunFields(out)) {
  console.error(`# unchanged: ${current.size} assets, ${transitions.length} transition(s) on record; file left as it was`)
  process.exit(0)
}

writeFileSync(new URL(OUT, root), JSON.stringify(out, null, 2) + '\n')
console.error(
  baseline
    ? `# baseline: ${current.size} assets recorded, 0 transitions (a first run records no transitions) -> ${OUT}`
    : `# ${current.size} assets, ${transitions.length} transition(s) on record (+${transitions.length - (held?.transitions?.length ?? 0)} this run) -> ${OUT}`,
)
