// How long a webhook actually took, read from the live API and committed.
//
//   node scripts/measure-webhook-latency.mjs
//
// The product's most perishable claim is the announcement lead: a multiplier change is published
// on chain about nine to ten minutes before it takes effect. That is worth something only if the
// notice arrives inside it, and until exdate subscribed an endpoint of its own the signed outbox
// had delivered nothing at all - so the latency was a budget derived from the poll interval, which
// is the shape of a number nobody measured.
//
// What this does is read /v1/:chain/webhooks/latency, which the API computes over real deliveries
// and refuses to summarise before there is one, and write the answer with the count and the date
// beside it. The refusal travels: with no delivery yet the file says `sufficient: false` and the
// site shows nothing, exactly as the off-hours share did until it had covered every session.
//
// The three legs are kept apart because they fail for different reasons and different people own
// them: exdate's own observation lag, the outbox, and the total a subscriber experiences. A single
// total would let a fast outbox hide a slow observation, which is the leg that decides whether the
// lead is usable.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const API = (process.env.EXDATE_API_URL ?? 'https://api.exdate.me').replace(/\/+$/, '')
const CHAIN = process.env.EXDATE_CHAIN ?? '4663'
const OUT = new URL('data/webhook-latency.observed.json', root)

const held = (() => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'))
  } catch {
    return null
  }
})()

let answer
try {
  const response = await fetch(`${API}/v1/${CHAIN}/webhooks/latency`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  answer = await response.json()
} catch (error) {
  // A read that failed is not a measurement of zero. The committed file is left exactly as it was,
  // because "the API was unreachable this morning" must never be published as "nothing was
  // delivered" - that is the same failure as a corporate-action window read badly overwriting the
  // archive, and it is refused here for the same reason.
  console.error(`# ${API} did not answer (${error.message}); ${OUT.pathname.split('/').pop()} left untouched`)
  process.exit(held ? 0 : 1)
}

const out = {
  note: "How long a signed webhook took to reach a subscriber, over real deliveries only. Never derived from the poll interval: a delivery path with nothing subscribed to it has no latency, it has a budget. The three legs are apart because they fail for different reasons - exdate's own observation lag, the outbox, and the total a subscriber experiences.",
  source: `${API}/v1/${CHAIN}/webhooks/latency`,
  chainId: Number(CHAIN),
  observedAt: 'PLACEHOLDER',
  legs: answer.legs,
  basis: answer.basis,
  /**
   * Where the receiving end is. Stated because it bounds what the total means: exdate's own
   * subscriber runs on the same machine as the sender, so the figure includes signing, the HTTP
   * round trip and the subscriber's verification, and excludes public internet transit to
   * somebody else's server. A reader must be able to tell those apart without asking.
   */
  scope:
    'the subscriber is exdate’s own receiver on the same host, so public internet transit to a third party is not included',
  endpointsConfigured: answer.endpointsConfigured ?? null,
  delivered: answer.delivered,
  pending: answer.pending,
  /**
   * Why `pending` is what it is. A subscriber nobody can reach and an outbox that has not run yet
   * both leave every delivery queued, so without this the file records the same thing for both -
   * which is exactly what it did on 2026-09-06 while every delivery was answering `fetch failed`.
   */
  attempted: answer.attempted ?? null,
  failed: answer.failed,
  sufficient: answer.sufficient,
  notComputed: answer.notComputed,
  announceToObserve: answer.announceToObserve,
  observeToDeliver: answer.observeToDeliver,
  announceToDeliver: answer.announceToDeliver,
  byType: answer.byType,
}

// `observedAt` moves every run and says nothing about the data, so it is compared out: a run that
// re-confirms the same counts leaves the file byte-identical and commits nothing.
const withoutRunFields = (value) => {
  const { observedAt: _at, ...rest } = value ?? {}
  return JSON.stringify(rest)
}
const unchanged = held !== null && withoutRunFields(held) === withoutRunFields(out)
out.observedAt = unchanged ? held.observedAt : new Date().toISOString()

if (unchanged) {
  console.error(`# unchanged: ${out.delivered} delivered, ${out.pending} pending, ${out.failed} failed; file left as it was`)
} else {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  const total = out.announceToDeliver
  const tried = out.attempted?.triedNotAccepted ?? 0
  console.error(
    out.sufficient
      ? `# ${out.delivered} real deliver${out.delivered === 1 ? 'y' : 'ies'}; announce -> deliver median ${total.medianSeconds ?? 'n/a'}s over n=${total.n} -> data/webhook-latency.observed.json`
      : tried > 0
        ? // Not "no real delivery yet": deliveries were tried and refused, which is a different
          // thing and the one worth saying out loud.
          `# ${tried} deliver${tried === 1 ? 'y' : 'ies'} attempted and none accepted (${out.notComputed}) -> data/webhook-latency.observed.json`
        : `# no real delivery yet (${out.notComputed}); recorded as insufficient rather than estimated -> data/webhook-latency.observed.json`,
  )
}

/*
 * An outbox that is being drained and refused is BROKEN, not merely unmeasured, and it must not
 * pass quietly as the second.
 *
 * This ran for hours on 2026-09-06 with a subscriber configured, 45 deliveries at five attempts
 * each and every one answering `fetch failed` at the socket. Nothing failed, nothing alerted, and
 * the committed file said `sufficient: false` - which was true and read exactly like an outbox
 * waiting for its first event. A failed scheduled run emails the repository owner with no
 * configuration at all, which is the alarm this had and never rang.
 *
 * AFTER the write, deliberately: failing first would discard the reading that explains the
 * failure. The same order deploy/update-api.sh and the capture watchdog use.
 */
const attempted = out.attempted
if (!out.sufficient && attempted && attempted.triedNotAccepted > 0) {
  console.error(
    `# BROKEN: ${attempted.triedNotAccepted} deliver${attempted.triedNotAccepted === 1 ? 'y has' : 'ies have'} been attempted and none accepted` +
      `${attempted.lastError ? `; last answer: ${attempted.lastError}` : ''}` +
      `${attempted.lastResponseStatus === null ? ' (no HTTP status, so the connection itself never happened)' : ` (HTTP ${attempted.lastResponseStatus})`}`,
  )
  console.error('# The subscriber is unreachable or refusing. Look at: docker compose logs receiver, on the API host.')
  process.exit(1)
}
