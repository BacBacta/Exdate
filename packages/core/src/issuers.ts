/**
 * What a tokenized-equity issuer's mechanism is, extracted from two that were read rather than one
 * that was assumed.
 *
 * The order matters and is the reason this file is dated after the adapters rather than before
 * them. exdate read Robinhood first and would have written "balanceOf is the raw amount" into a
 * common contract, because on Robinhood Chain it is. On Backed's EVM tokens `balanceOf()` is the
 * ADJUSTED view and `sharesOf()` is the constant - the exact inverse - so that contract would have
 * been wrong in the direction that reports a post-dividend balance as a pre-dividend one, silently,
 * on 726 tokens.
 *
 * So the interface names the two ROLES and lets each issuer say which selector fills them. It never
 * assumes ERC-20's own `balanceOf` is either.
 *
 * What is deliberately NOT here: anything that exists on one issuer only. Robinhood's ~9-minute
 * announcement lead, Backed's step history, Coinbase's oracle registry - each is real and each
 * belongs to its own adapter. An abstraction that carries one issuer's peculiarity has not
 * abstracted anything; it has renamed it.
 */

/** How an issuer expresses the multiplier in its contracts. Roles, never selectors by name. */
export interface IssuerMechanism {
  /** Stable key. The issuer's legal name is not one: it changes and it is not unique. */
  id: 'robinhood' | 'coinbase-b20' | 'backed-xstocks'
  issuer: string
  /**
   * The view that does NOT move when a corporate action lands. Robinhood: `balanceOf()`.
   * Backed: `sharesOf()`. Null where the mechanism is documented but not live.
   */
  constantView: string | null
  /**
   * The view that DOES move. Robinhood: `balanceOfUI()`. Backed: `balanceOf()`.
   * These two being swapped between the first two issuers with real events is the whole reason
   * this interface exists.
   */
  adjustedView: string | null
  /** Where the multiplier itself is read. */
  multiplierView: string | null
  /** WAD everywhere seen so far - 1e18 means 1.0 - but stated per issuer rather than assumed. */
  multiplierScale: bigint
  /**
   * Whether a log fires before the change takes effect. Robinhood emits `UIMultiplierUpdated`
   * about nine to ten minutes ahead; nothing is emitted when it takes effect. Unread elsewhere,
   * and `null` means unread rather than absent.
   */
  hasAnnouncementEvent: boolean | null
  /** Whether the issuer publishes the declared cash amount per share. Robinhood does; Backed does not. */
  publishesDeclaredRate: boolean
  /** Whether the issuer publishes its own step history. Backed does, back to 2025; Robinhood does not. */
  publishesStepHistory: boolean
  /**
   * What exdate can measure for this issuer, and it follows from the two flags above rather than
   * from ambition: a haircut needs BOTH the declared rate and the observed step. With only the
   * step, the honest product is a ledger.
   */
  produces: 'haircuts' | 'step-ledger' | 'nothing-yet'
  /** The file the claims above were read from, so a row here can be checked without trusting it. */
  evidence: string
}

/**
 * `produces` derived rather than stored, so a row cannot claim a haircut it has no rate for.
 * Exported because the derivation is the argument, not a detail.
 */
export function producesFor(input: {
  publishesDeclaredRate: boolean
  publishesStepHistory: boolean
  everMoved: boolean
}): IssuerMechanism['produces'] {
  if (!input.everMoved) return 'nothing-yet'
  return input.publishesDeclaredRate ? 'haircuts' : 'step-ledger'
}

export const ISSUER_MECHANISMS: readonly IssuerMechanism[] = [
  {
    id: 'robinhood',
    issuer: 'Robinhood Assets (Jersey) Limited',
    constantView: 'balanceOf(address)',
    adjustedView: 'balanceOfUI(address)',
    multiplierView: 'uiMultiplier()',
    multiplierScale: 10n ** 18n,
    hasAnnouncementEvent: true,
    publishesDeclaredRate: true,
    publishesStepHistory: false,
    produces: 'haircuts',
    evidence: 'data/multiplier-events.observed.json',
  },
  {
    id: 'coinbase-b20',
    issuer: 'Coinbase',
    // ERC-8056 is documented on Base and reverts on all 13 tokens until the Cobalt hardfork, so
    // the roles are unfilled rather than guessed.
    constantView: null,
    adjustedView: null,
    multiplierView: 'multiplier()',
    multiplierScale: 10n ** 18n,
    hasAnnouncementEvent: null,
    publishesDeclaredRate: false,
    publishesStepHistory: false,
    produces: 'nothing-yet',
    evidence: 'data/base-b20-verification.json',
  },
  {
    id: 'backed-xstocks',
    issuer: 'Backed Finance',
    constantView: 'sharesOf(address)',
    adjustedView: 'balanceOf(address)',
    multiplierView: 'getCurrentMultiplier()',
    multiplierScale: 10n ** 18n,
    hasAnnouncementEvent: null,
    publishesDeclaredRate: false,
    publishesStepHistory: true,
    produces: 'step-ledger',
    evidence: 'data/xstocks-verification.json, data/xstocks-steps.observed.json',
  },
] as const

/**
 * The one calculation that is genuinely common to all three: how far a multiplier moved, in basis
 * points, exactly.
 *
 * Integer arithmetic on the WAD rather than a float ratio, because a dividend step is tens of basis
 * points and a float divide loses the low digits of a 1e18 value where it matters most. Scaled by
 * 100 so a hundredth of a basis point survives - Robinhood's smallest observed step is DELL at
 * 0.64 bps, and rounding to whole bps would print it as 1.
 */
export function stepBpsExact(oldMultiplier: bigint, newMultiplier: bigint): number | null {
  if (oldMultiplier <= 0n) return null
  return Number(((newMultiplier - oldMultiplier) * 1_000_000n) / oldMultiplier) / 100
}

/**
 * What kind of corporate action a step is, from its size alone — and the answer is usually "cannot
 * tell", which is the point.
 *
 * exdate's own record refuses to classify by magnitude: Robinhood's observed dividends run from
 * 0.64 to 214.86 bps and one split was x4, so the "0.05 %–2 %" band from the original brief does
 * not hold. What a step size CAN establish is the two ends: a multiplier that at least doubled is
 * a split whatever anyone declares, and one that at least halved is a reverse split. Everything in
 * between is unknowable from the number and needs the issuer to say.
 *
 * Backed labels every step (`Dividend`, `Split`, `ReverseSplit`, `Administrative`); Robinhood does
 * not. So this exists to CHECK a declared label, never to invent a missing one.
 */
export function stepShape(oldMultiplier: bigint, newMultiplier: bigint): 'split' | 'reverse-split' | 'undetermined' | null {
  if (oldMultiplier <= 0n) return null
  if (newMultiplier >= oldMultiplier * 2n) return 'split'
  if (newMultiplier * 2n <= oldMultiplier) return 'reverse-split'
  return 'undetermined'
}
