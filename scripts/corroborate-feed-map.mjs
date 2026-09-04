// Turn accumulated price readings into a corroborated token -> feed pairing.
//
// No first-party statement links any Stock Token to any Chainlink feed, so the map is a
// ticker match and `confidence` is `low` almost everywhere. Two kinds of evidence can
// lift a pairing, and they are not the same thing:
//
//   multiplier-step   this token's own dividend moved this feed by the step's own size,
//                     louder than the feed's noise. Causal, and the strongest available.
//                     SGOV alone has it.
//   traded-price      this token's pool price sits far closer to this feed than to any
//                     other, repeatedly. Identification rather than causation: weaker,
//                     because two unrelated assets can trade at the same price.
//
// Both are recorded by name. `corroborated` is true when either holds, and
// `corroboratedBy` says which - a reader must never have to guess what carried it.
//
//   node scripts/corroborate-feed-map.mjs
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const MAP = 'data/token-feed-map.json'

/** Mirrors CORROBORATION_MINIMUM_SAMPLES and CORROBORATION_MAJORITY in packages/core/src/pools.ts. */
const MINIMUM_SAMPLES = 3
const MAJORITY = 2 / 3

const map = read(MAP)
let gap
try {
  gap = read('data/dex-feed-gap.observed.json')
} catch {
  console.error('# no gap readings yet; nothing to corroborate')
  process.exit(0)
}
const tally = gap.corroboration ?? {}

let lifted = 0
let refused = 0
for (const pair of map.pairs) {
  const entry = tally[pair.token.toLowerCase()]
  const byStep = pair.evidence?.multiplierStep?.agreeing > 0

  if (!entry) {
    // No pool with liquidity, or no reading yet: say that, rather than leaving the
    // absence of evidence looking like evidence weighed and rejected.
    pair.evidence = {
      ...pair.evidence,
      tradedPrice: { samples: 0, corroborating: 0, medianSeparation: null, verdict: 'no_reading' },
    }
  } else {
    const enough = entry.samples >= MINIMUM_SAMPLES
    const majority = entry.samples > 0 && entry.corroborating / entry.samples >= MAJORITY
    const byPrice = enough && majority
    pair.evidence = {
      ...pair.evidence,
      tradedPrice: {
        samples: entry.samples,
        corroborating: entry.corroborating,
        /** How many times further the nearest other feed sits. Higher is stronger identification. */
        medianSeparation: entry.medianSeparation ?? null,
        lastRefusal: entry.lastRefusal ?? null,
        verdict: byPrice
          ? 'corroborates'
          : !enough
            ? `needs ${MINIMUM_SAMPLES} readings, has ${entry.samples}`
            : `only ${entry.corroborating} of ${entry.samples} readings agree`,
      },
    }
    if (byPrice) lifted++
    else if (enough) refused++
  }

  const byPrice = pair.evidence.tradedPrice?.verdict === 'corroborates'
  pair.corroboratedBy = [byStep ? 'multiplier-step' : null, byPrice ? 'traded-price' : null].filter(Boolean)
  pair.corroborated = pair.corroboratedBy.length > 0
}

map.corroborated = map.pairs.filter((p) => p.corroborated).length
map.corroboratedByStep = map.pairs.filter((p) => p.corroboratedBy?.includes('multiplier-step')).length
map.corroboratedByPrice = map.pairs.filter((p) => p.corroboratedBy?.includes('traded-price')).length
map.corroborationNote =
  'A pairing is corroborated when its own multiplier step was seen moving this feed (causal, strongest), or when its traded price repeatedly sits far closer to this feed than to any other (identification, weaker: two unrelated assets can trade at one price). corroboratedBy names which. Neither is a first-party statement, and none reaches `high`.'
map.corroboratedAt = new Date().toISOString()

await writeFile(new URL(MAP, root), JSON.stringify(map, null, 2) + '\n')
console.error(`# ${map.corroborated}/${map.pairs.length} pairings corroborated: ${map.corroboratedByStep} by step, ${map.corroboratedByPrice} by price`)
console.error(`# price evidence: ${lifted} pairing(s) meet the bar, ${refused} have enough readings and do not`)
console.error(`# wrote ${MAP}`)
