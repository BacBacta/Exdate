import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, parseAbi, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { ARBSYS_ADDRESS, ROBINHOOD_CHAIN } from '../src/chains.js'
import {
  HOLDINGS_SELECTOR,
  HOLDINGS_SIGNATURE,
  decodeAggregate3,
  decodeHoldings,
  encodeHoldingsCall,
  formatWad,
  isAddress,
  owedWad,
  parseDecimalWad,
  walletView,
} from '../src/holdings.js'

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
// SGOV, AAPL, F: real Stock Token addresses from the issuer's registry.
const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
const AAPL = '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'
const FORD = '0x3c4bb1ed1a6f8d1f1b5d4c1e0e6f6e2e2f3a4b5c'
const HOLDER = '0x8601015e6310726547AE737D04b4f6C6E06F58b1'

const abi = parseAbi([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
])
const pad = (address: string) => address.slice(2).toLowerCase().padStart(64, '0')
const uint = (value: bigint): `0x${string}` => `0x${value.toString(16).padStart(64, '0')}`

describe('selectors', () => {
  it('match viem for every signature', () => {
    for (const key of Object.keys(HOLDINGS_SIGNATURE) as (keyof typeof HOLDINGS_SIGNATURE)[]) {
      expect(HOLDINGS_SELECTOR[key]).toBe(toFunctionSelector(HOLDINGS_SIGNATURE[key]))
    }
  })

  it("Robinhood Chain's block-number source is ArbSys.arbBlockNumber, selector computed", () => {
    const source = ROBINHOOD_CHAIN.blockNumberSource!
    expect(source.target).toBe(ARBSYS_ADDRESS)
    expect(source.selector).toBe(toFunctionSelector(source.signature))
  })
})

describe('encodeHoldingsCall', () => {
  it('is byte for byte what viem encodes for the same aggregate3', () => {
    const tokens = [SGOV, AAPL, FORD]
    const holderWord = pad(HOLDER)
    const calls = [
      { target: MULTICALL3, allowFailure: true, callData: HOLDINGS_SELECTOR.getBlockNumber },
      { target: MULTICALL3, allowFailure: true, callData: HOLDINGS_SELECTOR.getCurrentBlockTimestamp },
      ...tokens.flatMap((token) => [
        { target: token, allowFailure: true, callData: `${HOLDINGS_SELECTOR.balanceOf}${holderWord}` as `0x${string}` },
        { target: token, allowFailure: true, callData: `${HOLDINGS_SELECTOR.balanceOfUI}${holderWord}` as `0x${string}` },
        { target: token, allowFailure: true, callData: HOLDINGS_SELECTOR.uiMultiplier },
      ]),
    ] as const
    const expected = encodeFunctionData({ abi, functionName: 'aggregate3', args: [calls as never] })
    const actual = encodeHoldingsCall(MULTICALL3, tokens, HOLDER)
    expect(actual.toLowerCase()).toBe(expected.toLowerCase())
    // and viem reads it back as the same eleven calls
    const decoded = decodeFunctionData({ abi, data: actual })
    expect(decoded.functionName).toBe('aggregate3')
    expect((decoded.args as readonly unknown[])[0]).toHaveLength(11)
  })

  it("reads the block through the chain's own source when given one", () => {
    const expected = encodeFunctionData({
      abi,
      functionName: 'aggregate3',
      args: [
        [
          { target: ARBSYS_ADDRESS, allowFailure: true, callData: '0xa3b1b31d' },
          { target: MULTICALL3, allowFailure: true, callData: HOLDINGS_SELECTOR.getCurrentBlockTimestamp },
        ],
      ],
    })
    expect(encodeHoldingsCall(MULTICALL3, [], HOLDER, ROBINHOOD_CHAIN.blockNumberSource).toLowerCase()).toBe(expected.toLowerCase())
  })

  it('encodes with no tokens at all', () => {
    const expected = encodeFunctionData({
      abi,
      functionName: 'aggregate3',
      args: [
        [
          { target: MULTICALL3, allowFailure: true, callData: HOLDINGS_SELECTOR.getBlockNumber },
          { target: MULTICALL3, allowFailure: true, callData: HOLDINGS_SELECTOR.getCurrentBlockTimestamp },
        ],
      ],
    })
    expect(encodeHoldingsCall(MULTICALL3, [], HOLDER).toLowerCase()).toBe(expected.toLowerCase())
  })

  it('refuses a holder that is not an address', () => {
    expect(() => encodeHoldingsCall(MULTICALL3, [SGOV], '0x1234')).toThrow(/not an address/)
    expect(isAddress(HOLDER)).toBe(true)
    expect(isAddress(HOLDER.slice(0, 41))).toBe(false)
    expect(isAddress(`${HOLDER}0`)).toBe(false)
    expect(isAddress('not an address at all, forty-two chars long')).toBe(false)
  })
})

