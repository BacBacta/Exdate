/**
 * How long a webhook takes to arrive, measured on real deliveries only.
 *
 * The product's most perishable claim is the announcement lead: a multiplier change is published
 * on chain about nine to ten minutes before it takes effect. That lead is only worth something if
 * the notice reaches a subscriber inside it, and until this module nothing measured whether it
 * did. What is published has to be a measurement of deliveries that actually happened, never a
 * budget derived from the poll interval - which is how a system claims a latency it has never met.
 *
 * The path has three legs, and they are reported apart because they fail for different reasons and
 * different people own them:
 *
 *   announce -> observe   exdate's own lag. The live indexer sees the log; a step it never saw is
 *                         a step it could not have sent, and no delivery time can hide that.
 *   observe -> send       the outbox, drained at the start of each poll cycle. Bounded by
 *                         EXDATE_POLL_INTERVAL_BLOCKS, ~60 s by default.
 *   announce -> deliver   the total, which is the only leg a subscriber experiences.
 *
 * Every figure carries the count it was computed from. A median over one delivery is a reading,
 * not a rate, and the caller is told which it has rather than being left to assume.
 */

/** One delivery, reduced to the instants that matter. All seconds since the epoch. */
export interface DeliveryTiming {
  eventId: string
  type: string
  endpointId: string
  /** From the event payload: when the chain carried the announcement. Null for an event with no log behind it. */
  announcedAt: number | null
  /** When exdate wrote the event to the outbox - its own observation, at a polled block. */
  observedAt: number
  /** When a subscriber accepted the delivery. Null while it is queued or failed. */
  deliveredAt: number | null
  /** How many attempts it took. 1 means it went out first time. */
  attempts: number
}

export interface LatencyLeg {
  /** How many deliveries carried this leg. Never inferred: a leg with no sample is absent, not zero. */
  n: number
  medianSeconds: number | null
  minSeconds: number | null
  maxSeconds: number | null
}

export interface LatencySummary {
  /** Deliveries that reached a subscriber and were accepted by it. */
  delivered: number
  /** Written but not yet accepted, so counted nowhere below. */
  pending: number
  /** Given up on. Reported, because a latency computed over successes alone flatters itself. */
  failed: number
  /** exdate's own lag: chain announcement to outbox row. */
  announceToObserve: LatencyLeg
  /** The outbox: written to accepted by a subscriber. */
  observeToDeliver: LatencyLeg
  /** What a subscriber experiences. The only one worth quoting on its own. */
  announceToDeliver: LatencyLeg
  /**
   * Whether these figures may be published as a claim about exdate's latency.
   *
   * False until at least one real delivery exists, with the reason in `notComputed`. There is no
   * higher threshold than one here on purpose: a single real delivery is a fact, where zero is an
   * estimate, and the count is published beside every figure so a reader is never misled about how
   * much a median rests on.
   */
  sufficient: boolean
  notComputed: string | null
}

const leg = (values: number[]): LatencyLeg => {
  if (values.length === 0) return { n: 0, medianSeconds: null, minSeconds: null, maxSeconds: null }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: sorted.length,
    // The lower of the two middles on an even count, rather than their mean: these are observed
    // durations, and an average of two of them is a number nothing was measured at.
    medianSeconds: sorted[Math.floor((sorted.length - 1) / 2)]!,
    minSeconds: sorted[0]!,
    maxSeconds: sorted[sorted.length - 1]!,
  }
}

export function summarizeLatency(timings: readonly DeliveryTiming[]): LatencySummary {
  const delivered = timings.filter((t) => t.deliveredAt !== null)
  const failed = timings.filter((t) => t.deliveredAt === null && t.attempts >= 8)
  const pending = timings.length - delivered.length - failed.length

  // A negative duration is a clock disagreeing with itself, not a fast delivery, so it is dropped
  // rather than pulling a median down. Kept visible by the leg's own n falling short of `delivered`.
  const positive = (values: (number | null)[]) => values.filter((v): v is number => v !== null && v >= 0)

  return {
    delivered: delivered.length,
    pending,
    failed: failed.length,
    announceToObserve: leg(positive(timings.map((t) => (t.announcedAt === null ? null : t.observedAt - t.announcedAt)))),
    observeToDeliver: leg(positive(delivered.map((t) => t.deliveredAt! - t.observedAt))),
    announceToDeliver: leg(
      positive(delivered.map((t) => (t.announcedAt === null ? null : t.deliveredAt! - t.announcedAt))),
    ),
    sufficient: delivered.length > 0,
    notComputed: delivered.length > 0 ? null : 'no_real_delivery_yet',
  }
}

/**
 * The instant a webhook payload says the chain carried the announcement, or null.
 *
 * Only `multiplier.scheduled` has one: it is the single event type behind which there is a log
 * with a block timestamp. Everything else - an applied multiplier, a stale feed, a reconciled
 * dividend - is an observation by the poller with no on-chain instant to be late against, so
 * asking "how long after the chain" of those would be asking a question with no answer.
 */
export function announcedAtFromPayload(type: string, payload: string): number | null {
  if (type !== 'multiplier.scheduled') return null
  try {
    const parsed = JSON.parse(payload) as { data?: { announcedAt?: unknown } }
    const at = parsed.data?.announcedAt
    if (typeof at !== 'string') return null
    const ms = Date.parse(at)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  } catch {
    return null
  }
}
