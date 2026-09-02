import { WAD } from './multiplier.js'

/**
 * Reconciliation: the declared corporate action against the observed multiplier
 * step. The difference is the effective haircut, and it is the one number
 * exdate publishes that exists nowhere else.
 *
 * Everything here is arithmetic on inputs the caller must have sourced. The
 * functions never invent a price, a rate or a fallback - a missing input yields
 * a `pending` or `anomaly` verdict, never a number.
 */

/** Parse a decimal string ("0.306812") into a fixed-point bigint. Exact, no float. */
export function parseDecimal(value: string, decimals: number): bigint {
  const trimmed = value.trim()
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.' || trimmed === '-') {
    throw new Error(`not a decimal: ${JSON.stringify(value)}`)
  }
  const negative = trimmed.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.')
  if (fraction.length > decimals) {
    // Truncate rather than round: an issuer rate is a stated figure, and
    // rounding it up would overstate what holders were owed.
    const scaled = BigInt(whole + fraction.slice(0, decimals))
    return negative ? -scaled : scaled
  }
  const scaled = BigInt(whole + fraction.padEnd(decimals, '0'))
  return negative ? -scaled : scaled
}

/** Rescale a fixed-point bigint from one number of decimals to another. */
export function rescale(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return value
  if (fromDecimals < toDecimals) return value * 10n ** BigInt(toDecimals - fromDecimals)
  return value / 10n ** BigInt(fromDecimals - toDecimals)
}

/** The multiplier step actually observed on chain, as a WAD fraction. */
export function observedStepWad(oldMultiplier: bigint, newMultiplier: bigint): bigint {
  if (oldMultiplier === 0n) throw new Error('oldMultiplier is zero')
  return ((newMultiplier - oldMultiplier) * WAD) / oldMultiplier
}

/**
 * The step a fully reinvested dividend would have produced.
 *
 * A cash dividend of `rate` USD per share, reinvested at price `price`, buys
 * `rate / price` extra shares per share held, which is exactly the multiplier
 * step. Both arguments are WAD.
 */
export function expectedStepWad(rateWad: bigint, priceWad: bigint): bigint {
  if (priceWad <= 0n) throw new Error('price must be positive')
  return (rateWad * WAD) / priceWad
}

/** USD per share actually delivered by an observed step at a given price. */
export function receivedPerShareWad(priceWad: bigint, stepWad: bigint): bigint {
  return (priceWad * stepWad) / WAD
}

/**
 * Effective haircut in basis points: the fraction of the declared dividend that
 * did not reach token holders. 3 000 bps means 30 % was withheld somewhere.
 */
export function haircutBps(rateWad: bigint, receivedWad: bigint): number {
  if (rateWad === 0n) throw new Error('declared rate is zero')
  return Number(((rateWad - receivedWad) * 10_000n) / rateWad)
}

export type ReconciliationStatus = 'pending' | 'matched' | 'anomaly'
export type Confidence = 'low' | 'medium' | 'high'

export interface ReconcileInput {
  /** Declared gross amount per underlying share, WAD. From the issuer. */
  rateWad: bigint
  /** Reference price at the moment the multiplier took effect, WAD. */
  priceWad: bigint | undefined
  /** Multiplier before the step. */
  oldMultiplier: bigint | undefined
  /** Multiplier after the step. */
  newMultiplier: bigint | undefined
  /** How many multiplier events this token has produced so far. */
  observedEventCount: number
  /** False when the token -> feed pairing is still a ticker heuristic. */
  feedVerified?: boolean
  /**
   * Bounds outside which a result is reported as an anomaly rather than a
   * measurement, in basis points. The default admits everything from "holders
   * received 1 % more than declared" to "half the dividend disappeared", which
   * comfortably contains the 30 % US non-resident withholding rate and the
   * ~34-36 % observed on AAPL and SGOV. It rejects ASML at 90 %.
   *
   * This is a presentation bound, not a claim about what is correct.
   */
  plausibleHaircutBps?: readonly [number, number]
}

