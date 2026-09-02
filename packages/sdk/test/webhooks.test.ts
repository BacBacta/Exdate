import { describe, expect, it } from 'vitest'
import {
  WEBHOOK_HEADERS,
  parseWebhook,
  signBody,
  verifyWebhook,
  webhookFromRequest,
} from '../src/index.js'
import type { AnyWebhookEnvelope } from '../src/index.js'

/**
 * What a consumer actually writes: take the raw body, verify it, then act on a
 * typed event. The failure paths matter more than the happy one - a handler
 * that parses first and verifies later has already lost the bytes the signature
 * covers.
 */

const SECRET = 'whsec_0123456789abcdef0123456789abcdef'
const NOW = 1_788_373_934

/** The delivery SGOV's August reconciliation actually produced. */
const envelope: AnyWebhookEnvelope = {
  id: 'dividend.reconciled:4663:0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67:2026-08-06',
  type: 'dividend.reconciled',
  chainId: 4663,
  observedAt: '2026-09-02T19:26:37.000Z',
  token: { address: '0x92fd66527192e3e61d4ddd13322aa222de86f9b5', symbol: 'SGOV' },
  data: {
    actionId: '0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67',
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
}
const body = JSON.stringify(envelope)
const sign = (overrides: { secret?: string; timestamp?: number } = {}) =>
  signBody({ secret: overrides.secret ?? SECRET, timestamp: overrides.timestamp ?? NOW, body })

describe('verifying a delivery', () => {
  it('accepts one that exdate signed', async () => {
    expect(await verifyWebhook({ secret: SECRET, header: await sign(), body, nowSeconds: NOW })).toEqual({
      valid: true,
    })
  })

  it('defaults the clock to now, so a live delivery needs no timestamp', async () => {
    const header = await signBody({ secret: SECRET, timestamp: Math.floor(Date.now() / 1000), body })
    expect(await verifyWebhook({ secret: SECRET, header, body })).toEqual({ valid: true })
  })

  it('rejects a replayed delivery and says which check failed', async () => {
    const header = await sign({ timestamp: NOW - 3600 })
    expect(await verifyWebhook({ secret: SECRET, header, body, nowSeconds: NOW })).toEqual({
      valid: false,
      reason: 'timestamp_outside_tolerance',
    })
  })
})

describe('parsing', () => {
  it('verifies before it parses, and narrows data on the type', async () => {
    const result = await parseWebhook({ secret: SECRET, header: await sign(), body, nowSeconds: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    // The discriminated union: narrowing on `type` narrows `data` with it, so
    // impliedHaircutBps exists here without a cast.
    if (result.event.type === 'dividend.reconciled') {
      expect(result.event.data.impliedHaircutBps).toBe(3378)
      expect(result.event.data.priceSource).toBe('chainlink:getRoundData')
    } else {
      throw new Error('expected a reconciliation')
    }
  })

  it('never parses a body that failed verification', async () => {
    const tampered = body.replace('3378', '1')
    const result = await parseWebhook({ secret: SECRET, header: await sign(), body: tampered, nowSeconds: NOW })
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('reports a verified body that is not JSON rather than throwing', async () => {
    const raw = 'not json'
    const header = await signBody({ secret: SECRET, timestamp: NOW, body: raw })
    expect(await parseWebhook({ secret: SECRET, header, body: raw, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'invalid_json',
    })
  })

  it('accepts either secret during a rotation', async () => {
    const previous = 'whsec_ffffffffffffffffffffffffffffffff'
    const header = await sign({ secret: previous })
    const result = await parseWebhook({ secret: [SECRET, previous], header, body, nowSeconds: NOW })
    expect(result.ok).toBe(true)
  })
})

describe('from a Request', () => {
  const request = (header: string, payload = body) =>
    new Request('https://consumer.test/hook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [WEBHOOK_HEADERS.signature]: header },
      body: payload,
    })

  it('reads the raw body itself, so the caller cannot lose the signed bytes', async () => {
    const result = await webhookFromRequest(request(await sign()), { secret: SECRET, nowSeconds: NOW })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.event.token?.symbol).toBe('SGOV')
  })

  it('rejects a request with no signature header at all', async () => {
    const bare = new Request('https://consumer.test/hook', { method: 'POST', body })
    expect(await webhookFromRequest(bare, { secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'malformed_header',
    })
  })

  it('is not fooled by a body re-encoded on the way in', async () => {
    // Whitespace and key order change the bytes; the signature covers bytes.
    const reencoded = JSON.stringify(JSON.parse(body), null, 2)
    const result = await webhookFromRequest(request(await sign(), reencoded), {
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })
})
