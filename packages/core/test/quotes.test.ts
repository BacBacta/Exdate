import { describe, expect, it } from 'vitest'
import {
  QUOTE_TOLERANCE_SECONDS,
  capturedStepKey,
  indexCapturedSteps,
  issuerPriceAt,
  quoteMidWad,
  selectQuoteAt,
  type CapturedQuote,
  type CapturedStep,
} from '../src/quotes.js'

// SGOV's 2026-08-07 step, and the shape the capture script writes.
const EFFECTIVE = '2026-08-07T15:10:24.000Z'
const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
const at = (offsetSeconds: number, mid = '100.455', extra: Partial<CapturedQuote> = {}): CapturedQuote => ({
  bid: (Number(mid) - 0.005).toFixed(3),
  ask: (Number(mid) + 0.005).toFixed(3),
  mid,
  generatedAt: new Date(Date.parse(EFFECTIVE) + offsetSeconds * 1000).toISOString(),
  ...extra,
})

describe('selectQuoteAt', () => {
  it('takes the quote nearest the instant, from either side', () => {
    const selected = selectQuoteAt([at(-41), at(-11), at(19)], EFFECTIVE)
    expect(selected?.distanceSeconds).toBe(-11)
    expect(selected?.offBySeconds).toBe(11)
  })

  it('prefers the earlier quote on a tie, because the later one already reflects the step', () => {
    const selected = selectQuoteAt([at(30, '101'), at(-30, '100')], EFFECTIVE)
    expect(selected?.distanceSeconds).toBe(-30)
    expect(selected?.quote.mid).toBe('100')
  })

  it('refuses everything outside the tolerance rather than reaching for the least bad', () => {
    expect(selectQuoteAt([at(121), at(-3600)], EFFECTIVE)).toBeNull()
    expect(selectQuoteAt([at(120)], EFFECTIVE)?.offBySeconds).toBe(120)
    expect(QUOTE_TOLERANCE_SECONDS).toBe(120)
  })

  it('honours a caller-supplied tolerance', () => {
    expect(selectQuoteAt([at(45)], EFFECTIVE, 30)).toBeNull()
    expect(selectQuoteAt([at(45)], EFFECTIVE, 60)?.offBySeconds).toBe(45)
  })

  it('is null on no quotes, an unparseable instant, and a quote that is not a number', () => {
    expect(selectQuoteAt(undefined, EFFECTIVE)).toBeNull()
    expect(selectQuoteAt([], EFFECTIVE)).toBeNull()
    expect(selectQuoteAt([at(0)], 'not a date')).toBeNull()
    expect(selectQuoteAt([{ ...at(0), generatedAt: 'nonsense' }], EFFECTIVE)).toBeNull()
    expect(selectQuoteAt([{ ...at(0), mid: 'n/a' }], EFFECTIVE)).toBeNull()
  })
})

describe('quoteMidWad', () => {
  it('converts the issuer decimals exactly', () => {
    expect(quoteMidWad('100.455')).toBe(100_455_000_000_000_000_000n)
    expect(quoteMidWad('14.385000')).toBe(14_385_000_000_000_000_000n)
    expect(quoteMidWad('1659')).toBe(1659n * 10n ** 18n)
  })

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['1e2', '-1', '', '.5', '1.', '1,5', 'null']) expect(() => quoteMidWad(bad)).toThrow(/not a decimal/)
  })
})

describe('issuerPriceAt', () => {
  const step: CapturedStep = { token: SGOV, symbol: 'SGOV', effectiveAt: EFFECTIVE, quotes: [at(-41), at(-11), at(19)] }

  it('yields the underlying price in WAD, with the quote it came from', () => {
    const result = issuerPriceAt(step, EFFECTIVE)
    expect(result.priceWad).toBe(100_455_000_000_000_000_000n)
    expect(result.selected?.distanceSeconds).toBe(-11)
    expect(result.refusal).toBeNull()
  })

  it('names why there is no price, and never substitutes one', () => {
    expect(issuerPriceAt(undefined, EFFECTIVE)).toMatchObject({ priceWad: null, refusal: 'no_capture_for_this_step' })
    expect(issuerPriceAt({ ...step, quotes: [at(600)] }, EFFECTIVE)).toMatchObject({
      priceWad: null,
      refusal: 'no_quote_within_tolerance',
    })
    expect(issuerPriceAt({ ...step, quotes: [], givenUp: true }, EFFECTIVE)).toMatchObject({
      priceWad: null,
      refusal: 'capture_given_up',
    })
  })

  it('treats a halt as a refusal: a quote published while trading is halted is a last price, not a market', () => {
    const halted = issuerPriceAt({ ...step, quotes: [at(-5, '100.455', { isTradingHalt: true })] }, EFFECTIVE)
    expect(halted.priceWad).toBeNull()
    expect(halted.refusal).toBe('trading_halted_at_effect')
    // the quote is still reported, so a consumer can see what was refused and why
    expect(halted.selected?.distanceSeconds).toBe(-5)
  })
})

describe('capturedStepKey', () => {
  it('is case-insensitive on the address and identical across timestamp spellings', () => {
    expect(capturedStepKey(SGOV, EFFECTIVE)).toBe(capturedStepKey(SGOV.toLowerCase(), '2026-08-07T15:10:24Z'))
  })

  it('indexes steps for lookup by token and instant', () => {
    const index = indexCapturedSteps([{ token: SGOV, symbol: 'SGOV', effectiveAt: EFFECTIVE, quotes: [at(0)] }])
    expect(index.get(capturedStepKey(SGOV.toLowerCase(), EFFECTIVE))?.symbol).toBe('SGOV')
    expect(index.get(capturedStepKey('0x0000000000000000000000000000000000000001', EFFECTIVE))).toBeUndefined()
  })
})
