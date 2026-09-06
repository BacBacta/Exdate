// One row per issuer, generated from what was actually read on each chain.
//
//   node scripts/build-issuer-mechanisms.mjs           # write docs/issuer-mechanisms.md
//   node scripts/build-issuer-mechanisms.mjs --check   # regenerate and diff, for CI
//
// This is the table the roadmap's chantier 1b asks for, and it exists before any abstraction does,
// on purpose: an interface extracted from one implementation encodes that implementation's
// assumptions as though they were the domain's. Reading a third issuer already broke one of them -
// xStocks' balanceOf() is the ADJUSTED view where Robinhood's is the constant - so the common
// contract cannot say "balanceOf is the raw amount", and would have, had it been written first.
//
// Every cell traces to a verification file or is marked "not probed". An issuer nobody has read is
// listed as unread rather than left out, because a table with three rows reads as "these are the
// issuers" and the honest claim is "these are the ones exdate has looked at".
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(new URL(path, root), 'utf8'))
  } catch {
    return null
  }
}
const CHECK = process.argv.includes('--check')
const OUT = 'docs/issuer-mechanisms.md'

const registry = readJson('data/robinhood-assets.snapshot.json')
const events = readJson('data/multiplier-events.observed.json')
const base = readJson('data/base-b20-verification.json')
const xstocks = readJson('data/xstocks-verification.json')
const feeds = readJson('data/chainlink-feeds.snapshot.json')

const NOT_PROBED = '— not probed'

const rhTokens = registry?.assets?.length ?? 0
const rhFeeds = (feeds?.feeds ?? feeds ?? []).filter?.((feed) => feed.docs?.assetClass === 'Equities' || feed.name)?.length ?? null
const rhSteps = new Set((events?.events ?? []).map((event) => `${event.token}:${event.effectiveAt}`)).size

const baseTokens = base?.tokens?.length ?? (base?.summary?.tokens ?? 0)
const baseMoved = (base?.tokens ?? []).filter((token) => token.multiplier && token.multiplier !== '1000000000000000000').length

const xsAssets = xstocks?.registry?.assets ?? 0
const xsNetworks = Object.keys(xstocks?.registry?.deploymentsByNetwork ?? {}).length
// Counted by DISTINCT address, not by row: the same token is read on Ethereum and on BNB Chain, so
// summing the rows says "8 of 12 sampled" about six tokens and reads as twice the coverage.
const xsSampled = [
  ...new Map(
    Object.values(xstocks?.chains ?? {})
      .flatMap((chain) => chain.tokens ?? [])
      .map((token) => [token.address, token]),
  ).values(),
]
const xsMoved = xsSampled.filter((token) => token.multiplierWad && token.multiplierWad !== '1000000000000000000').length
const xsHistorySteps = Object.values(xstocks?.declaredHistory ?? {}).reduce((sum, rows) => sum + rows.length, 0)

/**
 * The rows. Each one names the file it was read from, so a claim here can be checked without
 * trusting this script - and an issuer with no file says so in the same column.
 */
