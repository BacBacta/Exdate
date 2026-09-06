# The open-core boundary

**Generated. Do not edit — run `node scripts/build-open-core.mjs`.**

Every fact below is read from the file that decides it: the routes from `packages/api/src/index.ts`,
the quotas from `packages/api/src/limits.ts`, the carve-outs from `DATA-LICENSE.md`, and the state
of each prerequisite from the committed record. A document written beside the code answers this on
the day it is written and drifts from the next commit; this one cannot.

## Today: everything is open

There is **no paid tier**, and nothing in this repository is reserved. Every route answers without a
key, every dataset in `data/` is committed, and the two published packages are MIT. This section
says so plainly rather than leaving a reader to infer it from an absence.

| What | Licence | Where |
|---|---|---|
| Code — `@exdate/core`, `@exdate/sdk`, the indexer, the API, both sites | MIT | `LICENSE` |
| exdate's own observations in `data/` | CC BY 4.0 | `DATA-LICENSE.md` |
| The issuer's own rows, republished with their source stated | **not exdate's to license** | `DATA-LICENSE.md`, carved out by column |
| OpenFIGI's identifiers | **not exdate's to license** | `DATA-LICENSE.md` |

The middle two are the part a re-user must read. exdate's licence from the issuer is personal and
non-sublicensable (`docs/terms-review.md` §5.2), so it cannot pass on rights it does not hold: the
issuer's fields are reproduced with their source named so a measurement can be checked, and what
may be done with them is between the re-user and the issuer's terms.

Files the carve-out names today, wholly or by column: `data/robinhood-assets.snapshot.json`, `data/robinhood-corporate-actions.snapshot.json`, `data/corporate-actions.archive.json`, `data/reconciliations.observed.json`, `data/effective-prices.observed.json`, `data/exdate.tokenlist.json`, `data/figi.observed.json`. Which of the two each one is, and which fields are affected, is in `DATA-LICENSE.md`'s own tables - this line is the index, not the answer.

## The API, route by route

Rate limits, not tiers: 60 requests a minute for an anonymous caller (per client address),
600 with a key. A key changes the quota and nothing else — **no route, field or dataset is
behind one**. `/v1/health` and `/v1/me` are outside the count.

| Route | What it serves | Tier |
|---|---|---|
| `GET /v1/me` | the caller’s tier and what is left of its quota | open |
| `GET /v1/health` | liveness, and how old the compiled registry is | open |
| `GET /v1/webhooks` | the event catalogue, the signing scheme and the retry schedule | open |
| `POST /v1/webhooks/subscriptions` | subscribe an endpoint without the operator | open |
| `GET /v1/webhooks/subscriptions/:id` | read or revoke a subscription, with its own secret | open |
| `DELETE /v1/webhooks/subscriptions/:id` | read or revoke a subscription, with its own secret | open |
| `POST /v1/webhooks/subscriptions/:id/test` | replay the most recent real event to a subscriber | open |
| `GET /v1/chains` | the chains exdate reads, and what it knows on each | open |
| `GET /v1/:chain/tokens` | every token with its multiplier, feed and event summary | open |
| `GET /v1/:chain/tokens/:address` | one token, in full, with its identifiers | open |
| `GET /v1/:chain/tokens/:address/yield` | the distribution ledger — never a rate | open |
| `GET /v1/:chain/tokens/:address/pending` | what is declared and has not arrived, and what it owes | open |
| `GET /v1/:chain/events` | every UIMultiplierUpdated log, newest first | open |
| `GET /v1/:chain/reconciliations` | declared against delivered, per dividend — the differentiating dataset | open |
| `GET /v1/:chain/webhooks/events` | the outbox: what was noticed, and what each delivery did | open |
| `GET /v1/:chain/webhooks/latency` | how long deliveries actually took, over real deliveries only | open |
| `GET /v1/status` | feed health across every token, now | open |
| `GET /v1/calendar` | the issuer’s declared rows, upcoming first | open |

## What a paid tier would reserve, when there is one

The differentiating dataset is `/v1/:chain/reconciliations` — declared against delivered, per
dividend, priced at the instant of the step — together with the signed webhooks that carry it
inside the announcement lead. That is what a paid tier would be built on, and this document names
it in advance so the boundary is legible before it matters rather than announced afterwards.

**It is not reserved today, and it should not be**, for reasons that are measurements rather than
strategy. 0 of 5 prerequisites are met:

| Prerequisite | State | What the record says |
|---|---|---|
| More than one archive witness | **not met** | the oldest multiplier step is confirmed by 1 endpoint; 1 of the probed endpoints reach it at all |
| Production reads on something exdate controls | **not met** | reads go to third-party endpoints with no service commitment, with Robinhood’s own as the fallback |
| A database that survives a code deploy | **not met** | Ponder refuses a schema written by a different build, so a code deploy drops it and the poller rewrites the derived tables |
| An alert when the watcher stops | **partly met** | a watchdog checks the heartbeat and fails its own scheduled run when it is stale, which emails the repository owner; no real-time sink is configured |
| A measured delivery latency | **not met** | no delivery has been accepted by a subscriber yet, so there is no latency to promise |

Why each one blocks a paid tier:

- **More than one archive witness** — a single witness means one third party going away takes the state confirmation with it.
- **Production reads on something exdate controls** — docs/terms-review.md §2.4(a) reserves Robinhood’s RPC for testing and development, and a third party can degrade without notice — measured twice in one day.
- **A database that survives a code deploy** — what is lost is derived and comes back within one poll, but an availability promise cannot be made over it.
- **An alert when the watcher stops** — a capture missed at the instant of a step is unrecoverable — the issuer serves only the present.
- **A measured delivery latency** — the announcement lead is the most saleable thing here and it cannot be sold before it is measured.

Selling against any of these unmet would be selling a promise exdate cannot keep, which is the
same failure as publishing a number nobody measured. When they are met, this table is what will
have changed, and it changes by regenerating this file rather than by editing it.

## How to tell, for any field

1. **A route or a package** — open, all of it, today. The table above is generated from the source.
2. **A value in `data/`** — every dataset names its sources per row or in a `sources` block. A
   value sourced `onchain:…` or `chainlink:…`, or a file describing its own measurement, is
   exdate's and CC BY 4.0. A value sourced `robinhood:…` or `openfigi:…` is not exdate's to
   license.
3. **Anything else** — it does not exist. If this document does not name it, it is not reserved.
