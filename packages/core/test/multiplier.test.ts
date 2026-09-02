import { describe, expect, it } from 'vitest'
import {
  WAD,
  announcementLeadSeconds,
  isApplied,
  isPending,
  kindFromCorporateActionType,
  stepBps,
  toRawAmount,
  toUnderlyingShares,
} from '../src/multiplier.js'

// Real values read from Robinhood Chain on 2026-09-02. See
// data/multiplier-events.observed.json.
const SGOV_1 = 1_000_957_519_890_990_718n
const SGOV_2 = 1_002_981_519_346_766_532n
const SGOV_3 = 1_005_101_770_003_214_918n
const AAPL = 1_000_566_080_061_092_436n
const CCL = 1_021_486_444_855_206_408n
const CRWD = 4_000_000_000_000_000_000n

describe('raw <-> UI conversion', () => {
  it('is the identity at a multiplier of 1.0', () => {
    const raw = 123_456_789_000_000_000_000n
    expect(toUnderlyingShares(raw, WAD)).toBe(raw)
    expect(toRawAmount(raw, WAD)).toBe(raw)
  })

  it('scales a whole token by the real AAPL multiplier', () => {
    // One AAPL token represents 1.000566080061092436 underlying shares.
    expect(toUnderlyingShares(WAD, AAPL)).toBe(AAPL)
  })

  it('applies the CRWD 4x action to a raw balance', () => {
    expect(toUnderlyingShares(5n * WAD, CRWD)).toBe(20n * WAD)
  })

  it('floors, and the floor is pinned exactly', () => {
    // 987654321123456789 * 1005101770003214918 / 1e18, truncated. A ceiling
    // implementation would give one more wei and overstate every balance.
    const raw = 987_654_321_123_456_789n
    expect(toUnderlyingShares(raw, SGOV_3)).toBe(992_693_106_312_510_034n)
    expect((raw * SGOV_3) % WAD).not.toBe(0n) // the case is genuinely inexact
    expect(toUnderlyingShares(1n, WAD + 1n)).toBe(1n)
    expect(toUnderlyingShares(1n, WAD - 1n)).toBe(0n)
  })

  it('round-trips within one wei of floor division', () => {
    const raw = 987_654_321_123_456_789n
    const shares = toUnderlyingShares(raw, SGOV_3)
    const back = toRawAmount(shares, SGOV_3)
    expect(raw - back).toBeGreaterThanOrEqual(0n)
    expect(raw - back).toBeLessThanOrEqual(1n)
  })

  it('never multiplies twice: a UI amount fed back in would overstate', () => {
    // Guards the classic mistake in the opposite direction from the Chainlink
    // one: applying the multiplier to an already-scaled amount.
    const raw = WAD
    const once = toUnderlyingShares(raw, CCL)
    const twice = toUnderlyingShares(once, CCL)
    expect(twice).toBeGreaterThan(once)
    expect(once).toBe(CCL)
  })

  it('rejects a zero multiplier instead of dividing by it', () => {
    expect(() => toRawAmount(WAD, 0n)).toThrow(/zero/)
  })

  it('handles a zero balance', () => {
    expect(toUnderlyingShares(0n, SGOV_3)).toBe(0n)
    expect(toRawAmount(0n, SGOV_3)).toBe(0n)
  })
})

describe('stepBps', () => {
  it('reproduces the observed SGOV chain of three events', () => {
    expect(stepBps(WAD, SGOV_1)).toBeCloseTo(9.58, 2)
    expect(stepBps(SGOV_1, SGOV_2)).toBeCloseTo(20.22, 2)
    expect(stepBps(SGOV_2, SGOV_3)).toBeCloseTo(21.14, 2)
  })

  it('reproduces the extremes observed in Phase 0', () => {
    // DELL, the smallest step seen, and CCL, the largest dividend step.
    expect(stepBps(WAD, 1_000_063_708_620_124_549n)).toBeCloseTo(0.64, 2)
    expect(stepBps(WAD, CCL)).toBeCloseTo(214.86, 2)
  })

  it('is negative for a reverse action', () => {
    expect(stepBps(CRWD, WAD)).toBeCloseTo(-7500, 0)
  })
})

describe('kind classification', () => {
  it('never guesses from magnitude', () => {
    // CCL (+214.86 bps) is a cash dividend and CRWD (+30 000 bps) is a split.
    // Only the issuer's own action type separates them.
    expect(kindFromCorporateActionType('CORPORATE_ACTION_TYPE_CASH_DIVIDEND')).toBe('dividend')
    expect(kindFromCorporateActionType('CORPORATE_ACTION_TYPE_STOCK_DIVIDEND')).toBe('dividend')
    expect(kindFromCorporateActionType('CORPORATE_ACTION_TYPE_FORWARD_SPLIT')).toBe('split')
    expect(kindFromCorporateActionType('CORPORATE_ACTION_TYPE_REVERSE_SPLIT')).toBe('reverse_split')
  })

  it('stays unknown without a matched action', () => {
    expect(kindFromCorporateActionType(undefined)).toBe('unknown')
    expect(kindFromCorporateActionType(null)).toBe('unknown')
    expect(kindFromCorporateActionType('CORPORATE_ACTION_TYPE_SPIN_OFF')).toBe('unknown')
  })
})

describe('pending detection', () => {
  const now = 1_788_353_960n // 2026-09-02T12:59:20Z

  it('is false when the views merely echo the last applied change', () => {
    // AAPL on 2026-09-02: effectiveAt is 2026-08-14, three weeks in the past,
    // and newUIMultiplier mirrors uiMultiplier. Nothing is pending.
    expect(
      isPending({ uiMultiplier: AAPL, newUIMultiplier: AAPL, effectiveAt: 1_786_720_366n }, now),
    ).toBe(false)
  })

  it('is false for a token that has never moved', () => {
    expect(isPending({ uiMultiplier: WAD, newUIMultiplier: WAD, effectiveAt: 0n }, now)).toBe(false)
  })

  it('is true only when the target differs and the clock has not passed it', () => {
    expect(
      isPending({ uiMultiplier: WAD, newUIMultiplier: SGOV_1, effectiveAt: now + 600n }, now),
    ).toBe(true)
  })

  it('is false once the effective timestamp is reached', () => {
    expect(isPending({ uiMultiplier: WAD, newUIMultiplier: SGOV_1, effectiveAt: now }, now)).toBe(false)
  })

  it('is false when a future timestamp carries an unchanged target', () => {
    expect(isPending({ uiMultiplier: SGOV_1, newUIMultiplier: SGOV_1, effectiveAt: now + 600n }, now)).toBe(false)
  })
})

describe('application is derived from the clock', () => {
  it('flips exactly at effectiveAt because no event is ever emitted', () => {
    const effectiveAt = 1_788_220_826n // SGOV, 2026-09-01T00:00:26Z
    expect(isApplied(effectiveAt, effectiveAt - 1n)).toBe(false)
    expect(isApplied(effectiveAt, effectiveAt)).toBe(true)
    expect(isApplied(effectiveAt, effectiveAt + 1n)).toBe(true)
  })
})

describe('announcement lead', () => {
  it('measures the ~9 minute warning observed on every dividend', () => {
    // SGOV: announced 2026-08-31T23:50:51Z, effective 2026-09-01T00:00:26Z.
    expect(announcementLeadSeconds(1_788_220_251n, 1_788_220_826n)).toBe(575)
  })
})