const ISSUERS = [
  {
    issuer: 'Robinhood Assets (Jersey)',
    product: 'Stock Tokens',
    chains: 'Robinhood Chain (4663)',
    standard: 'ERC-8056 Scaled UI Amount',
    constantView: '`balanceOf()`',
    adjustedView: '`balanceOfUI()`',
    multiplierView: '`uiMultiplier()`',
    announcement: '`UIMultiplierUpdated`, ~9–10 min ahead',
    applicationEvent: 'none — nothing is emitted when it takes effect',
    declaredRate: 'yes — `/rhj/corporate-actions`, a one-month window with no pagination',
    declaredHistory: 'no — a row that falls out is unrecoverable',
    tokens: String(rhTokens),
    stepsSeen: String(rhSteps),
    produces: '**haircuts** — declared rate and observed step both available',
    evidence: '`data/robinhood-assets.snapshot.json`, `data/multiplier-events.observed.json`',
  },
  {
    issuer: 'Coinbase (B20)',
    product: 'Tokenized stocks on Base',
    chains: 'Base (8453)',
    standard: 'B20 Beryl — ERC-8056 documented, not live until Cobalt',
    constantView: `${NOT_PROBED} — ERC-8056 views revert`,
    adjustedView: NOT_PROBED,
    multiplierView: '`multiplier()`',
    announcement: `${NOT_PROBED} — no step has ever happened`,
    applicationEvent: NOT_PROBED,
    declaredRate: 'no corporate-action feed found',
    declaredHistory: 'n/a',
    tokens: String(baseTokens),
    stepsSeen: String(baseMoved),
    produces: '**nothing yet** — every multiplier is exactly 1.0',
    evidence: '`data/base-b20-verification.json`',
  },
  {
    issuer: 'Backed Finance (xStocks)',
    product: 'xStocks',
    chains: `${xsNetworks} networks, incl. Ethereum (1) and BNB Chain (56)`,
    standard: 'Backed AutoFeeToken — a rebasing ERC-20',
    // The inversion, in the two cells where it matters. This is the assumption an interface
    // extracted from Robinhood alone would have got backwards.
    constantView: '`sharesOf()`',
    adjustedView: '`balanceOf()` — **inverted vs ERC-8056**',
    multiplierView: '`getCurrentMultiplier()` (3 words, first is the WAD); `multiplier()` also answers',
    announcement: `${NOT_PROBED} — needs a log scan over a known step`,
    applicationEvent: NOT_PROBED,
    declaredRate: 'no — the issuer publishes the step, not the cash rate',
    declaredHistory: 'yes — every step back to 2025, with its reason',
    tokens: String(xsAssets),
    stepsSeen: `${xsMoved} of ${xsSampled.length} distinct tokens sampled have moved; ${xsHistorySteps} steps in the issuer's history`,
    produces: '**a step ledger** — a haircut needs a cash rate from a source that is not the issuer',
    evidence: '`data/xstocks-verification.json`',
  },
  {
    issuer: 'Ondo',
    product: 'Ondo Global Markets',
    chains: NOT_PROBED,
    standard: NOT_PROBED,
    constantView: NOT_PROBED,
    adjustedView: NOT_PROBED,
    multiplierView: NOT_PROBED,
    announcement: NOT_PROBED,
    applicationEvent: NOT_PROBED,
    declaredRate: NOT_PROBED,
    declaredHistory: NOT_PROBED,
    tokens: NOT_PROBED,
    stepsSeen: NOT_PROBED,
    produces: NOT_PROBED,
    evidence: 'not read',
  },
  {
    issuer: 'Dinari',
    product: 'dShares',
    chains: NOT_PROBED,
    standard: NOT_PROBED,
    constantView: NOT_PROBED,
    adjustedView: NOT_PROBED,
    multiplierView: NOT_PROBED,
    announcement: NOT_PROBED,
    applicationEvent: NOT_PROBED,
    declaredRate: NOT_PROBED,
    declaredHistory: NOT_PROBED,
    tokens: NOT_PROBED,
    stepsSeen: NOT_PROBED,
    // The one first-party thing on record, from the roadmap: their own page names the four event
    // types. It confirms the market thesis and says nothing about the mechanism.
    produces: `${NOT_PROBED} — their page names dividends, splits, ticker changes and mergers; the mechanism is not stated`,
    evidence: 'not read',
  },
  {
    issuer: 'Swarm',
    product: 'Swarm Markets',
    chains: NOT_PROBED,
    standard: NOT_PROBED,
    constantView: NOT_PROBED,
    adjustedView: NOT_PROBED,
    multiplierView: NOT_PROBED,
    announcement: NOT_PROBED,
    applicationEvent: NOT_PROBED,
    declaredRate: NOT_PROBED,
    declaredHistory: NOT_PROBED,
    tokens: NOT_PROBED,
    stepsSeen: NOT_PROBED,
    produces: NOT_PROBED,
    evidence: 'not read',
  },
]

const read = ISSUERS.filter((row) => row.evidence !== 'not read')
const column = (key, label) =>
  `### ${label}\n\n| Issuer | ${label} |\n|---|---|\n${ISSUERS.map((row) => `| ${row.issuer} | ${row[key]} |`).join('\n')}\n`

