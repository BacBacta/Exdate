// exdate's own webhook subscriber: the first endpoint that ever received a delivery.
//
// The signed outbox has existed since M4 and had never delivered anything, because nothing was
// subscribed to it. That is not a small gap: the announcement lead is the most perishable thing
// this project measures, and a delivery path that has never carried a delivery is a claim, not a
// capability. This is the endpoint that turns it into one.
//
// It runs inside the indexer's own network namespace (docker-compose.yml, `network_mode:
// service:indexer`), so the indexer reaches it at http://127.0.0.1:8091 and nothing else can reach
// it at all - no port is published, no name resolves to it, and no certificate or DNS record had
// to be created. That also means it satisfies the endpoint rule in @exdate/core unchanged: http
// is allowed for loopback and refused everywhere else, and this genuinely is loopback rather than
// an exception carved for it.
//
// What it measures is stated as plainly as what it does not. The delivery it accepts is the real
// signed POST the outbox makes, with the real payload, verified with the real scheme - so the
// outbox leg is measured end to end. It is not measured across the public internet, because the
// sender and the receiver are one machine. A subscriber somewhere else adds their own transit;
// this measures everything up to the point where that begins.
//
// It returns 200 only when the signature verifies inside the tolerance. A rejection is a non-2xx,
// which the outbox records as a failure and retries - so "delivered" in the record means "a
// subscriber checked the signature and accepted it", never "something answered".
import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'

const PORT = Number(process.env.EXDATE_RECEIVER_PORT ?? 8091)
const SECRET = process.env.EXDATE_RECEIVER_SECRET ?? ''
/** The same window the sender documents. A replayed delivery is refused, not counted. */
const TOLERANCE_SECONDS = Number(process.env.EXDATE_RECEIVER_TOLERANCE ?? 300)
const MAX_BODY_BYTES = 1_000_000

if (SECRET.length < 16) {
  console.error('receiver: EXDATE_RECEIVER_SECRET must be at least 16 characters; refusing to start')
  process.exit(1)
}

/**
 * The verifier, written out rather than imported from @exdate/sdk.
 *
 * A receiver that shares code with the sender proves the two agree, not that either is right: if
 * the scheme were wrong in one place it would be wrong in both and the test would still pass. This
 * is the independent implementation, from the documented scheme alone - HMAC-SHA256 over
 * `${t}.${rawBody}`, compared in constant time, inside a 300 s window.
 */
function verify(header, rawBody) {
  const parts = Object.fromEntries(
    String(header ?? '')
      .split(',')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2),
  )
  const t = Number(parts.t)
  const given = parts.v1
  if (!Number.isFinite(t) || typeof given !== 'string') return { ok: false, reason: 'malformed_signature_header' }
  const age = Math.abs(Math.floor(Date.now() / 1000) - t)
  if (age > TOLERANCE_SECONDS) return { ok: false, reason: `timestamp_outside_tolerance:${age}s` }
  const expected = createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'signature_mismatch' }
  return { ok: true, reason: null }
}

/**
 * What arrived, newest first, capped.
 *
 * Deliberately in memory and deliberately small: the measurement exdate publishes is computed by
 * the API from its own tables, which hold every instant this would - so a file here would be a
 * second copy of the record, free to disagree with it. This exists so a person can look at what
 * the endpoint actually received, and it is gone on restart, which is the honest lifetime for a
 * debugging view.
 */
const recent = []
const RECENT_MAX = 200
let accepted = 0
let rejected = 0

const readBody = (request) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://receiver')

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, accepted, rejected }))
    return
  }

  if (request.method === 'GET' && url.pathname === '/deliveries') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ accepted, rejected, recent }, null, 2))
    return
  }

  if (request.method !== 'POST' || url.pathname !== '/hook') {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
    return
  }

  let raw
  try {
    raw = await readBody(request)
  } catch {
    response.writeHead(413, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'body too large' }))
    return
  }

  // The signature is over the bytes as they were sent, so the body is verified before it is
  // parsed. Re-serialising JSON and signing that is the classic way to produce a delivery that
  // fails its own verification.
  const result = verify(request.headers['exdate-signature'], raw)
  const eventId = String(request.headers['exdate-event-id'] ?? '')
  const type = String(request.headers['exdate-event'] ?? '')

  recent.unshift({
    receivedAt: new Date().toISOString(),
    eventId,
    type,
    delivery: String(request.headers['exdate-delivery'] ?? ''),
    bytes: Buffer.byteLength(raw),
    accepted: result.ok,
    reason: result.reason,
  })
  recent.length = Math.min(recent.length, RECENT_MAX)

  if (!result.ok) {
    rejected++
    console.error(`receiver: rejected ${type || 'unknown'} ${eventId}: ${result.reason}`)
    // 400, not 200. The outbox records a non-2xx as a failure and retries, which is exactly right:
    // a delivery whose signature did not verify was not received.
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: result.reason }))
    return
  }

  accepted++
  console.log(`receiver: accepted ${type} ${eventId} (${Buffer.byteLength(raw)} bytes)`)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: true }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`receiver: listening on 127.0.0.1:${PORT}, tolerance ${TOLERANCE_SECONDS}s`)
})
