# exdate changelog

What changed in the API, the SDK and the published files, by date. The API is versioned by path
(`/v1/…`); nothing under `/v1` has been removed or renamed since it went live, and a field that is
added is listed here on the day it appears. The site's own record of decisions, with the
measurements behind them, is `CLAUDE.md` in the repository.

## 2026-09-05

- **API.** Self-service webhook subscriptions: `POST /v1/webhooks/subscriptions` takes an https URL
  and optional event types and answers with a secret once; `GET`, `DELETE` and `POST …/test` on
  `/v1/webhooks/subscriptions/:id` with that secret in `x-exdate-subscription-secret`. `GET
  /v1/webhooks` gains `selfService` (null on an instance that keeps no store). The SDK gains
  `webhooks.subscribe`, `subscription`, `unsubscribe` and `test`.
- **Site.** `/calendar.ics` (every declared dividend and every observed multiplier change),
  `/t/<address>/calendar.ics` per token, `/feed.xml`; one link preview per token; a badge per token
  at `/badge/<address>.svg` and `/badge.svg`; `/how/`, `/dividends/`, `/docs/`, `/about/` and this
  changelog.
- **Packages.** `@exdate/core` and `@exdate/sdk` published to npm: `0.1.0` under `latest`, and
  `0.1.1-oidc.0` under `next`, built through trusted publishing with a provenance attestation
  naming the workflow, repository and commit (`npm view @exdate/sdk --json`, `dist.attestations`).
- **Reference.** `docs/api.md` opens on a first call with a response captured from the live API;
  the seven webhook event types are listed with what triggers each.

## 2026-09-04

- **API.** `api.exdate.me` is live, one machine, no availability commitment. Reconciliation rows
  carry `feedCorroboratedBy` (`multiplier-step`, `traded-price`, or both), and `confidence` is
  derived from it: a pairing corroborated by behaviour reaches `medium`; `high` stays reserved for
  a first-party address-level link, which does not exist. The token route's `feed.corroboratedBy`
  says the same thing on the token.
- **Data.** Reconciliation rows say which price they used: a Chainlink round in force at the
  instant of the step, or the issuer's own quote captured at that instant by the watcher. The
  quote covers all 194 tokens; the round exists for 35.
- **Data.** Hourly readings of the traded price against the Chainlink feed, per token, with the
  pool's depth; net creation per token per day; the RPC endpoints probed for archive depth.

## 2026-09-03

- **API.** Keys and quotas: `Authorization: Bearer <key>` or `X-Api-Key`, the three
  `X-RateLimit-*` headers on every answer, `429` with `Retry-After`, `401` on an unknown key
  rather than a silent downgrade, `GET /v1/me` uncounted. Anonymous callers share 60 requests a
  minute per address.
- **API.** `/v1/:chain/tokens/:address/pending` gains a fourth declared state, `upcoming`, for a
  process date that has not arrived; `awaiting` no longer claims a future date is late.
- **SDK.** `createClient({ apiKey })` and `me()`. The response types are compiled against the
  API's serialisers in both directions, so a field the API adds cannot stay invisible to the SDK.
- **Hosting.** `Dockerfile` and `docker-compose.yml` for running the indexer and the API on a
  machine of your own.

## 2026-09-02

- **API v1.** `/v1/health`, `/v1/chains`, `/v1/:chain/tokens`, `/v1/:chain/tokens/:address`,
  `/v1/:chain/events`, `/v1/status`, `/v1/calendar`, `/v1/:chain/reconciliations`,
  `/v1/:chain/tokens/:address/yield` (a distribution ledger, not a rate),
  `/v1/:chain/tokens/:address/pending` (scheduled, awaiting, overdue,
  declared-complete-not-on-chain), `/v1/webhooks` (the catalogue and the signing scheme) and
  `/v1/:chain/webhooks/events` (the outbox).
- **Webhooks.** Seven event types, HMAC-SHA256 over `${t}.${rawBody}` in the `exdate-signature`
  header, 300 s tolerance, deterministic event ids, eight attempts over about twelve hours.
- **SDK.** `@exdate/sdk`: a typed client for every route, `ExdateError` with the status, and the
  webhook verifier, which is the sender's own function.
- **Data.** The issuer's corporate-action feed archived daily, since it keeps only a month; every
  `UIMultiplierUpdated` log since public mainnet; the token-to-feed pairing with what corroborates
  each row.
