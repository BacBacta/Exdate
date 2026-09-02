// Every Robinhood feed has a second proxy. Do the two agree?
//
// `feeds-robinhood-mainnet.json` gives each feed a `proxyAddress` and a
// `secondaryProxyAddress`, and the path is `rh<ticker>-usd-shared-svr` - SVR is
// Chainlink's Smart Value Recapture, where a second proxy serves the same data
// under a different OEV arrangement. exdate reads `proxyAddress` only.
//
// That is a gap worth closing rather than assuming away: if a lending market
// reads the SVR proxy and exdate reads the other, a staleness alarm or a
// reconciliation price could be about a different number than the one the
// protocol is actually using.
//
//   node scripts/phase0/check-svr-proxies.mjs [--out data/svr-proxy-check.json]
//
// Reads both proxies by address and compares what they answer: the aggregator
// each points at, the description, the decimals, and the latest round.

import { readFileSync, writeFileSync } from 'node:fs'
import { rpc, SELECTOR, decodeLatestRoundData } from './rpc.mjs'

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'data/svr-proxy-check.json'

const AGGREGATOR = '0x245a7bfc' // aggregator()
const feeds = JSON.parse(readFileSync('data/chainlink-feeds.snapshot.json', 'utf8')).filter((feed) =>
  /^Robinhood /.test(feed.name),
)

const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest'])

function decodeString(hex) {
  const body = hex.slice(2)
  const length = Number(BigInt(`0x${body.slice(64, 128)}`))
  return Buffer.from(body.slice(128, 128 + length * 2), 'hex').toString('utf8')
}
const decodeAddress = (hex) => `0x${hex.slice(26)}`

async function readProxy(address) {
  const [round, description, decimals, aggregator] = await Promise.all([
    call(address, SELECTOR.latestRoundData).then(decodeLatestRoundData).catch(() => null),
    call(address, SELECTOR.description).then(decodeString).catch(() => null),
    call(address, SELECTOR.decimals).then((hex) => Number(BigInt(hex))).catch(() => null),
    call(address, AGGREGATOR).then(decodeAddress).catch(() => null),
  ])
  return { address, round, description, decimals, aggregator }
}

console.log(`# ${feeds.length} Robinhood feeds, each with a primary and an SVR proxy\n`)

const rows = []
for (const feed of feeds) {
  if (!feed.secondaryProxyAddress) {
    rows.push({ name: feed.name, primary: feed.proxyAddress, secondary: null, note: 'no secondary proxy' })
    continue
  }
  const [primary, secondary] = [await readProxy(feed.proxyAddress), await readProxy(feed.secondaryProxyAddress)]

  const sameAnswer =
    primary.round !== null && secondary.round !== null && primary.round.answer === secondary.round.answer
  const sameRound = primary.round !== null && secondary.round !== null && primary.round.roundId === secondary.round.roundId
  const sameAggregator =
    primary.aggregator !== null && primary.aggregator.toLowerCase() === secondary.aggregator?.toLowerCase()
  const driftBps =
    primary.round && secondary.round && secondary.round.answer !== 0n
      ? Number(((primary.round.answer - secondary.round.answer) * 1_000_000n) / secondary.round.answer) / 100
      : null
  const ageDeltaSeconds =
    primary.round && secondary.round ? Number(primary.round.updatedAt - secondary.round.updatedAt) : null

  rows.push({
    name: feed.name,
    path: feed.path,
    primary: feed.proxyAddress,
    secondary: feed.secondaryProxyAddress,
    primaryAggregator: primary.aggregator,
    secondaryAggregator: secondary.aggregator,
    sameAggregator,
    primaryDescription: primary.description,
    secondaryDescription: secondary.description,
    sameDescription: primary.description === secondary.description,
    decimals: primary.decimals,
    sameDecimals: primary.decimals === secondary.decimals,
    primaryAnswer: primary.round?.answer.toString() ?? null,
    secondaryAnswer: secondary.round?.answer.toString() ?? null,
    sameAnswer,
    sameRoundId: sameRound,
    driftBps,
    primaryUpdatedAt: primary.round ? new Date(Number(primary.round.updatedAt) * 1000).toISOString() : null,
    secondaryUpdatedAt: secondary.round ? new Date(Number(secondary.round.updatedAt) * 1000).toISOString() : null,
    ageDeltaSeconds,
  })

  const verdict = sameAnswer
    ? sameRound
      ? 'identical'
      : `same answer, different round id`
    : `DIFFERENT: ${driftBps === null ? '?' : driftBps.toFixed(2)} bps apart, ${ageDeltaSeconds}s apart`
  console.log(`  ${feed.name.replace('Robinhood ', '').padEnd(14)} ${verdict}`)
}

const compared = rows.filter((row) => row.secondary !== null)
const identical = compared.filter((row) => row.sameAnswer && row.sameRoundId)
const sameValue = compared.filter((row) => row.sameAnswer)
const sameAgg = compared.filter((row) => row.sameAggregator)

console.log(`\n# ${compared.length} pairs compared`)
console.log(`  same aggregator behind both proxies: ${sameAgg.length}`)
console.log(`  same answer:                         ${sameValue.length}`)
console.log(`  same answer AND same round id:       ${identical.length}`)
const worst = compared
  .filter((row) => row.driftBps !== null)
  .sort((a, b) => Math.abs(b.driftBps) - Math.abs(a.driftBps))[0]
if (worst) console.log(`  largest drift: ${worst.name} at ${worst.driftBps.toFixed(4)} bps`)

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: 'Robinhood feeds are published through two proxies: the primary and an SVR (Smart Value Recapture) one. exdate reads the primary. This compares what each answers, by address, so the choice is documented rather than assumed.',
      feeds: compared.length,
      sameAggregator: sameAgg.length,
      sameAnswer: sameValue.length,
      sameAnswerAndRound: identical.length,
      rows,
    },
    null,
    2,
  )}\n`,
)
console.log(`\nwrote ${OUT}`)
