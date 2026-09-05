import { describe, expect, it } from 'vitest'
import { verifySignature, WEBHOOK_SIGNATURE_HEADER } from '@exdate/core'
import { createApi } from '../src/index.js'
import { MemorySubscriptionStore, SUBSCRIPTION_SECRET_HEADER, isPrivateHost, validateSubscriptionUrl } from '../src/subscriptions.js'
import type { Repository, WebhookDeliveryRow, WebhookEventRow } from '../src/types.js'

/**
 * Self-service subscriptions, end to end through the routes: what is
 * refused and why, that the secret is shown once and then identifies the
 * subscriber, that a wrong secret and an unknown id answer alike, and that a
 * test delivery is a real recorded payload the receiver can verify with the
 * secret it was given.
 */

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'

const payload = JSON.stringify({
  id: 'dividend.reconciled:4663:sgov:2026-08-06',
  type: 'dividend.reconciled',
  chainId: 4663,
  observedAt: '2026-09-02T18:34:20.000Z',
  token: { address: SGOV, symbol: 'SGOV' },
  data: { impliedHaircutBps: 3378, status: 'matched' },
})
const event: WebhookEventRow = {
  id: 'dividend.reconciled:4663:sgov:2026-08-06',
  chainId: 4663,
  type: 'dividend.reconciled',
  token: SGOV,
  payload,
  createdAt: at('2026-09-02T18:34:20Z'),
  createdBlock: 52_788_670n,
}

function harness(options: { deliveries?: WebhookDeliveryRow[]; store?: MemorySubscriptionStore | null; allowPrivate?: boolean } = {}) {
  const store = options.store === undefined ? new MemorySubscriptionStore() : options.store
  const sent: { url: string; init: RequestInit }[] = []
  let clock = Date.parse('2026-09-05T16:00:00Z')
  const repository: Repository = {
    tokens: async () => [],
    token: async () => null,
    multiplierEvents: async () => [],
    corporateActions: async () => [],
    reconciliations: async () => [],
    webhookEvents: async () => [event],
    webhookDeliveries: async () => options.deliveries ?? [],
  }
  const app = createApi({
    repository,
    now: () => BigInt(Math.floor(clock / 1000)),
    nowMs: () => clock,
    webhookEndpointsConfigured: () => 1 + (store ? 1 : 0),
    subscriptions: store ?? undefined,
    subscriptionPolicy: { allowPrivate: options.allowPrivate ?? false, maxPerHost: 2, signupsPerHourPerClient: 3 },
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), init: init ?? {} })
      return new Response('ok', { status: 200 })
    }) as typeof fetch,
    clientAddress: () => '203.0.113.7',
  })
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) as RequestInit
  return { app, store, sent, json, advance: (ms: number) => (clock += ms) }
}

