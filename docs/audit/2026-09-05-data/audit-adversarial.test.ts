// Audit P9 (2026-09-05): try to defeat each documented trap with a constructed input.
// Evidence only - copied to docs/audit/2026-09-05-data/ and removed from the package after the run.
import { describe, expect, it } from 'vitest'
import { reconcile, reconcileSplit, observedStepWad } from '../src/reconcile.js'
import { pairActionsWithChanges, actionKey } from '../src/pairing.js'
import { feedHealth } from '../src/staleness.js'
import { poolPriceWad, compareToFeed, corroborateFeedByPrice, feedCorroboratedByPrice } from '../src/pools.js'
import { isErc20Transfer, isErc721Transfer, filterErc20Transfers } from '../src/logs.js'
import { issuerPriceAt } from '../src/quotes.js'
import { validateTokenList } from '../src/tokenlist.js'
import { isPending, kindFromCorporateActionType, WAD } from '../src/multiplier.js'
import { ROBINHOOD_CHAIN } from '../src/chains.js'
import { classifyMarketSession } from '../../../scripts/lib/market-session.mjs'
import { keccak256, toHex } from 'viem'

const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const
const A = '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const wad = (s: string) => BigInt(Math.round(Number(s) * 1e6)) * 10n ** 12n

describe('P9 adversarial', () => {
  it('1 mispaired feed: a neighbouring feed 2x closer is refused (not_closest), 2.5x further is refused (insufficient_separation), 3x passes', () => {
    const traded = wad('100')
    expect(corroborateFeedByPrice({ tradedPriceWad: traded, assignedFeedPriceWad: wad('101'), otherFeedPricesWad: [wad('100.5')] })?.refusal).toBe('not_closest')
    expect(corroborateFeedByPrice({ tradedPriceWad: traded, assignedFeedPriceWad: wad('101'), otherFeedPricesWad: [wad('102.5')] })?.refusal).toBe('insufficient_separation')
    expect(corroborateFeedByPrice({ tradedPriceWad: traded, assignedFeedPriceWad: wad('101'), otherFeedPricesWad: [wad('103.1')] })?.corroborates).toBe(true)
    // a majority below two thirds does not lift, whatever the sample size
    expect(feedCorroboratedByPrice({ samples: 38, corroborating: 24 })).toBe(false)
    expect(feedCorroboratedByPrice({ samples: 38, corroborating: 26 })).toBe(true)
    expect(feedCorroboratedByPrice({ samples: 2, corroborating: 2 })).toBe(false)
  })

  it('2 a round hours stale at effectiveAt is labelled, never silently live', () => {
    const h = feedHealth({ updatedAt: 1_000_000n, nowSeconds: 1_000_000n + 86_401n })
    expect(h.status).toBe('stale'); expect(h.beyondHeartbeat).toBe(true)
    expect(feedHealth({ updatedAt: 0n, nowSeconds: 1n }).beyondHeartbeat).toBeUndefined()
    // reconcile() itself takes no staleness input: the label travels beside the row, not inside it
    const r = reconcile({ rateWad: wad('0.27'), priceWad: wad('305.17105'), oldMultiplier: WAD, newMultiplier: 1000566080061092436n, observedEventCount: 1 })
    expect(r.impliedHaircutBps).toBe(3601)
  })

  it('3 two issuer actions inside one 4-day window for one token pair one-to-one, nearest first, the other stays unmatched', () => {
    const tok = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
    const a1 = { id: 'x', token: tok, processDate: '2026-08-13' }
    const a2 = { id: 'y', token: tok, processDate: '2026-08-14' }
    const c = { token: tok.toLowerCase(), effectiveAt: BigInt(Date.parse('2026-08-14T15:12:46Z') / 1000) }
    const p = pairActionsWithChanges([a1, a2], [c])
    expect(p.matched).toHaveLength(1)
    expect(p.matched[0]!.action.id).toBe('y') // nearest
    expect(p.unmatchedActions.map((a) => a.id)).toEqual(['x'])
    expect(p.unmatchedChanges).toHaveLength(0)
  })

  it('4 a split reaching reconcile() as a dividend: the x4 step is an anomaly at any price, and reconcileSplit refuses without a declared ratio', () => {
    const r = reconcile({ rateWad: wad('0.27'), priceWad: wad('300'), oldMultiplier: WAD, newMultiplier: 4n * WAD, observedEventCount: 1 })
    expect(r.status).toBe('anomaly')
    const s = reconcileSplit({ oldRate: null, newRate: null, oldMultiplier: WAD, newMultiplier: 4n * WAD })
    expect(s.status).toBe('unsupported_action_type'); expect(s.observedRatioWad).toBe(4n * WAD)
    expect(reconcileSplit({ oldRate: '1', newRate: '4', oldMultiplier: WAD, newMultiplier: 4n * WAD }).status).toBe('matched')
    expect(kindFromCorporateActionType('CORPORATE_ACTION_TYPE_FORWARD_SPLIT')).toBe('split')
  })

  it('5 pool arithmetic with 18 vs 6 decimals: swapping the decimals is off by exactly 1e12', () => {
    // sqrtPriceX96 for price 1 USDG per token with token0 = stock (18 dp), token1 = USDG (6 dp): sqrt(1e6/1e18) * 2^96
    const sqrtP = BigInt(Math.floor(Math.sqrt(1e-12) * 2 ** 96))
    const right = poolPriceWad({ sqrtPriceX96: sqrtP, stockIsToken0: true, stockDecimals: 18, quoteDecimals: 6 })!
    const wrong = poolPriceWad({ sqrtPriceX96: sqrtP, stockIsToken0: true, stockDecimals: 6, quoteDecimals: 18 })!
    expect(Number(right) / 1e18).toBeCloseTo(1, 6)
    // the swapped reading is 1e-24 of the right one, which a WAD cannot hold: it collapses to 0, never to a plausible price
    expect(wrong).toBe(0n)
    expect(right).not.toBe(wrong)
  })

  it('6 ET/UTC boundaries in both DST directions', () => {
    // 2026-03-08 02:00 ET springs forward: 09:29 ET is 14:29 UTC before, 13:29 UTC after
    expect(classifyMarketSession(new Date('2026-03-06T14:29:59Z'))).toBe('pre_market')   // Fri EST: 09:29:59 ET
    expect(classifyMarketSession(new Date('2026-03-06T14:30:00Z'))).toBe('regular')
    expect(classifyMarketSession(new Date('2026-03-09T13:29:59Z'))).toBe('pre_market')   // Mon EDT: 09:29:59 ET
    expect(classifyMarketSession(new Date('2026-03-09T13:30:00Z'))).toBe('regular')
    // 2026-11-01 02:00 ET falls back
    expect(classifyMarketSession(new Date('2026-10-30T19:59:59Z'))).toBe('regular')      // Fri EDT: 15:59:59 ET
    expect(classifyMarketSession(new Date('2026-10-30T20:00:00Z'))).toBe('after_hours')  // Fri EDT: 16:00:00 ET
    expect(classifyMarketSession(new Date('2026-11-02T20:59:59Z'))).toBe('regular')      // Mon EST: 15:59:59 ET
    expect(classifyMarketSession(new Date('2026-11-02T21:00:00Z'))).toBe('after_hours')
    expect(classifyMarketSession(new Date('2026-09-05T15:00:00Z'))).toBe('weekend')      // Saturday
  })

  it('7 the same series id on two months is two actions', () => {
    expect(actionKey({ id: 's', token: null, processDate: '2026-08-05' })).not.toBe(actionKey({ id: 's', token: null, processDate: '2026-09-02' }))
  })

  it('8 a re-announced schedule is not a pending update, and a past effectiveAt is not pending', () => {
    const now = 2_000n
    expect(isPending({ uiMultiplier: WAD, newUIMultiplier: WAD, effectiveAt: 1_000n } as any, now)).toBe(false)
    expect(isPending({ uiMultiplier: WAD, newUIMultiplier: 2n * WAD, effectiveAt: 1_000n } as any, now)).toBe(false)
    expect(isPending({ uiMultiplier: WAD, newUIMultiplier: 2n * WAD, effectiveAt: 3_000n } as any, now)).toBe(true)
  })

  it('9 an ERC-721 Transfer with the same topic0 is dropped', () => {
    const erc20 = { topics: [T, A, A], data: '0x01' as const }
    const erc721 = { topics: [T, A, A, '0x0000000000000000000000000000000000000000000000000000000000000001' as const], data: '0x' as const }
    expect(isErc20Transfer(erc20)).toBe(true); expect(isErc721Transfer(erc721)).toBe(true)
    expect(filterErc20Transfers([erc20, erc721])).toHaveLength(1)
    expect(keccak256(toHex('Transfer(address,address,uint256)'))).toBe(T)
  })

  it('11 a quote on a halted market is refused, and a quote 121 s away is refused', () => {
    const step = { token: 'x', symbol: 'UPS', effectiveAt: '2026-09-04T15:10:26Z', quotes: [{ bid: '1', ask: '1', mid: '1', generatedAt: '2026-09-04T15:10:30Z', isTradingHalt: true }] }
    expect(issuerPriceAt(step, step.effectiveAt).refusal).toBe('trading_halted_at_effect')
    const late = { ...step, quotes: [{ bid: '1', ask: '1', mid: '1', generatedAt: '2026-09-04T15:12:27Z', isTradingHalt: false }] }
    expect(issuerPriceAt(late, step.effectiveAt).refusal).toBe('no_quote_within_tolerance')
    expect(issuerPriceAt({ ...step, quotes: [], givenUp: true }, step.effectiveAt).refusal).toBe('capture_given_up')
  })

  it('12 the gap sign: pool above feed is positive', () => {
    const c = compareToFeed({ poolPriceWad: wad('101'), feedAnswer: 100_00000000n, feedDecimals: 8, feedUpdatedAt: 0n, observedAt: 100n, heartbeatSeconds: 86_400 })!
    expect(c.deviationBps).toBeGreaterThan(0); expect(Math.round(c.deviationBps)).toBe(100)
  })

  it('13 a token list with a hyphenated name or a 31-char name fails validation loudly', () => {
    const base = { name: 'exdate Robinhood Stock Tokens', timestamp: '2026-09-05T00:00:00Z', version: { major: 1, minor: 0, patch: 0 }, tokens: [{ chainId: 4663, address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL', name: 'Apple', decimals: 18 }] } as any
    expect(validateTokenList(base)).toEqual([])
    expect(validateTokenList({ ...base, name: 'exdate-list' }).length).toBeGreaterThan(0)
    expect(validateTokenList({ ...base, name: 'a'.repeat(31) }).length).toBeGreaterThan(0)
    // the schema pattern is case-insensitive, so a lowercase address passes validation: checksums are the expectations file's job, not the schema's
    expect(validateTokenList({ ...base, tokens: [{ ...base.tokens[0], address: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9' }] })).toEqual([])
    expect(validateTokenList({ ...base, tokens: [{ ...base.tokens[0], address: '0xaf3d76f1834a1d425780943c99ea8a608f8a93' }] }).length).toBeGreaterThan(0)
  })

  it('16 the block number source is ArbSys, never block.number', () => {
    expect(ROBINHOOD_CHAIN.blockNumberSource?.target).toBe('0x0000000000000000000000000000000000000064')
    expect(ROBINHOOD_CHAIN.blockNumberSource?.selector).toBe(keccak256(toHex('arbBlockNumber()')).slice(0, 10))
  })

  it('WAD invariants on the committed reconciliations', () => {
    expect(observedStepWad(WAD, 1000566080061092436n)).toBe(566080061092436n)
  })
})
