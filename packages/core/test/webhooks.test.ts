import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_SECONDS,
  endpointWants,
  nextAttemptDelaySeconds,
  parseSignatureHeader,
  parseWebhookEndpoints,
  signBody,
  verifySignature,
  webhookEventId,
} from '../src/webhooks.js'

/**
 * A signature scheme is worth exactly what its verifier rejects, so most of
 * this file is about what must NOT pass: a body changed by one character, a
 * replayed delivery, a secret that no longer applies.
 */

const SECRET = 'whsec_0123456789abcdef0123456789abcdef'
const BODY = JSON.stringify({ type: 'dividend.reconciled', data: { haircutBps: 3378 } })
const NOW = 1_788_373_934

describe('signing', () => {
  it('agrees with an independent HMAC implementation', async () => {
    // node:crypto, not the WebCrypto path the library uses: two implementations
    // of the same scheme, so a wrong digest cannot agree with itself.
    const expected = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`).digest('hex')
    expect(await signBody({ secret: SECRET, timestamp: NOW, body: BODY })).toBe(`t=${NOW},v1=${expected}`)
  })

  it('signs the timestamp together with the body', async () => {
    const a = await signBody({ secret: SECRET, timestamp: NOW, body: BODY })
    const b = await signBody({ secret: SECRET, timestamp: NOW + 1, body: BODY })
    expect(a).not.toBe(b)
  })

  it('refuses to sign with an empty secret', async () => {
    await expect(signBody({ secret: '', timestamp: NOW, body: BODY })).rejects.toThrow(/secret/)
  })

  it('parses the header it produces', async () => {
    const header = await signBody({ secret: SECRET, timestamp: NOW, body: BODY })
    expect(parseSignatureHeader(header)?.timestamp).toBe(NOW)
    expect(parseSignatureHeader(header)?.signatures).toHaveLength(1)
    expect(parseSignatureHeader('nonsense')).toBeNull()
    expect(parseSignatureHeader('t=abc,v1=ff')).toBeNull()
  })
})

describe('verification', () => {
  const sign = (overrides: { timestamp?: number; body?: string; secret?: string } = {}) =>
    signBody({
      secret: overrides.secret ?? SECRET,
      timestamp: overrides.timestamp ?? NOW,
      body: overrides.body ?? BODY,
    })

  it('accepts a delivery it just signed', async () => {
    const header = await sign()
    expect(await verifySignature({ secret: SECRET, header, body: BODY, nowSeconds: NOW })).toEqual({ valid: true })
  })

  it('rejects a body altered by one character', async () => {
    const header = await sign()
    const tampered = BODY.replace('3378', '3379')
    expect(await verifySignature({ secret: SECRET, header, body: tampered, nowSeconds: NOW })).toEqual({
      valid: false,
      reason: 'signature_mismatch',
    })
  })

  it('rejects a valid signature replayed later', async () => {
    const header = await sign()
    expect(await verifySignature({ secret: SECRET, header, body: BODY, nowSeconds: NOW + 3600 })).toEqual({
      valid: false,
      reason: 'timestamp_outside_tolerance',
    })
    // Still inside the window, so the same delivery is accepted.
    expect(await verifySignature({ secret: SECRET, header, body: BODY, nowSeconds: NOW + 60 })).toEqual({
      valid: true,
    })
  })

  it('rejects a timestamp from the future beyond the tolerance', async () => {
    const header = await sign({ timestamp: NOW + 3600 })
    expect(await verifySignature({ secret: SECRET, header, body: BODY, nowSeconds: NOW })).toEqual({
      valid: false,
      reason: 'timestamp_outside_tolerance',
    })
  })

  it('rejects the wrong secret', async () => {
    const header = await sign({ secret: 'whsec_ffffffffffffffffffffffffffffffff' })
    expect(await verifySignature({ secret: SECRET, header, body: BODY, nowSeconds: NOW })).toEqual({
      valid: false,
      reason: 'signature_mismatch',
    })
  })

  it('accepts either secret during a rotation', async () => {
    const old = 'whsec_00000000000000000000000000000000'
    const header = await sign({ secret: old })
    expect(
      await verifySignature({ secret: [SECRET, old], header, body: BODY, nowSeconds: NOW }),
    ).toEqual({ valid: true })
  })

  it('rejects a missing or malformed header rather than throwing', async () => {
    for (const header of [null, undefined, '', 'v1=deadbeef', 't=1788373934']) {
      expect(await verifySignature({ secret: SECRET, header, body: BODY, nowSeconds: NOW })).toEqual({
        valid: false,
        reason: 'malformed_header',
      })
    }
  })

  it('accepts a header carrying several candidate signatures', async () => {
    const header = await sign()
    const withExtra = `${header},v1=${'0'.repeat(64)}`
    expect(await verifySignature({ secret: SECRET, header: withExtra, body: BODY, nowSeconds: NOW })).toEqual({
      valid: true,
    })
  })
})

describe('event identity', () => {
  it('is deterministic, so the indexer and the poller cannot double-send', () => {
    const token = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
    const fromIndexer = webhookEventId('multiplier.scheduled', 4663, `${token}:1788220826`)
    const fromPoller = webhookEventId('multiplier.scheduled', 4663, `${token.toLowerCase()}:1788220826`)
    expect(fromIndexer).toBe(fromPoller)
    expect(fromIndexer).toBe(`multiplier.scheduled:4663:${token.toLowerCase()}:1788220826`)
  })

  it('names every event the catalogue documents', () => {
    expect(WEBHOOK_EVENTS.map((event) => event.type)).toEqual([
      'multiplier.scheduled',
      'multiplier.applied',
      'feed.stale',
      'feed.resumed',
      'pause.changed',
      'dividend.pending',
      'dividend.reconciled',
    ])
    // The two that no log backs must say so in their own description.
    const applied = WEBHOOK_EVENTS.find((event) => event.type === 'multiplier.applied')
    expect(applied?.trigger).toContain('Nothing is emitted on chain')
  })
})

describe('endpoint configuration', () => {
  const endpoint = { id: 'curator', url: 'https://example.test/hook', secret: SECRET }

  it('reads a configured endpoint', () => {
    expect(parseWebhookEndpoints(JSON.stringify([endpoint]))).toEqual([endpoint])
  })

  it('treats absent configuration as no endpoints, not as an error', () => {
    expect(parseWebhookEndpoints(undefined)).toEqual([])
    expect(parseWebhookEndpoints('')).toEqual([])
    expect(parseWebhookEndpoints('   ')).toEqual([])
  })

  it('refuses plaintext http except on localhost', () => {
    expect(() => parseWebhookEndpoints(JSON.stringify([{ ...endpoint, url: 'http://example.test/hook' }]))).toThrow(
      /https/,
    )
    expect(() =>
      parseWebhookEndpoints(JSON.stringify([{ ...endpoint, url: 'http://localhost:4000/hook' }])),
    ).not.toThrow()
  })

  it('refuses a weak or missing secret', () => {
    expect(() => parseWebhookEndpoints(JSON.stringify([{ ...endpoint, secret: 'short' }]))).toThrow(/secret/)
    expect(() => parseWebhookEndpoints(JSON.stringify([{ id: 'x', url: 'https://a.test' }]))).toThrow(/secret/)
  })

  it('refuses malformed configuration loudly, because silence looks like no events', () => {
    expect(() => parseWebhookEndpoints('{')).toThrow(/valid JSON/)
    expect(() => parseWebhookEndpoints('{"url":"https://a.test"}')).toThrow(/array/)
    expect(() => parseWebhookEndpoints(JSON.stringify([endpoint, endpoint]))).toThrow(/duplicate/)
    expect(() =>
      parseWebhookEndpoints(JSON.stringify([{ ...endpoint, events: ['dividend.settled'] }])),
    ).toThrow(/unknown event/)
  })

  it('filters by subscription, and no list means everything', () => {
    const [all] = parseWebhookEndpoints(JSON.stringify([endpoint]))
    const [some] = parseWebhookEndpoints(JSON.stringify([{ ...endpoint, events: ['feed.stale'] }]))
    expect(endpointWants(all!, 'dividend.reconciled')).toBe(true)
    expect(endpointWants(some!, 'dividend.reconciled')).toBe(false)
    expect(endpointWants(some!, 'feed.stale')).toBe(true)
  })
})

describe('retry schedule', () => {
  it('backs off and then gives up rather than retrying forever', () => {
    expect(nextAttemptDelaySeconds(1)).toBe(30)
    expect(WEBHOOK_RETRY_SCHEDULE_SECONDS.every((seconds, i, all) => i === 0 || seconds > all[i - 1]!)).toBe(true)
    expect(nextAttemptDelaySeconds(WEBHOOK_MAX_ATTEMPTS)).toBeNull()
    expect(nextAttemptDelaySeconds(WEBHOOK_MAX_ATTEMPTS - 1)).toBe(43_200)
    expect(() => nextAttemptDelaySeconds(0)).toThrow(/1-based/)
  })

  it('spans more than half a day before giving up', () => {
    const total = WEBHOOK_RETRY_SCHEDULE_SECONDS.reduce((sum, seconds) => sum + seconds, 0)
    expect(total).toBeGreaterThan(12 * 3600)
  })
})
