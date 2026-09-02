import { describe, expect, it } from 'vitest'
import { WAD } from '../src/multiplier.js'
import {
  MATCH_WINDOW_DAYS,
  matchesProcessDate,
  parseDecimal,
  reconcile,
  rescale,
} from '../src/reconcile.js'

/** Chainlink answers carry 8 decimals; the maths runs in WAD. */
const price = (chainlinkAnswer: bigint) => rescale(chainlinkAnswer, 8, 18)

describe('parseDecimal', () => {
  it('parses the issuer rate strings exactly', () => {
    expect(parseDecimal('0.27', 18)).toBe(270_000_000_000_000_000n)
    expect(parseDecimal('0.306812', 18)).toBe(306_812_000_000_000_000n)
    expect(parseDecimal('1.817086', 18)).toBe(1_817_086_000_000_000_000n)
    expect(parseDecimal('3.45', 18)).toBe(3_450_000_000_000_000_000n)
  })

  it('handles integers, bare fractions and negatives', () => {
    expect(parseDecimal('4', 18)).toBe(4n * WAD)
    expect(parseDecimal('.5', 18)).toBe(WAD / 2n)
    expect(parseDecimal('-0.25', 18)).toBe(-WAD / 4n)
  })

  it('truncates rather than rounds an over-precise input', () => {
    expect(parseDecimal('0.19', 1)).toBe(1n)
  })

  it('refuses anything that is not a decimal instead of yielding zero', () => {
    for (const bad of ['', '.', '-', 'abc', '1.2.3', '1e18', ' 0x1 ']) {
      expect(() => parseDecimal(bad, 18)).toThrow()
    }
  })
})

describe('reconciliation against the events observed in Phase 0', () => {
  it('measures a ~36 % haircut on the AAPL dividend', () => {
    // Issuer rate $0.27 (processDate 2026-08-13). Chainlink round in force at
    // effectiveAt 2026-08-14T15:12:46Z: 305.1710.
    const result = reconcile({
      rateWad: parseDecimal('0.27', 18),
      priceWad: price(30_517_100_000n),
      oldMultiplier: WAD,
      newMultiplier: 1_000_566_080_061_092_436n,
      observedEventCount: 1,
    })
    expect(result.status).toBe('matched')
    expect(result.impliedHaircutBps).toBeGreaterThan(3_550)
    expect(result.impliedHaircutBps).toBeLessThan(3_650)
    // Received per share, ~$0.1728.
    expect(Number(result.receivedPerShareWad) / 1e18).toBeCloseTo(0.1728, 4)
  })

  it('measures a ~34 % haircut on the SGOV dividend, independently', () => {
    // Two unrelated underlyings landing in the same band is the finding.
    const result = reconcile({
      rateWad: parseDecimal('0.306812', 18),
      priceWad: price(10_057_120_000n),
      oldMultiplier: 1_000_957_519_890_990_718n,
      newMultiplier: 1_002_981_519_346_766_532n,
      observedEventCount: 3,
    })
    expect(result.status).toBe('matched')
    expect(result.impliedHaircutBps).toBeGreaterThan(3_300)
    expect(result.impliedHaircutBps).toBeLessThan(3_400)
  })

  it('flags ASML as an anomaly rather than reporting a 90 % haircut as a measurement', () => {
    const result = reconcile({
      rateWad: parseDecimal('1.817086', 18),
      priceWad: price(172_630_000_000n),
      oldMultiplier: WAD,
      newMultiplier: 1_000_101_323_251_417_769n,
      observedEventCount: 1,
    })
    expect(result.status).toBe('anomaly')
    expect(result.impliedHaircutBps).toBeGreaterThan(9_000)
    expect(result.note).toMatch(/reinvestment model/)
  })

  it('flags CCL as an anomaly and exposes the implied price that gives it away', () => {
    // No Chainlink feed for CCL, so there is no price to reconcile against.
    // The implied reinvestment price - $6.98 against a ~$23.9 spot - is what
    // shows the reinvestment model does not describe this event.
    const result = reconcile({
      rateWad: parseDecimal('0.15', 18),
      priceWad: undefined,
      oldMultiplier: WAD,
      newMultiplier: 1_021_486_444_855_206_408n,
      observedEventCount: 1,
    })
    expect(result.status).toBe('anomaly')
    expect(result.impliedHaircutBps).toBeUndefined()
    expect(Number(result.impliedReinvestPriceWad) / 1e18).toBeCloseTo(6.98, 2)
    expect(result.note).toMatch(/no reference price/)
  })

  it('reports a declared dividend with no on-chain step as pending, not as zero', () => {
    // BND: COMPLETED by the issuer on 2026-08-05, multiplier still 1.0 four
    // weeks later. A zero here would be a fabricated number.
    const result = reconcile({
      rateWad: parseDecimal('0.25155', 18),
      priceWad: price(7_182_000_000n),
      oldMultiplier: undefined,
      newMultiplier: undefined,
      observedEventCount: 0,
    })
    expect(result.status).toBe('pending')
    expect(result.impliedHaircutBps).toBeUndefined()
    expect(result.observedStepWad).toBeUndefined()
    expect(result.note).toMatch(/no multiplier step observed/)
  })
})

describe('confidence', () => {
  const base = {
    rateWad: parseDecimal('0.306812', 18),
    priceWad: price(10_057_120_000n),
    oldMultiplier: 1_000_957_519_890_990_718n,
    newMultiplier: 1_002_981_519_346_766_532n,
  }

  it('is low below three observed events', () => {
    expect(reconcile({ ...base, observedEventCount: 2, feedVerified: true }).confidence).toBe('low')
  })

  it('is low while the token -> feed pairing is only a ticker heuristic', () => {
    expect(reconcile({ ...base, observedEventCount: 50, feedVerified: false }).confidence).toBe('low')
  })

  it('rises only once both hold', () => {
    expect(reconcile({ ...base, observedEventCount: 3, feedVerified: true }).confidence).toBe('medium')
    expect(reconcile({ ...base, observedEventCount: 10, feedVerified: true }).confidence).toBe('high')
  })
})

describe('matching an issuer processDate to an on-chain effectiveAt', () => {
  const effectiveAt = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))

  it('matches AAPL across one day', () => {
    expect(matchesProcessDate('2026-08-13', effectiveAt('2026-08-14T15:12:46Z'))).toBe(true)
  })

  it('matches COST across a weekend', () => {
    // processDate Friday 2026-08-07, effective Monday 2026-08-10.
    expect(matchesProcessDate('2026-08-07', effectiveAt('2026-08-10T15:10:24Z'))).toBe(true)
  })

  it('matches CCL across a weekend', () => {
    expect(matchesProcessDate('2026-08-28', effectiveAt('2026-08-31T15:10:26Z'))).toBe(true)
  })

  it('never matches backwards in time', () => {
    expect(matchesProcessDate('2026-08-14', effectiveAt('2026-08-13T15:10:00Z'))).toBe(false)
  })

  it('stops at the window edge', () => {
    const edge = effectiveAt('2026-08-07T00:00:00Z')
    expect(matchesProcessDate('2026-08-03', edge)).toBe(true)
    expect(matchesProcessDate('2026-08-02', edge)).toBe(false)
    expect(MATCH_WINDOW_DAYS).toBe(4)
  })

  it('refuses an unparseable date instead of matching everything', () => {
    expect(matchesProcessDate('not-a-date', effectiveAt('2026-08-14T15:12:46Z'))).toBe(false)
  })
})
