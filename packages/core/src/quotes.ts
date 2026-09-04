/**
 * The issuer's own quote as a reconciliation input.
 *
 * The reconciliation needs the underlying equity price at the instant a multiplier
 * step took effect. Two sources can supply it and they are not equivalent:
 *
 *   Chainlink `getRoundData`   35 of 194 tokens, and the round in force can be
 *                              hours old - SGOV's was 15 hours stale at effect.
 *   `/rhj/prices`              all 194 tokens, refreshed every 15 s, but serves
 *                              only the present: it must be captured as it happens.
 *
 * The issuer publishes the raw underlying price, not the token price. That is not
 * assumed: `scripts/phase0/check-quote-basis.mjs` decides it against the feeds, and
 * SGOV - the one token whose multiplier is far enough from 1.0 for its own price
 * noise not to swamp the difference - separates the two hypotheses by a factor of
 * fifty. So a quote goes into `underlyingPriceWad` and is never divided by a
 * multiplier, while a Chainlink answer goes into `priceWad` and is.
 *
 * This module only chooses; it never fetches and never interpolates. A missing
 * quote yields null and the row stays unpriced.
 */

/** One captured quote. `generatedAt` is the issuer's own timestamp, which dates the price; `capturedAt` only dates the request. */
export interface CapturedQuote {
  bid: string
  ask: string
  mid: string
  generatedAt: string
  capturedAt?: string
  isTradingHalt?: boolean | null
  /** Signed seconds from the step's `effectiveAt`; negative is before. */
  distanceSeconds?: number
}

export interface CapturedStep {
  token: string
  symbol: string | null
  effectiveAt: string
  quotes?: CapturedQuote[]
  givenUp?: boolean
  givenUpReason?: string
}

/**
 * How close a quote must be to `effectiveAt` to stand for the price at that instant.
 *
 * Two minutes. A dividend step is ~20 bps, and the haircut error is roughly the
 * price error times the fraction that arrived, so a 50 bps price move shifts a 34 %
 * haircut by a third of a point. Large-cap equities do not move 50 bps in two
 * minutes outside a halt, and a halt is reported on the quote itself.
 */
export const QUOTE_TOLERANCE_SECONDS = 120

export interface SelectedQuote {
  quote: CapturedQuote
  /** Signed seconds from `effectiveAt`; negative is before. */
  distanceSeconds: number
  /** Absolute distance, which is what the tolerance is applied to. */
  offBySeconds: number
}

const distance = (quote: CapturedQuote, effectiveAt: string): number =>
  Math.round((Date.parse(quote.generatedAt) - Date.parse(effectiveAt)) / 1000)

/**
 * The quote nearest `effectiveAt`, or null when none is inside the tolerance. Ties
 * go to the earlier quote: the price before a step is the price the step was
 * computed against, and the one after already reflects it.
 */
export function selectQuoteAt(
  quotes: readonly CapturedQuote[] | undefined,
  effectiveAt: string,
  toleranceSeconds: number = QUOTE_TOLERANCE_SECONDS,
): SelectedQuote | null {
  if (!quotes?.length || Number.isNaN(Date.parse(effectiveAt))) return null
  let best: SelectedQuote | null = null
  for (const quote of quotes) {
    if (Number.isNaN(Date.parse(quote.generatedAt))) continue
    if (!Number.isFinite(Number(quote.mid))) continue
    const signed = distance(quote, effectiveAt)
    const off = Math.abs(signed)
    if (off > toleranceSeconds) continue
    if (!best || off < best.offBySeconds || (off === best.offBySeconds && signed < best.distanceSeconds)) {
      best = { quote, distanceSeconds: signed, offBySeconds: off }
    }
  }
  return best
}

/** Indexes captured steps by `(token, effectiveAt)`, the key a multiplier change is unique under. */
export function indexCapturedSteps(steps: readonly CapturedStep[]): Map<string, CapturedStep> {
  return new Map(steps.map((step) => [capturedStepKey(step.token, step.effectiveAt), step]))
}

export const capturedStepKey = (token: string, effectiveAt: string): string =>
  `${token.toLowerCase()}:${Math.floor(Date.parse(effectiveAt) / 1000)}`

/** `"100.455"` -> WAD. Refuses anything that is not a plain decimal rather than coercing it. */
export function quoteMidWad(mid: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(mid)) throw new Error(`quotes: not a decimal mid: ${mid}`)
  const [whole, fraction = ''] = mid.split('.')
  return BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

/** Why a step has no issuer price, in words a response can carry. */
export type QuoteRefusal =
  | 'no_capture_for_this_step'
  | 'no_quote_within_tolerance'
  | 'capture_given_up'
  | 'trading_halted_at_effect'

export interface QuoteLookup {
  priceWad: bigint | null
  selected: SelectedQuote | null
  refusal: QuoteRefusal | null
}

/**
 * The issuer's underlying price for one step, or a reason there is none.
 *
 * A halt is a refusal rather than a price: the issuer states `isTradingHalt`, and a
 * quote published while trading is halted is a last price, not a market.
 */
export function issuerPriceAt(
  step: CapturedStep | undefined,
  effectiveAt: string,
  toleranceSeconds: number = QUOTE_TOLERANCE_SECONDS,
): QuoteLookup {
  if (!step) return { priceWad: null, selected: null, refusal: 'no_capture_for_this_step' }
  const selected = selectQuoteAt(step.quotes, effectiveAt, toleranceSeconds)
  if (!selected) {
    return { priceWad: null, selected: null, refusal: step.givenUp ? 'capture_given_up' : 'no_quote_within_tolerance' }
  }
  if (selected.quote.isTradingHalt === true) {
    return { priceWad: null, selected, refusal: 'trading_halted_at_effect' }
  }
  return { priceWad: quoteMidWad(selected.quote.mid), selected, refusal: null }
}
