// What would indexing transfers actually cost, and what would it be worth?
//
// The kickoff brief assumed a transfer indexer. Phase 0 found the log volume
// prohibitive on the public RPC and the milestone was dropped, but the number
// behind that decision - "AAPL alone emits ~375 000 logs/day" - was measured
// once, early, on one token. This measures the whole set, over a window, and
// answers the two questions that decide the design:
//
//   1. how many Transfer logs per day across all 194 tokens, and
//   2. how many of them are provable trades - a Stock Token and USDG moving in
//      the same transaction, which is the only on-chain evidence that a trade
//      happened rather than custody moving.
//
//   node scripts/phase0/measure-transfers.mjs [blocks]
//
// Read-only, one wide eth_getLogs per chunk, no state.

import { readFileSync, writeFileSync } from 'node:fs'
import { rpc, hex, TOPIC } from './rpc.mjs'

const BLOCKS = BigInt(process.argv[2] ?? 6000)
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase()

const registry = JSON.parse(readFileSync('data/robinhood-assets.snapshot.json', 'utf8'))
const tokens = registry.assets.flatMap((asset) =>
  (asset.deployments ?? []).filter((d) => d.chainId === 4663).map((d) => d.contractAddress),
)
const bySymbol = new Map(
  registry.assets.flatMap((asset) =>
    (asset.deployments ?? []).map((d) => [d.contractAddress.toLowerCase(), asset.tokenSymbol]),
  ),
)

const head = BigInt(await rpc('eth_blockNumber', []))
const from = head - BLOCKS + 1n
console.log(`# head ${head}, window ${BLOCKS} blocks (${from}-${head})`)

/**
 * The endpoint caps a result set at 10 000 logs, and that cap is itself the
 * first measurement: a window that overflows it is a window with more than
 * 10 000 transfers in it. Halve until it fits, and report the window that did.
 */
async function transfersIn(address, startBlock, endBlock) {
  let start = startBlock
  for (;;) {
    try {
      const result = await rpc('eth_getLogs', [
        { address, fromBlock: hex(start), toBlock: hex(endBlock), topics: [TOPIC.Transfer] },
      ])
      return { logs: result, blocks: endBlock - start + 1n }
    } catch (error) {
      if (!/exceeds limit/.test(error.message)) throw error
      const span = endBlock - start + 1n
      if (span <= 1n) throw error
      start = endBlock - span / 2n + 1n
      console.log(`  (over the 10 000-log cap; narrowing to ${span / 2n} blocks)`)
    }
  }
}

const { logs, blocks: window } = await transfersIn(tokens, from, head)
const BLOCKS_MEASURED = window
console.log(`# ${logs.length} Transfer logs from the 194 Stock Tokens in ${window} blocks`)

// ERC-721 declares the same signature, so topic0 collides by construction. A
// fourth topic is the tokenId: that log is an NFT, not an ERC-20 transfer.
const erc20 = logs.filter((log) => log.topics.length === 3)
const erc721 = logs.length - erc20.length
const zero = '0x0000000000000000000000000000000000000000000000000000000000000000'
const mints = erc20.filter((log) => log.topics[1] === zero).length
const burns = erc20.filter((log) => log.topics[2] === zero).length

// Blocks are ~0.1 s, so a day is ~857 000 of them.
const perDay = (n) => Math.round((n / Number(BLOCKS_MEASURED)) * 857_000)

console.log(`  ERC-20:        ${erc20.length}  (~${perDay(erc20.length).toLocaleString('en-US')}/day)`)
console.log(`  ERC-721 (dropped by arity): ${erc721}`)
console.log(`  mints ${mints}, burns ${burns} - restricted to KYB'd participants`)

const byToken = new Map()
for (const log of erc20) {
  const key = log.address.toLowerCase()
  byToken.set(key, (byToken.get(key) ?? 0) + 1)
}
const busiest = [...byToken.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log(`  ${byToken.size} of 194 tokens moved at all; busiest:`)
for (const [address, count] of busiest) {
  console.log(`    ${(bySymbol.get(address) ?? address).padEnd(8)} ${count} (~${perDay(count).toLocaleString('en-US')}/day)`)
}

// --- provable trades ---------------------------------------------------------
const { logs: usdgLogs } = await transfersIn(USDG, head - BLOCKS_MEASURED + 1n, head)
const usdgTx = new Set(usdgLogs.filter((log) => log.topics.length === 3).map((log) => log.transactionHash))
const stockTx = new Set(erc20.map((log) => log.transactionHash))
const provable = [...stockTx].filter((tx) => usdgTx.has(tx))

console.log(`\n# provable trades in the same window`)
console.log(`  USDG transfers:            ${usdgLogs.length}`)
console.log(`  transactions moving a token: ${stockTx.size}`)
console.log(`  ...that also move USDG:      ${provable.length} (~${perDay(provable.length).toLocaleString('en-US')}/day)`)
console.log(
  `  a transfer alone proves custody moved, not that a trade happened; both legs in one transaction is the evidence.`,
)

writeFileSync(
  'data/transfer-volume.observed.json',
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      note: 'What indexing transfers would cost, measured rather than assumed. One eth_getLogs over a window narrowed until it fits under the endpoint\'s 10 000-log cap; per-day figures extrapolate at the measured chain cadence of ~857 000 blocks a day. A sample of a single window, not a day: the off-hours share is not measured here.',
      chainId: 4663,
      headBlock: Number(head),
      windowBlocks: Number(BLOCKS_MEASURED),
      windowSeconds: Number(BLOCKS_MEASURED) / 10,
      erc20Transfers: erc20.length,
      erc20TransfersPerDay: perDay(erc20.length),
      erc721LogsDroppedByArity: erc721,
      mints,
      burns,
      tokensThatMoved: byToken.size,
      tokensTotal: tokens.length,
      busiest: busiest.map(([address, count]) => ({
        symbol: bySymbol.get(address) ?? null,
        token: address,
        transfers: count,
        perDay: perDay(count),
      })),
      usdgTransfers: usdgLogs.length,
      transactionsMovingAToken: stockTx.size,
      provableTrades: provable.length,
      provableTradesPerDay: perDay(provable.length),
      provableShareOfTokenTransactions: Number((provable.length / stockTx.size).toFixed(4)),
    },
    null,
    2,
  )}\n`,
)
console.log('\nwrote data/transfer-volume.observed.json')
