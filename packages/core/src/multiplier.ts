/**
 * ERC-8056 multiplier maths.
 *
 * The multiplier is a WAD: 1e18 == 1.0. A raw balance never changes when a
 * dividend is paid; the multiplier does, and with it the number of underlying
 * shares the same raw balance represents.
 */

export const WAD = 10n ** 18n

/** `underlying shares = raw amount * uiMultiplier / 1e18` */
export function toUnderlyingShares(rawAmount: bigint, uiMultiplier: bigint): bigint {
  return (rawAmount * uiMultiplier) / WAD
}

/** Inverse of {@link toUnderlyingShares}. Floor division, so it is not exact. */
export function toRawAmount(underlyingShares: bigint, uiMultiplier: bigint): bigint {
  if (uiMultiplier === 0n) throw new Error('uiMultiplier is zero')
  return (underlyingShares * WAD) / uiMultiplier
}

/** Signed size of a multiplier change, in basis points, as a float. */
export function stepBps(oldMultiplier: bigint, newMultiplier: bigint): number {
  if (oldMultiplier === 0n) throw new Error('oldMultiplier is zero')
  return (Number(newMultiplier - oldMultiplier) / Number(oldMultiplier)) * 10_000
}

/**
 * Classify a multiplier change.
 *
 * Deliberately NOT a magnitude band. Phase 0 observed steps from +0.64 bps
 * (DELL) to +214.86 bps (CCL) for ordinary cash dividends, which overlaps any
 * threshold one might pick, so magnitude alone cannot separate a dividend from
 * a split. `kind` is only trustworthy once a corporate action from the issuer
 * has been matched to the event; until then it stays 'unknown'.
 */
export type MultiplierEventKind = 'dividend' | 'split' | 'reverse_split' | 'unknown'

export function kindFromCorporateActionType(type: string | null | undefined): MultiplierEventKind {
  switch (type) {
    case 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND':
    case 'CORPORATE_ACTION_TYPE_STOCK_DIVIDEND':
      return 'dividend'
    case 'CORPORATE_ACTION_TYPE_FORWARD_SPLIT':
      return 'split'
    case 'CORPORATE_ACTION_TYPE_REVERSE_SPLIT':
      return 'reverse_split'
    default:
      return 'unknown'
  }
}

export interface MultiplierViews {
  uiMultiplier: bigint
  newUIMultiplier: bigint
  /** Seconds since the epoch, as returned by `effectiveAt()`. */
  effectiveAt: bigint
}

/**
 * Is a multiplier change actually pending right now?
 *
 * These views are retrospective, not prospective. With nothing scheduled,
 * `newUIMultiplier()` mirrors `uiMultiplier()` and `effectiveAt()` holds the
 * timestamp of the last change that already took effect (or 0 for a token that
 * has never moved). Reading a non-zero `effectiveAt` as "pending" reported nine
 * phantom dividends on 2026-09-02.
 */
export function isPending(views: MultiplierViews, nowSeconds: bigint): boolean {
  return views.effectiveAt > nowSeconds && views.newUIMultiplier !== views.uiMultiplier
}

/**
 * Has an announced change taken effect? There is no application event on chain,
 * so this is derived from the clock and nothing else.
 */
export function isApplied(effectiveAt: bigint, nowSeconds: bigint): boolean {
  return effectiveAt <= nowSeconds
}

/** Seconds between an announcement and the moment it takes effect. */
export function announcementLeadSeconds(announcedAt: bigint, effectiveAt: bigint): number {
  return Number(effectiveAt - announcedAt)
}
