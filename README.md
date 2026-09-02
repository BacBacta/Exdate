# exdate

**The corporate-action layer for tokenized stocks.**

Robinhood Stock Tokens don't pay cash dividends onchain — they raise an ERC-8056 multiplier that
changes how many underlying shares each token represents, while raw balances stay put. Standard
tooling ignores this, which is why public data on these assets has been off by 10x to 100x.

exdate indexes what actually happens: every multiplier update, every corporate action, the dividend
that is owed but not yet reflected, the net yield after the fees and withholding nobody documents,
and the health of every Chainlink feed.

> **Status: M1 to M4 shipped.** The indexer, the API, the reconciliation table and
> the status page run against Robinhood Chain mainnet today: 194 tokens polled, 35 Chainlink
> feeds, 12 distinct multiplier changes, 43 issuer corporate actions, 49 reconciliation rows. The
> SDK is not built yet — it is marked below.
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
pnpm test         # unit tests for @exdate/core and @exdate/api
pnpm typecheck
```

The poller writes its first rows within about a minute. Until then the page says so; it never
shows a zero it has not observed.

### Verification scripts

```bash
node scripts/phase0/check-chain.mjs            # chainId 4663, cadence, head
node scripts/phase0/check-tokens.mjs AAPL SGOV # ERC-20 + ERC-8056 views
node scripts/phase0/check-feeds.mjs            # every Chainlink feed + its age
node scripts/phase0/check-corporate-actions.mjs # issuer dividends vs onchain steps
node scripts/phase0/feed-price-at.mjs <feed> <iso> # Chainlink price at an instant, no archive
node scripts/phase0/snapshot-registry.mjs      # refresh + diff the issuer registry
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
| `data/token-feed-map.json` | token → feed pairing, **every row `verified: false`** |
| `data/multiplier-events.observed.json` | every `UIMultiplierUpdated` log on chain — 13 logs, 12 distinct changes, 10 tokens |
| `data/reconciliations.observed.json` | every declared action against the step it produced, priced at `effectiveAt` |

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

Two things worth knowing before pointing a production consumer at it: a fresh database emits the
current backlog once (43 events on 2026-09-02 — 37 declared dividends and 6 reconciliations), and
delivery is drained at the start of each poll cycle, so it lags an event by up to one interval
(~60 s by default) against a ~9-minute announcement lead.

```ts
// M5
import { exdate } from '@exdate/sdk'
const y = await exdate.yield('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC')
```

## Repo layout

```
packages/core     chains, ABIs, WAD maths, staleness, NFT log filtering, reconciliation,
                  the throttled RPC transport, the generated registry. No I/O, unit-tested.
packages/indexer  Ponder: indexes UIMultiplierUpdated, polls the ERC-8056 views, the
                  Chainlink feeds and the issuer's corporate actions, serves the API.
packages/api      Hono routes over a Repository interface — no SQL, deployable alone.
apps/status       Next.js App Router status page. Reads the API and nothing else.
packages/sdk      @exdate/sdk                                             (M5, not started)
scripts           verification and backfill scripts
data              committed snapshots of first-party registries and observed events
docs              Phase 0 report
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
