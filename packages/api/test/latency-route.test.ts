import { describe, expect, it } from 'vitest'
import { createApi } from '../src/index.js'
import type { Repository, WebhookDeliveryRow, WebhookEventRow } from '../src/types.js'

/**
 * The route that says how long a webhook took, and - more often, for now - that it will not say.
 *
 * The claim this backs is the announcement lead: about nine to ten minutes between the chain
 * carrying a change and the change taking effect. A lead is only useful if the notice arrives
 * inside it, so the figure has to come from deliveries that happened. The refusal is therefore the
 * important case, not the edge case: for as long as nothing is subscribed, the honest answer is
 * `sufficient: false` with a reason, never a number derived from the poll interval.
 */

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const UPS = '0xf23250DAC154D05Bb671cB0d0eBEf3c635c79CE2'

/** UPS's real announcement of 2026-09-04: on chain 15:00:41, effective 15:10:26. */
const announcement: WebhookEventRow = {
  id: 'multiplier.scheduled:4663:0xups:1757000000',
  chainId: 4663,
  type: 'multiplier.scheduled',
  token: UPS,
  payload: JSON.stringify({
    type: 'multiplier.scheduled',
    data: { announcedAt: '2026-09-04T15:00:41.000Z', effectiveAt: '2026-09-04T15:10:26.000Z' },
  }),
  // Observed 20 seconds after the chain carried it.
  createdAt: at('2026-09-04T15:01:01Z'),
  createdBlock: 55_000_000n,
}

/** An applied multiplier: an observation by the poller, with no log and so no instant to be late against. */
const applied: WebhookEventRow = {
  id: 'multiplier.applied:4663:0xups:1757000626',
  chainId: 4663,
  type: 'multiplier.applied',
  token: UPS,
  payload: JSON.stringify({ type: 'multiplier.applied', data: { effectiveAt: '2026-09-04T15:10:26.000Z' } }),
  createdAt: at('2026-09-04T15:11:00Z'),
  createdBlock: 55_005_000n,
}

const delivery = (over: Partial<WebhookDeliveryRow> & { eventId: string; type: string }): WebhookDeliveryRow => ({
  id: `${over.eventId}|exdate-receiver`,
  chainId: 4663,
  endpointId: 'exdate-receiver',
  host: '127.0.0.1',
  status: 'delivered',
  attempts: 1,
  nextAttemptAt: at('2026-09-04T15:01:01Z'),
  lastAttemptAt: at('2026-09-04T15:01:23Z'),
  deliveredAt: at('2026-09-04T15:01:23Z'),
  responseStatus: 200,
  error: null,
  ...over,
})

const api = (events: WebhookEventRow[], deliveries: WebhookDeliveryRow[]) =>
  createApi({
    repository: {
      webhookEvents: async () => events,
      webhookDeliveries: async () => deliveries,
    } as unknown as Repository,
  })

const latency = async (events: WebhookEventRow[], deliveries: WebhookDeliveryRow[]) => {
  const response = await api(events, deliveries).request('/v1/4663/webhooks/latency')
  expect(response.status).toBe(200)
  return response.json() as Promise<Record<string, any>>
}

describe('GET /v1/:chain/webhooks/latency', () => {
  it('refuses to state a latency while nothing has ever been delivered', async () => {
    const body = await latency([announcement], [])
    expect(body.sufficient).toBe(false)
    expect(body.notComputed).toBe('no_real_delivery_yet')
    expect(body.announceToDeliver).toEqual({ n: 0, medianSeconds: null, minSeconds: null, maxSeconds: null })
    // The refusal must not read as speed: no leg carries a figure.
    expect(body.observeToDeliver.medianSeconds).toBeNull()
  })

  it('still refuses when the outbox holds a queued row', async () => {
    const body = await latency(
      [announcement],
      [delivery({ eventId: announcement.id, type: announcement.type, status: 'queued', deliveredAt: null })],
    )
    expect(body.sufficient).toBe(false)
    expect(body.pending).toBe(1)
    expect(body.delivered).toBe(0)
  })

  it('reports the three legs from one real delivery, and says what each one is', async () => {
    const body = await latency([announcement], [delivery({ eventId: announcement.id, type: announcement.type })])
    expect(body.sufficient).toBe(true)
    expect(body.delivered).toBe(1)
    expect(body.announceToObserve).toMatchObject({ n: 1, medianSeconds: 20 })
    expect(body.observeToDeliver).toMatchObject({ n: 1, medianSeconds: 22 })
    expect(body.announceToDeliver).toMatchObject({ n: 1, medianSeconds: 42 })
    expect(body.legs.announceToObserve).toMatch(/chain carried the announcement/)
    expect(body.basis).toMatch(/never derived from the poll interval|real deliveries only/)
  })

  it('gives an applied multiplier no announce leg, because there is no log behind it', async () => {
    // Nothing is emitted on chain when a change takes effect. Reporting a lag of zero there would
    // be a measurement against an instant that does not exist.
    const body = await latency([applied], [delivery({ eventId: applied.id, type: applied.type, deliveredAt: at('2026-09-04T15:11:30Z') })])
    expect(body.announceToObserve.n).toBe(0)
    expect(body.announceToDeliver.n).toBe(0)
    expect(body.observeToDeliver).toMatchObject({ n: 1, medianSeconds: 30 })
  })

  it('breaks the figures down by event type, so one slow type cannot hide inside the median', async () => {
    const body = await latency(
      [announcement, applied],
      [
        delivery({ eventId: announcement.id, type: announcement.type }),
        delivery({ eventId: applied.id, type: applied.type, deliveredAt: at('2026-09-04T15:11:30Z') }),
      ],
    )
    expect(body.byType.map((row: { type: string }) => row.type)).toEqual(['multiplier.applied', 'multiplier.scheduled'])
    const scheduled = body.byType.find((row: { type: string }) => row.type === 'multiplier.scheduled')
    expect(scheduled.announceToDeliver).toMatchObject({ n: 1, medianSeconds: 42 })
  })

  it('leaves out a delivery whose event has aged out of the outbox', async () => {
    // Without the event there is no observation instant, so the row would have to be measured
    // from itself. Dropped, and visible as a delivery count that does not reach any leg's n.
    const body = await latency([], [delivery({ eventId: announcement.id, type: announcement.type })])
    expect(body.delivered).toBe(0)
    expect(body.sufficient).toBe(false)
  })

  it('404s on an unknown chain like every other route', async () => {
    const response = await api([], []).request('/v1/999/webhooks/latency')
    expect(response.status).toBe(404)
  })
})
