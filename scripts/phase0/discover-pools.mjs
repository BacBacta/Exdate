// Where the Stock Tokens actually trade, found on chain rather than taken from a page.
//
// Robinhood's own contracts page lists the rollup, the bridge and the precompiles, and
// no DEX address at all. So the venue was found by behaviour: take the counterparties
// of recent Transfer logs that hold code, and ask each whether it answers the selectors
// a Uniswap v3 pool answers. Two such factories turned up; the first then confirmed the
// finding by claiming each pool through its own `getPool`, which makes the pool -> factory
// link first-party on chain - something the token -> feed pairing has nowhere.
//
// This script enumerates every (token, USDG, fee tier) pool that factory reports, reads
// each pool's price and liquidity, and writes what it found.
//
//   node scripts/phase0/discover-pools.mjs
import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { rpc } from './rpc.mjs'

const root = new URL('../../', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const USDG_DECIMALS = 6
/**
 * Found by probing Transfer counterparties, then confirmed: this factory's `getPool`
 * returns exactly the pools that were found by behaviour. A second contract answering
 * pool selectors sits at 0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3 and does not answer
 * `getPool`; it is recorded as unidentified rather than guessed at.
 */
const FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'
const OTHER_FACTORY = '0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3'
const FEE_TIERS = [100, 500, 3000, 10_000]
const ZERO = '0x' + '0'.repeat(40)

// Computed in packages/core/src/pools.ts and checked against viem there.
const SEL = { getPool: '0x1698ee82', slot0: '0x3850c7bd', liquidity: '0x1a686502', token0: '0x0dfe1681' }

const pad = (address) => address.replace(/^0x/, '').toLowerCase().padStart(64, '0')
const word = (n) => BigInt(n).toString(16).padStart(64, '0')

/** aggregate3, hand-encoded the same way packages/core/src/holdings.ts does. */
function aggregate3(calls) {
  const tuples = calls.map(({ target, callData }) => {
    const bytes = callData.slice(2)
    const length = bytes.length / 2
    return pad(target) + word(1) + word(0x60) + word(length) + bytes.padEnd(Math.ceil(length / 32) * 64, '0')
  })
  const offsets = []
  let offset = BigInt(calls.length * 32)
  for (const tuple of tuples) {
    offsets.push(word(offset))
    offset += BigInt(tuple.length / 2)
  }
  return `0x82ad56cb${word(0x20)}${word(calls.length)}${offsets.join('')}${tuples.join('')}`
}

function decodeAggregate3(result) {
  const hex = result.slice(2)
  const at = (byteOffset) => Number(BigInt('0x' + hex.slice(byteOffset * 2, byteOffset * 2 + 64)))
  const arrayStart = at(0)
  const length = at(arrayStart)
  const base = arrayStart + 32
  const out = []
  for (let i = 0; i < length; i++) {
    const tuple = base + at(base + i * 32)
    const success = at(tuple) === 1
    const bytes = tuple + at(tuple + 32)
    const size = at(bytes)
    out.push({ success, returnData: '0x' + hex.slice((bytes + 32) * 2, (bytes + 32 + size) * 2) })
  }
  return out
}

/** Multicall3 takes hundreds of sub-calls per request; 400 keeps calldata well inside what the node accepts. */
async function batched(calls, size = 400) {
  const out = []
  for (let i = 0; i < calls.length; i += size) {
    const chunk = calls.slice(i, i + size)
    const result = await rpc('eth_call', [{ to: MULTICALL3, data: aggregate3(chunk) }, 'latest'], { minGap: 150, tries: 8 })
    out.push(...decodeAggregate3(result))
  }
  return out
}

const registry = read('data/robinhood-assets.snapshot.json')
const assets = registry.assets ?? registry
const tokens = []
for (const asset of assets) {
  for (const d of asset.deployments ?? []) {
    if (String(d.chainId) === '4663') {
      tokens.push({ symbol: asset.tokenSymbol, address: d.contractAddress, decimals: asset.tokenDecimals ?? 18 })
    }
  }
}
console.error(`# ${tokens.length} tokens x ${FEE_TIERS.length} fee tiers against USDG`)

// --- 1. which pools exist -----------------------------------------------------
const lookups = tokens.flatMap((token) =>
  FEE_TIERS.map((fee) => ({ token, fee, target: FACTORY, callData: SEL.getPool + pad(token.address) + pad(USDG) + word(fee) })),
)
const found = await batched(lookups)
const pools = []
lookups.forEach((lookup, i) => {
  const row = found[i]
  if (!row?.success || row.returnData.length !== 66) return
  const address = '0x' + row.returnData.slice(26)
  if (address === ZERO) return
  pools.push({ ...lookup.token, feeTier: lookup.fee, pool: address })
})
console.error(`# ${pools.length} pools reported by the factory, across ${new Set(pools.map((p) => p.address)).size} tokens`)

// --- 2. what each pool says ---------------------------------------------------
const reads = pools.flatMap((pool) => [
  { target: pool.pool, callData: SEL.slot0 },
  { target: pool.pool, callData: SEL.liquidity },
  { target: pool.pool, callData: SEL.token0 },
])
const answers = await batched(reads)
const Q192 = 1n << 192n
const rows = []
pools.forEach((pool, i) => {
  const [slot0, liquidity, token0] = [answers[i * 3], answers[i * 3 + 1], answers[i * 3 + 2]]
  if (!slot0?.success || slot0.returnData.length < 130) return
  const sqrtPriceX96 = BigInt('0x' + slot0.returnData.slice(2, 66))
  const stockIsToken0 = token0?.success ? '0x' + token0.returnData.slice(26) === pool.address.toLowerCase() : null
  if (stockIsToken0 === null) return
  const scale = 10n ** BigInt(18 + pool.decimals - USDG_DECIMALS)
  const squared = sqrtPriceX96 * sqrtPriceX96
  const priceWad = sqrtPriceX96 === 0n ? null : stockIsToken0 ? (squared * scale) / Q192 : (Q192 * scale) / squared
  rows.push({
    symbol: pool.symbol,
    token: pool.address,
    pool: pool.pool,
    feeTier: pool.feeTier,
    stockIsToken0,
    sqrtPriceX96: sqrtPriceX96.toString(),
    liquidity: liquidity?.success ? BigInt(liquidity.returnData).toString() : null,
    priceWad: priceWad === null ? null : priceWad.toString(),
    price: priceWad === null ? null : (Number(priceWad) / 1e18).toFixed(6),
  })
})

const withLiquidity = rows.filter((r) => r.liquidity && BigInt(r.liquidity) > 0n)
const tokensQuotable = new Set(withLiquidity.map((r) => r.token.toLowerCase()))
const otherCode = await rpc('eth_getCode', [OTHER_FACTORY, 'latest'])

await writeFile(
  new URL('data/dex-pools.json', root),
  JSON.stringify(
    {
      note:
        "Uniswap v3 pools pairing each Stock Token with USDG, enumerated from the factory. Prices are the raw token price, the same thing Chainlink publishes (P_equity x multiplier), so the two are directly comparable and no multiplier is unwound from either.",
      method:
        "The venue was found by behaviour - Transfer counterparties that answer token0/token1/slot0 - and then confirmed by the factory claiming each pool through getPool. Prices come from slot0().sqrtPriceX96, adjusted for the 18-vs-6 decimal difference against USDG.",
      discoveredAt: new Date().toISOString(),
      factory: FACTORY,
      quote: { symbol: 'USDG', address: USDG, decimals: USDG_DECIMALS },
      feeTiers: FEE_TIERS,
      unidentifiedVenue: {
        address: OTHER_FACTORY,
        bytes: (otherCode.length - 2) / 2,
        note: 'answers pool selectors on its own pools but not getPool; a second venue, left unnamed rather than guessed at',
      },
      summary: {
        tokens: tokens.length,
        pools: rows.length,
        poolsWithLiquidity: withLiquidity.length,
        tokensQuotable: tokensQuotable.size,
      },
      pools: rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.feeTier - b.feeTier),
    },
    null,
    2,
  ) + '\n',
)
console.error(`# ${rows.length} pools read, ${withLiquidity.length} with liquidity, covering ${tokensQuotable.size} of ${tokens.length} tokens`)
console.error('# wrote data/dex-pools.json')
