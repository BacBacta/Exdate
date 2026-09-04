import type { FeedCorroboration } from './generated/registry.js'
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

/**
 * A split reconciles as a ratio, not as a per-share amount.
 *
 * A cash dividend is reconciled against a price; a split has no price in it at
 * all. The issuer declares "n old shares become m new ones" and the multiplier
 * must move by exactly m/n - an arithmetic identity with no oracle, no
 * withholding and no room for a haircut. Which makes it the one corporate
 * action exdate could reconcile at `high` confidence.
 *
 * It has never been run on real data. The only split ever observed on chain is
 * CRWD's x4 on 2026-07-02, and its issuer row fell out of the one-month window
 * before anything archived it, so the declared side does not exist. Nor has any
 * split appeared in the window since: all 43 archived actions are cash
 * dividends, so the shape the issuer uses for `oldRate`/`newRate` has never
 * been seen either.
 *
 * Hence the contract: this function reconciles only when both declared rates
 * are present and positive, and refuses otherwise. Nothing here guesses what a
 * split payload looks like - the first real one will either satisfy this or be
 * reported as unreconcilable, and neither outcome invents a number.
 */
export interface SplitReconciliation {
  status: 'matched' | 'anomaly' | 'unsupported_action_type'
  /** The ratio the multiplier actually moved by, WAD. Always present when the step is readable. */
  observedRatioWad: bigint | undefined
  /** The ratio the issuer declared, WAD, when it declared one. */
  declaredRatioWad: bigint | undefined
  /** Signed difference in basis points, observed against declared. */
  differenceBps: number | undefined
  note: string
}

