# exdate

**The corporate-action layer for tokenized stocks.**

Robinhood Stock Tokens don't pay cash dividends onchain — they raise an ERC-8056 multiplier that
changes how many underlying shares each token represents, while raw balances stay put. Standard
tooling ignores this, which is why public data on these assets has been off by 10x to 100x.

exdate indexes what actually happens: every multiplier update, every corporate action, the dividend
that is owed but not yet reflected, the net yield after the fees and withholding nobody documents,
and the health of every Chainlink feed.

> **Status: M1 to M5 shipped.** The indexer, the API, the reconciliation table and
> the status page run against Robinhood Chain mainnet today: 194 tokens polled, 35 Chainlink
> feeds, 12 distinct multiplier changes, 43 issuer corporate actions, 49 reconciliation rows, and
> 43 signed webhook deliveries verified end to end. What is left is listed under Known gaps.
> Read [`docs/phase-0-verification.md`](docs/phase-0-verification.md) for every verified fact.

## Why it matters

| | |
|---|---|
| **Pending dividend** | Between ex-date and multiplier application, a token is worth more than the oracle says. Undervalued collateral, predictable DEX/NAV premium. |
| **Observed haircut** | Reconciling declared dividends against observed multiplier steps measures the real cost of the structure. Published nowhere else. |
| **Feed health** | Feeds are 24/5 and freeze off-hours. The kickoff brief states ~46% of transfers happen outside NYSE hours — exdate has not measured that, and indexes no transfers. Lending protocols need to know before they liquidate. |

None of that is hypothetical. On 2026-09-02, mid-session, the SPY feed was **18 hours** stale and
the QQQ feed **4 hours** stale. Ten tokens have already moved their multiplier — steps ranging from
0.64 bps to 214.86 bps — and the onchain warning before a change takes effect is **nine minutes**.
Only 18% of Stock Tokens have a Chainlink feed at all. Reconciling the issuer's own dividend rates
against the onchain steps gives a **~34–36 % haircut** on AAPL and SGOV, four events that don't
reconcile at all, and seven dividends marked *completed* that have not reached the chain after up
to four weeks. Every input is sourced; see the report.

## Run it

```bash
pnpm install
pnpm dev          # indexer + API   http://localhost:42069
pnpm dev:status   # status page      http://localhost:3000
pnpm test         # unit tests: core, api, sdk, and the indexer's webhook outbox
pnpm typecheck
```

The poller writes its first rows within about a minute. Until then the page says so; it never
shows a zero it has not observed.

Two GitHub Actions run in `.github/workflows`: `ci` typechecks, tests, builds the status page and
proves the generated registry still matches the data it comes from; `archive-corporate-actions`
runs daily, merges the issuer's window into `data/corporate-actions.archive.json` and commits it
only when something changed. The second is not housekeeping — the issuer keeps about a month, so
every day it does not run is a day of dividend history that becomes unrecoverable.

### Verification scripts

```bash
node scripts/phase0/check-chain.mjs            # chainId 4663, cadence, head
node scripts/phase0/check-tokens.mjs AAPL SGOV # ERC-20 + ERC-8056 views
node scripts/phase0/check-feeds.mjs            # every Chainlink feed + its age
node scripts/phase0/check-corporate-actions.mjs # issuer dividends vs onchain steps
node scripts/phase0/feed-price-at.mjs <feed> <iso> # Chainlink price at an instant, no archive
node scripts/phase0/snapshot-registry.mjs      # refresh + diff the issuer registry
node scripts/phase0/probe-oracle-link.mjs      # is there an on-chain token <-> feed link? (no)
node scripts/phase0/verify-feed-map.mjs        # corroborate the feed map by behaviour
node scripts/archive-corporate-actions.mjs     # merge today's window into the archive
node scripts/backfill-multiplier-events.mjs    # full-chain event scan, 26 requests
node scripts/build-reconciliations.mjs         # declared vs observed, priced at effectiveAt
node scripts/generate-registry.mjs             # snapshots -> typed module
```

Live checks against mainnet, opt-in so the unit suite never needs the network:

```bash
EXDATE_INTEGRATION=1 pnpm --filter @exdate/core test
```

Committed artifacts, all first-party or read from the chain:

