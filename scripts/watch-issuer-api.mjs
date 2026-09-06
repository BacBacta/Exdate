// Watch the SHAPE of the issuer's API, not its values.
//
//   node scripts/watch-issuer-api.mjs
//   EXDATE_ISSUER_API_OFFLINE=1 node scripts/watch-issuer-api.mjs   # describe the committed snapshots instead
//
// Every figure exdate publishes for the declared side of a dividend comes from three gRPC-transcoded
// JSON endpoints, and none of them is versioned or announced. A field renamed, retyped or removed
// does not break anything loudly: `row.rate` becomes undefined, an amount becomes null, a row is
// dropped, and the record goes on being written - with a hole in it that looks exactly like a quiet
// month. This repository has already paid for one instance of that class: the issuer's `id` turned
// out to name a dividend SERIES rather than a payment, which silently dropped three pending rows
// until someone noticed the count.
//
// Two different things are recorded here, and they are not the same claim:
//
//   * the shape - every field path and its JSON type, with how many rows carried it. New fields are
//     news, not a failure: they are what says the issuer has started publishing something.
//   * the contract - the fields exdate actually reads. One of those going missing IS a failure, and
//     the run exits 1 by name, because everything downstream would keep working and be wrong.
//
// The contract list is declared here rather than derived: grepping for a field name across the
// readers finds string literals in comments and tests as readily as real reads. Each entry names
// the reader it exists for, so an obsolete one is removable by looking rather than by guessing.
//
// Plain ESM, no dependency, like the other collectors: the Action runs it on a bare node.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const OUT = 'data/issuer-api-shape.observed.json'
// Overridable so the detector can be rehearsed against a stub. A detector that has only ever seen
// the endpoint agree with it has not been tested on the thing it exists for.
const BASE = process.env.EXDATE_ISSUER_API_BASE || 'https://api.robinhood.com/rhj'
const OFFLINE = process.env.EXDATE_ISSUER_API_OFFLINE === '1'
/** One symbol is enough to describe /prices: the shape is per endpoint, not per asset. */
const PRICE_SYMBOL = process.env.EXDATE_ISSUER_API_PRICE_SYMBOL || 'SGOV'

/**
 * The fields exdate reads, per endpoint, and what reads them.
 *
 * A path here is a promise this repository has made to itself. If one stops being served, the
 * reader named beside it produces a null, a zero or a missing row rather than an error.
 */
const CONTRACT = {
  assets: {
    'assets[].tokenSymbol': 'the quote symbol for /prices, and the ticker every feed join goes through',
    'assets[].tokenName': 'the company name on every token page',
    'assets[].tokenDecimals': 'raw <-> UI conversion',
    'assets[].isin': 'the published identifier, and the CUSIP is derived from it',
    'assets[].status': 'which assets are live at all',
    'assets[].deployments[].contractAddress': 'the key everything in this repository is keyed on',
    'assets[].deployments[].chainId': 'which chain a deployment is on',
  },
  prices: {
    'quotes[].bid': 'half of the mid the effective-price capture prices a haircut from',
    'quotes[].ask': 'the other half',
    'quotes[].generatedAt': "the issuer's own timestamp, which decides the distance from effectiveAt",
    'quotes[].isTradingHalt': 'a quote published while trading is halted is refused, not priced',
  },
  // Read off the live response, not from memory: the first version of this list said
  // `corporateActions[]` and a flat `processDate`, and the endpoint serves `corpActions[]` with
  // processDate as a three-part object. The detector caught that on its first run, which is the
  // whole argument for having it.
  corporateActions: {
    'corpActions[].id': 'the series id, half of the (id, processDate) key',
    'corpActions[].processDate.year': 'the other half, and what the landing window is armed from',
    'corpActions[].processDate.month': 'same',
    'corpActions[].processDate.day': 'same',
    'corpActions[].status': 'declared vs completed',
    'corpActions[].type': 'cash dividend vs anything else, which decides how it reconciles',
    'corpActions[].tokenSymbol': 'the ticker on every calendar row',
    'corpActions[].deployments[].contractAddress': 'which token the action belongs to',
    'corpActions[].details.cashDividend.rate': 'the declared amount - the entire declared side of a haircut',
  },
}

const iso = () => new Date().toISOString()

/** The JSON type of a value, with null distinct from absent and an array described by its elements. */
function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Every field path in a payload, with the type(s) seen at it and how many values carried it.
 *
 * An array contributes ONE path with `[]` in it, aggregated over every element, so 194 assets
 * describe one shape rather than 194. `present` against `total` is what makes an optional field
 * legible: a field on 3 of 45 rows is a field that exists, not a field that vanished.
 */
function describe(value, path = '', into = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) describe(item, `${path}[]`, into)
    return into
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) describe(inner, path ? `${path}.${key}` : key, into)
    return into
  }
  const entry = into.get(path) ?? { types: new Set(), count: 0 }
  entry.types.add(typeOf(value))
  entry.count++
  into.set(path, entry)
  return into
}

/** The map above, as a sorted plain object that diffs cleanly and commits byte-identically. */
const serialise = (map) =>
  Object.fromEntries(
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, e]) => [path, { types: [...e.types].sort(), count: e.count }]),
  )

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One endpoint, retried.
 *
 * The issuer answers `local_rate_limited` with HTTP 200, so a status check is not enough - and a
 * read that failed must never be recorded as a shape, because it would report every field as
 * removed. Retried rather than failed on the first refusal: the limiter is documented and
 * transient, and a daily job that fails on it is noise nobody reads by the third week.
 */