describe('POST /v1/webhooks/subscriptions', () => {
  it('creates a subscription and shows the secret once', async () => {
    const { app, store, json } = harness()
    const response = await app.request('/v1/webhooks/subscriptions', json({ url: 'https://hooks.example.test/exdate', events: ['dividend.reconciled'] }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.id).toMatch(/^sub_[0-9a-f]{24}$/)
    expect(body.secret).toMatch(/^whsec_[0-9a-f]{64}$/)
    expect(body.host).toBe('hooks.example.test')
    expect(body.events).toEqual(['dividend.reconciled'])
    expect(body.status).toBe('active')
    expect(body.secretHeader).toBe(SUBSCRIPTION_SECRET_HEADER)
    expect((await store!.list())[0]!.createdFrom).toBe('203.0.113.7')
    // Read back: the secret is never repeated.
    const read = await app.request(`/v1/webhooks/subscriptions/${body.id}`, { headers: { [SUBSCRIPTION_SECRET_HEADER]: body.secret } })
    expect(read.status).toBe(200)
    const view = await read.json()
    expect(view).not.toHaveProperty('secret')
    expect(view.deliveries).toEqual({ queued: 0, delivered: 0, failed: 0, lastDeliveredAt: null })
  })

  it('refuses http, private hosts, credentials and unknown event types', async () => {
    const { app, json } = harness()
    const cases: [Record<string, unknown>, string][] = [
      [{ url: 'http://hooks.example.test/x' }, 'https'],
      [{ url: 'https://localhost/x' }, 'public host'],
      [{ url: 'https://10.0.0.5/x' }, 'public host'],
      [{ url: 'https://[::1]/x' }, 'public host'],
      [{ url: 'https://user:pw@hooks.example.test/x' }, 'credentials'],
      [{ url: 'https://hooks.example.test/x', events: ['dividend.paid'] }, 'unknown event type'],
      [{ url: 'https://hooks.example.test/x', events: [] }, 'at least one'],
      [{ url: 'https://hooks.example.test/x', description: 'x'.repeat(201) }, 'description'],
      [{}, 'url is required'],
    ]
    for (const [body, reason] of cases) {
      const response = await app.request('/v1/webhooks/subscriptions', json(body))
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect((await response.json()).error, JSON.stringify(body)).toContain(reason)
    }
    const notJson = await app.request('/v1/webhooks/subscriptions', { method: 'POST', body: 'nope' })
    expect(notJson.status).toBe(400)
  })

  it('allows a private host only when the operator says so', async () => {
    const { app, json } = harness({ allowPrivate: true })
    const response = await app.request('/v1/webhooks/subscriptions', json({ url: 'http://localhost:9999/hook' }))
    expect(response.status).toBe(201)
  })

  it('caps active subscriptions per host, and signups per client per hour', async () => {
    const { app, json, advance } = harness()
    expect((await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/1' }))).status).toBe(201)
    expect((await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/2' }))).status).toBe(201)
    const third = await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/3' }))
    expect(third.status).toBe(409)
    // Three signups have been taken this hour (the refused one counted): the next is 429 for an hour.
    const fourth = await app.request('/v1/webhooks/subscriptions', json({ url: 'https://b.example.test/1' }))
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('retry-after')).toBe('3600')
    advance(3_600_001)
    expect((await app.request('/v1/webhooks/subscriptions', json({ url: 'https://b.example.test/1' }))).status).toBe(201)
  })

  it('answers 501 when the instance keeps no store, and the catalogue says so', async () => {
    const { app, json } = harness({ store: null })
    expect((await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/1' }))).status).toBe(501)
    expect((await (await app.request('/v1/webhooks')).json()).selfService).toBeNull()
  })
})

describe('managing a subscription with its secret', () => {
  it('answers 404 alike for a wrong secret and an unknown id', async () => {
    const { app, json } = harness()
    const created = await (await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/1' }))).json()
    const wrong = await app.request(`/v1/webhooks/subscriptions/${created.id}`, { headers: { [SUBSCRIPTION_SECRET_HEADER]: 'whsec_' + '0'.repeat(64) } })
    const unknown = await app.request('/v1/webhooks/subscriptions/sub_000000000000000000000000', { headers: { [SUBSCRIPTION_SECRET_HEADER]: created.secret } })
    const missing = await app.request(`/v1/webhooks/subscriptions/${created.id}`)
    expect([wrong.status, unknown.status, missing.status]).toEqual([404, 404, 404])
    expect(await wrong.json()).toEqual(await unknown.json())
  })

  it('revokes, and a revoked subscription reads as revoked and cannot be tested', async () => {
    const { app, json } = harness()
    const created = await (await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/1' }))).json()
    const headers = { [SUBSCRIPTION_SECRET_HEADER]: created.secret }
    const revoked = await app.request(`/v1/webhooks/subscriptions/${created.id}`, { method: 'DELETE', headers })
    expect(revoked.status).toBe(200)
    expect((await revoked.json()).status).toBe('revoked')
    const again = await (await app.request(`/v1/webhooks/subscriptions/${created.id}`, { method: 'DELETE', headers })).json()
    expect(again.revokedNow).toBe(false)
    const read = await (await app.request(`/v1/webhooks/subscriptions/${created.id}`, { headers })).json()
    expect(read.status).toBe('revoked')
    expect((await app.request(`/v1/webhooks/subscriptions/${created.id}/test`, { method: 'POST', headers })).status).toBe(409)
  })

  it('counts the outbox deliveries for this endpoint', async () => {
    const store = new MemorySubscriptionStore()
    const { app, json } = harness({ store })
    const created = await (await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/1' }))).json()
    const deliveries: WebhookDeliveryRow[] = [
      { id: `${event.id}|${created.id}`, chainId: 4663, eventId: event.id, type: event.type, endpointId: created.id, host: 'a.example.test', status: 'delivered', attempts: 1, nextAttemptAt: 0n, lastAttemptAt: at('2026-09-05T16:10:00Z'), deliveredAt: at('2026-09-05T16:10:00Z'), responseStatus: 200, error: null },
      { id: `other|${created.id}`, chainId: 4663, eventId: 'other', type: event.type, endpointId: created.id, host: 'a.example.test', status: 'failed', attempts: 8, nextAttemptAt: 0n, lastAttemptAt: 0n, deliveredAt: null, responseStatus: 503, error: 'HTTP 503' },
      { id: `${event.id}|someone-else`, chainId: 4663, eventId: event.id, type: event.type, endpointId: 'someone-else', host: 'b.example.test', status: 'queued', attempts: 0, nextAttemptAt: 0n, lastAttemptAt: null, deliveredAt: null, responseStatus: null, error: null },
    ]
    const withDeliveries = harness({ store, deliveries })
    const read = await (await withDeliveries.app.request(`/v1/webhooks/subscriptions/${created.id}`, { headers: { [SUBSCRIPTION_SECRET_HEADER]: created.secret } })).json()
    expect(read.deliveries).toEqual({ queued: 0, delivered: 1, failed: 1, lastDeliveredAt: '2026-09-05T16:10:00.000Z' })
  })
})

describe('POST /v1/webhooks/subscriptions/:id/test', () => {
  it('replays the most recent recorded event, signed with the subscription secret', async () => {
    const { app, json, sent } = harness()
    const created = await (await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/hook', events: ['dividend.reconciled'] }))).json()
    const response = await app.request(`/v1/webhooks/subscriptions/${created.id}/test`, { method: 'POST', headers: { [SUBSCRIPTION_SECRET_HEADER]: created.secret } })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.ok).toBe(true)
    expect(result.eventId).toBe(event.id)
    expect(result.responseStatus).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('https://a.example.test/hook')
    const headers = sent[0]!.init.headers as Record<string, string>
    expect(sent[0]!.init.body).toBe(payload)
    expect(headers['exdate-delivery']).toBe(`test|${created.id}|${event.id}`)
    // The receiver verifies with the secret it was given, over the bytes it received.
    const verdict = await verifySignature({ secret: created.secret, header: headers[WEBHOOK_SIGNATURE_HEADER]!, body: String(sent[0]!.init.body), nowSeconds: Math.floor(Date.parse('2026-09-05T16:00:10Z') / 1000) })
    expect(verdict.valid).toBe(true)
    const forged = await verifySignature({ secret: 'whsec_' + 'f'.repeat(64), header: headers[WEBHOOK_SIGNATURE_HEADER]!, body: String(sent[0]!.init.body), nowSeconds: Math.floor(Date.parse('2026-09-05T16:00:10Z') / 1000) })
    expect(forged.valid).toBe(false)
  })

  it('says when there is nothing this subscription would receive', async () => {
    const { app, json } = harness()
    const created = await (await app.request('/v1/webhooks/subscriptions', json({ url: 'https://a.example.test/hook', events: ['feed.stale'] }))).json()
    const response = await app.request(`/v1/webhooks/subscriptions/${created.id}/test`, { method: 'POST', headers: { [SUBSCRIPTION_SECRET_HEADER]: created.secret } })
    expect(response.status).toBe(409)
  })
})

describe('the host policy', () => {
  it('names every private and loopback form', () => {
    for (const host of ['localhost', 'app.localhost', 'db.internal', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '224.0.0.1']) {
      expect(isPrivateHost(host), host).toBe(true)
    }
    for (const host of ['hooks.example.test', '8.8.8.8', '172.32.0.1', '2606:4700::1111', 'example.local.example.com']) {
      expect(isPrivateHost(host), host).toBe(false)
    }
  })

  it('validates a URL the way the route does', () => {
    expect(validateSubscriptionUrl('https://hooks.example.test/a?b=1')).toMatchObject({ ok: true })
    expect(validateSubscriptionUrl('https://hooks.example.test/a#frag')).toMatchObject({ ok: false })
    expect(validateSubscriptionUrl('ftp://hooks.example.test/a')).toMatchObject({ ok: false })
    expect(validateSubscriptionUrl('https://' + 'a'.repeat(2050))).toMatchObject({ ok: false })
    expect(validateSubscriptionUrl(42)).toMatchObject({ ok: false })
  })
})
