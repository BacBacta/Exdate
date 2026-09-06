// Join every token to its FIGI through OpenFIGI, and refuse rather than guess.
//
//   node scripts/build-figi-map.mjs
//
// A FIGI is the identifier an order-management system already keys on, so publishing it beside the
// address is what lets an integrator match exdate's rows to theirs with no mapping table. The join
// is on ISIN, which the issuer publishes for all 194 assets and which exdate validates by check
// digit - not on ticker, which is a display name and not a key.
//
// Which FIGI, and why, decided by reading a real answer rather than by assuming one. Apple's ISIN
// returns **263 rows across 86 composite FIGIs** - every foreign listing of the same company is in
// there - so "the composite FIGI of this ISIN" does not exist. What does exist, and is the same on
// all 263 rows, is one `shareClassFIGI`: BBG001S5N8V8. That is the right identifier here, and not
// by elimination: a tokenized share represents the share class, not any venue's line in it.
//
// So `shareClassFigi` is the join exdate publishes. `compositeFigi` is published too, but only
// where it is unambiguous - the composite carrying a row whose `exchCode` is the ISIN's own
// country - because a country-level line is what most systems mean by "the FIGI".
//
// The refusal rule is explicit, because a FIGI pointing at the wrong line is worse than no FIGI:
// no rows, or more than one share class behind one ISIN, yields null with the reason recorded. The
// coverage is published as a number rather than implied.
//
// By default only tokens absent from the committed file are joined, so a scheduled run costs zero
// requests until the issuer adds an asset. `--all` re-joins everything, which is what to run when
// the join rule itself changes. Either way the file is left byte-identical when nothing moved:
// `observedAt` is a claim about a reading, and rewriting it daily to say nothing would make every
// commit look like new evidence.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const ALL = process.argv.includes('--all')
const ENDPOINT = 'https://api.openfigi.com/v3/mapping'
// Without a key: 25 requests a minute, 10 jobs a request. 194 ISINs is 20 requests, so one every
// three seconds stays well inside it and needs no key - which is the point: no credential, no
// account, nothing that can expire without anyone noticing.
const BATCH = 10
const GAP_MS = 3_000

const registry = JSON.parse(readFileSync(new URL('data/robinhood-assets.snapshot.json', root), 'utf8'))
const assets = registry.assets ?? []
const OUT = new URL('data/figi.observed.json', root)
const held = (() => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'))
  } catch {
    return { rows: [] }
  }
})()
/** What the file already holds, by token, so an incremental run keeps it and asks for the rest. */
const heldByToken = new Map((held.rows ?? []).map((row) => [row.token, row]))

const everything = assets
  .map((asset) => ({
    token: asset.deployments?.[0]?.contractAddress?.toLowerCase() ?? null,
    symbol: asset.tokenSymbol,
    isin: asset.isin ?? null,
  }))
  .filter((row) => row.token && row.isin)
/**
 * A held row is re-joined when its ISIN changed - the identifier it was joined on is no longer the
 * one the issuer publishes, so the FIGI beside it describes a different asset - and never merely
 * because it refused: a refusal that was true yesterday is not re-asked daily at OpenFIGI's expense.
 */
const wanted = ALL
  ? everything
  : everything.filter((row) => {
      const previous = heldByToken.get(row.token)
      return !previous || previous.isin !== row.isin
    })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rows = []
let requests = 0

for (let index = 0; index < wanted.length; index += BATCH) {
  const batch = wanted.slice(index, index + BATCH)
  const body = batch.map((row) => ({ idType: 'ID_ISIN', idValue: row.isin }))
  let answer
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    requests++
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    answer = await response.json()
  } catch (error) {
    for (const row of batch) rows.push({ ...row, figi: null, shareClassFigi: null, refusal: `request_failed: ${String(error.message).slice(0, 60)}` })
    await sleep(GAP_MS)
    continue
  }

  batch.forEach((row, offset) => {
    const result = answer[offset] ?? {}
    const data = result.data ?? []
    if (!data.length) {
      rows.push({ ...row, figi: null, shareClassFigi: null, refusal: result.warning ? 'not_found' : 'no_data' })
      return
    }
    const shareClasses = [...new Set(data.map((entry) => entry.shareClassFIGI).filter(Boolean))]
    if (shareClasses.length !== 1) {
      // Zero or several share classes behind one ISIN. Choosing between them would be a guess
      // dressed as an identifier, so nothing is published and the count is recorded.
      rows.push({
        ...row,
        figi: null,
        shareClassFigi: null,
        refusal: shareClasses.length === 0 ? 'no_share_class' : `ambiguous_share_class:${shareClasses.length}`,
        candidates: shareClasses.slice(0, 4),
      })
      return
    }
    // The country-level line, where the ISIN's own country identifies it unambiguously.
    const country = row.isin.slice(0, 2)
    const home = [...new Set(data.filter((entry) => entry.exchCode === country).map((entry) => entry.compositeFIGI).filter(Boolean))]
    rows.push({
      ...row,
      shareClassFigi: shareClasses[0],
      figi: home.length === 1 ? home[0] : null,
      compositeRefusal: home.length === 1 ? null : home.length === 0 ? `no_listing_in_${country}` : `ambiguous_composite:${home.length}`,
      venueRows: data.length,
      name: data[0].name ?? null,
      securityType: data[0].securityType ?? null,
      refusal: null,
    })
  })
  await sleep(GAP_MS)
}

