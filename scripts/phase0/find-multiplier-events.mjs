// Phase 0 - step 4: scan the whole chain for UIMultiplierUpdated on the given
// tokens and print the observed step and the scheduling lead time.
//
//   node scripts/phase0/find-multiplier-events.mjs SGOV AAPL
//   node scripts/phase0/find-multiplier-events.mjs 0x92FD...F9B5
//
// With no argument, every token whose registry multiplier is not exactly 1.0 is
// scanned - those are the only ones that can have an event.
import { rpc, hex, TOPIC, decodeUIMultiplierUpdated } from './rpc.mjs'
import { fetchRegistry, toRows } from './registry.mjs'

const CHUNK = 2_000_000n

const args = process.argv.slice(2).map((a) => a.toLowerCase())
const rows = toRows(await fetchRegistry()).filter((r) =>
  args.length > 0
    ? args.includes(r.address.toLowerCase()) || args.includes(r.symbol.toLowerCase())
    : r.currentMultiplier !== '1.000000000000000000' || r.pendingMultiplier !== '',
)

const latest = BigInt(await rpc('eth_blockNumber', []))
const timestamps = new Map()
const timestampOf = async (blockNumber) => {
  if (!timestamps.has(blockNumber)) {
    const block = await rpc('eth_getBlockByNumber', [blockNumber, false])
    timestamps.set(blockNumber, BigInt(block.timestamp))
  }
  return timestamps.get(blockNumber)
}

for (const row of rows) {
  const logs = []
  for (let from = 0n; from <= latest; from += CHUNK) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n
    try {
      logs.push(...(await rpc('eth_getLogs', [{ address: row.address, fromBlock: hex(from), toBlock: hex(to), topics: [TOPIC.UIMultiplierUpdated] }], { minGap: 400 })))
    } catch (error) {
      console.error(`# ${row.symbol} ${from}-${to}: ${String(error.message).slice(0, 70)}`)
    }
  }

  console.log(`\n${row.symbol} ${row.address} - ${logs.length} UIMultiplierUpdated event(s)`)
  for (const log of logs) {
    const { oldMultiplier, newMultiplier, effectiveAt } = decodeUIMultiplierUpdated(log.data)
    const minedAt = await timestampOf(log.blockNumber)
    const leadMinutes = (Number(effectiveAt - minedAt) / 60).toFixed(1)
    const stepBps = (Number(newMultiplier - oldMultiplier) / Number(oldMultiplier)) * 10_000
    console.log(
      `  block=${BigInt(log.blockNumber)} announcedAt=${new Date(Number(minedAt) * 1000).toISOString()}` +
        ` effectiveAt=${new Date(Number(effectiveAt) * 1000).toISOString()} lead=${leadMinutes}min` +
        ` ${oldMultiplier} -> ${newMultiplier} (${stepBps.toFixed(2)} bps) tx=${log.transactionHash}`,
    )
  }
}