const doc = `# What each issuer actually does

**Generated. Do not edit — run \`node scripts/build-issuer-mechanisms.mjs\`.**

${read.length} of ${ISSUERS.length} issuers have been read; the rest are listed as unread rather
than left out, because a table of three reads as *these are the issuers* when the honest claim is
*these are the ones exdate has looked at*.

This table exists **before** any common interface does. An interface extracted from one
implementation encodes that implementation's assumptions as though they were the domain's, and
reading a third issuer already broke one: **xStocks' \`balanceOf()\` is the adjusted view where
Robinhood's is the constant.** A contract written after Robinhood alone would have said "balanceOf
is the raw amount", and been wrong in the direction that reports a post-dividend balance as a
pre-dividend one.

## The whole table

| | ${ISSUERS.map((row) => row.issuer).join(' | ')} |
|---|${ISSUERS.map(() => '---').join('|')}|
| **Product** | ${ISSUERS.map((row) => row.product).join(' | ')} |
| **Chains** | ${ISSUERS.map((row) => row.chains).join(' | ')} |
| **Standard** | ${ISSUERS.map((row) => row.standard).join(' | ')} |
| **Constant view** | ${ISSUERS.map((row) => row.constantView).join(' | ')} |
| **Adjusted view** | ${ISSUERS.map((row) => row.adjustedView).join(' | ')} |
| **Multiplier** | ${ISSUERS.map((row) => row.multiplierView).join(' | ')} |
| **Announcement** | ${ISSUERS.map((row) => row.announcement).join(' | ')} |
| **Application event** | ${ISSUERS.map((row) => row.applicationEvent).join(' | ')} |
| **Declared cash rate** | ${ISSUERS.map((row) => row.declaredRate).join(' | ')} |
| **Declared step history** | ${ISSUERS.map((row) => row.declaredHistory).join(' | ')} |
| **Tokens** | ${ISSUERS.map((row) => row.tokens).join(' | ')} |
| **Steps observed** | ${ISSUERS.map((row) => row.stepsSeen).join(' | ')} |
| **What exdate could produce** | ${ISSUERS.map((row) => row.produces).join(' | ')} |
| **Evidence** | ${ISSUERS.map((row) => row.evidence).join(' | ')} |

## The three things that differ, and why each one matters

**1. Which view is constant.** Robinhood: \`balanceOf()\` is constant, \`balanceOfUI()\` adjusts.
Backed: \`sharesOf()\` is constant, \`balanceOf()\` adjusts. Coinbase: neither, until Cobalt ships.
A common interface must name the two roles and let each adapter say which selector fills them —
it must never assume ERC-20's own \`balanceOf\` is one or the other.

**2. What the issuer publishes.** Robinhood gives the **declared cash rate** and a one-month window
that loses rows; Backed gives the **full step history** and no cash rate. So the same measurement
has opposite gaps: exdate archives Robinhood's feed daily because it disappears, and would need a
non-issuer source for a rate on Backed. **Only Robinhood supports a haircut end to end today.**

**3. Whether anything has moved.** Coinbase: nothing, ever — 13 tokens at exactly 1.0. Backed: four
of six sampled have moved, with steps of 36 to 48 bps. Robinhood: ${rhSteps} distinct steps. An
adapter for an issuer with no events is untestable against reality, which is why Base is verified
and unwired.

## What this says about the interface

Not yet. The roadmap's order is 1c (wire xStocks as a **second concrete implementation**, with no
interface) then 1d (**extract** the interface from the two). This table is the argument for that
order rather than a substitute for it: three issuers, three spellings of one idea, and the one
assumption everybody would have shared turned out to be inverted between the first two that have
real events.

One thing already generalises, measured rather than assumed: **\`multiplier()\` — the same four
bytes — answers on both Coinbase B20 and Backed, and on Backed it agrees with
\`getCurrentMultiplier()\`'s first word.** One selector, one meaning, two unrelated issuers.
`

const held = (() => {
  try {
    return readFileSync(new URL(OUT, root), 'utf8')
  } catch {
    return null
  }
})()

if (CHECK) {
  if (held === doc) {
    console.log(`ok   ${OUT} matches what was read on chain`)
    process.exit(0)
  }
  const a = (held ?? '').split('\n')
  const b = doc.split('\n')
  const at = a.findIndex((line, index) => line !== b[index])
  console.error(`FAIL ${OUT} is out of date; regenerate with: node scripts/build-issuer-mechanisms.mjs`)
  console.error(`  first difference at line ${at + 1}`)
  console.error(`  held:  ${JSON.stringify(a[at] ?? '<end of file>')}`)
  console.error(`  built: ${JSON.stringify(b[at] ?? '<end of file>')}`)
  process.exit(1)
}

writeFileSync(new URL(OUT, root), doc)
console.error(`# ${OUT}: ${read.length}/${ISSUERS.length} issuers read, ${ISSUERS.length - read.length} listed as unread`)