async function get(path, { attempts = 4 } = {}) {
  let last = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await sleep(1500 * attempt)
    try {
      const response = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } })
      const text = await response.text()
      if (!response.ok || text.includes('local_rate_limited')) {
        last = `HTTP ${response.status}${text.includes('local_rate_limited') ? ' (rate limited)' : ''}`
        continue
      }
      return JSON.parse(text)
    } catch (error) {
      last = error.message
    }
  }
  throw new Error(`${path}: ${last} after ${attempts} attempts`)
}

const local = (file) => JSON.parse(readFileSync(new URL(`data/${file}`, root), 'utf8'))

const sources = OFFLINE
  ? {
      assets: () => ({ assets: local('robinhood-assets.snapshot.json').assets }),
      corporateActions: () => ({ corporateActions: local('robinhood-corporate-actions.snapshot.json').corporateActions ?? local('robinhood-corporate-actions.snapshot.json').actions }),
    }
  : {
      assets: () => get('/assets'),
      prices: () => get(`/prices/${PRICE_SYMBOL}`),
      corporateActions: () => get('/corporate-actions'),
    }

const observed = {}
const failed = []
for (const [name, load] of Object.entries(sources)) {
  try {
    const payload = await load()
    const map = describe(payload)
    if (map.size === 0) throw new Error('no fields at all')
    observed[name] = serialise(map)
  } catch (error) {
    failed.push(`${name}: ${error.message}`)
    console.error(`# ${name} could not be read: ${error.message}`)
  }
}
if (Object.keys(observed).length === 0) {
  console.error('# nothing could be read; refusing to write a shape from no data')
  process.exit(1)
}

const held = (() => {
  try {
    return JSON.parse(readFileSync(new URL(OUT, root), 'utf8'))
  } catch {
    return null
  }
})()

// --- what moved -------------------------------------------------------------
const transitions = []
for (const [name, shape] of Object.entries(observed)) {
  const before = held?.shape?.[name]
  // A first sighting is a baseline, not 200 added fields. Same rule as the registry watcher and
  // pauseTransition(): a thing observed for the first time has not changed.
  if (!before) {
    transitions.push({ at: iso(), endpoint: name, kind: 'baseline', detail: `${Object.keys(shape).length} field(s) recorded for the first time` })
    continue
  }
  for (const path of Object.keys(shape)) {
    if (!(path in before)) transitions.push({ at: iso(), endpoint: name, kind: 'field-added', path, types: shape[path].types })
    else if (String(before[path].types) !== String(shape[path].types)) {
      transitions.push({ at: iso(), endpoint: name, kind: 'type-changed', path, from: before[path].types, to: shape[path].types })
    }
  }
  for (const path of Object.keys(before)) {
    if (!(path in shape)) transitions.push({ at: iso(), endpoint: name, kind: 'field-removed', path, types: before[path].types })
  }
}

// --- what exdate depends on --------------------------------------------------
/**
 * A field exdate reads has gone, or changed to a type a reader was not written for.
 *
 * `null` appearing beside a type is a widening, not a break - an optional field is normal and every
 * reader here already treats an absent value as absent. A string becoming a number is the break:
 * the reader keeps running and may be quietly wrong, which is the whole reason this file exists.
 */
const solid = (types) => (types ?? []).filter((t) => t !== 'null').sort().join('|')
const broken = []
for (const [name, paths] of Object.entries(CONTRACT)) {
  const shape = observed[name]
  if (!shape) continue // could not be read this run; reported above, not counted as removed
  const before = held?.shape?.[name]
  for (const [path, why] of Object.entries(paths)) {
    if (!(path in shape)) {
      broken.push({ endpoint: name, path, kind: 'removed', readBy: why })
      continue
    }
    const was = before?.[path]?.types
    if (was && solid(was) !== solid(shape[path].types)) {
      broken.push({ endpoint: name, path, kind: 'retyped', from: was, to: shape[path].types, readBy: why })
    }
  }
}

const state = {
  note: 'The SHAPE of the issuer’s API - field paths and their types, never values. New fields are news; a field exdate reads going missing is a failure, because everything downstream would keep working and be wrong.',
  source: 'robinhood:/rhj/assets, /rhj/prices, /rhj/corporate-actions',
  exdateObserves: 'which field paths were served, their JSON types, and how many values carried each; the transitions between one reading and the next',
  observedAt: iso(),
  offline: OFFLINE,
  endpointsRead: Object.keys(observed),
  endpointsFailed: failed,
  contractBroken: broken,
  transitions: [...(held?.transitions ?? []), ...transitions].slice(-200),
  shape: { ...(held?.shape ?? {}), ...observed },
}

// A rebuild that saw the same shape must be byte-identical, or a daily Action rewrites the file to
// say nothing and, through the site's data/** deploy trigger, republishes the whole record for it.
const substance = (s) => JSON.stringify({ shape: s.shape, contractBroken: s.contractBroken, transitions: s.transitions })
if (held && substance(held) === substance(state)) {
  console.error(`# unchanged since ${held.observedAt} - not rewritten`)
} else {
  writeFileSync(new URL(OUT, root), JSON.stringify(state, null, 2) + '\n')
  console.error(`# ${Object.keys(observed).length} endpoint(s), ${transitions.length} transition(s) -> ${OUT}`)
}

for (const t of transitions) console.error(`#   ${t.kind} ${t.endpoint}${t.path ? ` ${t.path}` : ''}${t.detail ? ` ${t.detail}` : ''}`)
for (const b of broken) console.error(`# BROKEN ${b.endpoint} ${b.path} ${b.kind}${b.from ? ` ${b.from} -> ${b.to}` : ''} - read by: ${b.readBy}`)

// A field exdate reads is gone: fail loudly. Everything downstream would keep running and produce
// a hole that looks like a quiet month.
process.exit(broken.length > 0 ? 1 : 0)
