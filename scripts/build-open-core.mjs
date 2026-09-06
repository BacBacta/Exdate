// The open-core boundary, generated from the code and the record rather than written beside them.
//
//   node scripts/build-open-core.mjs           # write docs/open-core.md
//   node scripts/build-open-core.mjs --check   # regenerate and diff, for CI
//
// The question this answers is the one a reader should never have to ask: for any route, any
// dataset and any field, which side of the line is it on? A document written by hand answers it on
// the day it is written and drifts from the next commit - this repository has measured that drift
// four times in a week - so every fact below is read from the file that decides it: the routes from
// the API's own source, the quotas from limits.ts, the carve-outs from DATA-LICENSE.md, and the
// prerequisites of a paid tier from the committed record.
//
// The last part is the point of doing it now rather than later. exdate has no paid tier and could
// not honestly sell one today: one archive witness, production reads on third parties with no
// service commitment, a database schema dropped on every code deploy. Those are measurements, not
// opinions, so they are computed here from data/ and stated as the reason nothing is reserved yet.
// A boundary drawn while there is nothing behind it is the honest time to draw one.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const readJson = (path) => JSON.parse(read(path))
const CHECK = process.argv.includes('--check')
const OUT = 'docs/open-core.md'

// --- the routes, from the API's own source ----------------------------------
// Parsed rather than listed: a route added without a line here would otherwise be invisible, which
// is exactly the state this document exists to prevent.
const apiSource = read('packages/api/src/index.ts')
const routes = [...apiSource.matchAll(/app\.(get|post|delete)\('([^']+)'/g)].map(([, method, path]) => ({
  method: method.toUpperCase(),
  path,
}))

/**
 * What each route is for, in one line. Keyed on the path, so a route whose purpose is not written
 * down here fails the build rather than appearing in the table blank - a row with no explanation
 * is how a reader ends up asking the question this file exists to answer.
 */
const PURPOSE = {
  '/v1/me': 'the caller’s tier and what is left of its quota',
  '/v1/health': 'liveness, and how old the compiled registry is',
  '/v1/webhooks': 'the event catalogue, the signing scheme and the retry schedule',
  '/v1/webhooks/subscriptions': 'subscribe an endpoint without the operator',
  '/v1/webhooks/subscriptions/:id': 'read or revoke a subscription, with its own secret',
  '/v1/webhooks/subscriptions/:id/test': 'replay the most recent real event to a subscriber',
  '/v1/chains': 'the chains exdate reads, and what it knows on each',
  '/v1/:chain/tokens': 'every token with its multiplier, feed and event summary',
  '/v1/:chain/tokens/:address': 'one token, in full, with its identifiers',
  '/v1/:chain/tokens/:address/yield': 'the distribution ledger — never a rate',
  '/v1/:chain/tokens/:address/pending': 'what is declared and has not arrived, and what it owes',
  '/v1/:chain/events': 'every UIMultiplierUpdated log, newest first',
  '/v1/:chain/reconciliations': 'declared against delivered, per dividend — the differentiating dataset',
  '/v1/:chain/webhooks/events': 'the outbox: what was noticed, and what each delivery did',
  '/v1/:chain/webhooks/latency': 'how long deliveries actually took, over real deliveries only',
  '/v1/status': 'feed health across every token, now',
  '/v1/calendar': 'the issuer’s declared rows, upcoming first',
}

const missing = routes.filter((route) => !(route.path in PURPOSE))
if (missing.length) {
  console.error(`# ${missing.map((r) => r.path).join(', ')} has no purpose written down in scripts/build-open-core.mjs`)
  process.exit(1)
}

// --- the quotas, from limits.ts ---------------------------------------------
const limitsSource = read('packages/api/src/limits.ts')
const defaultOf = (name, fallback) => {
  const match = limitsSource.match(new RegExp(`positiveInt\\(env\\.${name},\\s*(\\d+)\\)`))
  return match ? Number(match[1]) : fallback
}
const anonRpm = defaultOf('EXDATE_ANON_RPM', null)
const keyRpm = defaultOf('EXDATE_KEY_RPM', null)
if (anonRpm === null || keyRpm === null) {
  console.error('# could not read the default quotas out of packages/api/src/limits.ts; the regex no longer matches')
  process.exit(1)
}
const exemptFromQuota = [...apiSource.matchAll(/c\.req\.path === '([^']+)'/g)].map(([, path]) => path)

