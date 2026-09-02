import { describe, expect, it } from 'vitest'
import type { Hex } from 'viem'
import { TOPIC } from '../src/abi.js'
import {
  ZERO_ADDRESS,
  filterErc20Transfers,
  isBurn,
  isErc20Transfer,
  isErc721Transfer,
  isMint,
  isProvableTrade,
} from '../src/logs.js'

const AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'

const topicAddress = (address: string): Hex => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
const amount = (value: bigint): Hex => `0x${value.toString(16).padStart(64, '0')}`

const erc20Transfer = (address: string, from: string, to: string, value = 1n) => ({
  address,
  topics: [TOPIC.Transfer, topicAddress(from), topicAddress(to)] as Hex[],
  data: amount(value),
})

const erc721Transfer = (address: string, from: string, to: string, tokenId = 42n) => ({
  address,
  topics: [TOPIC.Transfer, topicAddress(from), topicAddress(to), amount(tokenId)] as Hex[],
  data: '0x' as Hex,
})

describe('NFT log filtering', () => {
  it('accepts a three-topic ERC-20 Transfer', () => {
    expect(isErc20Transfer(erc20Transfer(AAPL, AAPL, USDG))).toBe(true)
  })

  it('rejects a four-topic ERC-721 Transfer carrying the same topic0', () => {
    const nft = erc721Transfer('0x1111111111111111111111111111111111111111', AAPL, USDG)
    expect(nft.topics[0]).toBe(TOPIC.Transfer)
    expect(isErc20Transfer(nft)).toBe(false)
    expect(isErc721Transfer(nft)).toBe(true)
  })

  it('would have read a token id as an amount without the arity check', () => {
    // The whole point: topic0 is identical, so only arity separates them.
    const nft = erc721Transfer(AAPL, AAPL, USDG, 9_999_999n)
    expect(nft.topics[0]).toBe(erc20Transfer(AAPL, AAPL, USDG).topics[0])
    expect(isErc20Transfer(nft)).toBe(false)
  })

  it('ignores case in topic0', () => {
    const log = erc20Transfer(AAPL, AAPL, USDG)
    log.topics[0] = TOPIC.Transfer.toUpperCase().replace('0X', '0x') as Hex
    expect(isErc20Transfer(log)).toBe(true)
  })

  it('rejects a different event entirely', () => {
    expect(
      isErc20Transfer({ topics: [TOPIC.UIMultiplierUpdated], data: '0x' }),
    ).toBe(false)
    expect(isErc20Transfer({ topics: [], data: '0x' })).toBe(false)
  })

  it('filters a mixed batch, keeping only the ERC-20 rows', () => {
    const batch = [
      erc20Transfer(AAPL, AAPL, USDG),
      erc721Transfer('0x2222222222222222222222222222222222222222', AAPL, USDG),
      erc20Transfer(USDG, USDG, AAPL),
      erc721Transfer('0x3333333333333333333333333333333333333333', USDG, AAPL),
    ]
    expect(filterErc20Transfers(batch)).toHaveLength(2)
  })

  it('cannot be replaced by a collection denylist', () => {
    // The collision is by construction, so an NFT deployed at any address at
    // all - including one nobody has listed - still collides.
    const unknownCollection = erc721Transfer('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', AAPL, USDG)
    expect(isErc20Transfer(unknownCollection)).toBe(false)
  })
})

describe('mint and burn', () => {
  it('reads a transfer from the zero address as a mint', () => {
    expect(isMint(ZERO_ADDRESS)).toBe(true)
    expect(isMint(AAPL)).toBe(false)
  })

  it('reads a transfer to the zero address as a burn', () => {
    expect(isBurn(ZERO_ADDRESS)).toBe(true)
    expect(isBurn(AAPL)).toBe(false)
  })
})

describe('provable trade', () => {
  it('needs both legs in the same transaction', () => {
    const bothLegs = [erc20Transfer(AAPL, AAPL, USDG), erc20Transfer(USDG, USDG, AAPL)]
    expect(isProvableTrade(bothLegs, AAPL, USDG)).toBe(true)
  })

  it('rejects a lone Stock Token transfer, which only proves custody moved', () => {
    expect(isProvableTrade([erc20Transfer(AAPL, AAPL, USDG)], AAPL, USDG)).toBe(false)
  })

  it('is not fooled by an NFT transfer standing in for the quote leg', () => {
    const legs = [erc20Transfer(AAPL, AAPL, USDG), erc721Transfer(USDG, USDG, AAPL)]
    expect(isProvableTrade(legs, AAPL, USDG)).toBe(false)
  })
})
