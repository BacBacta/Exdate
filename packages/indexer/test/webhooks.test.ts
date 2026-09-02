import { getTableName } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBHOOK_RETRY_SCHEDULE_SECONDS, verifySignature } from '@exdate/core'

/**
 * The webhook outbox, tested as plain code.
 *
 * The poller and the gap sweep need a chain and a Ponder process, so they are
 * exercised by running the indexer. The outbox does not: it is bookkeeping over
 * two tables plus one `fetch`, and it is where the behaviour a consumer depends
 * on lives - exactly-once emission, the retry ladder, giving up, and never
 * sending a body that differs from the one that was signed.
 *
 * `context.db` is doubled by the small store below. It implements only the four
 * calls the module makes, which is the point: a double that implemented more
 * would be asserting things about Ponder rather than about this code.
 */

const SECRET = 'whsec_0123456789abcdef0123456789abcdef'
const ENDPOINT = { id: 'curator', url: 'https://hooks.example.test/exdate', secret: SECRET }
const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5' as const
const NOW = 1_788_373_934n

const EVENTS = 'webhook_events'
const DELIVERIES = 'webhook_deliveries'

/**
 * A Ponder-shaped store over two Maps, keyed the way both tables are: on `id`.
 *
 * Tables are looked up by their SQL name rather than by object identity,
 * because each case re-imports the module under test and therefore gets its
 * own instance of the schema.
 */
function fakeDb() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>([
    [EVENTS, new Map()],
    [DELIVERIES, new Map()],
  ])
  const rowsOf = (table: unknown) => {
    const rows = tables.get(getTableName(table as never))
    if (!rows) throw new Error(`unknown table ${getTableName(table as never)}`)
    return rows
  }
  return {
    tables,
    // What the module receives: a context whose `db` is this store.
    context: {
      db: {
        insert: (table: unknown) => ({
          values: (row: Record<string, unknown>) => ({
            onConflictDoNothing: async () => {
              const rows = rowsOf(table)
              const id = String(row.id)
              if (rows.has(id)) return null
              rows.set(id, { ...row })
              return { ...row }
            },
          }),
        }),
        update: (table: unknown, key: { id: string }) => ({
          set: async (patch: Record<string, unknown>) => {
            const rows = rowsOf(table)
            rows.set(key.id, { ...(rows.get(key.id) ?? {}), ...patch })
          },
        }),
        sql: {
          select: () => ({
            from: async (table: unknown) => [...rowsOf(table).values()],
          }),
        },
      },
    },
  }
}

const enqueueInput = (overrides: Record<string, unknown> = {}) => ({
  chainId: 4663,
  type: 'dividend.reconciled' as const,
  subject: 'action-1',
  token: { address: SGOV, symbol: 'SGOV' },
  now: NOW,
  data: {
    actionId: 'action-1',
    processDate: '2026-08-06',
    grossPerUnderlyingShare: '0.306812',
    effectiveAt: '2026-08-07T15:10:24.000Z',
    lagDays: 1,
    observedStepBps: 20.2206328995484,
    expectedStepBps: 30.53615327227618,
    impliedHaircutBps: 3378,
    status: 'matched',
    confidence: 'low',
    note: null,
    priceSource: 'chainlink:getRoundData',
  },
  ...overrides,
})

/** The module reads its endpoints at import, so each case imports it fresh. */
async function load(endpoints: unknown[] | undefined) {
  vi.resetModules()
  if (endpoints === undefined) delete process.env.EXDATE_WEBHOOK_ENDPOINTS
  else process.env.EXDATE_WEBHOOK_ENDPOINTS = JSON.stringify(endpoints)
  return import('../src/webhooks.js')
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})
beforeEach(() => {
  delete process.env.EXDATE_WEBHOOK_ENDPOINTS
})