| File | What |
|---|---|
| `data/robinhood-assets.snapshot.json` | 194 Stock Tokens from the issuer's own registry |
| `data/robinhood-corporate-actions.snapshot.json` | 43 dividends from the issuer's own feed (12 done, 31 upcoming) |
| `data/chainlink-feeds.snapshot.json` | 57 Chainlink feeds on Robinhood Chain |
| `data/token-feed-map.json` | token → feed pairing, **every row `verified: false`**, one row corroborated |
| `data/feed-map-verification.json` | what that pairing was actually tested against |
| `data/multiplier-events.observed.json` | every `UIMultiplierUpdated` log on chain — 13 logs, 12 distinct changes, 10 tokens |
| `data/reconciliations.observed.json` | every declared action against the step it produced, priced at `effectiveAt` |
| `data/corporate-actions.archive.json` | every action the issuer has published while exdate was watching — its own endpoint keeps about a month |

## API

```
GET /v1/health                             build identity
GET /v1/chains                             supported chains
GET /v1/:chain/tokens                      every token: multiplier, scheduled update, feed state
GET /v1/:chain/tokens/:addr                one token plus its full event history
GET /v1/:chain/events                      every multiplier event, newest first
GET /v1/:chain/reconciliations             declared vs observed, per action  ?token= ?status=
GET /v1/:chain/tokens/:addr/yield          the distribution ledger: per-payment gross, received,
                                           haircut; growth split dividend / unexplained; no rate
GET /v1/:chain/tokens/:addr/pending        what is owed and has not arrived: the change already
                                           announced on chain, and every declared dividend the
                                           multiplier has not reflected
GET /v1/status                             every feed: live, stale, paused, and how many have none
GET /v1/calendar                           issuer corporate actions + pending on-chain updates
GET /v1/webhooks                           the event catalogue, the signing scheme, the retries
GET /v1/:chain/webhooks/events             the outbox: what was noticed, and what each delivery did
```

Full reference, with a real captured response for every route: [`docs/api.md`](docs/api.md).

`:chain` accepts `robinhood` or `4663`. Every bigint is a decimal string; anything unobserved is
`null`, never `0`.

`/yield` is a ledger, not a rate. It carries one row per observed multiplier step and per declared
action, calls a step *yield* only when it is paired with an issuer cash dividend, and lists every
figure it refuses to compute (`annualizedYield`, `trailingTwelveMonthYield`, `forwardYield`) with a
reason code. Nothing in it is per annum.

`/pending` keeps three states apart that are usually conflated: `scheduled` (a log is on chain, the
change is about nine minutes away), `awaiting` (declared, still inside the observed next-business-day
window) and `declared_complete_not_on_chain` (the issuer's own feed says COMPLETED while the
multiplier has not moved — seven tokens on 2026-09-02, BND for four weeks). It projects the step a
full payment would produce at the latest round, marked `notAMeasurement`, and refuses to predict
when the step will land or how much of it will survive.

## Webhooks

Seven events: `multiplier.scheduled`, `multiplier.applied`, `feed.stale`, `feed.resumed`,
`pause.changed`, `dividend.pending`, `dividend.reconciled`. `GET /v1/webhooks` serves the
catalogue, and each entry states what exdate *observed* to send it — `multiplier.applied` is a
poller observation, because nothing is emitted on chain when a change takes effect.

Endpoints are configured out of band, because they carry the signing secret:

```
EXDATE_WEBHOOK_ENDPOINTS=[{"id":"curator","url":"https://…","secret":"…","events":["dividend.reconciled"]}]
```

Every delivery is signed HMAC-SHA256 over `` `${t}.${rawBody}` `` and carries

```
exdate-signature: t=<unix seconds>,v1=<hex digest>
exdate-event: dividend.reconciled
exdate-event-id: dividend.reconciled:4663:<action>:<processDate>
```

Verify the **raw bytes**, before parsing the JSON:

```ts
import { verifySignature } from '@exdate/core'

const raw = await request.text()
const result = await verifySignature({
  secret: process.env.WEBHOOK_SECRET!,
  header: request.headers.get('exdate-signature'),
  body: raw,
  nowSeconds: Math.floor(Date.now() / 1000),
})
if (!result.valid) return new Response(result.reason, { status: 400 })
```

The timestamp is inside the signed material and is checked against a 300 s window, so a captured
delivery cannot be replayed. Event ids are deterministic: a redelivery, or the same occurrence seen
by both the live indexer and the poller, carries the id you already have — key your bookkeeping on
it. Failures retry seven times over about twelve hours and are then marked `failed` and kept, so a
consumer that was down can see what it missed at `/v1/:chain/webhooks/events`.

