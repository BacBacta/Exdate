import type { Address } from 'viem'

/**
 * Chain registry. exdate is multi-chain from day one: Base / Coinbase B20 is a
 * planned second issuer, so nothing outside this file may hardcode a chain id.
 */
export type ChainKey = 'robinhood'

export interface ChainDefinition {
  key: ChainKey
  id: number
  name: string
  /** Legal entity that issues the Stock Tokens on this chain. */
  issuer: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  /** Public RPC. Rate limited; see docs/phase-0-verification.md section 7. */
  defaultRpcUrl: string
  explorerUrl: string
  /**
   * First block worth indexing. Block 1 is 2026-04-30, the public mainnet date
   * is 2026-07-01 (~block 900 000) and the earliest UIMultiplierUpdated log is
   * at block 978 630, so this floor skips ~900 000 empty blocks.
   */
  startBlock: number
  /** Canonical Multicall3, verified deployed on Robinhood Chain. */
  multicall3Address: Address
  /** ~0.1 s per block, measured over 10 000 blocks on 2026-09-02. */
  blockTimeSeconds: number
  /**
   * Where a contract call can read the chain's own block number. On an
   * Arbitrum-family chain `block.number` inside the EVM is the parent chain's
   * block (measured 2026-09-03: Multicall3's getBlockNumber answered
   * 25 896 564 while eth_blockNumber and ArbSys.arbBlockNumber both answered
   * 53 391 912), so a read that wants to date itself must go through ArbSys.
   * Absent on a chain where `block.number` is already the L2 block.
   */
  blockNumberSource?: { target: Address; selector: `0x${string}`; signature: string }
}

/** The Arbitrum ArbSys precompile: 1 byte of code at a fixed address on every Arbitrum-family chain, verified on Robinhood Chain. */
export const ARBSYS_ADDRESS: Address = '0x0000000000000000000000000000000000000064'

export const ROBINHOOD_CHAIN: ChainDefinition = {
  key: 'robinhood',
  id: 4663,
  name: 'Robinhood Chain',
  issuer: 'Robinhood Assets (Jersey) Limited',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  defaultRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  startBlock: 900_000,
  multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  blockTimeSeconds: 0.1,
  blockNumberSource: { target: ARBSYS_ADDRESS, selector: '0xa3b1b31d', signature: 'arbBlockNumber()' },
}

export const CHAINS: Record<ChainKey, ChainDefinition> = {
  robinhood: ROBINHOOD_CHAIN,
}

export const CHAINS_BY_ID: Record<number, ChainDefinition> = Object.fromEntries(
  Object.values(CHAINS).map((chain) => [chain.id, chain]),
)

/**
 * Resolve a chain from a URL path segment: either its key or its numeric id.
 *
 * `Object.hasOwn`, not `in`: `'constructor' in CHAINS` is true for any object
 * literal, and the `in` form let `/v1/constructor/tokens` answer 200 with an
 * empty dataset instead of 404. The id branch accepts only a plain decimal
 * integer, so "4663.0", "0x1237" and " 4663" are all unknown.
 */
export function resolveChain(segment: string): ChainDefinition | undefined {
  if (Object.hasOwn(CHAINS, segment)) return CHAINS[segment as ChainKey]
  if (!/^\d+$/.test(segment)) return undefined
  return CHAINS_BY_ID[Number(segment)]
}

/**
 * Issuer REST API. Documented at docs.robinhood.com/chain/stock-token-apis.
 * No auth. Documented limit 60 req/s, but /prices answers the plain-text body
 * "local_rate_limited" with HTTP 200 well below that - always parse defensively.
 */
export const ROBINHOOD_API_BASE = 'https://api.robinhood.com/rhj'

/** Chainlink feed heartbeat on every Robinhood tokenized-equity feed. */
export const FEED_HEARTBEAT_SECONDS = 86_400

/** Chainlink deviation threshold, percent, on every Robinhood equity feed. */
export const FEED_DEVIATION_THRESHOLD_PERCENT = 0.5
