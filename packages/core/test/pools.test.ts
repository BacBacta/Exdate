import { toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  FEE_TIERS,
  POOL_SELECTOR,
  POOL_SIGNATURE,
  compareToFeed,
  deviationBps,
  poolPriceWad,
  selectVenuePrice,
  type PoolQuote,
} from '../src/pools.js'

const WAD = 10n ** 18n

/**
 * How far a computed price sits from what the fixture meant, in basis points. The
 * fixtures build `sqrtPriceX96` with an integer square root, which truncates, so a
 * price recovered from one is right to well under a basis point but not to the last
 * wei. Asserting exact equality would be asserting the fixture's rounding, not the
 * function's arithmetic.
 */
const offBy = (actual: bigint, expected: bigint) => Math.abs(deviationBps(actual, expected)!)

/** sqrtPriceX96 for a raw token1/token0 ratio of exactly `n/d`. */
const sqrtFor = (n: bigint, d: bigint) => {
  // integer sqrt of (n << 192) / d
  let x = (n << 192n) / d
  if (x < 2n) return x
  let y = x
  let z = (x + 1n) / 2n
  while (z < y) {
    y = z
    z = (x / z + z) / 2n
  }
  return y
}

describe('selectors', () => {
  it('match viem for every signature', () => {
    for (const key of Object.keys(POOL_SIGNATURE) as (keyof typeof POOL_SIGNATURE)[]) {
      expect(POOL_SELECTOR[key], key).toBe(toFunctionSelector(POOL_SIGNATURE[key]))
    }
  })

  it('offers the four standard fee tiers', () => {
    expect([...FEE_TIERS]).toEqual([100, 500, 3000, 10_000])
  })
})

describe('poolPriceWad', () => {
  // AAPL/USDG: an 18-decimal token against a 6-decimal quote, which is where an
  // unadjusted implementation is off by a factor of a million.
  const decimals = { stockDecimals: 18, quoteDecimals: 6 }

  it('reads $328 per token with the stock as token0', () => {
    // raw USDG per raw AAPL = 328 * 1e6 / 1e18
    const sqrt = sqrtFor(328n * 10n ** 6n, 10n ** 18n)
    const price = poolPriceWad({ sqrtPriceX96: sqrt, stockIsToken0: true, ...decimals })!
    expect(offBy(price, 328n * WAD)).toBeLessThan(0.01)
  })

  it('reads the same price with the order inverted', () => {
    const sqrt = sqrtFor(10n ** 18n, 328n * 10n ** 6n)
    const price = poolPriceWad({ sqrtPriceX96: sqrt, stockIsToken0: false, ...decimals })!
    expect(offBy(price, 328n * WAD)).toBeLessThan(0.01)
  })

  it('handles a quote with the same decimals as the token', () => {
    const sqrt = sqrtFor(50n * 10n ** 18n, 10n ** 18n)
    const price = poolPriceWad({ sqrtPriceX96: sqrt, stockIsToken0: true, stockDecimals: 18, quoteDecimals: 18 })!
    expect(offBy(price, 50n * WAD)).toBeLessThan(0.01)
  })

  it('applies the decimal difference exactly, which is where a naive reading is off by a million million', () => {
    // A ratio of exactly 1 raw unit to 1 raw unit: sqrtPriceX96 is 2^96 with no rounding.
    const one = 1n << 96n
    // 1 raw USDG per 1 raw AAPL is 1e-18 AAPL for 1e-6 USDG, so 1e12 USDG per whole AAPL.
    expect(poolPriceWad({ sqrtPriceX96: one, stockIsToken0: true, ...decimals })).toBe(10n ** 12n * WAD)
    expect(poolPriceWad({ sqrtPriceX96: one, stockIsToken0: false, ...decimals })).toBe(10n ** 12n * WAD)
  })

  it('refuses a pool that was never initialised rather than printing zero', () => {
    expect(poolPriceWad({ sqrtPriceX96: 0n, stockIsToken0: true, ...decimals })).toBeNull()
    expect(poolPriceWad({ sqrtPriceX96: -1n, stockIsToken0: true, ...decimals })).toBeNull()
  })
})

describe('deviationBps', () => {
  it('is signed, and zero when the two agree', () => {
    expect(deviationBps(100n * WAD, 100n * WAD)).toBe(0)
    expect(deviationBps(101n * WAD, 100n * WAD)).toBe(100)
    expect(deviationBps(99n * WAD, 100n * WAD)).toBe(-100)
  })

  it('resolves a single basis point on a three-figure price', () => {
    expect(deviationBps(328_032_800_000_000_000_000n, 328n * WAD)).toBe(1)
  })

  it('refuses a reference that is not a price, because a percentage of nothing is not zero', () => {
    expect(deviationBps(100n * WAD, 0n)).toBeNull()
  })
})

describe('selectVenuePrice', () => {
  const pool = (name: string, liquidity: bigint, priceWad = 328n * WAD, feeTier = 500): PoolQuote => ({
    pool: name,
    feeTier,
    liquidity,
    priceWad,
  })

  it('takes the deepest pool, not the cheapest fee tier', () => {
    const result = selectVenuePrice([pool('thin', 10n, 300n * WAD, 100), pool('deep', 10_000n, 328n * WAD, 3000)])
    expect(result.best?.pool).toBe('deep')
    expect(result.refusal).toBeNull()
    expect(result.candidates.map((c) => c.pool)).toEqual(['deep', 'thin'])
  })

  it('names why there is no price, and shows what it passed over', () => {
    expect(selectVenuePrice([])).toMatchObject({ best: null, refusal: 'no_pool' })
    const empty = selectVenuePrice([pool('drained', 0n)])
    expect(empty).toMatchObject({ best: null, refusal: 'no_liquidity' })
    expect(empty.candidates).toHaveLength(1)
  })
})

describe('compareToFeed', () => {
  // Both sides quote the raw token: Chainlink publishes P_equity x multiplier, and the
  // pool trades that same token. Unwinding the multiplier here would double-count it.
  const base = { feedDecimals: 8, heartbeatSeconds: 86_400, observedAt: 1_788_000_000n }

  it('scales an 8-decimal answer to WAD and reports a signed distance', () => {
    const result = compareToFeed({
      ...base,
      poolPriceWad: 328n * WAD,
      feedAnswer: 32_800_000_000n, // 328.00000000
      feedUpdatedAt: 1_788_000_000n - 600n,
    })!
    expect(result.feedPriceWad).toBe(328n * WAD)
    expect(result.deviationBps).toBe(0)
    expect(result.feedAgeSeconds).toBe(600)
    expect(result.beyondHeartbeat).toBe(false)
  })

  it('flags a feed past its own publication guarantee, which is when the gap matters most', () => {
    const result = compareToFeed({
      ...base,
      poolPriceWad: 330n * WAD,
      feedAnswer: 32_800_000_000n,
      feedUpdatedAt: 1_788_000_000n - 90_000n,
    })!
    expect(result.deviationBps).toBeCloseTo(60.98, 1)
    expect(result.beyondHeartbeat).toBe(true)
  })

  it('is null when the feed has no usable answer', () => {
    expect(compareToFeed({ ...base, poolPriceWad: 328n * WAD, feedAnswer: 0n, feedUpdatedAt: 1_788_000_000n })).toBeNull()
  })
})