/**
 * Merge over what the file held. A transient HTTP failure never overwrites a good row: it is
 * evidence about the network, not about the identifier. Every other outcome - including a
 * `not_found` where a value used to resolve - does overwrite, because that IS about the identifier.
 */
const merged = new Map(heldByToken)
for (const row of rows) {
  if (row.refusal?.startsWith('request_failed') && merged.get(row.token)?.shareClassFigi) continue
  merged.set(row.token, row)
}
/** A token the issuer removed from the registry leaves with it: this file describes the registry. */
for (const token of [...merged.keys()]) {
  if (!everything.some((row) => row.token === token)) merged.delete(token)
}
rows.length = 0
rows.push(...merged.values())

// Sorted before anything is counted from it, not while the file is being written: the counts
// below are objects, and an object's key order follows insertion, so counting over rows in
// discovery order made an unchanged rebuild differ from the committed file in the ORDER of
// `compositeRefusals` alone. Found by printing the first differing byte rather than the byte count.
rows.sort((a, b) => a.symbol.localeCompare(b.symbol))

/** Tally by reason, with the keys sorted, so one reason appearing first cannot rewrite the file. */
const tally = (pick) => {
  const counts = {}
  for (const row of rows) {
    const reason = pick(row)
    if (reason) counts[reason.split(':')[0]] = (counts[reason.split(':')[0]] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

const matched = rows.filter((row) => row.shareClassFigi)
const refusals = tally((row) => row.refusal)

const out = {
  note: "Every token's FIGI, joined on the ISIN the issuer publishes. One row per token; `figi` is OpenFIGI's country-level compositeFIGI and `shareClassFigi` the share class across countries. A venue-level FIGI is never published: a tokenized share is listed on no venue. Null with a reason wherever the join was not unambiguous - a FIGI pointing at the wrong line is worse than none.",
  source: 'openfigi:v3/mapping',
  joinedOn: 'ID_ISIN',
  observedAt: 'PLACEHOLDER',
  summary: {
    tokens: rows.length,
    /** Joined to a share-class FIGI, which is the identifier a tokenized share actually has. */
    matched: matched.length,
    unmatched: rows.length - matched.length,
    /** And of those, how many also have an unambiguous country-level composite. */
    withComposite: rows.filter((row) => row.figi).length,
    refusals,
    compositeRefusals: tally((row) => row.compositeRefusal),
    requests,
  },
  rows,
}
/**
 * `observedAt` and the request count both move every run and say nothing about the data, so they
 * are compared out before deciding whether anything changed. Written only when it did, so a
 * scheduled run that re-confirms the join leaves the file exactly as it was and commits nothing.
 */
const withoutRunFields = (value) => {
  const { observedAt: _at, summary: { requests: _requests, ...summary } = {}, ...rest } = value ?? {}
  return JSON.stringify({ ...rest, summary })
}
const unchanged = withoutRunFields(held) === withoutRunFields(out)
out.observedAt = unchanged ? (held.observedAt ?? new Date().toISOString()) : new Date().toISOString()
if (unchanged) out.summary.requests = held.summary?.requests ?? requests
if (unchanged && held.rows?.length) {
  console.error(`# unchanged: ${rows.length} tokens, ${requests} requests made, file left as it was`)
} else {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  console.error(`# ${matched.length}/${rows.length} tokens joined to a share-class FIGI (${out.summary.withComposite} with a country composite) in ${requests} requests -> data/figi.observed.json`)
  if (Object.keys(refusals).length) console.error(`# refusals: ${JSON.stringify(refusals)}`)
}
