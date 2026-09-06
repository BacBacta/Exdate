import { describe, expect, it } from 'vitest'
import { announcedAtFromPayload, summarizeLatency, type DeliveryTiming } from '../src/latency.js'

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)

/** UPS's real announcement, 2026-09-04: on chain 15:00:41, effective 15:10:26. */
const ANNOUNCED = at('2026-09-04T15:00:41.000Z')

const timing = (over: Partial<DeliveryTiming> = {}): DeliveryTiming => ({
  eventId: 'multiplier.scheduled:4663:0xups:1757000000',
  type: 'multiplier.scheduled',
  endpointId: 'exdate-receiver',
  announcedAt: ANNOUNCED,
  observedAt: ANNOUNCED + 20,
  deliveredAt: ANNOUNCED + 42,
  attempts: 1,
  ...over,
})

describe('summarizeLatency', () => {
  it('refuses to state a latency before a single real delivery', () => {
    const summary = summarizeLatency([])
    expect(summary.sufficient).toBe(false)
    expect(summary.notComputed).toBe('no_real_delivery_yet')
    expect(summary.announceToDeliver).toEqual({ n: 0, medianSeconds: null, minSeconds: null, maxSeconds: null })
  })

  it('still refuses when an event was written but nothing has accepted it', () => {
    // The outbox holding a queued row is not a delivery. Counting it would publish exdate's
    // intention to send as though it were a subscriber's experience.
    const summary = summarizeLatency([timing({ deliveredAt: null, attempts: 1 })])
    expect(summary.sufficient).toBe(false)
    expect(summary.pending).toBe(1)
    expect(summary.delivered).toBe(0)
    expect(summary.observeToDeliver.n).toBe(0)
  })

  it('reports one real delivery as one, and separates the three legs', () => {
    const summary = summarizeLatency([timing()])
    expect(summary.sufficient).toBe(true)
    expect(summary.delivered).toBe(1)
    expect(summary.announceToObserve).toMatchObject({ n: 1, medianSeconds: 20 })
    expect(summary.observeToDeliver).toMatchObject({ n: 1, medianSeconds: 22 })
    expect(summary.announceToDeliver).toMatchObject({ n: 1, medianSeconds: 42 })
  })

  it('counts a given-up delivery as failed rather than dropping it', () => {
    // Eight attempts is the outbox's ceiling. A latency computed over successes alone, with the
    // failures quietly absent, is the flattering version of the same number.
    const summary = summarizeLatency([timing(), timing({ eventId: 'b', deliveredAt: null, attempts: 8 })])
    expect(summary.failed).toBe(1)
    expect(summary.pending).toBe(0)
    expect(summary.delivered).toBe(1)
  })

  it('takes the lower middle on an even count, never an average of two observations', () => {
    const summary = summarizeLatency([
      timing({ eventId: 'a', deliveredAt: ANNOUNCED + 10 }),
      timing({ eventId: 'b', deliveredAt: ANNOUNCED + 30 }),
    ])
    expect(summary.announceToDeliver.medianSeconds).toBe(10)
    expect(summary.announceToDeliver.minSeconds).toBe(10)
    expect(summary.announceToDeliver.maxSeconds).toBe(30)
  })

  it('drops a negative duration rather than reporting a delivery that beat its own announcement', () => {
    const summary = summarizeLatency([timing({ deliveredAt: ANNOUNCED - 5 })])
    // Counted as delivered, because it was; excluded from every leg, because two clocks
    // disagreeing is not a measurement of speed.
    expect(summary.delivered).toBe(1)
    expect(summary.announceToDeliver.n).toBe(0)
    expect(summary.sufficient).toBe(true)
  })

  it('measures the outbox leg for an event with no on-chain instant behind it', () => {
    // multiplier.applied has no log: nothing is emitted when a change takes effect. So it has no
    // announce leg at all, and saying it was late by zero would be a claim about a fact that
    // does not exist.
    const summary = summarizeLatency([timing({ type: 'multiplier.applied', announcedAt: null })])
    expect(summary.announceToObserve.n).toBe(0)
    expect(summary.announceToDeliver.n).toBe(0)
    expect(summary.observeToDeliver).toMatchObject({ n: 1, medianSeconds: 22 })
  })
})

describe('announcedAtFromPayload', () => {
  it('reads the instant only from the one event type that has a log behind it', () => {
    const payload = JSON.stringify({ data: { announcedAt: '2026-09-04T15:00:41.000Z' } })
    expect(announcedAtFromPayload('multiplier.scheduled', payload)).toBe(ANNOUNCED)
    expect(announcedAtFromPayload('multiplier.applied', payload)).toBeNull()
    expect(announcedAtFromPayload('dividend.reconciled', payload)).toBeNull()
  })

  it('returns null rather than throwing on anything malformed', () => {
    expect(announcedAtFromPayload('multiplier.scheduled', 'not json')).toBeNull()
    expect(announcedAtFromPayload('multiplier.scheduled', '{}')).toBeNull()
    expect(announcedAtFromPayload('multiplier.scheduled', '{"data":{"announcedAt":null}}')).toBeNull()
    expect(announcedAtFromPayload('multiplier.scheduled', '{"data":{"announcedAt":"nope"}}')).toBeNull()
  })
})

