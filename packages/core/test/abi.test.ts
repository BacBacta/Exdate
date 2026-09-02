import { describe, expect, it } from 'vitest'
import { keccak256, toHex } from 'viem'
import { TOPIC, aggregatorV3Abi, stockTokenAbi } from '../src/abi.js'

/**
 * The topic0 constants are what the indexer filters logs on. A wrong constant is
 * not a crash - it is an indexer that quietly sees nothing. So they are
 * recomputed here from the signatures rather than compared to themselves.
 */
describe('event topic0 constants', () => {
  it('UIMultiplierUpdated is keccak256 of its signature', () => {
    expect(keccak256(toHex('UIMultiplierUpdated(uint256,uint256,uint256)'))).toBe(TOPIC.UIMultiplierUpdated)
  })

  it('TransferWithScaledUI is keccak256 of its signature', () => {
    expect(keccak256(toHex('TransferWithScaledUI(address,address,uint256,uint256)'))).toBe(
      TOPIC.TransferWithScaledUI,
    )
  })

  it('Transfer is keccak256 of the signature ERC-20 and ERC-721 share', () => {
    expect(keccak256(toHex('Transfer(address,address,uint256)'))).toBe(TOPIC.Transfer)
  })

  it('matches the ABI event declarations they were derived from', () => {
    // Rebuild each signature from the ABI item so the two cannot drift.
    const signature = (name: string) => {
      const item = stockTokenAbi.find((entry) => entry.type === 'event' && entry.name === name)
      if (!item || item.type !== 'event') throw new Error(`no event ${name}`)
      return `${name}(${item.inputs.map((input) => input.type).join(',')})`
    }
    expect(keccak256(toHex(signature('UIMultiplierUpdated')))).toBe(TOPIC.UIMultiplierUpdated)
    expect(keccak256(toHex(signature('TransferWithScaledUI')))).toBe(TOPIC.TransferWithScaledUI)
    expect(keccak256(toHex(signature('Transfer')))).toBe(TOPIC.Transfer)
  })
})

describe('ABI shape', () => {
  it('declares every ERC-8056 view the poller reads', () => {
    const names = new Set<string>(stockTokenAbi.filter((e) => e.type === 'function').map((e) => e.name))
    for (const required of ['uiMultiplier', 'newUIMultiplier', 'effectiveAt', 'oraclePaused', 'totalSupplyUI']) {
      expect(names.has(required), required).toBe(true)
    }
  })

  it('declares the two aggregator reads the reconciliation depends on', () => {
    const names = new Set<string>(aggregatorV3Abi.filter((e) => e.type === 'function').map((e) => e.name))
    expect(names.has('latestRoundData')).toBe(true)
    expect(names.has('getRoundData')).toBe(true)
  })
})