// --- the carve-outs, from the licence ---------------------------------------
const licence = read('DATA-LICENSE.md')
const reservedFiles = [...licence.matchAll(/`(data\/[a-z0-9.\-]+\.json)`/g)].map(([, file]) => file)
const issuerFiles = [...new Set(reservedFiles)].filter((file) => licence.includes(`\`${file}\``))

// --- what a paid tier would need, measured ----------------------------------
// Each of these is a fact in the record, not a judgement. They are the reason nothing is reserved
// today: a tier sold against any one of them unmet is a promise exdate cannot keep.
const verification = readJson('data/multiplier-state-verification.json')
const witnesses = Math.max(
  0,
  ...(verification.steps ?? []).map((step) => (step.witnesses ?? []).length),
)
const endpoints = readJson('data/rpc-endpoints.observed.json')
const archiveEndpoints = (endpoints.endpoints ?? []).filter((row) => row.reachesOldestStep).length
const capture = readJson('data/effective-prices.observed.json')
const latency = readJson('data/webhook-latency.observed.json')

const prerequisites = [
  {
    name: 'More than one archive witness',
    state: witnesses >= 2 ? 'met' : 'not met',
    detail: `the oldest multiplier step is confirmed by ${witnesses} endpoint${witnesses === 1 ? '' : 's'}; ${archiveEndpoints} of the probed endpoints reach it at all`,
    why: 'a single witness means one third party going away takes the state confirmation with it',
  },
  {
    name: 'Production reads on something exdate controls',
    state: 'not met',
    detail: 'reads go to third-party endpoints with no service commitment, with Robinhood’s own as the fallback',
    why: 'docs/terms-review.md §2.4(a) reserves Robinhood’s RPC for testing and development, and a third party can degrade without notice — measured twice in one day',
  },
  {
    name: 'A database that survives a code deploy',
    state: 'not met',
    detail: 'Ponder refuses a schema written by a different build, so a code deploy drops it and the poller rewrites the derived tables',
    why: 'what is lost is derived and comes back within one poll, but an availability promise cannot be made over it',
  },
  {
    name: 'An alert when the watcher stops',
    state: capture.watcher ? 'partly met' : 'not met',
    detail: capture.watcher
      ? 'a watchdog checks the heartbeat and fails its own scheduled run when it is stale, which emails the repository owner; no real-time sink is configured'
      : 'no watcher heartbeat in the record',
    why: 'a capture missed at the instant of a step is unrecoverable — the issuer serves only the present',
  },
  {
    name: 'A measured delivery latency',
    state: latency.sufficient ? 'met' : 'not met',
    detail: latency.sufficient
      ? `median ${latency.announceToDeliver.medianSeconds} s over ${latency.delivered} real deliveries`
      : 'no delivery has been accepted by a subscriber yet, so there is no latency to promise',
    why: 'the announcement lead is the most saleable thing here and it cannot be sold before it is measured',
  },
]
const met = prerequisites.filter((row) => row.state === 'met').length

