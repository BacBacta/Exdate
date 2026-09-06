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
