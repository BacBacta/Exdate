import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { signBody } from '@exdate/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * exdate's own subscriber, driven by the sender's own signing function over real HTTP.
 *
 * The point is not that the two agree - they would agree just as happily if the scheme were wrong
 * in both, because deploy/receiver/server.mjs implements the verification independently, from the
 * documented scheme and not from @exdate/core. What this asserts is that the endpoint the outbox
 * will actually POST to accepts a genuine delivery and refuses every way of faking one, over a
 * socket rather than through a function call: a receiver that verifies correctly in a unit test
 * and 500s on a real request has delivered nothing.
 *
 * `delivered` in the outbox means "this receiver checked the signature and returned 200". That is
 * what makes the published latency a measurement of deliveries that were received, rather than of
 * connections that were opened, so it has to be true of the running process.
 */
const SECRET = 'a-receiver-secret-of-32-characters'
const PORT = 8194
const HOOK = `http://127.0.0.1:${PORT}/hook`
const server = fileURLToPath(new URL('../../../deploy/receiver/server.mjs', import.meta.url))

let child: ChildProcess

const body = JSON.stringify({
  id: 'multiplier.scheduled:4663:0xf23250dac154d05bb671cb0d0ebef3c635c79ce2:1757000000',
  type: 'multiplier.scheduled',
  data: { announcedAt: '2026-09-04T15:00:41.000Z', effectiveAt: '2026-09-04T15:10:26.000Z' },
})

const post = async (signature: string | null, id: string) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'exdate-event': 'multiplier.scheduled',
    'exdate-event-id': id,
  }
  if (signature !== null) headers['exdate-signature'] = signature
  const response = await fetch(HOOK, { method: 'POST', headers, body })
  return { status: response.status, json: (await response.json()) as { ok?: boolean; error?: string } }
}

const now = () => Math.floor(Date.now() / 1000)

beforeAll(async () => {
  child = spawn(process.execPath, [server], {
    env: { ...process.env, EXDATE_RECEIVER_SECRET: SECRET, EXDATE_RECEIVER_PORT: String(PORT) },
    stdio: 'ignore',
  })
  // Poll rather than sleep: a fixed wait is either slower than it needs to be or flaky.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/health`)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('the receiver never started listening')
}, 15_000)

afterAll(() => child?.kill())

describe('the deployed webhook receiver', () => {
  it('accepts a delivery signed by the sender itself', async () => {
    const result = await post(await signBody({ secret: SECRET, timestamp: now(), body }), 'accepted')
    expect(result.status).toBe(200)
    expect(result.json.ok).toBe(true)
  })

  it('refuses a forged signature with a non-2xx, so the outbox records a failure', async () => {
    const result = await post(await signBody({ secret: 'another-secret-16-chars', timestamp: now(), body }), 'forged')
    expect(result.status).toBe(400)
    expect(result.json.error).toBe('signature_mismatch')
  })

  it('refuses a replay outside the tolerance', async () => {
    const result = await post(await signBody({ secret: SECRET, timestamp: now() - 3600, body }), 'replayed')
    expect(result.status).toBe(400)
    expect(result.json.error).toMatch(/^timestamp_outside_tolerance/)
  })

  it('refuses a body altered after signing', async () => {
    // The signature covers the bytes as sent. A receiver that re-serialises the JSON before
    // checking would accept this, which is why the raw body is verified before it is parsed.
    const result = await post(await signBody({ secret: SECRET, timestamp: now(), body: `${body} ` }), 'tampered')
    expect(result.status).toBe(400)
    expect(result.json.error).toBe('signature_mismatch')
  })

  it('refuses a delivery with no signature at all', async () => {
    const result = await post(null, 'unsigned')
    expect(result.status).toBe(400)
    expect(result.json.error).toBe('malformed_signature_header')
  })

  it('counts what it accepted and what it refused', async () => {
    const view = (await (await fetch(`http://127.0.0.1:${PORT}/deliveries`)).json()) as {
      accepted: number
      rejected: number
      recent: { eventId: string; accepted: boolean }[]
    }
    expect(view.accepted).toBe(1)
    expect(view.rejected).toBe(4)
    expect(view.recent.filter((row) => row.accepted).map((row) => row.eventId)).toEqual(['accepted'])
  })
})