export interface Reconciliation {
  status: ReconciliationStatus
  confidence: Confidence
  expectedStepWad: bigint | undefined
  observedStepWad: bigint | undefined
  receivedPerShareWad: bigint | undefined
  impliedHaircutBps: number | undefined
  /**
   * The price at which the observed step would imply a zero haircut. When this
   * is far from spot, the reinvestment model does not describe what happened -
   * that is what makes COST and CCL anomalies rather than measurements.
   */
  impliedReinvestPriceWad: bigint | undefined
  /** Why the row is not a measurement, when it is not one. */
  note?: string
}

const DEFAULT_PLAUSIBLE_HAIRCUT_BPS = [-100, 5_000] as const

export function reconcile(input: ReconcileInput): Reconciliation {
  const {
    rateWad,
    priceWad,
    oldMultiplier,
    newMultiplier,
    observedEventCount,
    feedVerified = false,
    plausibleHaircutBps = DEFAULT_PLAUSIBLE_HAIRCUT_BPS,
  } = input

  const confidence: Confidence =
    observedEventCount < 3 || !feedVerified ? 'low' : observedEventCount < 10 ? 'medium' : 'high'

  if (oldMultiplier === undefined || newMultiplier === undefined) {
    return {
      status: 'pending',
      confidence,
      expectedStepWad: undefined,
      observedStepWad: undefined,
      receivedPerShareWad: undefined,
      impliedHaircutBps: undefined,
      impliedReinvestPriceWad: undefined,
      note: 'declared by the issuer, no multiplier step observed on chain yet',
    }
  }

  const observed = observedStepWad(oldMultiplier, newMultiplier)

  // Without a price there is still one thing worth reporting: the price at
  // which this step would have delivered the declared rate in full. Comparing
  // it to spot is how CCL and COST were caught in Phase 0.
  const impliedReinvest = observed === 0n ? undefined : (rateWad * WAD) / observed

  if (priceWad === undefined || priceWad <= 0n) {
    return {
      status: 'anomaly',
      confidence: 'low',
      expectedStepWad: undefined,
      observedStepWad: observed,
      receivedPerShareWad: undefined,
      impliedHaircutBps: undefined,
      impliedReinvestPriceWad: impliedReinvest,
      note: 'no reference price at effectiveAt - most Stock Tokens have no Chainlink feed',
    }
  }

  const expected = expectedStepWad(rateWad, priceWad)
  const received = receivedPerShareWad(priceWad, observed)
  const bps = haircutBps(rateWad, received)
  const [lower, upper] = plausibleHaircutBps
  const plausible = bps >= lower && bps <= upper

  return {
    status: plausible ? 'matched' : 'anomaly',
    confidence,
    expectedStepWad: expected,
    observedStepWad: observed,
    receivedPerShareWad: received,
    impliedHaircutBps: bps,
    impliedReinvestPriceWad: impliedReinvest,
    note: plausible
      ? undefined
      : `implied haircut ${(bps / 100).toFixed(1)} % falls outside the plausible band; the reinvestment model does not describe this event`,
  }
}

/**
 * Match an issuer corporate action to an on-chain multiplier event.
 *
 * `processDate` is the issuer's scheduling day, explicitly not the ex-date or
 * the payable date. Empirically the on-chain `effectiveAt` lands on the next
 * business day around 15:10 UTC - AAPL 08-13 to 08-14, COST Friday 08-07 to
 * Monday 08-10 - so the window has to span a weekend.
 */
export const MATCH_WINDOW_DAYS = 4

export function matchesProcessDate(
  processDateIso: string,
  effectiveAtSeconds: bigint,
  windowDays: number = MATCH_WINDOW_DAYS,
): boolean {
  const processed = Date.parse(`${processDateIso}T00:00:00Z`)
  if (Number.isNaN(processed)) return false
  const lagMs = Number(effectiveAtSeconds) * 1000 - processed
  return lagMs >= 0 && lagMs <= windowDays * 86_400_000
}
