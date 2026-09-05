# exdate API reference

Every example below is a real response, captured from the indexer running against Robinhood Chain
mainnet on 2026-09-02. Nothing here is illustrative: if a field is `null` in an example, that is
what the chain said.

Base URL: **`https://api.exdate.me`**, or wherever you run the indexer yourself —
`http://localhost:42069` under `pnpm dev`, or the box `deploy/install-api.sh` sets up (see *Hosting*
in the README). The public instance is one small machine with no availability commitment. `:chain`
accepts the key (`robinhood`) or the id (`4663`).

The API is versioned by path: everything here is `/v1`, nothing under it has been removed or
renamed since it went live, and every addition is dated in [the changelog](../../docs/changelog.md).

Two rules hold everywhere:

- **every bigint is a decimal string** — `"1005101770003214918"`, never a JS number;
- **anything exdate has not observed is `null`** — never `0`, never a default, never an absent key.

A third rule governs prices: Chainlink's Robinhood feeds publish
`Token Price = Underlying Equity Price × Multiplier`. The multiplier is already in the answer.
Every response that carries a price says so in `answerIncludesMultiplier` / `includesMultiplier`.

---

## First call in 30 seconds

No key, no signup. Ask what a token is owed - SGOV here - and the answer comes back priced from
nothing but the issuer's declared rate and the multiplier read on chain:

```bash
curl https://api.exdate.me/v1/robinhood/tokens/0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5/pending
```

Captured 2026-09-05 15:50 UTC, the `declared` entry cut to what a first reader needs (`projection`
is in the full route reference below):

```json
{
  "chainId": 4663,
  "observedAt": "2026-09-05T15:50:35.000Z",
  "token": { "address": "0x92fd66527192e3e61d4ddd13322aa222de86f9b5", "symbol": "SGOV", "decimals": 18, "issuer": "Robinhood Assets (Jersey) Limited" },
  "multiplier": { "current": "1005101770003214918", "currentDecimal": "1.005101770003214918", "sampledAt": "2026-09-05T15:49:46.000Z" },
  "scheduled": null,
  "declared": [
    {
      "key": "0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67:2026-09-04",
      "state": "awaiting",
      "processDate": "2026-09-04",
      "daysSinceProcessDate": 1,
      "grossPerUnderlyingShare": "0.307098",
      "grossPerToken": "0.308664743364447294",
      "note": "declared by the issuer, still inside the observed next-business-day window",
      "source": "robinhood:/rhj/corporate-actions"
    }
  ],
  "summary": { "scheduledOnChain": 0, "declaredUpcoming": 0, "declaredAwaiting": 1, "declaredOverdue": 0, "declaredCompleteNotOnChain": 0, "longestOverdueDays": null, "nothingPending": false },
  "history": { "reconciledDividends": 1, "lastObservedHaircutBps": 3378 }
}
```

Three things to read off it: `grossPerToken` is `rate × multiplier` and needs no price; `state` says
where the dividend is between declaration and chain (`upcoming`, `awaiting`, `overdue`,
`declared_complete_not_on_chain`); `history.lastObservedHaircutBps` is what the previous one lost on
the way, measured. The same in TypeScript:

```ts
import { createClient } from '@exdate/sdk' // npm, with provenance

const exdate = createClient({ baseUrl: 'https://api.exdate.me' })
const owed = await exdate.pending('0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5')
owed.declared[0]?.grossPerToken // '0.308664743364447294'
```

Every other route is below; the 60-a-minute anonymous quota is enough to read all of them.

## Keys and quotas

Every route but `/v1/health` is counted. Without a key a caller shares an anonymous quota per client
address (60 requests a minute by default); with one, the quota the operator attached to it. The key
travels as `Authorization: Bearer <key>` or `X-Api-Key: <key>`, and three headers come back on every
answer: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (a Unix timestamp). Past
the quota the answer is `429` with `Retry-After` and a JSON body:

