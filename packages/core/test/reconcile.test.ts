import { describe, expect, it } from 'vitest'
import { WAD } from '../src/multiplier.js'
import { haircutBps, haircutBpsPrecise, parseDecimal, reconcile, reconcileSplit, rescale, underlyingPriceWad } from '../src/reconcile.js'

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

describe('the token price is total return and must be unwound, not multiplied', () => {
  it('is the identity at a multiplier of 1.0', () => {
    expect(underlyingPriceWad(price(30_517_110_000n), WAD)).toBe(price(30_517_110_000n))
  })

  it('divides by the multiplier in force', () => {
    // A x4 token quoting $400 is a $100 equity.
    expect(underlyingPriceWad(400n * WAD, 4n * WAD)).toBe(100n * WAD)
  })

  it('refuses a zero multiplier', () => {
    expect(() => underlyingPriceWad(WAD, 0n)).toThrow(/positive/)
  })
})

describe('reconciliation against the events observed in Phase 0', () => {
  it('measures a 36.0 % haircut on the AAPL dividend', () => {
    // Issuer rate $0.27 (processDate 2026-08-13). Chainlink round in force at
    // effectiveAt 2026-08-14T15:12:46Z: round 18446744073709552078, 305.1711,
    // the same round data/reconciliations.observed.json carries.
    const result = reconcile({
      rateWad: parseDecimal('0.27', 18),
      priceWad: price(30_517_110_000n),
      oldMultiplier: WAD,
      newMultiplier: 1_000_566_080_061_092_436n,
      observedEventCount: 1,
    })
    expect(result.status).toBe('matched')
    expect(result.impliedHaircutBps).toBe(3_601)
    // Received per underlying share, ~$0.1728.
    expect(Number(result.receivedPerShareWad) / 1e18).toBeCloseTo(0.1728, 4)
    // Multiplier 1.0, so the token price and the equity price coincide.
    expect(result.underlyingPriceWad).toBe(price(30_517_110_000n))
  })

  it('measures a ~34 % haircut on the SGOV dividend, independently', () => {
    // Two unrelated underlyings landing in the same band is the finding.
    // SGOV's multiplier was already 1.000957 here, so the equity price is the
    // token price divided by that - a tenth of a percent, but the right model.
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
    expect(result.underlyingPriceWad).toBeLessThan(price(10_057_120_000n))
  })

  it('would have been off by four on CRWD had the token price been used raw', () => {
    // Hypothetical: a $0.20 dividend on a x4 token quoting $100 (a $25 equity)
    // that delivered its full value. Reinvested at $25 the step is 0.8 %; against
    // the token price it would look like 0.2 % and a 75 % haircut.
    const step = parseDecimal('0.008', 18)
    const result = reconcile({
      rateWad: parseDecimal('0.20', 18),
      priceWad: 100n * WAD,
      oldMultiplier: 4n * WAD,
      newMultiplier: 4n * WAD + (4n * WAD * step) / WAD,
      observedEventCount: 1,
    })
    expect(result.underlyingPriceWad).toBe(25n * WAD)
    expect(result.impliedHaircutBps).toBe(0)
    expect(result.status).toBe('matched')
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
    // The implied reinvestment price - $6.98 against a ~$23.5 spot - is what
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

describe('inputs that must yield a verdict, never a number or a throw', () => {
  const step = {
    oldMultiplier: WAD,
    newMultiplier: 1_000_566_080_061_092_436n,
    observedEventCount: 1,
  }

  it('treats a zero price as no price', () => {
    const result = reconcile({ ...step, rateWad: parseDecimal('0.27', 18), priceWad: 0n })
    expect(result.status).toBe('anomaly')
    expect(result.impliedHaircutBps).toBeUndefined()
    expect(result.note).toMatch(/no reference price/)
  })

  it('treats a negative price as no price', () => {
    const result = reconcile({ ...step, rateWad: parseDecimal('0.27', 18), priceWad: -1n })
    expect(result.status).toBe('anomaly')
    expect(result.impliedHaircutBps).toBeUndefined()
  })

  it('returns a verdict on a zero declared rate instead of throwing', () => {
    const result = reconcile({ ...step, rateWad: 0n, priceWad: 100n * WAD })
    expect(result.status).toBe('anomaly')
    expect(result.impliedHaircutBps).toBeUndefined()
    expect(result.impliedReinvestPriceWad).toBeUndefined()
    expect(result.note).toMatch(/not positive/)
  })

  it('does not print a negative implied price for a multiplier that fell', () => {
    // A reverse split matched to a cash-dividend row by mistake: the step is
    // negative and the reinvestment model simply does not apply.
    const result = reconcile({
      rateWad: parseDecimal('0.15', 18),
      priceWad: 100n * WAD,
      oldMultiplier: 4n * WAD,
      newMultiplier: WAD,
      observedEventCount: 1,
    })
    expect(result.status).toBe('anomaly')
    expect(result.impliedReinvestPriceWad).toBeUndefined()
    expect(result.impliedHaircutBps).toBeUndefined()
    expect(result.note).toMatch(/did not increase/)
  })

  it('refuses to call a phase-floor price a measurement', () => {
    const result = reconcile({
      ...step,
      rateWad: parseDecimal('0.27', 18),
      priceWad: price(30_517_110_000n),
      priceAtPhaseFloor: true,
    })
    expect(result.status).toBe('anomaly')
    expect(result.impliedHaircutBps).toBeUndefined()
    expect(result.impliedReinvestPriceWad).toBeDefined()
    expect(result.note).toMatch(/rollover/)
  })
})

describe('the plausibility band', () => {
  // $1 a share at a $10 equity: a full reinvestment is a 1000 bps step. Every
  // 1e14 of multiplier is then 1 bps of step and 10 bps of haircut.
  const rateWad = parseDecimal('1', 18)
  const priceWad = 10n * WAD
  const at = (stepWad: bigint) =>
    reconcile({ rateWad, priceWad, oldMultiplier: WAD, newMultiplier: WAD + stepWad, observedEventCount: 1 })

  it('is inclusive at the upper edge, 5000 bps', () => {
    // Half the dividend arrived: step 500 bps.
    expect(at(500n * 10n ** 14n).impliedHaircutBps).toBe(5_000)
    expect(at(500n * 10n ** 14n).status).toBe('matched')
    expect(at(499n * 10n ** 14n).status).toBe('anomaly')
  })

  it('is inclusive at the lower edge, -100 bps', () => {
    // 1 % more than declared: step 1010 bps.
    expect(at(1_010n * 10n ** 14n).impliedHaircutBps).toBe(-100)
    expect(at(1_010n * 10n ** 14n).status).toBe('matched')
    expect(at(1_011n * 10n ** 14n).status).toBe('anomaly')
  })

  it('does not let truncation pull a row inside the band', () => {
    // -100.9 bps of haircut. Whole-bps truncation reads it as -100, which is on
    // the edge; the band is checked on the precise value and rejects it.
    const stepWad = 1_010_090n * 10n ** 11n
    const received = (priceWad * stepWad) / WAD
    expect(haircutBps(rateWad, received)).toBe(-100)
    expect(haircutBpsPrecise(rateWad, received)).toBeCloseTo(-100.9, 5)
    expect(at(stepWad).status).toBe('anomaly')
  })

  it('honours a caller-supplied band', () => {
    const result = reconcile({
      rateWad,
      priceWad,
      oldMultiplier: WAD,
      newMultiplier: WAD + 600n * 10n ** 14n,
      observedEventCount: 1,
      plausibleHaircutBps: [0, 3_000],
    })
    expect(result.impliedHaircutBps).toBe(4_000)
    expect(result.status).toBe('anomaly')
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

  it('lets behavioural corroboration reach medium, and no further', () => {
    // SGOV: three steps, and the July one moved its feed by exactly its own
    // size at a thousand times the feed's noise, with no other feed closer.
    // That is evidence about the pairing, but it is not the issuer saying so,
    // and `high` is reserved for a first-party address-level statement.
    expect(reconcile({ ...base, observedEventCount: 3, feedCorroborated: true }).confidence).toBe('medium')
    expect(reconcile({ ...base, observedEventCount: 50, feedCorroborated: true }).confidence).toBe('medium')
    // Corroboration does not substitute for a sample either.
    expect(reconcile({ ...base, observedEventCount: 2, feedCorroborated: true }).confidence).toBe('low')
  })
})

describe('splits reconcile as a ratio, with no price in them', () => {
  // CRWD's real step: 1.0 -> 4.0 on 2026-07-02, the only split ever observed on
  // this chain. Its issuer row fell out of the one-month window before anything
  // archived it, so every `oldRate`/`newRate` below is CONSTRUCTED to exercise
  // the arithmetic - no split payload has ever been seen from the issuer, and
  // none of these numbers is a claim about what it published.
  const CRWD = { oldMultiplier: WAD, newMultiplier: 4n * WAD }

  it('matches a declared 1:4 against the observed x4', () => {
    const result = reconcileSplit({ ...CRWD, oldRate: '1', newRate: '4' })
    expect(result.status).toBe('matched')
    expect(result.observedRatioWad).toBe(4n * WAD)
    expect(result.declaredRatioWad).toBe(4n * WAD)
    expect(result.differenceBps).toBe(0)
  })

  it('is scale-free: 5:20 is the same split as 1:4', () => {
    expect(reconcileSplit({ ...CRWD, oldRate: '5', newRate: '20' }).status).toBe('matched')
  })

  it('calls a ratio that does not match what happened an anomaly', () => {
    const result = reconcileSplit({ ...CRWD, oldRate: '1', newRate: '3' })
    expect(result.status).toBe('anomaly')
    expect(result.differenceBps).toBeCloseTo(3333.33, 1)
    expect(result.note).toContain('4.000000x where the issuer declared 3.000000x')
  })

  it('holds a reverse split to the same rule', () => {
    const result = reconcileSplit({
      oldMultiplier: 10n * WAD,
      newMultiplier: WAD,
      oldRate: '10',
      newRate: '1',
    })
    expect(result.status).toBe('matched')
    expect(result.observedRatioWad).toBe(WAD / 10n)
  })

  it('refuses without a declared ratio, and still reports what was observed', () => {
    // The real case today: a split matched to a step whose issuer row carries
    // no ratio. The row says what the chain did and admits it cannot check it.
    const result = reconcileSplit({ ...CRWD, oldRate: null, newRate: null })
    expect(result.status).toBe('unsupported_action_type')
    expect(result.observedRatioWad).toBe(4n * WAD)
    expect(result.declaredRatioWad).toBeUndefined()
    expect(result.note).toContain('no share ratio')
  })

  it('rejects a non-positive declared ratio rather than dividing by it', () => {
    expect(reconcileSplit({ ...CRWD, oldRate: '0', newRate: '4' }).status).toBe('anomaly')
    expect(reconcileSplit({ ...CRWD, oldRate: '1', newRate: '0' }).status).toBe('anomaly')
  })

  it('tolerates only arithmetic noise, because there is no market in a ratio', () => {
    // One part in a million: a rounding difference passes, a real mismatch does not.
    const nearlyFour = (4n * WAD * 1_000_001n) / 1_000_000n
    expect(reconcileSplit({ ...CRWD, newMultiplier: nearlyFour, oldRate: '1', newRate: '4' }).status).toBe(
      'matched',
    )
    const clearlyNotFour = (4n * WAD * 1_002n) / 1_000n
    expect(
      reconcileSplit({ ...CRWD, newMultiplier: clearlyNotFour, oldRate: '1', newRate: '4' }).status,
    ).toBe('anomaly')
  })
})
