// Read the Chainlink price that was live at a given instant, without an archive
// node: getRoundData(uint80) reads the aggregator's own round history from
// current storage, so a plain full node answers it.
//
//   node scripts/phase0/feed-price-at.mjs 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 2026-08-14T15:12:46Z
//
// Prints the last round at or before the instant and the first one after it.
// Round ids on a proxy are phase-encoded: (phaseId << 64) | aggregatorRoundId.
// Only the current phase is searched; a feed that changed phase since the target
// instant will report the earliest round of the current phase instead.
import { rpc, SELECTOR, decodeLatestRoundData } from './rpc.mjs'

const [feed, iso] = process.argv.slice(2)
if (!feed || !iso) {
  console.error('usage: feed-price-at.mjs <feedProxy> <ISO-8601 instant>')
  process.exit(1)
}
const target = BigInt(Math.floor(Date.parse(iso) / 1000))
const GET_ROUND_DATA = '0x9a6fc8f5'
const word = (n) => n.toString(16).padStart(64, '0')
const call = (data) => rpc('eth_call', [{ to: feed, data }, 'latest'])

const decimals = Number(BigInt(await call(SELECTOR.decimals)))
const latest = decodeLatestRoundData(await call(SELECTOR.latestRoundData))
const phase = latest.roundId >> 64n
const latestAggregatorRound = latest.roundId & ((1n << 64n) - 1n)

const roundAt = async (aggregatorRound) => {
  try {
    return decodeLatestRoundData(await call(GET_ROUND_DATA + word((phase << 64n) | aggregatorRound)))
  } catch {
    return null
  }
}

let lo = 1n
let hi = latestAggregatorRound
let best = null
while (lo <= hi) {
  const mid = (lo + hi) / 2n
  const round = await roundAt(mid)
  if (!round || round.updatedAt === 0n) {
    lo = mid + 1n
    continue
  }
  if (round.updatedAt <= target) {
    best = round
    lo = mid + 1n
  } else {
    hi = mid - 1n
  }
}

const show = (round) =>
  round
    ? `${(Number(round.answer) / 10 ** decimals).toFixed(decimals > 8 ? 8 : 4)} (round ${round.roundId}, updatedAt ${new Date(Number(round.updatedAt) * 1000).toISOString()})`
    : 'none'

console.log(`feed      ${feed}`)
console.log(`target    ${new Date(Number(target) * 1000).toISOString()}`)
console.log(`phase     ${phase}, ${latestAggregatorRound} rounds in phase`)
console.log(`at/before ${show(best)}`)
console.log(`after     ${show(best ? await roundAt((best.roundId & ((1n << 64n) - 1n)) + 1n) : null)}`)