```json
{ "error": "rate limited", "limitPerMinute": 60, "retryAfterSeconds": 41 }
```

An unknown key is `401 {"error":"unknown API key"}`, never a silent downgrade to anonymous, so a typo
shows up as a refusal and not as a smaller quota than promised.

## `GET /v1/me`

What the API knows about the caller, without spending a request:

```json
{ "tier": "key", "label": "acme", "limitPerMinute": 600, "remaining": 598, "resetAt": "2026-09-03T16:41:00.000Z", "keysConfigured": 2 }
```

`label` is the name the operator gave the key; the key itself is never echoed. `tier` is `anonymous`
without a key, and `label` is then `null`.

## `GET /v1/health`

```json
{ "ok": true, "registryGeneratedAt": "2026-09-02T15:14:00.463Z" }
```

`registryGeneratedAt` dates the token registry snapshot, not the process. Uncounted, so a probe
never eats into a quota.

## `GET /v1/chains`

The chains this deployment serves. Multi-chain from day one: Base / Coinbase is a planned second
issuer, so nothing keys on a single chain.

## `GET /v1/:chain/tokens` · `GET /v1/:chain/tokens/:address`

The list carries `count`, `polled` (how many have been read at least once) and every token. One
token, in full:

```json
{
  "chainId": 4663,
  "address": "0x92fd66527192e3e61d4ddd13322aa222de86f9b5",
  "symbol": "SGOV",
  "name": "iShares 0-3 Month Treasury Bond • Robinhood Token",
  "decimals": 18,
  "isin": "US46436E7186",
  "issuer": "Robinhood Assets (Jersey) Limited",
  "registry": { "source": "robinhood:/rhj/assets", "generatedAt": "2026-09-02T15:14:00.463Z" },
  "state": "indexed",
  "multiplier": {
    "current": "1005101770003214918",
    "currentDecimal": "1.005101770003214918",
    "scheduled": null,
    "lastChangeEffectiveAt": "2026-09-01T00:00:26.000Z",
    "totalSupplyUI": "14295704240018345085764",
    "sampledAt": "2026-09-02T18:34:20.000Z"
  },
  "events": {
    "count": 3,
    "last": {
      "effectiveAt": "2026-09-01T00:00:26.000Z",
      "applied": true,
      "announcedAt": "2026-08-31T23:50:51.000Z",
      "announcementLeadSeconds": 575,
      "announcedTx": "0xf33317c324c4d1d53278dd5c0fcb6ca3afeea41ccf39441ecada548148f5f4e7",
      "announcementCount": 1,
      "source": "onchain:scan",
      "oldMultiplier": "1002981519346766532",
      "newMultiplier": "1005101770003214918",
      "stepBps": 21.1394787994627
    }
  },
  "feed": {
    "proxy": "0xa0df4ee0fff975306345875e3548fcc519577a11",
    "verified": false,
    "decimals": 8,
    "answer": "10092226805",
    "price": "100.92226805",
    "updatedAt": "2026-09-02T00:01:11.000Z",
    "ageSeconds": 67444,
    "beyondHeartbeat": false,
    "status": "live",
    "oraclePaused": false,
    "includesMultiplier": true
  }
}
```

Four fields carry the traps this API exists to avoid:

- **`multiplier.scheduled`** is non-null *only* while a change is genuinely pending — `effectiveAt`
  in the future **and** `newUIMultiplier != uiMultiplier`. Outside that window the on-chain views
  are retrospective: `effectiveAt()` holds the timestamp of the last change that already happened.
  Reading it as "pending" reports phantom dividends.
- **`multiplier.lastChangeEffectiveAt`** is `null` while a change is pending, because the timestamp
  then belongs to `scheduled` and is not a change that happened.
- **`events.last.applied`** is derived from the clock. Nothing is emitted on chain when a multiplier
  change takes effect — the announcement is the only log.
- **`feed.verified`** is `false` on every row today: the token → feed pairing is derived from the
  ticker, and no first-party statement links them.

