import type { Address } from 'viem'
import { REGISTRY_TOKENS, type RegistryToken } from './generated/registry.js'

export {
  REGISTRY_TOKENS,
  REGISTRY_GENERATED_AT,
  SCANNED_MULTIPLIER_EVENTS,
  ARCHIVED_CORPORATE_ACTIONS,
  SCAN_FROM_BLOCK,
  SCAN_THROUGH_BLOCK,
  SCANNED_AT,
} from './generated/registry.js'
export type {
  ArchivedCorporateAction,
  FeedCorroboration,
  RegistryToken,
  ScannedMultiplierEvent,
} from './generated/registry.js'

const byAddress = new Map<string, RegistryToken>(
  REGISTRY_TOKENS.map((token) => [`${token.chainId}:${token.address.toLowerCase()}`, token]),
)

/** Look a token up by chain and address. Never by symbol - metadata is mutable. */
export function findToken(chainId: number, address: string): RegistryToken | undefined {
  return byAddress.get(`${chainId}:${address.toLowerCase()}`)
}

export function tokensForChain(chainId: number): RegistryToken[] {
  return REGISTRY_TOKENS.filter((token) => token.chainId === chainId)
}

export function tokenAddresses(chainId: number): Address[] {
  return tokensForChain(chainId).map((token) => token.address)
}

/** Distinct Chainlink aggregators to poll for a chain. */
export function feedProxies(chainId: number): Address[] {
  const seen = new Set<string>()
  const proxies: Address[] = []
  for (const token of tokensForChain(chainId)) {
    if (!token.feedProxy) continue
    const key = token.feedProxy.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    proxies.push(token.feedProxy)
  }
  return proxies
}
