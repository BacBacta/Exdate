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
  /**
   * What the last attempt got back, when it got anything.
   *
   * Carried because a delivery attempted and refused is a completely different state from one
   * written a moment ago, and both are `pending`. Measured 2026-09-06: exdate's own subscriber had
   * 45 deliveries at five attempts each, every one answering `fetch failed` at the socket, and the
   * published summary said `no_real_delivery_yet` - true, and indistinguishable from an outbox
   * that had simply not run yet. Null on a delivery nothing has been tried on.
   */
  lastError?: string | null
  /** The HTTP status the last attempt got, or null when the connection itself never happened. */
  lastResponseStatus?: number | null
}

/**
 * One concluded delivery, written to a durable journal the moment it reaches a terminal state.
 *
 * This exists because the outbox does not survive a code deploy. Ponder refuses a schema written
 * by a different build, so `deploy/update-api.sh` drops it and lets the poller rebuild - and the
 * derived tables coming back is fine for token states and reconciliations, which are recomputed
 * from the chain within one poll. Deliveries are not derived: they are the record of something
 * that happened once, at an instant, and nothing recreates them. Measured on 2026-09-06, the
 * morning's deploy took every delivery row with it and the published latency would have restarted
 * from zero at every deploy for ever.
 *
 * So the journal is denormalised on purpose. It carries the instants the latency needs rather than
 * pointing at the event row that holds them, because that row is exactly what a drop removes.
 */
export interface DeliveryJournalEntry extends DeliveryTiming {
  /** When the entry was written, ISO. Distinct from `deliveredAt`, which is the delivery itself. */
  recordedAt: string
  /** Host only, never a URL: the journal is read by a route the public can call. */
  endpointHost: string
  responseStatus: number | null
  outcome: 'delivered' | 'failed'
}

/**
 * Where concluded deliveries are kept. The host injects an implementation - a file on a volume in
 * the indexer, the same shape as the self-service subscription store, and for the same reason:
 * something the process owns that a schema drop cannot reach.
 */
export interface DeliveryJournal {
  append(entry: DeliveryJournalEntry): Promise<void>
  list(): Promise<DeliveryJournalEntry[]>
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
  /**
   * Where the concluded deliveries were read from. `journal` survives a code deploy; `outbox`
   * means the journal held nothing and the figures come from tables a deploy can drop, so a
   * reader knows the count can go backwards. Stated rather than left to be inferred.
   */
  source?: 'journal' | 'outbox'
  /** Written but not yet accepted, so counted nowhere below. */
  pending: number
  /**
   * Every delivery no subscriber has accepted, split by whether anything was even tried.
   *
   * A cut ACROSS `pending` and `failed`, not a breakdown of either: what matters to a reader is
   * "has anyone tried, and what came back", and a delivery on its fifth attempt and one that has
   * been given up on are the same answer to that question. A subscriber nobody can reach and an
   * outbox that has not run yet otherwise publish an identical summary, which is how a broken
   * outbox reads as an idle one.
   */
  attempted: {
    /** Written, and nothing has been tried on it yet. */
    neverAttempted: number
    /** Tried at least once and not accepted: a subscriber that is refusing, or unreachable. */
    triedNotAccepted: number
    /** What the most-tried unaccepted delivery last got back. Null when none has been tried. */
    lastError: string | null
    lastResponseStatus: number | null
  }
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

  const unaccepted = timings.filter((t) => t.deliveredAt === null)
  const tried = unaccepted.filter((t) => t.attempts > 0)
  // The one that has been tried hardest is the one whose error says most about why.
  const worst = tried.reduce<DeliveryTiming | null>((a, b) => (a === null || b.attempts > a.attempts ? b : a), null)

  return {
    delivered: delivered.length,
    pending,
    failed: failed.length,
    attempted: {
      neverAttempted: unaccepted.length - tried.length,
      triedNotAccepted: tried.length,
      lastError: worst?.lastError ?? null,
      lastResponseStatus: worst?.lastResponseStatus ?? null,
    },
    announceToObserve: leg(positive(timings.map((t) => (t.announcedAt === null ? null : t.observedAt - t.announcedAt)))),
    observeToDeliver: leg(positive(delivered.map((t) => t.deliveredAt! - t.observedAt))),
    announceToDeliver: leg(
      positive(delivered.map((t) => (t.announcedAt === null ? null : t.deliveredAt! - t.announcedAt))),
    ),
    sufficient: delivered.length > 0,
    // Three states, not two. "Nothing has been delivered yet" is honest about the figures and
    // silent about the cause; when deliveries have been tried and none accepted - whether they are
    // still retrying or have been given up on - saying only that hides an outbox that is broken
    // rather than young.
    notComputed:
      delivered.length > 0
        ? null
        : tried.length > 0
          ? 'deliveries_attempted_none_accepted'
          : 'no_real_delivery_yet',
  }
}

/**
 * The journal's entries as timings, plus whatever is still queued in the outbox.
 *
 * The two sources are authoritative for different things and are not merged by id: the journal
 * holds every delivery that CONCLUDED, the outbox holds those still in flight. A row that appears
 * in both would be one the journal has already recorded as concluded, so the outbox's copy is
 * dropped rather than counted twice.
 */
export function timingsFromJournal(
  journal: readonly DeliveryJournalEntry[],
  queued: readonly DeliveryTiming[],
): DeliveryTiming[] {
  const concluded = new Set(journal.map((entry) => `${entry.eventId}|${entry.endpointId}`))
  return [...journal, ...queued.filter((row) => !concluded.has(`${row.eventId}|${row.endpointId}`))]
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
