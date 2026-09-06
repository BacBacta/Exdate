import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DeliveryJournal, DeliveryJournalEntry } from '@exdate/core'
import { FileDeliveryJournal } from '../../indexer/src/latency-journal.js'
import { createApi } from '../src/index.js'
import type { Repository, WebhookDeliveryRow, WebhookEventRow } from '../src/types.js'

/**
 * The journal exists for one scenario, so the tests are that scenario.
 *
 * `deploy/update-api.sh` drops the Ponder schema whenever a code deploy changes its build id, and
 * on 2026-09-06 that took every delivery row with it. Token states and reconciliations coming back
 * is fine - the poller recomputes them from the chain. A delivery is not derived: it happened once,
 * at an instant, and nothing recreates it. So what is asserted below is that the published latency
 * survives the drop, and says which source it came from either way.
 */
const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const dir = mkdtempSync(join(tmpdir(), 'exdate-journal-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const announcement: WebhookEventRow = {
  id: 'multiplier.scheduled:4663:0xups:1757000000',
  chainId: 4663,
  type: 'multiplier.scheduled',
  token: '0xf23250DAC154D05Bb671cB0d0eBEf3c635c79CE2',
  payload: JSON.stringify({ type: 'multiplier.scheduled', data: { announcedAt: '2026-09-04T15:00:41.000Z' } }),
  createdAt: at('2026-09-04T15:01:01Z'),
  createdBlock: 55_000_000n,
}

const delivered: WebhookDeliveryRow = {
  id: `${announcement.id}|exdate-receiver`,
  chainId: 4663,
  eventId: announcement.id,
  type: announcement.type,
  endpointId: 'exdate-receiver',
  host: '127.0.0.1',
  status: 'delivered',
  attempts: 1,
  nextAttemptAt: at('2026-09-04T15:01:01Z'),
  lastAttemptAt: at('2026-09-04T15:01:23Z'),
  deliveredAt: at('2026-09-04T15:01:23Z'),
  responseStatus: 200,
  error: null,
}

const entry: DeliveryJournalEntry = {
  eventId: announcement.id,
  type: announcement.type,
  endpointId: 'exdate-receiver',
  endpointHost: '127.0.0.1',
  announcedAt: Math.floor(Date.parse('2026-09-04T15:00:41.000Z') / 1000),
  observedAt: Number(announcement.createdAt),
  deliveredAt: Number(delivered.deliveredAt),
  attempts: 1,
  responseStatus: 200,
  outcome: 'delivered',
  recordedAt: '2026-09-04T15:01:23.000Z',
}

const api = (events: WebhookEventRow[], deliveries: WebhookDeliveryRow[], journal?: DeliveryJournal) =>
  createApi({
    repository: { webhookEvents: async () => events, webhookDeliveries: async () => deliveries } as unknown as Repository,
    deliveryJournal: journal,
  })

const latency = async (events: WebhookEventRow[], deliveries: WebhookDeliveryRow[], journal?: DeliveryJournal) =>
  (await api(events, deliveries, journal).request('/v1/4663/webhooks/latency')).json() as Promise<Record<string, any>>

describe('the latency survives a schema drop', () => {
  it('measures from the outbox when the journal is empty, and says so', async () => {
    const empty = new FileDeliveryJournal(join(dir, 'empty.jsonl'))
    const body = await latency([announcement], [delivered], empty)
    expect(body.source).toBe('outbox')
    expect(body.delivered).toBe(1)
    expect(body.announceToDeliver).toMatchObject({ n: 1, medianSeconds: 42 })
  })

  it('still measures after the drop takes every table row, and says the source changed', async () => {
    // The drop, exactly: no events, no deliveries. Only the journal is left.
    const journal = new FileDeliveryJournal(join(dir, 'survives.jsonl'))
    await journal.append(entry)
    const body = await latency([], [], journal)
    expect(body.source).toBe('journal')
    expect(body.delivered).toBe(1)
    expect(body.sufficient).toBe(true)
    // Every leg intact: the journal carries the instants rather than pointing at the event row,
    // which is the row the drop removed.
    expect(body.announceToObserve).toMatchObject({ n: 1, medianSeconds: 20 })
    expect(body.observeToDeliver).toMatchObject({ n: 1, medianSeconds: 22 })
    expect(body.announceToDeliver).toMatchObject({ n: 1, medianSeconds: 42 })
  })

  it('does not count a delivery twice when it is in both the journal and the outbox', async () => {
    const journal = new FileDeliveryJournal(join(dir, 'both.jsonl'))
    await journal.append(entry)
    const body = await latency([announcement], [delivered], journal)
    expect(body.delivered).toBe(1)
    expect(body.announceToDeliver.n).toBe(1)
  })

  it('counts a delivery still queued in the outbox beside the journal it is not in', async () => {
    const journal = new FileDeliveryJournal(join(dir, 'inflight.jsonl'))
    await journal.append(entry)
    const queued: WebhookDeliveryRow = { ...delivered, id: 'q|exdate-receiver', eventId: 'q', status: 'queued', deliveredAt: null }
    const other: WebhookEventRow = { ...announcement, id: 'q' }
    const body = await latency([announcement, other], [delivered, queued], journal)
    expect(body.delivered).toBe(1)
    expect(body.pending).toBe(1)
  })

  it('keeps the refusal when the journal holds only a failure', async () => {
    // A give-up is a real outcome and is counted, but it is not a delivery: the figure stays refused.
    const journal = new FileDeliveryJournal(join(dir, 'failed.jsonl'))
    await journal.append({ ...entry, outcome: 'failed', deliveredAt: null, attempts: 8, responseStatus: 500 })
    const body = await latency([], [], journal)
    expect(body.failed).toBe(1)
    expect(body.delivered).toBe(0)
    expect(body.sufficient).toBe(false)
    expect(body.notComputed).toBe('no_real_delivery_yet')
  })
})

describe('FileDeliveryJournal', () => {
  it('survives a line a killed process left half-written', async () => {
    const path = join(dir, 'torn.jsonl')
    const journal = new FileDeliveryJournal(path)
    await journal.append(entry)
    await journal.append({ ...entry, eventId: 'second' })
    const { appendFileSync } = await import('node:fs')
    appendFileSync(path, '{"eventId":"third","obser')
    const rows = await journal.list()
    // One unreadable line must not cost the other two: every whole line is still a fact.
    expect(rows.map((row) => row.eventId)).toEqual([entry.eventId, 'second'])
  })

  it('reads an absent file as no deliveries rather than throwing', async () => {
    expect(await new FileDeliveryJournal(join(dir, 'nope.jsonl')).list()).toEqual([])
  })
})
