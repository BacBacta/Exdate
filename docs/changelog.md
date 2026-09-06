# exdate changelog

What changed in the API, the SDK and the published files, by date. The API is versioned by path
(`/v1/…`); nothing under `/v1` has been removed or renamed since it went live, and a field that is
added is listed here on the day it appears. The site's own record of decisions, with the
measurements behind them, is `CLAUDE.md` in the repository.

## 2026-09-06

- **New: `/subscribe/`.** The footer's *Subscribe* column linked the files themselves —
  `/calendar.ics`, `/feed.xml`, `/badge.svg`, `/tokenlist.json` — under labels that read like
  pages, so a person clicking *Calendar* landed on `BEGIN:VCALENDAR` and one clicking *Token list*
  on 124 KB of JSON. The files are unchanged and stay at their addresses; what is new is a page
  that says in plain words what each one is and where to paste it — the `webcal:` button and the
  URL for Google Calendar, the feed address for a reader, the badge with its Markdown and HTML, the
  token list with its version and what a wallet learns from it — with the file itself one click
  further, labelled as a file. The calendar subscription component that had been written for
  `/dividends/` and never mounted is mounted there now.

- **Editorial.** The site's title and lede describe the reconciliation rather than an accusation:
  *every dividend declared, against what actually arrived*. Every figure is unchanged — Apple's
  36 % and the words *never arrived* are measurements and stay exactly where they were. What went
  is the claim the record refuses: the README said exdate publishes "the net yield after the fees
  and withholding nobody documents", which asserts a decomposition of a difference that two
  independent tokens put in the mid-thirties and that nobody has ever documented. `/about/` now
  lists *explain the difference* among the things exdate refuses to do.

- `GET /v1/:chain/tokens` and `/v1/:chain/tokens/:address` now serve `logoUrl: null` for every
  token. The key stays — its type already admitted `null`, so nothing under `/v1` breaks on a
  missing field — but exdate no longer redistributes the issuer's CDN logo. It is a third-party
  mark served from the issuer's own host under a licence that is personal and non-sublicensable
  (`docs/terms-review.md` §5.2, §5.7), no exdate surface renders it, and serving less of the
  issuer verbatim shrinks the clause that applies at no product cost.
- `/tokenlist.json` drops the per-token `logoURI` for the same reason, version `1.0.6`. The
  list-level `logoURI` is exdate's own mark and is unchanged.
- **New: `identifiers` on the token routes.** `GET /v1/:chain/tokens` and
  `/v1/:chain/tokens/:address` now carry `identifiers: { address, ticker, isin, cusip, figi,
  shareClassFigi }`, so exdate's rows join to a portfolio system without a mapping table. `address`
  stays the key — it is the only one of the six that is first-party and readable from the chain.
  The `cusip` is **derived** from a US ISIN and its check digit verified, so it cannot disagree
  with the `isin` beside it, and it is `null` for the 16 non-US ISINs rather than invented. The
  two FIGIs come from OpenFIGI, joined on the ISIN: `shareClassFigi` resolves for all 194 and is
  the one to key on, because a Stock Token represents a share class and is listed on no venue at
  all; the country composite `figi` is `null` for 16, where the asset lists in no venue in its
  ISIN's country. The join is committed at `data/figi.observed.json` with each ISIN's venue-row
  count, so it can be re-checked rather than trusted.
- **New: `GET /v1/:chain/webhooks/latency`.** How long deliveries actually took, over real
  deliveries only, in three legs — exdate's own observation lag, the outbox, and the total a
  subscriber experiences. `sufficient` is `false` with a reason until at least one delivery has
  been accepted, and every leg is `null` then rather than zero: nothing here is derived from the
  poll interval, because a delivery path with nothing subscribed to it has a budget and not a
  latency. `delivered` means the signature verified at the receiving end, since a subscriber that
  rejects one returns a non-2xx and the outbox records that as a failure. The SDK gains
  `webhooks.latency()`.
- **exdate is now subscribed to its own outbox.** The signed outbox had existed since M4 and
  delivered nothing, because nothing was subscribed to it. `deploy/receiver/` is a dependency-free
  subscriber that runs inside the indexer's network namespace — reached at `http://127.0.0.1:8091`
  and by nothing else, so it needed no name, no certificate and no open port — verifies each
  signature independently of `@exdate/core`, and returns 200 only when it checks out.
- `/tokenlist.json` gains `extensions.cusip` and `extensions.shareClassFigi`, version `1.0.7`. The
  country composite is not there: the schema allows ten extensions per token, and the tenth slot
  goes to the identifier that is never null and never names a venue the token is not on. It is
  served in full by the API and by `data/figi.observed.json`.

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