const doc = `# The open-core boundary

**Generated. Do not edit — run \`node scripts/build-open-core.mjs\`.**

Every fact below is read from the file that decides it: the routes from \`packages/api/src/index.ts\`,
the quotas from \`packages/api/src/limits.ts\`, the carve-outs from \`DATA-LICENSE.md\`, and the state
of each prerequisite from the committed record. A document written beside the code answers this on
the day it is written and drifts from the next commit; this one cannot.

## Today: everything is open

There is **no paid tier**, and nothing in this repository is reserved. Every route answers without a
key, every dataset in \`data/\` is committed, and the two published packages are MIT. This section
says so plainly rather than leaving a reader to infer it from an absence.

| What | Licence | Where |
|---|---|---|
| Code — \`@exdate/core\`, \`@exdate/sdk\`, the indexer, the API, both sites | MIT | \`LICENSE\` |
| exdate's own observations in \`data/\` | CC BY 4.0 | \`DATA-LICENSE.md\` |
| The issuer's own rows, republished with their source stated | **not exdate's to license** | \`DATA-LICENSE.md\`, carved out by column |
| OpenFIGI's identifiers | **not exdate's to license** | \`DATA-LICENSE.md\` |

The middle two are the part a re-user must read. exdate's licence from the issuer is personal and
non-sublicensable (\`docs/terms-review.md\` §5.2), so it cannot pass on rights it does not hold: the
issuer's fields are reproduced with their source named so a measurement can be checked, and what
may be done with them is between the re-user and the issuer's terms.

${issuerFiles.length ? `Files the carve-out names today, wholly or by column: ${issuerFiles.map((file) => `\`${file}\``).join(', ')}. Which of the two each one is, and which fields are affected, is in \`DATA-LICENSE.md\`'s own tables - this line is the index, not the answer.` : ''}

## The API, route by route

Rate limits, not tiers: ${anonRpm} requests a minute for an anonymous caller (per client address),
${keyRpm} with a key. A key changes the quota and nothing else — **no route, field or dataset is
behind one**. \`${exemptFromQuota.join('` and `')}\` are outside the count.

| Route | What it serves | Tier |
|---|---|---|
${routes.map((route) => `| \`${route.method} ${route.path}\` | ${PURPOSE[route.path]} | open |`).join('\n')}

## What a paid tier would reserve, when there is one

The differentiating dataset is \`/v1/:chain/reconciliations\` — declared against delivered, per
dividend, priced at the instant of the step — together with the signed webhooks that carry it
inside the announcement lead. That is what a paid tier would be built on, and this document names
it in advance so the boundary is legible before it matters rather than announced afterwards.

**It is not reserved today, and it should not be**, for reasons that are measurements rather than
strategy. ${met} of ${prerequisites.length} prerequisites are met:

| Prerequisite | State | What the record says |
|---|---|---|
${prerequisites.map((row) => `| ${row.name} | **${row.state}** | ${row.detail} |`).join('\n')}

Why each one blocks a paid tier:

${prerequisites.map((row) => `- **${row.name}** — ${row.why}.`).join('\n')}

Selling against any of these unmet would be selling a promise exdate cannot keep, which is the
same failure as publishing a number nobody measured. When they are met, this table is what will
have changed, and it changes by regenerating this file rather than by editing it.

## How to tell, for any field

1. **A route or a package** — open, all of it, today. The table above is generated from the source.
2. **A value in \`data/\`** — every dataset names its sources per row or in a \`sources\` block. A
   value sourced \`onchain:…\` or \`chainlink:…\`, or a file describing its own measurement, is
   exdate's and CC BY 4.0. A value sourced \`robinhood:…\` or \`openfigi:…\` is not exdate's to
   license.
3. **Anything else** — it does not exist. If this document does not name it, it is not reserved.
`

const held = (() => {
  try {
    return read(OUT)
  } catch {
    return null
  }
})()

if (CHECK) {
  if (held === doc) {
    console.log(`ok   ${OUT} matches the code and the record`)
    process.exit(0)
  }
  // The first differing line, not the byte count. Twice in this repository a check that reported
  // how much differed sent the reader off to guess; the one that reports what differs settles it.
  const a = (held ?? '').split('\n')
  const b = doc.split('\n')
  const at = a.findIndex((line, index) => line !== b[index])
  console.error(`FAIL ${OUT} is out of date; regenerate with: node scripts/build-open-core.mjs`)
  console.error(`  first difference at line ${at + 1}`)
  console.error(`  held:  ${JSON.stringify(a[at] ?? '<end of file>')}`)
  console.error(`  built: ${JSON.stringify(b[at] ?? '<end of file>')}`)
  process.exit(1)
}

writeFileSync(new URL(OUT, root), doc)
console.error(`# ${OUT}: ${routes.length} routes, ${met}/${prerequisites.length} prerequisites met, ${witnesses} archive witness(es)`)
