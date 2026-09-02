import type { Hex } from 'viem'
import { TOPIC } from './abi.js'

/**
 * ERC-721 / ERC-20 `Transfer` topic0 collision.
 *
 * Both standards declare `Transfer(address,address,uint256)`, so their topic0 is
 * byte-identical by construction. This is not a Robinhood Punks quirk and no
 * collection denylist can fix it - every NFT on every chain collides.
 *
 * The difference is arity: ERC-721 indexes `tokenId`, giving four topics and an
 * empty `data` field, while ERC-20 carries the amount in `data` with three
 * topics. Treating a four-topic log as ERC-20 reads a token id as an amount.
 */
export interface MinimalLog {
  topics: readonly Hex[] | Hex[]
  data: Hex
}

export function isTransferTopic(log: MinimalLog): boolean {
  return log.topics[0]?.toLowerCase() === TOPIC.Transfer
}

/** True only for a genuine ERC-20 Transfer: topic0 matches and arity is three. */
export function isErc20Transfer(log: MinimalLog): boolean {
  return isTransferTopic(log) && log.topics.length === 3
}

/** True for an ERC-721 Transfer riding the same topic0. */
export function isErc721Transfer(log: MinimalLog): boolean {
  return isTransferTopic(log) && log.topics.length === 4
}

/** Drop every NFT transfer from a mixed batch of `Transfer` logs. */
export function filterErc20Transfers<T extends MinimalLog>(logs: readonly T[]): T[] {
  return logs.filter(isErc20Transfer)
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const normalize = (address: string) => address.toLowerCase()

/** A transfer out of the zero address is a mint. */
export function isMint(from: string): boolean {
  return normalize(from) === ZERO_ADDRESS
}

/** A transfer into the zero address is a burn. */
export function isBurn(to: string): boolean {
  return normalize(to) === ZERO_ADDRESS
}

/**
 * A `Transfer` proves custody moved, not that a trade happened. A provable
 * trade needs both legs - the Stock Token and the quote asset (USDG on
 * Robinhood Chain) - inside the same transaction.
 */
export function isProvableTrade(
  logs: readonly (MinimalLog & { address: string })[],
  stockToken: string,
  quoteAsset: string,
): boolean {
  const transfers = filterErc20Transfers(logs)
  const touches = (target: string) => transfers.some((log) => normalize(log.address) === normalize(target))
  return touches(stockToken) && touches(quoteAsset)
}