describe('an outbox that is refusing, against one that has not run', () => {
  /**
   * Measured on 2026-09-06 against the live API: exdate's own subscriber had 45 deliveries at five
   * attempts each, every one answering `fetch failed` at the socket, and the published summary read
   * `pending: 45, notComputed: "no_real_delivery_yet"` - true, and identical to what an outbox
   * written a minute ago would say. The receiver had been unreachable for hours and the surface
   * everyone reads could not show it.
   */
  const refused = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      timing({ eventId: `dividend.pending:4663:${i}`, deliveredAt: null, attempts: 5, lastError: 'fetch failed', lastResponseStatus: null }),
    )

  it('says the deliveries were attempted and refused, not that none has happened yet', () => {
    const summary = summarizeLatency(refused(45))
    expect(summary.pending).toBe(45)
    expect(summary.sufficient).toBe(false)
    expect(summary.notComputed).toBe('deliveries_attempted_none_accepted')
    expect(summary.attempted).toEqual({
      neverAttempted: 0,
      triedNotAccepted: 45,
      lastError: 'fetch failed',
      lastResponseStatus: null,
    })
  })

  it('keeps saying nothing has been delivered yet when nothing has been tried', () => {
    const summary = summarizeLatency([timing({ deliveredAt: null, attempts: 0 })])
    expect(summary.notComputed).toBe('no_real_delivery_yet')
    expect(summary.attempted.neverAttempted).toBe(1)
    expect(summary.attempted.triedNotAccepted).toBe(0)
    expect(summary.attempted.lastError).toBeNull()
  })

  it('separates the two when the outbox holds both', () => {
    const summary = summarizeLatency([
      timing({ eventId: 'a', deliveredAt: null, attempts: 0 }),
      timing({ eventId: 'b', deliveredAt: null, attempts: 3, lastError: 'ECONNREFUSED', lastResponseStatus: null }),
    ])
    expect(summary.attempted.neverAttempted).toBe(1)
    expect(summary.attempted.triedNotAccepted).toBe(1)
    expect(summary.attempted.lastError).toBe('ECONNREFUSED')
  })

  it('reports the status of a subscriber that answers and rejects, not only one that refuses the socket', () => {
    // A subscriber whose signature check fails answers 400. That is a different problem from an
    // unreachable one and must not be reported as the same thing.
    const summary = summarizeLatency([
      timing({ deliveredAt: null, attempts: 2, lastError: 'HTTP 400', lastResponseStatus: 400 }),
    ])
    expect(summary.attempted.lastResponseStatus).toBe(400)
    expect(summary.notComputed).toBe('deliveries_attempted_none_accepted')
  })

  it('says nothing about attempts once a real delivery exists', () => {
    const summary = summarizeLatency([timing(), timing({ eventId: 'b', deliveredAt: null, attempts: 4, lastError: 'fetch failed' })])
    expect(summary.sufficient).toBe(true)
    expect(summary.notComputed).toBeNull()
    // Still counted, because a subscriber that accepts one delivery and refuses the next is not
    // healthy, and a summary that reported only the success would say it was.
    expect(summary.attempted.triedNotAccepted).toBe(1)
  })
})

describe('a leg with no sample, beside deliveries that exist', () => {
  /**
   * The state the outbox reached on 2026-09-06 the moment it was repaired: 45 deliveries accepted,
   * none of them a `multiplier.scheduled`, so the leg a subscriber experiences has nothing in it
   * while `sufficient` is true. Read as "sufficient means every figure is measured", that
   * published `a median null s over 45 real deliveries`.
   */
  const noAnnouncement = (over = {}) =>
    timing({ announcedAt: null, observedAt: 1_788_400_000, deliveredAt: 1_788_400_042, ...over })

  it('states the total leg as absent rather than as zero', () => {
    const summary = summarizeLatency([noAnnouncement({ eventId: 'a' }), noAnnouncement({ eventId: 'b' })])
    expect(summary.sufficient).toBe(true)
    expect(summary.delivered).toBe(2)
    // n is the field that says whether there is a figure at all; the median stays null.
    expect(summary.announceToDeliver).toEqual({ n: 0, medianSeconds: null, minSeconds: null, maxSeconds: null })
    expect(summary.observeToDeliver.n).toBe(2)
  })

  it('counts how many went out first time, which is what makes a median readable', () => {
    const summary = summarizeLatency([
      noAnnouncement({ eventId: 'a', attempts: 1 }),
      // Accepted on its sixth attempt: the duration carries the outage it waited through.
      noAnnouncement({ eventId: 'b', attempts: 6, deliveredAt: 1_788_409_987 }),
    ])
    expect(summary.delivered).toBe(2)
    expect(summary.deliveredFirstAttempt).toBe(1)
    expect(summary.observeToDeliver.maxSeconds).toBe(9987)
  })

  it('counts none when every delivery took a retry', () => {
    const summary = summarizeLatency([noAnnouncement({ attempts: 6 })])
    expect(summary.deliveredFirstAttempt).toBe(0)
  })
})
