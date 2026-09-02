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
}

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
}

export const CHAINS: Record<ChainKey, ChainDefinition> = {
  robinhood: ROBINHOOD_CHAIN,
}

export const CHAINS_BY_ID: Record<number, ChainDefinition> = Object.fromEntries(
  Object.values(CHAINS).map((chain) => [chain.id, chain]),
)

/** Resolve a chain from a URL path segment: either its key or its numeric id. */
export function resolveChain(segment: string): ChainDefinition | undefined {
  if (segment in CHAINS) return CHAINS[segment as ChainKey]
  const id = Number(segment)
  return Number.isInteger(id) ? CHAINS_BY_ID[id] : undefined
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
