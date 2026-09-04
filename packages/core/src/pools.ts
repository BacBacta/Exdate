/**
 * What a Stock Token actually trades at, against what the oracle says.
 *
 * A lending market liquidates against the Chainlink feed. The feed is 24/5 and freezes
 * outside market hours; the chain does not stop. So the distance between the traded
 * price and the feed is the risk a curator carries, and it is largest exactly when the
 * feed is stalest. Nobody publishes it.
 *
 * This module is the arithmetic only: it never fetches, and it refuses rather than
 * approximates. Everything is exact integer maths on bigints, because a price is
 * compared here at basis-point resolution and a float would lose the last digits that
 * matter.
 */

/** Uniswap v3 pool selectors, computed rather than copied; the tests check each against viem. */
export const POOL_SELECTOR = {
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
  fee: '0xddca3f43',
  slot0: '0x3850c7bd',
  liquidity: '0x1a686502',
  getPool: '0x1698ee82',
} as const

export const POOL_SIGNATURE = {
  token0: 'token0()',
  token1: 'token1()',
  fee: 'fee()',
  slot0: 'slot0()',
  liquidity: 'liquidity()',
  getPool: 'getPool(address,address,uint24)',
} as const

/** The fee tiers a Uniswap v3 factory offers, in hundredths of a basis point. */
export const FEE_TIERS = [100, 500, 3000, 10_000] as const

const Q192 = 1n << 192n

export interface PoolPriceInput {
  /** `slot0().sqrtPriceX96`, the square root of the raw token1/token0 ratio, times 2^96. */
  sqrtPriceX96: bigint
  /** True when the Stock Token is the pool's token0. Order is by address and decides the inversion. */
  stockIsToken0: boolean
  /** Decimals of the Stock Token. 18 on Robinhood Chain, 8 on Base. */
  stockDecimals: number
  /** Decimals of the quote asset. USDG is 6, not 18. */
  quoteDecimals: number
}

/**
 * The price of one Stock Token in the quote asset, WAD.
 *
 * Uniswap holds `sqrtPriceX96 = sqrt(raw token1 / raw token0) * 2^96`, so the raw ratio
 * is `sqrtPriceX96^2 / 2^192`, and the human ratio needs the decimal difference applied.
 * Both branches are exact: the numerator is built first and divided once.
 *
 * Returns null on a pool that has never been initialised, whose `sqrtPriceX96` is zero.
 */
export function poolPriceWad({ sqrtPriceX96, stockIsToken0, stockDecimals, quoteDecimals }: PoolPriceInput): bigint | null {
  if (sqrtPriceX96 <= 0n) return null
  const scale = 10n ** BigInt(18 + stockDecimals - quoteDecimals)
  const squared = sqrtPriceX96 * sqrtPriceX96
  // stock is token0: quote per stock is the raw ratio itself.
  // stock is token1: quote per stock is its inverse.
  return stockIsToken0 ? (squared * scale) / Q192 : (Q192 * scale) / squared
}

/**
 * How far `price` sits from `reference`, in basis points, signed: positive means the
 * price is above the reference. Null when the reference is not a usable price, because
 * a percentage of nothing is not zero.
 */
export function deviationBps(priceWad: bigint, referenceWad: bigint): number | null {
  if (referenceWad <= 0n) return null
  return Number(((priceWad - referenceWad) * 1_000_000n) / referenceWad) / 100
}

export interface PoolQuote {
  pool: string
  feeTier: number
  /** Active in-range liquidity. Zero means the pool exists but nothing is quotable at this price. */
  liquidity: bigint
  priceWad: bigint
}

export type PoolRefusal = 'no_pool' | 'never_initialised' | 'no_liquidity'

export interface VenuePrice {
  /** The deepest pool that actually had liquidity, or null with a reason. */
  best: PoolQuote | null
  refusal: PoolRefusal | null
  /** Every pool considered, deepest first, so a reader can see what was passed over. */
  candidates: PoolQuote[]
}

/**
 * Picks the pool a price should be read from: the one with the most active liquidity.
 *
 * A thin pool prints a price that no size can trade at, so depth is the tiebreak rather
 * than fee tier. A pool with zero liquidity is refused rather than ranked last: its
 * `sqrtPriceX96` is whatever the last trade or the initialisation left behind.
 */
export function selectVenuePrice(pools: readonly PoolQuote[]): VenuePrice {
  if (pools.length === 0) return { best: null, refusal: 'no_pool', candidates: [] }
  const candidates = [...pools].sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0))
  const withDepth = candidates.filter((pool) => pool.liquidity > 0n && pool.priceWad > 0n)
  if (withDepth.length === 0) return { best: null, refusal: 'no_liquidity', candidates }
  return { best: withDepth[0]!, refusal: null, candidates }
}

export interface FeedComparison {
  /** The traded price, WAD. */
  poolPriceWad: bigint
  /** The Chainlink answer, WAD, as published: the token price with the multiplier in it. */
  feedPriceWad: bigint
  /** Signed distance of the traded price from the feed. */
  deviationBps: number
  /** How old the feed's answer was when the pool was read. */
  feedAgeSeconds: number
  /** True once the feed is past its own publication guarantee. */
  beyondHeartbeat: boolean
}

/**
 * Both sides quote the same thing: the pool trades the raw ERC-20, and Chainlink
 * publishes `P_token = P_equity x multiplier`, which is that same raw token. Nothing is
 * unwound here - doing so would double-count the multiplier, which is the trap rule 5
 * exists for.
 */
export function compareToFeed(input: {
  poolPriceWad: bigint
  feedAnswer: bigint
  feedDecimals: number
  feedUpdatedAt: bigint
  observedAt: bigint
  heartbeatSeconds: number
}): FeedComparison | null {
  const feedPriceWad = input.feedAnswer * 10n ** BigInt(18 - input.feedDecimals)
  const deviation = deviationBps(input.poolPriceWad, feedPriceWad)
  if (deviation === null) return null
  const age = Number(input.observedAt - input.feedUpdatedAt)
  return {
    poolPriceWad: input.poolPriceWad,
    feedPriceWad,
    deviationBps: deviation,
    feedAgeSeconds: age,
    beyondHeartbeat: age > input.heartbeatSeconds,
  }
}