describe('decodeHoldings', () => {
  const tokens = [SGOV, AAPL, FORD]
  // SGOV: 10 tokens at 1.005102 -> 10.05102 shares. AAPL: zero. FORD: views revert.
  const result = encodeFunctionResult({
    abi,
    functionName: 'aggregate3',
    result: [
      { success: true, returnData: uint(53_373_410n) },
      { success: true, returnData: uint(1_788_450_000n) },
      { success: true, returnData: uint(10n * 10n ** 18n) },
      { success: true, returnData: uint(10_051_020_000_000_000_000n) },
      { success: true, returnData: uint(1_005_102_000_000_000_000n) },
      { success: true, returnData: uint(0n) },
      { success: true, returnData: uint(0n) },
      { success: true, returnData: uint(10n ** 18n) },
      { success: false, returnData: '0x' },
      { success: false, returnData: '0x' },
      { success: false, returnData: '0x' },
    ],
  })

  it('reads the aggregate3 shape the way viem wrote it', () => {
    const rows = decodeAggregate3(result)
    expect(rows).toHaveLength(11)
    expect(rows[0]).toEqual({ success: true, returnData: uint(53_373_410n) })
    expect(rows[8]).toEqual({ success: false, returnData: '0x' })
  })

  it('keeps non-zero balances, drops zeros, reports reverts and carries the block', () => {
    const snapshot = decodeHoldings(result, tokens)
    expect(snapshot.blockNumber).toBe(53_373_410n)
    expect(snapshot.timestamp).toBe(1_788_450_000n)
    expect(snapshot.holdings).toEqual([
      { token: SGOV, raw: 10n * 10n ** 18n, underlyingShares: 10_051_020_000_000_000_000n, uiMultiplier: 1_005_102_000_000_000_000n },
    ])
    expect(snapshot.unreadable).toEqual([FORD])
  })

  it('refuses an answer that does not match the token list', () => {
    expect(() => decodeHoldings(result, [SGOV])).toThrow(/expected 5 results, got 11/)
  })

  it('refuses a truncated answer', () => {
    expect(() => decodeHoldings(result.slice(0, 200), tokens)).toThrow(/truncated/)
  })
})

describe('owed', () => {
  it("SGOV: the issuer's 0.3071 on 1.005102 shares is 0.3087, the calendar's own figure", () => {
    expect(formatWad(owedWad('0.3071', 1_005_102_000_000_000_000n), 4)).toBe('0.3087')
    expect(formatWad(owedWad('0.3071', 10_051_020_000_000_000_000n), 2, true)).toBe('3.09')
  })

  it('parses the rates the issuer prints and refuses the rest', () => {
    expect(parseDecimalWad('0.306812')).toBe(306_812_000_000_000_000n)
    expect(parseDecimalWad('2')).toBe(2n * 10n ** 18n)
    for (const bad of ['1e5', '-1', '', '.5', '1.', '0,25']) expect(() => parseDecimalWad(bad)).toThrow(/not a decimal/)
  })

  it('formats half-up, trims or pads', () => {
    expect(formatWad(125_000_000_000_000_000n, 2)).toBe('0.13')
    expect(formatWad(10n ** 18n, 4)).toBe('1')
    expect(formatWad(10n ** 18n, 2, true)).toBe('1.00')
    expect(formatWad(1_234_567_890_123_456_789n, 4)).toBe('1.2346')
    expect(formatWad(0n, 2, true)).toBe('0.00')
  })
})

describe('walletView', () => {
  const snapshot = decodeHoldings(
    encodeFunctionResult({
      abi,
      functionName: 'aggregate3',
      result: [
        { success: true, returnData: uint(1n) },
        { success: true, returnData: uint(2n) },
        { success: true, returnData: uint(10n * 10n ** 18n) },
        { success: true, returnData: uint(10_051_020_000_000_000_000n) },
        { success: true, returnData: uint(1_005_102_000_000_000_000n) },
        { success: true, returnData: uint(100n * 10n ** 18n) },
        { success: true, returnData: uint(100_057_000_000_000_000_000n) },
        { success: true, returnData: uint(1_000_570_000_000_000_000n) },
      ],
    }),
    [SGOV, AAPL],
  )

  it('joins declared dividends by address, sums what is due, and puts the money first', () => {
    const view = walletView(snapshot, {
      [SGOV.toLowerCase()]: [
        { processDate: '2026-09-04', rate: '0.3071', due: true },
        { processDate: '2026-10-05', rate: '0.31', due: false },
      ],
    })
    expect(view.lines.map((line) => line.holding.token)).toEqual([SGOV, AAPL])
    expect(formatWad(view.lines[0]!.owedDue, 4)).toBe('3.0867')
    expect(view.lines[0]!.dividends).toHaveLength(2)
    expect(formatWad(view.totalDue, 4)).toBe('3.0867')
    expect(formatWad(view.totalUpcoming, 4)).toBe('3.1158')
    expect(view.lines[1]!.dividends).toEqual([])
    expect(view.lines[1]!.owedDue).toBe(0n)
  })

  it('orders by shares when nothing is owed', () => {
    const view = walletView(snapshot, {})
    expect(view.lines.map((line) => line.holding.token)).toEqual([AAPL, SGOV])
    expect(view.totalDue).toBe(0n)
  })
})
