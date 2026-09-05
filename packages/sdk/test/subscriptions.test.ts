import { describe, expect, it } from 'vitest'
import { ExdateError, SUBSCRIPTION_SECRET_HEADER, createClient } from '../src/index.js'

/**
 * The four subscription calls: which URL, which method, which header carries
 * the secret - and that it is never the Authorization header, which carries
 * API keys and would make the API answer "unknown API key".
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const spy = (reply: (url: string, init: RequestInit) => Response) => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init: init ?? {} })
    return reply(url, init ?? {})
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

describe('webhook subscriptions', () => {
  it('subscribes with a JSON body and reads the secret back once', async () => {
    const { calls, fetch } = spy(() => json({ id: 'sub_1', secret: 'whsec_x', status: 'active' }, 201))
    const client = createClient({ baseUrl: 'https://api.example.com', apiKey: 'key_1', fetch })
    const created = await client.webhooks.subscribe({ url: 'https://hooks.example.test/x', events: ['dividend.reconciled'] })
    expect(created.secret).toBe('whsec_x')
    expect(calls[0]!.url).toBe('https://api.example.com/v1/webhooks/subscriptions')
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ url: 'https://hooks.example.test/x', events: ['dividend.reconciled'] })
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers.authorization).toBe('Bearer key_1')
  })

  it('manages with the secret in its own header, never in Authorization', async () => {
    const { calls, fetch } = spy(() => json({ id: 'sub_1', status: 'active', deliveries: { queued: 0, delivered: 0, failed: 0, lastDeliveredAt: null } }))
    const client = createClient({ baseUrl: 'https://api.example.com', apiKey: 'key_1', fetch })
    await client.webhooks.subscription('sub_1', 'whsec_x')
    await client.webhooks.unsubscribe('sub_1', 'whsec_x')
    await client.webhooks.test('sub_1', 'whsec_x')
    expect(calls.map((c) => [c.init.method, c.url.replace('https://api.example.com', '')])).toEqual([
      ['GET', '/v1/webhooks/subscriptions/sub_1'],
      ['DELETE', '/v1/webhooks/subscriptions/sub_1'],
      ['POST', '/v1/webhooks/subscriptions/sub_1/test?chain=robinhood'],
    ])
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>
      expect(headers[SUBSCRIPTION_SECRET_HEADER]).toBe('whsec_x')
      expect(headers.authorization).toBe('Bearer key_1')
    }
  })

  it('surfaces a 501 from an instance with no store as an ExdateError', async () => {
    const { fetch } = spy(() => json({ error: 'self-service subscriptions are not enabled on this instance' }, 501))
    const client = createClient({ baseUrl: 'https://api.example.com', fetch })
    await expect(client.webhooks.subscribe({ url: 'https://hooks.example.test/x' })).rejects.toMatchObject({ status: 501 })
    await expect(client.webhooks.subscribe({ url: 'https://hooks.example.test/x' })).rejects.toBeInstanceOf(ExdateError)
  })
})
