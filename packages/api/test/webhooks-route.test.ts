import { describe, expect, it } from 'vitest'
import { verifySignature, signBody, WEBHOOK_SIGNATURE_HEADER } from '@exdate/core'
import { createApi } from '../src/index.js'
import type { Repository, WebhookDeliveryRow, WebhookEventRow } from '../src/types.js'

/**
 * Two things are checked here that a shape test alone would miss: that the
 * scheme the catalogue advertises actually verifies a body signed with it, and
 * that no endpoint URL or secret reaches the response - the outbox is served
 * publicly, and a leaked signing secret would let anyone forge deliveries.
 */

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const SECRET = 'whsec_0123456789abcdef0123456789abcdef'
const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'

const payload = JSON.stringify({
  id: 'dividend.reconciled:4663:0x000...:2026-08-06',
  type: 'dividend.reconciled',
  chainId: 4663,
  observedAt: '2026-09-02T18:34:20.000Z',
  token: { address: SGOV, symbol: 'SGOV' },
  data: { impliedHaircutBps: 3378, status: 'matched' },
})

const event: WebhookEventRow = {
  id: 'dividend.reconciled:4663:0x000...:2026-08-06',
  chainId: 4663,
  type: 'dividend.reconciled',
  token: SGOV,
  payload,
  createdAt: at('2026-09-02T18:34:20Z'),
  createdBlock: 52_788_670n,
}

const delivered: WebhookDeliveryRow = {
  id: `${event.id}|curator`,
  chainId: 4663,
  eventId: event.id,
  type: event.type,
  endpointId: 'curator',
  host: 'hooks.example.test',
  status: 'delivered',
  attempts: 2,
  nextAttemptAt: at('2026-09-02T18:34:20Z'),
  lastAttemptAt: at('2026-09-02T18:35:00Z'),
  deliveredAt: at('2026-09-02T18:35:00Z'),
  responseStatus: 200,
  error: null,
}

const repository: Repository = {
  tokens: async () => [],
  token: async () => null,
  multiplierEvents: async () => [],
  corporateActions: async () => [],
  reconciliations: async () => [],
  webhookEvents: async () => [event],
  webhookDeliveries: async () => [delivered],
}

const app = createApi({
  repository,
  now: () => at('2026-09-02T18:45:00Z'),
  webhookEndpointsConfigured: 1,
})

describe('GET /v1/webhooks', () => {
  it('publishes the seven event types and the signing scheme', async () => {
    const body = await (await app.request('/v1/webhooks')).json()
    expect(body.events).toHaveLength(7)
    expect(body.signature).toMatchObject({
      algorithm: 'HMAC-SHA256',
      header: WEBHOOK_SIGNATURE_HEADER,
      toleranceSeconds: 300,
    })
    expect(body.retries.maxAttempts).toBeGreaterThan(1)
    expect(body.endpointsConfigured).toBe(1)
  })

  it('advertises a scheme that verifies a real signature', async () => {
    const body = await (await app.request('/v1/webhooks')).json()
    const timestamp = 1_788_373_934
    const header = await signBody({ secret: SECRET, timestamp, body: payload })
    expect(header.startsWith('t=')).toBe(true)
    expect(
      await verifySignature({
        secret: SECRET,
        header,
        body: payload,
        nowSeconds: timestamp + 10,
        toleranceSeconds: body.signature.toleranceSeconds,
      }),
    ).toEqual({ valid: true })
  })
})

describe('GET /v1/:chain/webhooks/events', () => {
  it('serves the outbox with its delivery attempts and the signed bytes', async () => {
    const response = await app.request('/v1/robinhood/webhooks/events')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.counts).toMatchObject({ events: 1, deliveries: 1, delivered: 1, queued: 0, failed: 0 })
    const [row] = body.events
    expect(row.type).toBe('dividend.reconciled')
    expect(row.payload.data.impliedHaircutBps).toBe(3378)
    // The raw string is what the signature covers, so it is served verbatim.
    expect(row.signedBody).toBe(payload)
    expect(row.deliveries[0]).toMatchObject({ endpointId: 'curator', host: 'hooks.example.test', attempts: 2 })
  })

  it('never serves an endpoint url or a secret', async () => {
    const text = await (await app.request('/v1/robinhood/webhooks/events')).text()
    expect(text).not.toContain('whsec_')
    expect(text).not.toContain('https://hooks.example.test')
  })

  it('filters by type and by delivery status', async () => {
    const byType = await (await app.request('/v1/robinhood/webhooks/events?type=feed.stale')).json()
    expect(byType.events).toHaveLength(0)
    expect(byType.counts.events).toBe(1) // the totals stay whole under a filter

    const byStatus = await (await app.request('/v1/robinhood/webhooks/events?status=queued')).json()
    expect(byStatus.events).toHaveLength(0)
    const delivered = await (await app.request('/v1/robinhood/webhooks/events?status=delivered')).json()
    expect(delivered.events).toHaveLength(1)
  })

  it('is a 404 for an unknown chain', async () => {
    expect((await app.request('/v1/base/webhooks/events')).status).toBe(404)
  })
})
