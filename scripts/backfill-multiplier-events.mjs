// Full-chain scan for UIMultiplierUpdated, in the one query shape this RPC can
// actually serve, and the reason the indexer does not do it itself.
//
// Measured on 2026-09-02 against rpc.mainnet.chain.robinhood.com:
//
//   this script   26 requests   all 194 addresses per request, 2 000 000 blocks
//                               each, whole chain in about two minutes
//   Ponder        2 000+        194 addresses split into 4 chunks of ~51, and
//                               a sync round of 25 blocks that never grows
//                               because each round takes 12 s. Extrapolated to
//                               the full 51.7 M blocks: roughly 300 days.
//
// The endpoint's limiter is cost-based, not rate-based - eth_blockNumber
// survives 8 parallel calls, eth_getLogs is rejected about half the time at any
// pacing - so the fix is fewer, wider requests plus retry, not slower requests.
//
// Output: data/multiplier-events.observed.json, then
//   node scripts/generate-registry.mjs
// to regenerate the typed module the indexer seeds from.
import { writeFile } from 'node:fs/promises'
import { rpc, hex, TOPIC, decodeUIMultiplierUpdated } from './phase0/rpc.mjs'
import { fetchRegistry, toRows } from './phase0/registry.mjs'

const CHAIN_ID = 4663
const CHUNK = BigInt(process.env.BACKFILL_CHUNK_BLOCKS ?? 2_000_000)
const START_BLOCK = BigInt(process.env.RHC_START_BLOCK ?? 900_000)
const OUT = new URL('../data/multiplier-events.observed.json', import.meta.url)

const rows = toRows(await fetchRegistry()).filter((row) => row.chainId === CHAIN_ID)
const addresses = rows.map((row) => row.address)
const symbolOf = new Map(rows.map((row) => [row.address.toLowerCase(), row.symbol]))

const latest = BigInt(await rpc('eth_blockNumber', []))
console.error(`# scanning ${addresses.length} tokens, blocks ${START_BLOCK}-${latest}, chunk ${CHUNK}`)

const logs = []
for (let from = START_BLOCK; from <= latest; from += CHUNK) {
  const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n
  const found = await rpc(
    'eth_getLogs',
    [{ address: addresses, fromBlock: hex(from), toBlock: hex(to), topics: [TOPIC.UIMultiplierUpdated] }],
    { minGap: 400, tries: 12 },
  )
  logs.push(...found)
  console.error(`#   ${from}-${to}: ${found.length}`)
}

// One eth_getBlockByNumber per matched log, which is a handful of calls.
const blockTimestamps = new Map()
const timestampOf = async (blockNumber) => {
  if (!blockTimestamps.has(blockNumber)) {
    const block = await rpc('eth_getBlockByNumber', [blockNumber, false])
    blockTimestamps.set(blockNumber, BigInt(block.timestamp))
  }
  return blockTimestamps.get(blockNumber)
}

const events = []
for (const log of logs) {
  const { oldMultiplier, newMultiplier, effectiveAt } = decodeUIMultiplierUpdated(log.data)
  const announcedAt = await timestampOf(log.blockNumber)
  events.push({
    chainId: CHAIN_ID,
    symbol: symbolOf.get(log.address.toLowerCase()) ?? 'UNKNOWN',
    token: log.address,
    block: Number(BigInt(log.blockNumber)),
    announcedAt: new Date(Number(announcedAt) * 1000).toISOString().replace('.000Z', 'Z'),
    effectiveAt: new Date(Number(effectiveAt) * 1000).toISOString().replace('.000Z', 'Z'),
    leadMinutes: Number(((Number(effectiveAt - announcedAt) / 60) * 10).toFixed(0)) / 10,
    oldMultiplier: oldMultiplier.toString(),
    newMultiplier: newMultiplier.toString(),
    stepBps: Number(((Number(newMultiplier - oldMultiplier) / Number(oldMultiplier)) * 10_000).toFixed(2)),
    tx: log.transactionHash,
  })
}

events.sort((a, b) => a.block - b.block)

await writeFile(
  OUT,
  JSON.stringify(
    {
      note: 'Every UIMultiplierUpdated log on Robinhood Chain, found by scripts/backfill-multiplier-events.mjs. Each row is a real log with its transaction hash; nothing here is derived or estimated.',
      chainId: CHAIN_ID,
      scannedFromBlock: Number(START_BLOCK),
      scannedThroughBlock: Number(latest),
      scannedAt: new Date().toISOString(),
      events,
    },
    null,
    2,
  ) + '\n',
)

console.error(`# ${events.length} events across ${new Set(events.map((e) => e.symbol)).size} tokens -> data/multiplier-events.observed.json`)
