import { FEED_HEARTBEAT_SECONDS } from './chains.js'

/**
 * Chainlink feed health.
 *
 * Robinhood tokenized-equity feeds are 24/5 with an 86 400 s heartbeat and a
 * 0.5 % deviation threshold. Off-hours they simply hold the last answer and
 * stop publishing, so `updatedAt` is the only honest signal. The kickoff brief
 * states that roughly 46 % of transfers happen outside NYSE hours - a figure
 * exdate has not measured, since it indexes no transfers - and off-hours is
 * exactly when a lending market is most exposed to a frozen price.
 *
 * Observed on 2026-09-02 during a live US session: SPY 18 h stale, QQQ 4 h,
 * USDG 21 h. Staleness is the normal state of these feeds, not an incident.
 */
export type FeedStatus = 'live' | 'stale' | 'paused' | 'unknown'

export interface FeedHealthInput {
  /** `updatedAt` from latestRoundData(), seconds. 0n or undefined means no round. */
  updatedAt: bigint | undefined
  /** Observation time, seconds. */
  nowSeconds: bigint
  /** The token's `oraclePaused()` flag, if it was read. */
  oraclePaused?: boolean
  /** Defaults to the 86 400 s heartbeat every Robinhood equity feed declares. */
  heartbeatSeconds?: number
}

export interface FeedHealth {
  status: FeedStatus
  /** Seconds since the last round, or undefined when there is no round. */
  ageSeconds: number | undefined
  /**
   * True once the age exceeds the heartbeat, regardless of the pause flag.
   * Undefined when there is no round to measure - never false, because "not
   * beyond the heartbeat" is a claim about a round that does not exist.
   */
  beyondHeartbeat: boolean | undefined
}

export function feedHealth(input: FeedHealthInput): FeedHealth {
  const { updatedAt, nowSeconds, oraclePaused, heartbeatSeconds = FEED_HEARTBEAT_SECONDS } = input

  if (updatedAt === undefined || updatedAt === 0n) {
    return { status: 'unknown', ageSeconds: undefined, beyondHeartbeat: undefined }
  }

  const ageSeconds = Number(nowSeconds - updatedAt)
  const beyondHeartbeat = ageSeconds > heartbeatSeconds

  // The pause flag wins for display, because a paused oracle is a deliberate
  // corporate-action window rather than a silent freeze. Chainlink's own docs
  // call the flag advisory and not enforced on chain, so the age check below
  // stays the primary guard and is still reported alongside.
  if (oraclePaused === true) return { status: 'paused', ageSeconds, beyondHeartbeat }

  return { status: beyondHeartbeat ? 'stale' : 'live', ageSeconds, beyondHeartbeat }
}

/**
 * What the poller should record when the pause flag it reads differs from the
 * one it read last time.
 *
 * Three cases, and the first is the one that is easy to get wrong: a token that
 * is ALREADY paused the first time exdate looks has not just been paused. Its
 * pause started at an unknown moment before the first observation, so it is a
 * baseline - recorded, but never sent as a transition, or every restart would
 * announce a pause that did not happen.
 *
 * A read that failed is `undefined` and yields null: exdate did not observe
 * anything, and "not observed" is not "unchanged".
 */
export function pauseTransition(
  previous: boolean | null | undefined,
  current: boolean | undefined,
): 'baseline' | 'paused' | 'resumed' | null {
  if (current === undefined) return null
  if (previous === undefined || previous === null) return current ? 'baseline' : null
  if (previous === current) return null
  return current ? 'paused' : 'resumed'
}

/**
 * The same question for feed health, which changes by the clock passing rather
 * than by anything arriving - so the transition only exists against the
 * previous poll's verdict, and the first observation of a stale feed is not a
 * feed going stale.
 */
export function feedStatusTransition(
  previous: FeedStatus | null | undefined,
  current: FeedStatus,
): 'stale' | 'resumed' | null {
  if (previous === undefined || previous === null) return null
  if (previous === current) return null
  if (previous === 'live' && current === 'stale') return 'stale'
  if (previous === 'stale' && current === 'live') return 'resumed'
  // Anything involving 'unknown' or 'paused' is not a staleness transition:
  // a feed that stops being readable has not gone stale, and a paused oracle is
  // a corporate-action window that pause.changed already reports.
  return null
}

/**
 * Is this price safe to act on at `nowSeconds`, given a caller's own tolerance?
 * Callers should pass their real risk bound - the 86 400 s heartbeat is a
 * publication guarantee, not a freshness guarantee.
 */
export function isFresh(input: FeedHealthInput & { toleranceSeconds: number }): boolean {
  const { updatedAt, nowSeconds, oraclePaused, toleranceSeconds } = input
  if (updatedAt === undefined || updatedAt === 0n) return false
  if (oraclePaused === true) return false
  return Number(nowSeconds - updatedAt) <= toleranceSeconds
}