Two things worth knowing before pointing a production consumer at it. A fresh database emits the
current backlog once (43 events on 2026-09-02 — 37 declared dividends and 6 reconciliations);
those `dividend.pending` payloads carry `backlog: true`, so a consumer starting up can act only on
`backlog: false`. And delivery is drained at the start of each poll cycle, so it lags an event by
up to one interval (~60 s by default) against a ~9-minute announcement lead.

## SDK

```ts
import { createClient } from '@exdate/sdk'

const exdate = createClient({ baseUrl: 'https://api.exdate.xyz' })
const ledger = await exdate.yield('0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5')

ledger.totals?.dividendGrowthBps    // 20.22 — explained by a paired issuer dividend
ledger.totals?.unexplainedGrowthBps // 30.73 — steps with no issuer row behind them
```

Typed against the API, with the two shapes it cannot afford to get wrong (`YieldLedger`,
`PendingView`) derived from the functions that produce them. The webhook verifier is the same
function the sender signs with, and installing the SDK does not drag in the server. Full usage:
[`packages/sdk/README.md`](packages/sdk/README.md).

## Repo layout

```
packages/core     chains, ABIs, WAD maths, staleness, NFT log filtering, reconciliation,
                  the throttled RPC transport, the generated registry. No I/O, unit-tested.
packages/indexer  Ponder: indexes UIMultiplierUpdated, polls the ERC-8056 views, the
                  Chainlink feeds and the issuer's corporate actions, serves the API.
packages/api      Hono routes over a Repository interface — no SQL, deployable alone.
apps/status       Next.js App Router status page. Reads the API and nothing else.
packages/sdk      @exdate/sdk — typed client + webhook verifier. Depends on core only.
scripts           verification and backfill scripts
data              committed snapshots of first-party registries, observed events, and the
                  feed-map verification
docs              Phase 0 report, API reference
```

### Why the history is scanned rather than indexed

Ponder's sync loop manages **25 blocks per 9–16 s** on the public RPC — about 300 days for the
51.7 M blocks since mainnet — because the endpoint rejects roughly half of all `eth_getLogs` calls
at any pacing and Ponder sizes each round from the previous round's duration. One wide query per
2 000 000 blocks does the same scan in **26 requests, two minutes**.

So history comes from `scripts/backfill-multiplier-events.mjs` and Ponder starts at the head and
owns everything live. Every row records which scanner found it (`onchain:scan` or
`onchain:indexer`); both are real logs with real transaction hashes. Point `RHC_RPC_URL_ARCHIVE` at
a dedicated provider and set `RHC_START_BLOCK=900000` to hand the whole history back to Ponder.

## Development

```bash
cp .env.example .env      # optional: every default points at the public RPC
```

Edit the root `.env` only. `pnpm dev`, `pnpm dev:status` and `pnpm start` copy it to
`packages/indexer/.env.local` and `apps/status/.env.local`, which are the files Ponder and Next
actually read.

No API key is needed anywhere. The registry, the prices and the corporate actions all come from the
issuer's own unauthenticated endpoints, and the scripts under `scripts/phase0/` are dependency-free
— plain Node 22, `fetch`, hand-rolled ABI encoding — so they run against a bare checkout.

See `CLAUDE.md` for verified onchain facts, known traps, and the decision log.

## Honesty policy

exdate never displays a number it cannot trace to an onchain event. Where no event has been
observed yet, the API returns an explicit `confidence` field and the UI says so. Fees and
withholding on onchain distributions are undocumented by the issuer; everything exdate reports
about them is **observed**, never official.

The same rule applies to this repository. Anything derived rather than read — currently the
token → feed mapping — is committed with `verified: false` and named as a heuristic.

That mapping has since been tested rather than left as an assumption
([`docs/phase-0-verification.md`](docs/phase-0-verification.md) §14). No first-party, address-level
link exists — the token contract answers with no address at all, and the probe that establishes
that is committed. What does exist: all 35 aggregators name their ticker in their own on-chain
`description()`, the issuer's registry carries 194 distinct tickers for 194 assets, and **SGOV's
2026-07-08 multiplier step was seen moving its assigned feed by +9.5778 bps against an expected
+9.5752 — on a feed whose ordinary movement is 0.0094 bps, and uniquely closest among all 35 feeds
measured at that instant**. That row is marked `corroborated`; the other 34 are not, and the
reconciliation confidence ladder keeps `high` reserved for a first-party statement that does not
yet exist.