export function reconcileSplit(input: {
  /** Shares before, as the issuer states them. */
  oldRate: string | null | undefined
  /** Shares after. */
  newRate: string | null | undefined
  oldMultiplier: bigint
  newMultiplier: bigint
  /** How close is close enough. One basis point by default: this is arithmetic, not a market. */
  toleranceBps?: number
}): SplitReconciliation {
  const { oldRate, newRate, oldMultiplier, newMultiplier, toleranceBps = 1 } = input

  const observedRatioWad =
    oldMultiplier > 0n ? (newMultiplier * WAD) / oldMultiplier : undefined

  if (!oldRate || !newRate) {
    return {
      status: 'unsupported_action_type',
      observedRatioWad,
      declaredRatioWad: undefined,
      differenceBps: undefined,
      note:
        'matched to a step, but the issuer row carries no share ratio to reconcile against; the observed ratio is stated instead',
    }
  }

  const oldWad = parseDecimal(oldRate, 18)
  const newWad = parseDecimal(newRate, 18)
  if (oldWad <= 0n || newWad <= 0n) {
    return {
      status: 'anomaly',
      observedRatioWad,
      declaredRatioWad: undefined,
      differenceBps: undefined,
      note: 'the declared share ratio is not positive; there is nothing to reconcile',
    }
  }

  const declaredRatioWad = (newWad * WAD) / oldWad
  if (observedRatioWad === undefined) {
    return {
      status: 'anomaly',
      observedRatioWad,
      declaredRatioWad,
      differenceBps: undefined,
      note: 'the multiplier before the step is zero; the observed ratio is undefined',
    }
  }

  const differenceBps =
    Number(((observedRatioWad - declaredRatioWad) * 1_000_000n) / declaredRatioWad) / 100
  const agrees = Math.abs(differenceBps) <= toleranceBps
  return {
    status: agrees ? 'matched' : 'anomaly',
    observedRatioWad,
    declaredRatioWad,
    differenceBps,
    note: agrees
      ? 'the multiplier moved by exactly the declared share ratio'
      : `the multiplier moved by ${(Number(observedRatioWad) / 1e18).toFixed(6)}x where the issuer declared ${(Number(declaredRatioWad) / 1e18).toFixed(6)}x`,
  }
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
   *
   * Ignored when {@link underlyingPriceWad} is given.
   */
  priceWad: bigint | undefined
  /**
   * The underlying equity price at that moment, WAD, from a source that already
   * publishes it as such - the issuer's own `/rhj/prices` quote, captured at the
   * instant of the step (see `quotes.ts`). Used as it is: no multiplier is
   * unwound from it, because none was applied to it.
   *
   * This is what lets a dividend be reconciled on any of the 194 tokens rather
   * than the 35 with a Chainlink feed, and against a price seconds old rather
   * than a round that can be hours stale. When both are supplied this one wins,
   * and `priceSource` on the result says which was used.
   */
  underlyingPriceWad?: bigint | undefined
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
   * The feed pairing is corroborated by behaviour rather than by its ticker
   * alone. Weaker than {@link feedVerified}, which would mean a first-party
   * address-level statement - there is none for any pair today. Which behaviour
   * carried it is {@link feedCorroboratedBy}, and the two are not equally
   * strong, so a row that reports one must never be presented as the other.
   */
  feedCorroborated?: boolean
  /**
   * Which evidence corroborates the pairing. Both raise confidence to `medium`,
   * because both are evidence about the thing confidence is about - is this the
   * right feed for this token - and neither is a first-party statement. They are
   * carried separately rather than merged because they answer that question in
   * different ways: a step that moved this feed is causal and tests the exact
   * mechanism a haircut depends on; a traded price that sits closest to this
   * feed identifies the underlying, which two unrelated assets could share.
   */
  feedCorroboratedBy?: readonly FeedCorroboration[]
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

export type PriceSource = 'chainlink:round' | 'issuer:quote'

export interface Reconciliation {
  status: ReconciliationStatus
  confidence: Confidence
  /**
   * Which corroboration the token -> feed pairing carries, so a consumer never
   * has to take `confidence` on trust. Empty when the pairing is a bare ticker
   * match. It is a fact about the pairing, not about this row: a row forced to
   * `low` for a reason of its own - no price, a non-positive rate - still
   * reports the evidence its pairing has.
   */
  feedCorroboratedBy: readonly FeedCorroboration[]
  /** Which of the two inputs the equity price came from; undefined when the row has no price. */
  priceSource?: PriceSource
  /** The equity price used, WAD: derived from the token price, or taken from the issuer quote as it is. */
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
    underlyingPriceWad: issuerUnderlyingWad,
    priceAtPhaseFloor = false,
    oldMultiplier,
    newMultiplier,
    observedEventCount,
    feedVerified = false,
    feedCorroborated = false,
    feedCorroboratedBy = [],
    plausibleHaircutBps = DEFAULT_PLAUSIBLE_HAIRCUT_BPS,
  } = input

  /**
   * Confidence is about the pairing first and the sample second, because a
   * haircut computed against the wrong feed is wrong however many events back
   * it up:
   *
   *   ticker match only          -> low, always
   *   corroborated by behaviour  -> medium from three events
   *   first-party address link   -> high from ten
   *
   * Nothing reaches `high` today: no first-party statement links any token to
   * any feed. See data/feed-map-verification.json for what was actually tested.
   *
   * Both kinds of corroboration land on the same rung, and the row says which
   * one it stands on rather than letting the weaker borrow the stronger's
   * standing. A fourth rung was considered and rejected: `medium` already means
   * "believed on behaviour, not stated by anyone", which is true of both, and
   * splitting it would put the distinction in a word instead of in the field
   * that names the evidence.
   */
  const confidence: Confidence =
    observedEventCount < 3 || !(feedVerified || feedCorroborated)
      ? 'low'
      : !feedVerified || observedEventCount < 10
        ? 'medium'
        : 'high'

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
      feedCorroboratedBy,
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
      feedCorroboratedBy,
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
      feedCorroboratedBy,
      ...empty,
      observedStepWad: observed,
      note: 'the multiplier did not increase; the reinvestment model does not describe this event',
    }
  }

  // Without a price there is still one thing worth reporting: the price at
  // which this step would have delivered the declared rate in full. Comparing
  // it to spot is how CCL and COST were caught in Phase 0.
  const impliedReinvest = (rateWad * WAD) / observed

  /**
   * The issuer's quote wins when it is there: it is the underlying price already,
   * measured seconds from the step, on any token. A Chainlink round is the
   * fallback, and carries the multiplier that has to be unwound.
   */
  const useIssuerQuote = issuerUnderlyingWad !== undefined && issuerUnderlyingWad > 0n
  const priceSource: PriceSource = useIssuerQuote ? 'issuer:quote' : 'chainlink:round'

  if (!useIssuerQuote && (priceWad === undefined || priceWad <= 0n)) {
    return {
      status: 'anomaly',
      confidence: 'low',
      feedCorroboratedBy,
      ...empty,
      observedStepWad: observed,
      impliedReinvestPriceWad: impliedReinvest,
      note: 'no reference price at effectiveAt - no Chainlink feed for this token, and no issuer quote captured at the instant of the step',
    }
  }

  // A phase floor only afflicts a Chainlink round: it means the round found is the
  // oldest the current aggregator holds, so the true price may predate a rollover.
  // An issuer quote carries its own timestamp and has no such failure mode.
  if (!useIssuerQuote && priceAtPhaseFloor) {
    return {
      status: 'anomaly',
      confidence: 'low',
      feedCorroboratedBy,
      ...empty,
      observedStepWad: observed,
      impliedReinvestPriceWad: impliedReinvest,
      note: "the only round available is the first of the aggregator's current phase; the price at effectiveAt may predate a rollover and is not a measurement",
    }
  }

  const underlying = useIssuerQuote ? issuerUnderlyingWad! : underlyingPriceWad(priceWad!, oldMultiplier)
  const expected = expectedStepWad(rateWad, underlying)
  const received = receivedPerShareWad(underlying, observed)
  const bps = haircutBps(rateWad, received)
  const precise = haircutBpsPrecise(rateWad, received)
  const [lower, upper] = plausibleHaircutBps
  const plausible = precise >= lower && precise <= upper

  return {
    status: plausible ? 'matched' : 'anomaly',
    confidence,
    feedCorroboratedBy,
    priceSource,
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