`state` is `not_yet_polled` until the poller has read the ERC-8056 views once — a token with no data
says so rather than showing zeros. A single token 404s with `{"error":"unknown token", …}`.

## `GET /v1/:chain/events`

Every `UIMultiplierUpdated` log, newest first, with `source` naming which scanner found it
(`onchain:indexer`, `onchain:scan`, `onchain:sweep` — all three are real logs with real transaction
hashes). `announcementCount` is above 1 where a schedule was re-announced; CRWD emitted the same
`(newMultiplier, effectiveAt)` twice, eleven hours apart.

## `GET /v1/:chain/reconciliations`

The body is `{ chainId, counts, returned, reconciliations }`. `?token=` narrows to one address,
`?status=` to one state; `returned` is the size of the filtered list and `counts` is always the whole
picture, so a filtered view cannot read as the total.

```json
{
  "id": "0x00000000000000000000000000000000…63fe4a67:2026-08-06",
  "symbol": "SGOV",
  "status": "matched",
  "confidence": "medium",
  "feedCorroboratedBy": ["multiplier-step", "traded-price"],
  "declared": {
    "type": "CORPORATE_ACTION_TYPE_CASH_DIVIDEND",
    "status": "CORPORATE_ACTION_STATUS_COMPLETED",
    "processDate": "2026-08-06",
    "grossPerShare": "0.306812",
    "source": "robinhood:/rhj/corporate-actions"
  },
  "observed": {
    "effectiveAt": "2026-08-07T15:10:24.000Z",
    "oldMultiplier": "1000957519890990718",
    "newMultiplier": "1002981519346766532",
    "stepBps": 20.2206328995484,
    "lagDays": 1,
    "source": "onchain:UIMultiplierUpdated"
  },
  "price": {
    "value": "100.57120681",
    "feed": "0xa0df4ee0fff975306345875e3548fcc519577a11",
    "roundId": "18446744073709551646",
    "updatedAt": "2026-08-07T00:01:33.000Z",
    "stalenessSeconds": 54531,
    "atPhaseFloor": false,
    "source": "chainlink:getRoundData"
  },
  "result": {
    "expectedStepBps": 30.53615327227618,
    "receivedPerShare": "0.203166809056096883",
    "impliedHaircutBps": 3378,
    "impliedReinvestPrice": "151.732144846392134274"
  }
}
```

Read it as: the issuer declared $0.306812 per underlying share; the multiplier moved 20.22 bps; at
the equity price implied by the Chainlink round in force, that step delivered $0.2032 — **33.78 %
did not arrive**. `id` is `issuerId:processDate`, because the issuer's id names a dividend *series*,
not a payment: SGOV, SHY and BND reuse theirs every month.

