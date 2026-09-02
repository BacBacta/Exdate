// Refresh data/robinhood-assets.snapshot.json from the official registry and
// report what changed against the committed snapshot.
import { fetchRegistry, loadSnapshot, writeSnapshot, toRows } from './registry.mjs'

const previous = toRows(await loadSnapshot())
const payload = await fetchRegistry()
const current = toRows(payload)

const key = (row) => `${row.chainId}:${row.address.toLowerCase()}`
const before = new Map(previous.map((row) => [key(row), row]))
const after = new Map(current.map((row) => [key(row), row]))

for (const [id, row] of after) {
  if (!before.has(id)) console.log(`ADDED    ${row.symbol} ${row.address}`)
}
for (const [id, row] of before) {
  if (!after.has(id)) console.log(`REMOVED  ${row.symbol} ${row.address}`)
}
for (const [id, row] of after) {
  const old = before.get(id)
  if (!old) continue
  if (old.currentMultiplier !== row.currentMultiplier) {
    console.log(`MULTIPLIER ${row.symbol} ${old.currentMultiplier} -> ${row.currentMultiplier}`)
  }
  if (old.pendingMultiplier !== row.pendingMultiplier) {
    console.log(`PENDING    ${row.symbol} ${JSON.stringify(old.pendingMultiplier)} -> ${JSON.stringify(row.pendingMultiplier)}`)
  }
  if (old.status !== row.status) console.log(`STATUS     ${row.symbol} ${old.status} -> ${row.status}`)
}

await writeSnapshot(payload)
console.log(`\nsnapshot written: ${current.length} deployments, ${(payload.assets ?? []).length} assets`)
