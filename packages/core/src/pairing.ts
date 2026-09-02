
/**
 * Pairing the two sides of a reconciliation.
 *
 * The issuer says a dividend was processed on a date; the chain says a multiplier
 * changed at an instant. Neither carries a reference to the other, so the join is
 * (contract address, a few days). This module is the single definition of that
 * join - the offline builder and the indexer must not drift apart on it, because
 * a wrong pair produces a haircut that looks exactly like a real one.
 *
 * `processDate` is explicitly not the ex-date and not the payable date. Observed:
 * AAPL 08-13 to 08-14, SGOV 08-06 to 08-07, ASML 08-05 to 08-06, COST Friday
 * 08-07 to Monday 08-10, CCL Friday 08-28 to Monday 08-31. The window has to span
 * a weekend, which is why it is four days and not one.
 */

export interface PairableAction {
  /**
   * The issuer's own uid. It names a dividend series, not a payment: SGOV, SHY
   * and BND carry the same id on their August and September rows, with a
   * different processDate and rate on each. One action is (id, processDate).
   */
  id: string
  /** Contract address on this chain, or null when the action names no deployment. */
  token: string | null
  processDate: string | null
}

export interface PairableChange {
  token: string
  /** Seconds since the epoch. */
  effectiveAt: bigint
}

export interface Pairing<A extends PairableAction, C extends PairableChange> {
  /** Actions matched to the multiplier step they produced. */
  matched: { action: A; change: C }[]
  /** Declared by the issuer, nothing observed on chain yet. */
  unmatchedActions: A[]
  /**
   * Observed on chain with no issuer row to explain it. Expected for anything
   * before roughly 2026-08-05: the issuer's feed only keeps about a month.
   */
  unmatchedChanges: C[]
}

/**
 * Days after `processDate` within which an on-chain step is taken to be that
 * action's. Calendar days, inclusive: a step on the fourth calendar day pairs, a
 * step on the fifth does not. Four rather than one because the observed lag is
 * "next business day", and a Friday or a holiday weekend puts that three or four
 * calendar days out.
 */
export const MATCH_WINDOW_DAYS = 4

/** What makes an action unique: the issuer id alone does not (see PairableAction). */
export const actionKey = (action: PairableAction) => `${action.id}:${action.processDate ?? ''}`

/**
 * Pair actions with changes, one-to-one, nearest first.
 *
 * Nearest-first matters: SGOV produces a dividend every month, so a token can hold
 * several actions and several changes at once. Taking the first candidate in
 * iteration order would let August's action claim September's step whenever the
 * arrays happen to be ordered that way.
 */
export function pairActionsWithChanges<A extends PairableAction, C extends PairableChange>(
  actions: readonly A[],
  changes: readonly C[],
  windowDays: number = MATCH_WINDOW_DAYS,
): Pairing<A, C> {
  const candidates: { action: A; change: C; lagSeconds: bigint }[] = []
  for (const action of actions) {
    if (!action.token || !action.processDate) continue
    const processedMs = Date.parse(`${action.processDate}T00:00:00Z`)
    if (Number.isNaN(processedMs)) continue
    const processedAt = BigInt(Math.floor(processedMs / 1000))
    for (const change of changes) {
      if (change.token.toLowerCase() !== action.token.toLowerCase()) continue
      // The window is in calendar days, the same unit lagDays reports. Measuring
      // it in seconds from midnight would make the usable window three days and
      // fifteen hours, since every observed step lands at ~15:10 UTC, and a
      // genuine four-calendar-day lag over a holiday weekend would fail to pair.
      const days = lagDays(action.processDate, change.effectiveAt)
      if (days === null || days < 0 || days > windowDays) continue
      // Ordering still uses seconds so that "nearest" is exact.
      candidates.push({ action, change, lagSeconds: change.effectiveAt - processedAt })
    }
  }

  // Shortest lag wins; ties break on the action key so the result is deterministic.
  candidates.sort((a, b) =>
    a.lagSeconds === b.lagSeconds
      ? actionKey(a.action).localeCompare(actionKey(b.action))
      : a.lagSeconds < b.lagSeconds
        ? -1
        : 1,
  )

  const usedActions = new Set<string>()
  const usedChanges = new Set<string>()
  const changeKey = (change: C) => `${change.token.toLowerCase()}:${change.effectiveAt}`
  const matched: { action: A; change: C }[] = []

  for (const candidate of candidates) {
    if (usedActions.has(actionKey(candidate.action))) continue
    const key = changeKey(candidate.change)
    if (usedChanges.has(key)) continue
    usedActions.add(actionKey(candidate.action))
    usedChanges.add(key)
    matched.push({ action: candidate.action, change: candidate.change })
  }

  return {
    matched,
    unmatchedActions: actions.filter((action) => !usedActions.has(actionKey(action))),
    unmatchedChanges: changes.filter((change) => !usedChanges.has(changeKey(change))),
  }
}

/**
 * Calendar days in UTC between the issuer's scheduling date and the on-chain
 * effect - the difference of the two dates, not of the two instants.
 *
 * AAPL was processed on 2026-08-13 and took effect at 2026-08-14T15:12:46Z. That
 * is one day later on the calendar and 1.63 days of elapsed time; rounding the
 * elapsed time reports 2, which is simply the wrong answer to "how many days
 * after processDate". The whole point of the field is to show the next-business-
 * day pattern, so it counts days the way a calendar does.
 */
export function lagDays(processDate: string, effectiveAt: bigint): number | null {
  const processedMs = Date.parse(`${processDate}T00:00:00Z`)
  if (Number.isNaN(processedMs)) return null
  const effectiveDate = new Date(Number(effectiveAt) * 1000).toISOString().slice(0, 10)
  const effectiveMs = Date.parse(`${effectiveDate}T00:00:00Z`)
  return Math.round((effectiveMs - processedMs) / 86_400_000)
}