`impliedReinvestPrice` is the price the step would have needed for the dividend to have arrived in
full. It needs no oracle, so it is the discriminator for the 159 of 194 tokens with no Chainlink
feed: a genuine reinvestment implies a price near spot (the two matched rows land at 1.47× and
1.51× today's price), and every anomaly is far outside.

Statuses: `matched`, `anomaly`, `pending` (declared, nothing on chain), `unmatched` (a step with no
issuer row — expected before ~2026-08-05, where the issuer's feed ends) and
`unsupported_action_type` (a split matched to a step: no per-share rate to reconcile against).

`confidence` starts at `low`: the token → feed pairing is inferred from a ticker, and no first-party
statement links them. It reaches `medium` from three observed events once the pairing is
corroborated by behaviour, and the row's own `feedCorroboratedBy` says by which behaviour — never
merge the two, because they are not the same claim:

- `multiplier-step` — this token's own step was seen moving this feed by the step's own size, above
  the feed's round-to-round noise, with no other mapped feed closer. Causal, and true of **SGOV
  alone**.
- `traded-price` — the token's on-chain traded price repeatedly sits far closer to this feed's
  answer than to any other mapped feed. Identification, and weaker: two unrelated assets can trade
  at one price. True of **23 of 35 pairings** today.

`high` is reserved for a first-party address-level link, which nothing has today. A row refused for
a reason of its own — no price at `effectiveAt`, a non-positive rate — reads `low` and still reports
`feedCorroboratedBy`, because that is a fact about the pairing and not about the event. An empty
array means the pairing rests on a ticker match alone; the same list is served per token under
`feed.corroboratedBy` on `GET /v1/:chain/tokens/:address`.

## `GET /v1/:chain/tokens/:address/yield`

A **ledger of distributions, not a rate**. One row per observed step and per declared action.

- `observed.netYieldBps` and `result.netYieldBps` exist only where a step is paired with an issuer
  **cash dividend** — a split produces the same arithmetic identity with no economic gain, so it
  never gets the name.
- `price.underlyingPrice` states its own derivation (`tokenPrice / multiplierBefore`).
- `totals` is `null` unless the ledger **closes**: the last applied step's `newMultiplier` equals
  `uiMultiplier()` read at the head. Growth is split into `dividendGrowthBps` (explained by paired
  dividends) and `unexplainedGrowthBps`, compounded, and the two multiply back to the whole.
- `notComputed` lists every refused figure with a machine-readable reason:
  `annualizedYield: no_observed_schedule`, `trailingTwelveMonthYield: window_shorter_than_period`,
  `forwardYield: delivery_not_demonstrated`. Nothing in the shape is per annum, trailing or forward
  — a documented refusal cannot be mistaken for a value that has not arrived yet.

SGOV on 2026-09-02: growth 51.02 bps = 20.22 explained ⊕ 30.73 unexplained, over three steps.

## `GET /v1/:chain/tokens/:address/pending`

What is owed and has not arrived, with each state kept apart:

| `state` | Meaning | Certainty |
|---|---|---|
| `scheduled` (top level) | a log is on chain, `effectiveAt` in the future | certain, ~9 minutes out |
| `upcoming` | declared, process date has not arrived | nothing owed yet |
| `awaiting` | declared, process date passed, still inside the 4-day pairing window | normal |
| `overdue` | declared, past the window, issuer still says in progress | late |
| `declared_complete_not_on_chain` | **the issuer says COMPLETED, the multiplier has not moved** | anomaly |

`upcoming` and `awaiting` are separated because `awaiting` carries a claim — the chain should move
within the window — that is simply false for a date that has not arrived. `summary` counts them
apart (`declaredUpcoming`, `declaredAwaiting`).

BND, four weeks after its own issuer marked the dividend complete:

```json
{
  "state": "indexed",
  "multiplier": { "current": "1000000000000000000", "currentDecimal": "1" },
  "scheduled": null,
  "declared": [{
    "state": "declared_complete_not_on_chain",
    "issuerStatus": "CORPORATE_ACTION_STATUS_COMPLETED",
    "processDate": "2026-08-05",
    "daysSinceProcessDate": 28,
    "windowDays": 4,
    "grossPerUnderlyingShare": "0.25155",
    "grossPerToken": "0.25155",
    "projection": null,
    "note": "the issuer marks this action completed; the multiplier has not moved"
  }],
  "summary": { "declaredOverdue": 1, "declaredCompleteNotOnChain": 1, "longestOverdueDays": 28 }
}
```

`grossPerToken` is `rate × uiMultiplier` — two known numbers, no price, so it is stated for all 194
tokens. `projection.stepBpsIfPaidInFull` is what a full payment would produce **at the latest
round**; it carries `notAMeasurement: true` and is `null` without a feed. `history` reports the
haircut measured on this token's own past distributions and applies it to nothing. The landing date
and the surviving fraction are refused under `notComputed`.

## `GET /v1/status`

`{ observedAt, chains: [ { chainId, name, tokens, tokensWithFeed, tokensWithoutFeed, live, stale,
paused, unknown, feeds } ] }` — one entry per chain served. `feeds` carries the health of every token
that has a feed (`symbol`, `token`, `feed`, `verified`, `status`, `ageSeconds`, `beyondHeartbeat`,
`updatedAt`), and `tokensWithoutFeed` lists the rest, because a caller must be able to see that most
Stock Tokens have no oracle at all rather than infer it from a short list. Off-hours these feeds hold
their last answer with no heartbeat, so `updatedAt` and `ageSeconds` are the only honest signals;
`status` is `live | stale | paused | unknown`.

## `GET /v1/calendar`

`{ observedAt, chains: [ { chainId, upcomingCorporateActions, scheduledMultiplierUpdates } ] }`. Two
different horizons in one response: `upcomingCorporateActions` from the issuer runs weeks ahead;
`scheduledMultiplierUpdates` is what is genuinely pending on chain, which is about nine minutes.

## `GET /v1/webhooks`

The event catalogue, the signing scheme (`HMAC-SHA256` over `` `${t}.${rawBody}` ``, 300 s
tolerance), the header names, the retry schedule, and `endpointsConfigured` — which is what tells an
operator whether silence means "nothing happened" or "nobody is listening". Each event states what
exdate *observed* to send it; `multiplier.applied` says outright that it is a poller observation,
because no log fires when a change takes effect.

The seven event types, as the catalogue states them:

| Type | Sent when |
|---|---|
| `multiplier.scheduled` | A `UIMultiplierUpdated` log whose `effectiveAt` is still in the future. The observed lead is about nine minutes. |
| `multiplier.applied` | `uiMultiplier()` differs from the previous poll. Nothing is emitted on chain when a change takes effect, so this is the poller's observation, not a log. |
| `feed.stale` | The age of a feed's latest round crossed the 86 400 s heartbeat between two polls. |
| `feed.resumed` | A fresh round arrived for a feed that was stale. |
| `pause.changed` | `oraclePaused()` differs from the previous poll. A token already paused at first observation is a baseline and is not sent. |
| `dividend.pending` | A new row in the issuer's corporate-action feed with no multiplier step paired to it. On a fresh database the whole outstanding backlog arrives at once, flagged `backlog: true`. |
| `dividend.reconciled` | A reconciliation row reached `matched` or `anomaly`, carrying the observed haircut. |

Retries after a non-2xx: 30 s, 2 min, 10 min, 30 min, 2 h, 6 h, 12 h - eight attempts in all, then
`failed` and kept.

## `GET /v1/:chain/webhooks/events`

The outbox: every event recorded, with each delivery's attempts, `responseStatus` and `error`.
Events are recorded whether or not an endpoint is configured, so this is a usable event log on its
own — and the honest answer to "did you send it?". `signedBody` is the exact string the signature
covers, so a delivery can be replayed and verified byte for byte. Delivery rows carry the endpoint
id and **host** only; the configured URL and its secret never leave the process.

`?type=`, `?status=` and `?limit=` filter; the counts stay whole.

---

## Verifying a webhook

```ts
import { webhookFromRequest } from '@exdate/sdk'

const result = await webhookFromRequest(request, { secret: process.env.EXDATE_WEBHOOK_SECRET! })
if (!result.ok) return new Response(result.reason, { status: 400 })
if (result.event.type === 'dividend.reconciled') {
  result.event.data.impliedHaircutBps // 3378
}
```

Verify the raw bytes before parsing: key order and whitespace change the bytes, and the signature
covers bytes. See [the SDK reference](../packages/sdk/README.md) for the rest.

## Running your own

`pnpm dev` runs it on a local PGlite database. If Ponder stops with *Schema "public" was previously
used by a different Ponder app*, the local database belongs to an earlier build: delete
`packages/indexer/.ponder/` and start again. For a hosted instance see *Hosting* in the README:
`docker compose up -d` brings up Postgres and the indexer, and `EXDATE_API_KEYS` turns on keys.
