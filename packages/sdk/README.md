# @exdate/sdk

Typed client and webhook verifier for the [exdate](../../README.md) API — the corporate-action layer
for Robinhood Chain Stock Tokens.

Nothing is computed in this package. Every number it returns traces back to a log, an ERC-8056 view
call or the issuer's own feed, and the two API rules hold throughout: **every bigint is a decimal
string**, and **anything exdate has not observed is `null`** — never `0`, never absent.

```bash
pnpm add @exdate/sdk
```

Published on npm from this repository through trusted publishing: from `0.1.1` on, every version
carries a provenance attestation naming the workflow, repository and commit that built it, which
you can read back with `npm view @exdate/sdk --json` (`dist.attestations`). The `next` dist-tag
carries prereleases. It depends on `@exdate/core` only; installing it never pulls in the server.

## Reading

```ts
import { createClient } from '@exdate/sdk'

// the public instance, or the host your own indexer runs on
const exdate = createClient({ baseUrl: 'https://api.exdate.me', apiKey: process.env.EXDATE_API_KEY })

const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'

const { token } = await exdate.token(SGOV)
token.multiplier.currentDecimal // '1.005101770003214918'
token.multiplier.scheduled      // null unless a change is genuinely pending
token.events.last?.applied      // derived from the clock: no log fires at effect
```

`chain` defaults to `robinhood` and accepts the key or the id (`4663`). Every method returns the
route's response as-is:

| Method | Route |
|---|---|
| `health()` `chains()` | `/v1/health` `/v1/chains` |
| `tokens()` `token(addr)` `tokenOrNull(addr)` | `/v1/:chain/tokens[/:addr]` |
| `events()` | `/v1/:chain/events` |
| `reconciliations({ token?, status? })` | `/v1/:chain/reconciliations` |
| `yield(addr)` | `/v1/:chain/tokens/:addr/yield` |
| `pending(addr)` | `/v1/:chain/tokens/:addr/pending` |
| `status()` `calendar()` | `/v1/status` `/v1/calendar` |
| `webhooks.catalogue()` `webhooks.events({ … })` | `/v1/webhooks`, `/v1/:chain/webhooks/events` |

### Keys and quotas

Without `apiKey` the anonymous quota applies (60 requests a minute per address by default). With
one, the quota the operator attached to the key. `exdate.me()` reports the tier and what is left
without spending a request, and a `429` arrives as an `ExdateError` whose `body` carries
`retryAfterSeconds`.

### Errors

A non-2xx answer throws `ExdateError` carrying `status`, `url` and the parsed `body`, so "this token
does not exist" is never silently the same as "the indexer is down":

```ts
try {
  await exdate.yield('0x0000000000000000000000000000000000000001')
} catch (error) {
  if (error instanceof ExdateError && error.isNotFound) { /* 404 */ }
}

// or, where a missing token is expected:
const maybe = await exdate.tokenOrNull(address) // null on 404, still throws on 500
```

## The two endpoints worth knowing

**`yield(addr)` is a ledger, not a rate.** One row per observed multiplier step and per declared
action. A step is called *yield* only when it is paired with an issuer cash dividend — so a split
can never read as one. `totals` exists only when the ledger *closes* against `uiMultiplier()` read
at the head. Everything it refuses to compute is listed with a reason code:

```ts
const ledger = await exdate.yield(SGOV)
ledger.totals?.dividendGrowthBps    // 20.22 — explained by a paired dividend
ledger.totals?.unexplainedGrowthBps // 30.73 — steps with no issuer row behind them
ledger.notComputed.map((n) => `${n.field}: ${n.reasonCode}`)
// [ 'annualizedYield: no_observed_schedule',
//   'trailingTwelveMonthYield: window_shorter_than_period',
//   'forwardYield: delivery_not_demonstrated', … ]
```

**`pending(addr)` separates three states** that are usually conflated:

```ts
const owed = await exdate.pending(BND)
owed.scheduled                      // a log is on chain; ~9 minutes of warning
owed.declared[0].state              // 'upcoming' | 'awaiting' | 'overdue' | 'declared_complete_not_on_chain'
owed.declared[0].grossPerToken      // rate x uiMultiplier — needs no price
owed.declared[0].projection         // null without a feed; `notAMeasurement: true` with one
owed.summary.longestOverdueDays     // 28 for BND on 2026-09-02
```

`declared_complete_not_on_chain` is the sharp one: the issuer's own feed says the action is
COMPLETED while the multiplier has not moved.

## Webhooks

The verifier is not a reimplementation — it is the same function the sender signs with. Verify the
**raw bytes**, before parsing:

```ts
import { webhookFromRequest } from '@exdate/sdk'

export async function POST(request: Request) {
  const result = await webhookFromRequest(request, { secret: process.env.EXDATE_WEBHOOK_SECRET! })
  if (!result.ok) return new Response(result.reason, { status: 400 })

  // Narrowing on `type` narrows `data` with it.
  if (result.event.type === 'dividend.reconciled') {
    result.event.data.impliedHaircutBps // 3378 — 33.78 % of SGOV's August dividend withheld
  }
  return new Response('ok')
}
```

The signature travels in the `exdate-signature` header as `t=<unix seconds>,v1=<hex digest>`:
HMAC-SHA256 over `${t}.${rawBody}`, checked against a 300 s window. The other headers are
`exdate-event` (the type), `exdate-event-id` and `exdate-delivery`.

`parseWebhook({ secret, header, body })` does the same from parts, and `verifyWebhook(…)` returns
`{ valid: false, reason }` — `malformed_header`, `timestamp_outside_tolerance`, `signature_mismatch` —
rather than throwing, so a handler can log which check failed without touching the secret.

Three things the scheme guarantees, and one it asks of you:

- the timestamp is inside the signed material and checked against a 300 s window, so a captured
  delivery cannot be replayed;
- `secret` accepts an array, so a rotation can accept both while deliveries are in flight;
- event ids are deterministic — a redelivery, or the same occurrence noticed by both the live
  indexer and the poller, carries the id you already have. Key your bookkeeping on it.
- **do not re-encode the body before verifying.** Key order and whitespace change the bytes; the
  signature covers bytes. `webhookFromRequest` reads the body itself for exactly this reason.

The seven event types and their payloads are typed in
[`@exdate/core/webhooks`](../core/src/webhooks.ts) (`WebhookData`), and the indexer that emits them
is compiled against the same map — a payload that drifts from what this package promises is a build
error, not a surprise in production.

## Types

`YieldLedger` and `PendingView` are derived from the functions that produce them, so they cannot
drift. The rest (`TokenView`, `ReconciliationView`, `MultiplierEventView`, …) are declared here, so
that installing the SDK does not drag in the server and its HTTP framework;
[`test/contract.assert.ts`](test/contract.assert.ts) compiles them against the API's serialisers in
both directions, in the repo where both exist.

One helper, because every consumer needs it and getting it backwards is the classic mistake:

```ts
import { underlyingSharesPerToken } from '@exdate/sdk'
underlyingSharesPerToken(token) // 1.00510177 for SGOV, or null if never polled
```

**Never multiply a Chainlink answer by the multiplier.** Robinhood's feeds publish
`Token Price = Underlying Equity Price x Multiplier`; the multiplier is already in the answer. Every
response that carries a price says so in its own `answerIncludesMultiplier` field.