describe('recording an occurrence', () => {
  it('writes the event once, however many times it is noticed', async () => {
    const { enqueueWebhook } = await load([ENDPOINT])
    const { context, tables } = fakeDb()

    expect(await enqueueWebhook(context as never, enqueueInput())).toBe(true)
    // The live indexer and the poller both see a schedule; the second is a no-op.
    expect(await enqueueWebhook(context as never, enqueueInput())).toBe(false)

    expect(tables.get(EVENTS)!.size).toBe(1)
    expect(tables.get(DELIVERIES)!.size).toBe(1)
  })

  it('records the event even with no endpoint configured', async () => {
    // Otherwise the outbox would be empty exactly when an operator asks
    // "did anything happen while nobody was listening?".
    const { enqueueWebhook } = await load(undefined)
    const { context, tables } = fakeDb()
    await enqueueWebhook(context as never, enqueueInput())
    expect(tables.get(EVENTS)!.size).toBe(1)
    expect(tables.get(DELIVERIES)!.size).toBe(0)
  })

  it('fans out only to the endpoints subscribed to that type', async () => {
    const { enqueueWebhook } = await load([
      { ...ENDPOINT, id: 'all' },
      { ...ENDPOINT, id: 'feeds-only', events: ['feed.stale'] },
    ])
    const { context, tables } = fakeDb()
    await enqueueWebhook(context as never, enqueueInput())
    expect([...tables.get(DELIVERIES)!.values()].map((row) => row.endpointId)).toEqual(['all'])
  })

  it('stores the host, never the url or the secret', async () => {
    const { enqueueWebhook } = await load([ENDPOINT])
    const { context, tables } = fakeDb()
    await enqueueWebhook(context as never, enqueueInput())
    const delivery = [...tables.get(DELIVERIES)!.values()][0]!
    expect(delivery.host).toBe('hooks.example.test')
    const serialised = JSON.stringify(delivery, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
    expect(serialised).not.toContain('whsec_')
    expect(serialised).not.toContain('/exdate')
  })
})

describe('delivering', () => {
  const capture = () => {
    const sent: { url: string; headers: Record<string, string>; body: string }[] = []
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      sent.push({
        url: String(input),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      })
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    return sent
  }

  it('signs the exact bytes it stored, so the delivery verifies', async () => {
    const { enqueueWebhook, deliverDueWebhooks } = await load([ENDPOINT])
    const { context, tables } = fakeDb()
    const sent = capture()

    await enqueueWebhook(context as never, enqueueInput())
    expect(await deliverDueWebhooks(context as never, NOW)).toBe(1)

    const delivery = sent[0]!
    const stored = [...tables.get(EVENTS)!.values()][0]!
    expect(delivery.body).toBe(stored.payload)
    expect(
      await verifySignature({
        secret: SECRET,
        header: delivery.headers['exdate-signature'],
        body: delivery.body,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: true })
    expect(delivery.headers['exdate-event']).toBe('dividend.reconciled')
    expect(delivery.headers['exdate-event-id']).toBe('dividend.reconciled:4663:action-1')
  })

  it('marks a delivered row and never sends it twice', async () => {
    const { enqueueWebhook, deliverDueWebhooks } = await load([ENDPOINT])
    const { context, tables } = fakeDb()
    const sent = capture()

    await enqueueWebhook(context as never, enqueueInput())
    await deliverDueWebhooks(context as never, NOW)
    expect(await deliverDueWebhooks(context as never, NOW + 60n)).toBe(0)
    expect(sent).toHaveLength(1)

    const row = [...tables.get(DELIVERIES)!.values()][0]!
    expect(row).toMatchObject({ status: 'delivered', attempts: 1, responseStatus: 200 })
  })

  it('backs off on failure, then gives up and keeps the row', async () => {
    const { enqueueWebhook, deliverDueWebhooks } = await load([ENDPOINT])
    const { context, tables } = fakeDb()
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 })) as typeof fetch

    await enqueueWebhook(context as never, enqueueInput())
    const row = () => [...tables.get(DELIVERIES)!.values()][0]!

    let clock = NOW
    for (const [attempt, delay] of WEBHOOK_RETRY_SCHEDULE_SECONDS.entries()) {
      expect(await deliverDueWebhooks(context as never, clock)).toBe(1)
      expect(row()).toMatchObject({ status: 'queued', attempts: attempt + 1, responseStatus: 503 })
      // Nothing is retried before its time.
      expect(await deliverDueWebhooks(context as never, clock + BigInt(delay) - 1n)).toBe(0)
      clock += BigInt(delay)
    }

    // The last attempt of the ladder gives up rather than retrying forever.
    expect(await deliverDueWebhooks(context as never, clock)).toBe(1)
    expect(row()).toMatchObject({
      status: 'failed',
      attempts: WEBHOOK_RETRY_SCHEDULE_SECONDS.length + 1,
      error: 'HTTP 503',
    })
    // Kept, not deleted: a consumer that was down should see what it missed.
    expect(tables.get(DELIVERIES)!.size).toBe(1)
    expect(await deliverDueWebhooks(context as never, clock + 86_400n)).toBe(0)
  })

  it('records a transport failure without leaking the url', async () => {
    const { enqueueWebhook, deliverDueWebhooks } = await load([ENDPOINT])
    const { context, tables } = fakeDb()
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as typeof fetch

    await enqueueWebhook(context as never, enqueueInput())
    await deliverDueWebhooks(context as never, NOW)
    const row = [...tables.get(DELIVERIES)!.values()][0]!
    expect(row.status).toBe('queued')
    expect(row.error).toContain('ECONNREFUSED')
    expect(row.nextAttemptAt).toBe(NOW + 30n)
  })

  it('does nothing at all when no endpoint is configured', async () => {
    const { deliverDueWebhooks } = await load(undefined)
    const { context } = fakeDb()
    const sent = capture()
    expect(await deliverDueWebhooks(context as never, NOW)).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('caps how many it attempts in one poll', async () => {
    process.env.EXDATE_WEBHOOK_MAX_PER_POLL = '2'
    const { enqueueWebhook, deliverDueWebhooks } = await load([ENDPOINT])
    const { context } = fakeDb()
    capture()
    for (let i = 0; i < 5; i++) {
      await enqueueWebhook(context as never, enqueueInput({ subject: `action-${i}` }))
    }
    expect(await deliverDueWebhooks(context as never, NOW)).toBe(2)
    expect(await deliverDueWebhooks(context as never, NOW)).toBe(2)
    expect(await deliverDueWebhooks(context as never, NOW)).toBe(1)
    delete process.env.EXDATE_WEBHOOK_MAX_PER_POLL
  })

  it('leaves the queue of an endpoint that was removed from the configuration', async () => {
    const { enqueueWebhook } = await load([ENDPOINT])
    const { context, tables } = fakeDb()
    await enqueueWebhook(context as never, enqueueInput())

    // Restart with the endpoint gone: the row stays visible, nothing is sent.
    const { deliverDueWebhooks } = await load([{ ...ENDPOINT, id: 'someone-else' }])
    const sent = capture()
    expect(await deliverDueWebhooks(context as never, NOW)).toBe(0)
    expect(sent).toHaveLength(0)
    expect([...tables.get(DELIVERIES)!.values()][0]).toMatchObject({ status: 'queued' })
  })
})
