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
 * Recover the underlying-equity price from a total-return token price.
 *
 * Chainlink's Robinhood feeds publish `P_token = P_equity x multiplier` - that is
 * rule 5, and the reason a feed answer must never be multiplied by the
 * multiplier again. Dividing by the multiplier that was in force is the one
 * legitimate inverse, and the reconciliation needs it: a dividend is paid per
 * underlying share and reinvested at the equity price, not at the token price.
 *
 * At the instant of a step the multiplier in force is still `oldMultiplier`
 * (the round in force at effectiveAt predates the change), so that is the
 * divisor. For a token whose multiplier is 1.0 the two prices coincide, which is
 * why AAPL's haircut does not move when this is applied and SGOV's moves by a
 * tenth of a percent - and why CRWD's, at x4, would have been off by a factor
 * of four.
 */
export function underlyingPriceWad(tokenPriceWad: bigint, multiplierInForce: bigint): bigint {
  if (multiplierInForce <= 0n) throw new Error('multiplier must be positive')
  return (tokenPriceWad * WAD) / multiplierInForce
}

/**
 * The step a fully reinvested dividend would have produced.
 *
 * A cash dividend of `rate` USD per underlying share, reinvested at the
 * underlying price `price`, buys `rate / price` extra shares per share held,
 * which is exactly the multiplier step. Both arguments are WAD, and `price`
 * must be the equity price - see {@link underlyingPriceWad}.
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
 *
 * Truncated toward zero, as BigInt division is. The plausibility band is checked
 * on {@link haircutBpsPrecise}, not on this, so a row at -100.9 bps cannot be
 * pulled inside a band whose edge is -100 by the rounding alone.
 */
export function haircutBps(rateWad: bigint, receivedWad: bigint): number {
  if (rateWad === 0n) throw new Error('declared rate is zero')
  return Number(((rateWad - receivedWad) * 10_000n) / rateWad)
}

/** The same figure with two decimal places, for comparisons against a band. */
export function haircutBpsPrecise(rateWad: bigint, receivedWad: bigint): number {
  if (rateWad === 0n) throw new Error('declared rate is zero')
  return Number(((rateWad - receivedWad) * 1_000_000n) / rateWad) / 100
}

export type ReconciliationStatus = 'pending' | 'matched' | 'anomaly'
export type Confidence = 'low' | 'medium' | 'high'

export interface ReconcileInput {
  /** Declared gross amount per underlying share, WAD. From the issuer. */
  rateWad: bigint
  /**
   * The Chainlink answer in force at the moment the multiplier took effect, WAD.
   * This is the TOKEN price - total return, multiplier included. The underlying
   * price is derived inside by dividing by `oldMultiplier`; do not pre-divide.
   */
  priceWad: bigint | undefined
  /**
   * True when the round found is the earliest of the aggregator's current phase,
   * so the true price at that instant may predate a rollover and be unreachable.
   * Such a row is reported as unpriceable rather than as a measurement.
   */
  priceAtPhaseFloor?: boolean
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
  /** The equity price the token price implies at `oldMultiplier`, WAD. */
  underlyingPriceWad: bigint | undefined
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
    priceAtPhaseFloor = false,
    oldMultiplier,
    newMultiplier,
    observedEventCount,
    feedVerified = false,
    plausibleHaircutBps = DEFAULT_PLAUSIBLE_HAIRCUT_BPS,
  } = input

  const confidence: Confidence =
    observedEventCount < 3 || !feedVerified ? 'low' : observedEventCount < 10 ? 'medium' : 'high'

  const empty = {
    underlyingPriceWad: undefined,
    expectedStepWad: undefined,
    observedStepWad: undefined,
    receivedPerShareWad: undefined,
    impliedHaircutBps: undefined,
    impliedReinvestPriceWad: undefined,
  }

  if (oldMultiplier === undefined || newMultiplier === undefined) {
    return {
      status: 'pending',
      confidence,
      ...empty,
      note: 'declared by the issuer, no multiplier step observed on chain yet',
    }
  }

  // A declared rate of zero or less has nothing to reconcile against. This is
  // not reachable through the indexer today, which only routes cash dividends
  // here, but the function's contract is that a bad input yields a verdict and
  // never a throw.
  if (rateWad <= 0n) {
    return {
      status: 'anomaly',
      confidence: 'low',
      ...empty,
      observedStepWad: oldMultiplier === 0n ? undefined : observedStepWad(oldMultiplier, newMultiplier),
      note: 'the declared rate is not positive; there is no dividend to reconcile',
    }
  }

  const observed = observedStepWad(oldMultiplier, newMultiplier)

  // A step that did not increase the multiplier is not a reinvested dividend,
  // whatever the issuer's row says. Dividing the rate by it would print a
  // negative or infinite price, so nothing is implied from it.
  if (observed <= 0n) {
    return {
      status: 'anomaly',
      confidence: 'low',
      ...empty,
      observedStepWad: observed,
      note: 'the multiplier did not increase; the reinvestment model does not describe this event',
    }
  }

  // Without a price there is still one thing worth reporting: the price at
  // which this step would have delivered the declared rate in full. Comparing
  // it to spot is how CCL and COST were caught in Phase 0.
  const impliedReinvest = (rateWad * WAD) / observed

  if (priceWad === undefined || priceWad <= 0n) {
    return {
      status: 'anomaly',
      confidence: 'low',
      ...empty,
      observedStepWad: observed,
      impliedReinvestPriceWad: impliedReinvest,
      note: 'no reference price at effectiveAt - most Stock Tokens have no Chainlink feed',
    }
  }

  if (priceAtPhaseFloor) {
    return {
      status: 'anomaly',
      confidence: 'low',
      ...empty,
      observedStepWad: observed,
      impliedReinvestPriceWad: impliedReinvest,
      note: "the only round available is the first of the aggregator's current phase; the price at effectiveAt may predate a rollover and is not a measurement",
    }
  }

  const underlying = underlyingPriceWad(priceWad, oldMultiplier)
  const expected = expectedStepWad(rateWad, underlying)
  const received = receivedPerShareWad(underlying, observed)
  const bps = haircutBps(rateWad, received)
  const precise = haircutBpsPrecise(rateWad, received)
  const [lower, upper] = plausibleHaircutBps
  const plausible = precise >= lower && precise <= upper

  return {
    status: plausible ? 'matched' : 'anomaly',
    confidence,
    underlyingPriceWad: underlying,
    expectedStepWad: expected,
    observedStepWad: observed,
    receivedPerShareWad: received,
    impliedHaircutBps: bps,
    impliedReinvestPriceWad: impliedReinvest,
    note: plausible
      ? undefined
      : `implied haircut ${precise.toFixed(1)} % falls outside the plausible band; the reinvestment model does not describe this event`.replace(`${precise.toFixed(1)} %`, `${(precise / 100).toFixed(1)} %`),
  }
}
