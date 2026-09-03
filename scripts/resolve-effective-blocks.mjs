// Resolve, once, the block at which each observed multiplier change took effect.
//
// `effectiveAt` is a timestamp; the chain applies the new multiplier from the
// first block whose timestamp is at or past it. A wallet's balance "at the
// step" is therefore its balance after every transfer in blocks strictly
// before that block. Twelve binary searches over block headers, which the
// public RPC serves for any height (only *state* is pruned), written to
// data/effective-blocks.json so no browser ever repeats them.
//
//   node scripts/resolve-effective-blocks.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { rpc, hex } from './phase0/rpc.mjs'

const EVENTS = 'data/multiplier-events.observed.json'
const OUT = 'data/effective-blocks.json'
const FLOOR = 900_000 // public mainnet; block 0 has timestamp 0 and must never enter a search

const events = JSON.parse(readFileSync(EVENTS, 'utf8')).events
const distinct = [...new Map(events.map((e) => [`${e.token.toLowerCase()}:${e.effectiveAt}`, e])).values()]
const previous = (() => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8')).blocks
  } catch {
    return []
  }
})()
const known = new Map(previous.map((b) => [`${b.token.toLowerCase()}:${b.effectiveAt}`, b]))

const header = async (n) => {
  const b = await rpc('eth_getBlockByNumber', [hex(n), false])
  if (!b) throw new Error(`no block ${n}`)
  return { number: Number(b.number), timestamp: Number(b.timestamp) }
}

/** First block with timestamp >= target, by bisection over [lo, hi]. */
async function firstBlockAtOrAfter(target, lo, hi) {
  let reads = 0
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const h = await header(mid)
    reads++
    if (h.timestamp >= target) hi = mid
    else lo = mid + 1
  }
  const found = await header(lo)
  const before = await header(lo - 1)
  reads += 2
  if (found.timestamp < target || before.timestamp >= target) throw new Error(`bisection failed at ${lo}`)
  return { block: lo, timestamp: found.timestamp, previousTimestamp: before.timestamp, reads }
}

const head = Number(await rpc('eth_blockNumber', []))
const blocks = []
for (const e of distinct) {
  const key = `${e.token.toLowerCase()}:${e.effectiveAt}`
  if (known.has(key)) {
    blocks.push(known.get(key))
    continue
  }
  const target = Math.floor(Date.parse(e.effectiveAt) / 1000)
  // the change is announced before it takes effect, so its block is a lower bound
  const r = await firstBlockAtOrAfter(target, Math.max(FLOOR, e.block), head)
  const row = {
    token: e.token,
    symbol: e.symbol,
    effectiveAt: e.effectiveAt,
    announcedBlock: e.block,
    effectiveBlock: r.block,
    effectiveBlockTimestamp: new Date(r.timestamp * 1000).toISOString(),
    previousBlockTimestamp: new Date(r.previousTimestamp * 1000).toISOString(),
    oldMultiplier: e.oldMultiplier,
    newMultiplier: e.newMultiplier,
  }
  console.log(`${e.symbol.padEnd(5)} ${e.effectiveAt}  block ${r.block}  (${r.reads} reads, +${r.block - e.block} after announcement)`)
  blocks.push(row)
}
blocks.sort((a, b) => a.effectiveBlock - b.effectiveBlock)
writeFileSync(
  OUT,
  JSON.stringify(
    {
      resolvedAt: new Date().toISOString(),
      method:
        'first block whose timestamp >= effectiveAt, bisection over eth_getBlockByNumber headers from the announcement block; a balance "at the step" is the balance after all transfers in blocks < effectiveBlock',
      source: EVENTS,
      blocks,
    },
    null,
    2,
  ) + '\n',
)
console.log(`wrote ${OUT}: ${blocks.length} effective blocks`)
