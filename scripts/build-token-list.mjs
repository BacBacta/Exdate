// A Uniswap token list for the Robinhood Stock Tokens, with what exdate knows attached.
//
// This is distribution rather than another page: a token list is how a wallet or an
// aggregator learns a token exists, and it is imported by URL, so exdate ends up inside
// other people's products instead of waiting for visitors.
//
// The extensions are the part nobody else can publish: what one token represents in
// shares today, whether a dividend has been declared and not yet delivered, what that
// dividend owes per token, and whether the price feed a lending market would use is
// actually corroborated. All of it from the committed record, all of it addressable.
//
//   node scripts/build-token-list.mjs
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { nextTokenListVersion, validateTokenList } from '../packages/core/src/tokenlist.ts'

const root = new URL('../', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const OUT = 'data/exdate.tokenlist.json'
const CHAIN_ID = 4663
const WAD = 10n ** 18n

const registry = read('data/robinhood-assets.snapshot.json')
const events = read('data/multiplier-events.observed.json').events
const reconciliations = read('data/reconciliations.observed.json').rows
const feedMap = read('data/token-feed-map.json')

const feedByToken = new Map(feedMap.pairs.map((p) => [p.token.toLowerCase(), p]))

/** Latest step per token, which is what a token represents in shares today. */
const lastStep = new Map()
for (const event of [...events].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))) {
  lastStep.set(event.token.toLowerCase(), event)
}

/** The nearest declared dividend that has not produced a step, and what it owes per token. */
const pendingByToken = new Map()
for (const row of reconciliations) {
  if (row.status !== 'pending' || !row.processDate || !row.rate) continue
  const key = row.token.toLowerCase()
  const current = pendingByToken.get(key)
  if (!current || row.processDate < current.processDate) pendingByToken.set(key, row)
}

const parseDecimal = (value) => {
  const [whole, fraction = ''] = String(value).split('.')
  return BigInt(whole || '0') * WAD + BigInt((fraction + '0'.repeat(18)).slice(0, 18))
}
const formatWad = (value, places) => {
  const unit = 10n ** BigInt(18 - places)
  const rounded = (value + unit / 2n) / unit
  const whole = rounded / 10n ** BigInt(places)
  const fraction = (rounded % 10n ** BigInt(places)).toString().padStart(places, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

const site = (process.env.EXDATE_SITE_URL || 'https://www.exdate.me').replace(/\/+$/, '')

const tokens = []
for (const asset of registry.assets ?? registry) {
  const deployment = (asset.deployments ?? []).find((d) => Number(d.chainId) === CHAIN_ID)
  if (!deployment) continue
  const address = deployment.contractAddress
  const key = address.toLowerCase()
  const step = lastStep.get(key)
  const multiplier = step ? BigInt(step.newMultiplier) : WAD
  const pending = pendingByToken.get(key)
  const pair = feedByToken.get(key)

  /**
   * At most ten, and every value primitive: the schema allows a nested object but a
   * flat map is what every consumer actually reads. Nothing is included that exdate
   * has not observed - an absent field is absent, never a zero.
   */
  const extensions = {
    /** What one token represents in underlying shares today. 1 for a token that never moved. */
    underlyingSharesPerToken: formatWad(multiplier, 18),
    isin: asset.isin ?? null,
    /** The Chainlink proxy a lending market would price this against, or null: 159 of 194 have none. */
    priceFeed: pair?.feedProxy ?? null,
    /**
     * Whether that pairing rests on more than a ticker match. No first-party statement
     * links any token to any feed, so this is never "verified".
     */
    priceFeedCorroboratedBy: (pair?.corroboratedBy ?? []).join(',') || null,
    dividendDeclaredNotOnChain: Boolean(pending),
    /** rate x what a token represents today. No price involved, so it holds for all 194. */
    dividendOwedPerToken: pending ? formatWad((parseDecimal(pending.rate) * multiplier) / WAD, 6) : null,
    dividendProcessDate: pending?.processDate ?? null,
    exdateUrl: `${site}/t/${key}/`,
  }

  tokens.push({
    chainId: CHAIN_ID,
    address,
    name: asset.tokenName.replace(/\s*[•·-]\s*Robinhood Token$/i, '').trim(),
    symbol: asset.tokenSymbol,
    decimals: asset.tokenDecimals ?? 18,
    ...(asset.logoUrl ? { logoURI: asset.logoUrl } : {}),
    extensions,
  })
}
tokens.sort((a, b) => a.symbol.localeCompare(b.symbol))

let previous
try {
  previous = read(OUT)
} catch {
  previous = undefined
}
const version = nextTokenListVersion(previous?.version, previous?.tokens ?? [], tokens)
const unchanged = previous && JSON.stringify(previous.version) === JSON.stringify(version)

const list = {
  name: 'exdate Robinhood Stock Tokens',
  // Reusing the previous timestamp when nothing moved keeps an unchanged rebuild
  // byte-identical, so a commit means the data changed and not that a job ran.
  timestamp: unchanged ? previous.timestamp : new Date().toISOString(),
  version,
  keywords: ['stock tokens', 'robinhood', 'dividends', 'corporate actions'],
  logoURI: `${site}/icon.svg`,
  tokens,
}

const problems = validateTokenList(list)
if (problems.length > 0) {
  console.error('# refusing to write an invalid list; a consumer would silently ignore it:')
  for (const problem of problems) console.error(`#   ${problem}`)
  process.exit(1)
}

await writeFile(new URL(OUT, root), JSON.stringify(list, null, 2) + '\n')
const withFeed = tokens.filter((t) => t.extensions.priceFeed).length
const withPending = tokens.filter((t) => t.extensions.dividendDeclaredNotOnChain).length
console.error(`# ${tokens.length} tokens, ${withFeed} with a price feed, ${withPending} with a dividend declared and not on chain`)
console.error(`# version ${version.major}.${version.minor}.${version.patch}${unchanged ? ' (unchanged)' : ''}`)
console.error(`# wrote ${OUT}`)
