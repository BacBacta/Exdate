# CLAUDE.md — exdate

Repo memory. Keep this file current as facts are confirmed or invalidated.
Code and comments in English. Talk to the human in French.

## What exdate is

An open-core data layer for Robinhood Chain Stock Tokens: indexer + API + webhooks + public status
page. It makes the ERC-8056 multiplier, corporate actions, pending dividends, observed net yield
and Chainlink feed health legible to lending-market curators, wallets and data aggregators.

The differentiating asset is the `reconciliations` table: matching each traditional corporate
action against the observed multiplier step yields the **effective haircut**, a number published
nowhere else.

## Non-negotiable rules

1. Never invent an address, ABI, RPC endpoint or feed ID. Mark `TODO_VERIFY` and surface it.
2. Never invent a market number. No data → the UI says so. Every displayed yield must trace back
   to a real onchain event.
3. Official docs beat this file. If they conflict, follow the docs and record the conflict here.
4. Identify tokens by address, never by symbol.
5. Chainlink prices for these tokens are **total return** — they already include the multiplier.
   NEVER multiply a Chainlink price by `uiMultiplier()`.

## Chain — verified 2026-09-02

- Robinhood Chain, Arbitrum Orbit L2, `chainId = 4663` (`eth_chainId` → `0x1237`), gas token ETH.
- RPC `https://rpc.mainnet.chain.robinhood.com` — works, but rate-limited and unfit for backfill
  (see "Known traps"). Explorer `robinhoodchain.blockscout.com` is behind Cloudflare: not scriptable.
- Block 1 is 2026-04-30; the public mainnet date is 2026-07-01 (≈ block 900 000).
  **Cadence ≈ 0.1 s/block, ≈ 857 000 blocks/day.** Block 0 has timestamp `0` — never use it for math.
- Single Robinhood-operated sequencer, no permissionless fallback.
- **Multicall3 is deployed at the canonical address** `0xcA11bde05977b3631167028862bE2a173976CA11`
  (3 808 bytes). It turns the 194-token poll — five views each, 970 calls, plus 35 feed rounds —
  into ~30 requests.
- **There is no archive.** `eth_call` at `latest - 10 000` already answers
  `metadata is not found`; only the last few thousand blocks of state are readable. Historical
  multiplier state must be reconstructed from events, not read back.
- Primary quote asset is **USDG** (6 decimals), not USDC.
- Deployed: Uniswap (v3 + v4 hooks), Morpho, Rialto (propAMM), Lighter (orderbook), Chainlink.

## Stock Tokens — verified 2026-09-02

ERC-20, 18 decimals, plus ERC-8056 (Scaled UI Amount):

```solidity
uiMultiplier()    -> uint256   // WAD, 1e18 = 1.0
newUIMultiplier() -> uint256   // last scheduled value — see the trap below
effectiveAt()     -> uint256   // when that value took/takes effect — often in the PAST
balanceOfUI(address) -> uint256
totalSupplyUI()   -> uint256
oraclePaused()    -> bool

event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue);
```

`underlying shares = raw amount * uiMultiplier / 1e18`

topic0 values (computed, not copied):

| Event | topic0 |
|---|---|
| `UIMultiplierUpdated` | `0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055` |
| `TransferWithScaledUI` | `0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802` |
| `Transfer` (ERC-20 **and** ERC-721) | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |

Issuer: Robinhood Assets (Jersey) Limited — these are **tokenized debt securities**, not equity.
Mint and burn are restricted to KYB'd authorized participants; the secondary market is
permissionless.

Fees and withholding applied to onchain distributions are **undocumented**. Measuring them is the
product.

## Token registry — VERIFIED, no longer TODO

Robinhood publishes the canonical list. This is the same endpoint `docs.robinhood.com/chain/contracts`
calls to build its own table, so it is first-party, address-keyed, and authoritative:

```
GET https://api.robinhood.com/rhj/assets
```

Per asset: `tokenSymbol`, `tokenName`, `tokenDecimals`, `isin`, `status`, `currentMultiplier`,
`pendingMultiplier`, `deployments[].contractAddress` + `chainId`.

- **194 active assets**, all on chain 4663, all 18 decimals (not "200+").
- Snapshot: `data/robinhood-assets.snapshot.json`. Refresh + diff:
  `node scripts/phase0/snapshot-registry.mjs`.
- All twelve addresses from the original kickoff prompt matched the registry exactly.
- `USDG` `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals) and
  `WETH` `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` are **not** Stock Tokens — every ERC-8056
  view reverts on them.

## Issuer REST API — verified 2026-09-02

`docs.robinhood.com/chain/stock-token-apis`. No auth. Base `https://api.robinhood.com/rhj/`.

| Endpoint | Cache | Use |
|---|---|---|
| `GET /assets` | — | registry; `pendingMultiplier` + `pendingMultiplierEffectiveTime` (only while pending) |
| `GET /prices/{symbol}` | 15 s | **raw underlying bid/ask, NOT multiplier-adjusted**; `isTradingHalt`; mint/burn volume |
| `GET /corporate-actions` | 1 h | every dividend/split the issuer processes: `rate`, `processDate`, `status`, contract address |

- `/corporate-actions` **is the traditional-side source** for `reconciliations`. No vendor needed.
  Snapshot `data/robinhood-corporate-actions.snapshot.json`; reconcile with
  `node scripts/phase0/check-corporate-actions.mjs`.
- **History is ~1 month deep** (oldest row 2026-08-05). Snapshot it continuously; the archive is
  ours to keep. The five July actions (CRWD, SGOV, MU, ORCL, DELL) need a one-off manual seed.
- **The issuer's `id` names a dividend series, not a payment.** SGOV, SHY and BND carry the same
  `id` on their August and September rows, with a different `processDate`, `rate` and `status` on
  each (3 of 40 ids in the 2026-09-02 snapshot). One action is `(id, processDate)`; keying on `id`
  alone silently dropped the pending month.
- `processDate` ≠ ex-date ≠ pay-date. Empirically the onchain `effectiveAt` lands the **next
  business day at ~15:10 UTC**. Match on address + 0–4 day window.
- Rate limiting is real despite the documented 60 req/s: `/prices` returns the plain-text body
  `local_rate_limited` with HTTP 200. Parse defensively, poll slowly.
- Historical feed prices do **not** need an archive node: `getRoundData(roundId)` reads round
  history from current storage. `node scripts/phase0/feed-price-at.mjs <feed> <iso>`.

## Feeds — verified 2026-09-02

`AggregatorV3Interface.latestRoundData()`, **8 decimals**, total return, **24/5**
(`marketHours: "us_equities_24/5"`), heartbeat 86 400 s, deviation threshold 0.5 %.

- Source: `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json` — the file
  `docs.chain.link` renders. Snapshot: `data/chainlink-feeds.snapshot.json`.
- 57 feeds on the chain, **35 tokenized-equity**. **Coverage is 35 / 194 = 18 %.** Most Stock
  Tokens have no feed at all — including CRWD, CCL and COST, which have had real multiplier events.
- Chainlink states the methodology as `Token Price = Underlying Equity Market Price × Multiplier`.
  That is the direct confirmation of rule 5.
- Off-hours the feed holds the last price with no heartbeat. Always read `updatedAt` and enforce a
  staleness bound. Also check the token's `oraclePaused()` — when true the feed stops publishing.
  Observed on 2026-09-02 during a live session: SPY 18 h stale, QQQ 4 h stale, USDG 21 h stale.
- Token → feed mapping: `data/token-feed-map.json`, every row `verified: false`. It is derived from
  the feed's display name because there is no onchain token→aggregator link. **This is the one place
  the repo currently identifies a token by symbol.** Do not promote a row without a first-party
  statement.

## Known traps

- **`newUIMultiplier()` / `effectiveAt()` are retrospective, not prospective.** With nothing
  pending, `newUIMultiplier() == uiMultiplier()` and `effectiveAt()` is a past timestamp (or `0`
  for a token that never moved). A pending update exists **only** while
  `effectiveAt() > block.timestamp && newUIMultiplier() != uiMultiplier()`. Treating a non-zero
  `effectiveAt` as "pending" reports 9 phantom dividends today.
- **There is no application event.** `UIMultiplierUpdated` fires once, at announcement, carrying a
  future `effectiveAt`. Nothing is emitted when the change takes effect (verified: zero logs in the
  200 000 blocks after activation for SGOV and CCL). Application must be derived from the clock —
  an indexer alone cannot produce it.
- **The announcement lead is ~9–10 minutes**, not weeks. See `docs/phase-0-verification.md` §4.
- **A schedule can be re-announced.** CRWD emitted the same `(newMultiplier, effectiveAt)` twice,
  11 h apart. Key `multiplier_events` on `(chain_id, token, effective_at)` and upsert.
- **NFT topic0 collision**: ERC-721 declares the same `Transfer(address,address,uint256)` as ERC-20,
  so `topic0` is identical **by construction** — this is not specific to Robinhood Punks and cannot
  be fixed with a collection denylist. ERC-721 logs carry a **fourth topic** (`tokenId`) and empty
  `data`. Drop any `Transfer` log with `topics.length == 4`.
- **Beacon proxy**: all 194 tokens are 283-byte EIP-1967 beacon proxies pointing at
  `0xe10b6f6b275de231345c20d14ab812db62151b00`. One upgrade changes every token's ABI at once.
- **The RPC's limiter is cost-based, not rate-based.** `eth_blockNumber` survives 25 back-to-back
  calls and even 8 in parallel with zero rejections. `eth_getLogs` is rejected **1 to 4 times out
  of 8 at any pacing** — serialised with a 150 ms gap changes nothing. Slowing down does not help;
  retrying does. `packages/core/src/transport.ts` absorbs these so the indexer never sees them.
- **`eth_getLogs` result caps** at 10 000 (and 50 000 on some nodes in the pool — inconsistent) and
  times out on wide ranges *without* an address filter. With all 194 addresses **and** a topic
  filter, a 5 000 000-block query answers in under a second.
- **Ponder cannot walk this chain's history on the public RPC.** Measured: 25 blocks per 9–16 s.
  Ponder splits the address list into 4 chunks and sizes each sync round from the previous round's
  duration, starting at 25 blocks with a ×1.5 ceiling per round — so a slow round never grows.
  Extrapolated over the 51.7 M blocks since mainnet: **≈ 300 days**. One wide query per 2 000 000
  blocks does the same scan in 26 requests, about two minutes. Hence the two-tier design below.
- AAPL alone emits ≈ 375 000 logs/day. A dedicated archive endpoint is required before indexing
  transfers.
- A `Transfer` proves custody moved, not that a trade happened. A provable trade needs both legs
  (Stock Token + USDG) in the same `transactionHash`.
- Mint = transfer from `address(0)`. Burn = transfer to `address(0)`.
- The kickoff brief states that ~46% of transfers happen outside NYSE hours, weekends included.
  **exdate has not measured this** — it indexes no transfers — so the figure is the brief's, not an
  observation. Correctness during off-hours windows is still a requirement, not a nice-to-have.

## Observed corporate actions

**13 `UIMultiplierUpdated` logs = 12 distinct changes across 10 tokens** since 2026-07-02 (CRWD
announced the same change twice). Full data in `data/multiplier-events.observed.json`.
Rescan the whole chain: `node scripts/backfill-multiplier-events.mjs`, then
`node scripts/generate-registry.mjs`.

The most recent is **F (Ford), 2026-09-02, +1.46 bps**, announced 15:00:41 UTC and effective
15:10:26 UTC — caught the same day, against an issuer row with `processDate` 2026-09-01 and a
declared rate of $0.15.

Observed step range: **+0.64 bps (DELL) to +214.86 bps (CCL)**, plus CRWD at ×4 (a split). The
"0.05 %–2 %" band from the kickoff prompt does not hold — do not classify `kind` by magnitude.

**SGOV is the reference token**: three chained events (1.0 → 1.000957 → 1.002981 → 1.005101),
which makes it the right fixture for reconciliation tests.

Reconciliation against the issuer's own rates, price = Chainlink round at `effectiveAt`, all rows
`confidence: low`. Live at `GET /v1/:chain/reconciliations`; rebuild offline with
`node scripts/build-reconciliations.mjs`.

| Token | Gross | Received | Haircut | Implied ÷ spot | Status |
|---|---|---|---|---|---|
| AAPL | $0.27 | $0.1728 | **36.0 %** | 1.47 | matched |
| SGOV | $0.306812 | $0.2034 | **33.7 %** | 1.51 | matched |
| ASML | $1.817086 | $0.1749 | 90.4 % | 10.7 | anomaly |
| COST | $1.47 | no feed | — | 2.58 | anomaly |
| CCL | $0.15 | no feed | — | 0.30 | anomaly |
| F | $0.15 | no feed | — | 74.5 | anomaly |
| BND, SHY, UMC, SIMO, FIX, CTSH, HWM | — | `COMPLETED` by issuer, multiplier still 1.0 | — | — | **pending** (BND: 4 weeks) |

Mid-30s on two independent tokens is consistent with 30 % US non-resident withholding plus
something unexplained. Report the observed number; never claim the decomposition.

**The implied-price ratio is the discriminator that survives having no oracle.** A step that really
was a reinvestment implies a price near spot: the two matched rows land at 1.47 and 1.51, every
anomaly is far outside. It uses `/rhj/prices`, which covers all 194 tokens, so it works for the 159
with no Chainlink feed. It is a plausibility check and never a reconciliation input — it is today's
price, not the price at `effectiveAt`.

## Stack

pnpm workspaces:

| Package | What |
|---|---|
| `packages/core` | `@exdate/core` — chains, ABIs, WAD maths, staleness, NFT log filtering, reconciliation, the throttled transport, and the generated registry. No I/O, fully unit-tested. |
| `packages/indexer` | Ponder + PGlite/Postgres. Indexes `UIMultiplierUpdated`, polls the ERC-8056 views, the Chainlink feeds and the issuer's corporate actions, and serves the API. |
| `packages/api` | `@exdate/api` — Hono routes over a `Repository` interface, so it never builds SQL and stays deployable on its own. |
| `apps/status` | Next.js App Router status page. Reads the API and nothing else. |
| `packages/sdk` | `@exdate/sdk` — M5, not started. |

Vitest lives in `packages/core` (raw↔UI conversion, reconciliation, pairing, rounds, staleness,
NFT log filtering, the transport, the committed dataset, opt-in live checks) and `packages/api`
(serialisation of every state the retrospective/prospective trap can produce). `pnpm test`.

**Historical prices need no archive node.** `packages/core/src/rounds.ts` binary-searches an
aggregator's own round history, which is readable from the head — about twelve reads per event, and
each row is priced once. It reports whether it hit the current phase's floor, because "the price at
your instant" and "the oldest price this phase has" must not read alike.

**The reconcile pass runs at the START of the poll cycle.** Ponder buffers writes made inside an
indexing function, so a `db.sql` read issued later in the same handler cannot see rows written
earlier in it. Reading last cycle's committed state costs one poll interval of latency on a
dividend that settled days ago.

**Two-tier indexing, forced by the RPC (see "Known traps").**

1. *History* — `node scripts/backfill-multiplier-events.mjs` scans the whole chain in 26 requests
   and writes `data/multiplier-events.observed.json`; `scripts/generate-registry.mjs` turns it into
   a typed module the poller seeds on first run, with `source = 'onchain:scan'`.
2. *Live* — Ponder's `StockToken` source starts at `latest` and catches every new event, writing
   `source = 'onchain:indexer'`, which wins on conflict.

Both tiers are real logs with real transaction hashes; `source` says which scanner found the row.
Set `RHC_RPC_URL_ARCHIVE` and `RHC_START_BLOCK=900000` to have Ponder own the whole history instead.

Multi-chain from day one — Base / Coinbase B20 is a planned second issuer, so keep `chain_id` and
`issuer` in every table and never hardcode a single chain.

## Running it

```bash
pnpm install
pnpm dev          # Ponder indexer + API on http://localhost:42069
pnpm dev:status   # status page on http://localhost:3000
pnpm test
pnpm typecheck
```

The poller writes its first rows within one interval (`EXDATE_POLL_INTERVAL_BLOCKS`, default 600
blocks ≈ 60 s). Until then the status page says so rather than showing zeros.

## Reference docs

- https://docs.robinhood.com/chain/building-with-stock-tokens/
- https://docs.robinhood.com/chain/contracts
- https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
- https://eips.ethereum.org/EIPS/eip-8056

## Decision log

- 2026-09-01 — exdate targets Robinhood Chain (194 tokens, public data gap) rather than Base
  (4 tokens). Base remains a planned second issuer for neutrality.
- 2026-09-02 — Name: **exdate**. Repo `exdate`, API `api.exdate.xyz`, SDK `@exdate/sdk`.
- 2026-09-02 — Phase 0 complete. Token addresses promoted from `TODO_VERIFY` to verified against
  the issuer's own registry. See `docs/phase-0-verification.md`.
- 2026-09-02 — **Proposed, pending human greenlight**: drop `applied_tx` / `applied_at` from
  `multiplier_events` (no such transaction exists) in favour of `announced_*` + a derived `applied`
  boolean; add `unique (chain_id, token, effective_at)` and `superseded_by`.
- 2026-09-02 — **Proposed, pending human greenlight**: M1 indexes multiplier events + polls views
  and feeds, and does **not** index transfers. Transfers are ~100 % of log volume and 0 % of the
  current product, and need a paid archive RPC.
- 2026-09-02 — **Proposed, pending human greenlight**: the corporate-actions source is the
  issuer's own `GET /rhj/corporate-actions`, snapshotted on every poll. No market-data vendor.
  `corporate_actions.source = 'robinhood:/rhj/corporate-actions'`, keep the issuer `id`
  (as `issuer_id` — see the 2026-09-02 series-id entry below).
- 2026-09-02 — No archive RPC before a transfer indexer exists. Nothing in M1–M3 needs one.
- 2026-09-02 — **Greenlit by the human**: the four proposals above are accepted. M1 built on them.
- 2026-09-02 — **Two-tier indexing**, forced by measurement, not preference: Ponder's sync loop
  manages 25 blocks per 9–16 s on the public RPC (≈ 300 days for the full history), while one wide
  `eth_getLogs` per 2 000 000 blocks scans everything in 26 requests. History comes from
  `scripts/backfill-multiplier-events.mjs`; Ponder starts at `latest` and owns everything live.
  Rows carry `source` so the two are never conflated. Reversible in one env var once a dedicated
  RPC exists (`RHC_START_BLOCK=900000`).
- 2026-09-02 — The API lives in `packages/api` as Hono routes over a `Repository` interface and is
  mounted by the indexer's `src/api/index.ts`. One implementation, served next to the data in dev,
  still deployable on its own later.
- 2026-09-02 — `corporate_actions.id = issuerId:processDate`, `issuer_id` kept as a column;
  `pairing.ts` keys one-to-one bookkeeping on the same pair. Cause: the issuer's `id` is a series
  id (SGOV/SHY/BND), and the live table had lost the three pending September rows to it.
- 2026-09-02 — `/v1/:chain/tokens/:addr/yield` is a **distribution ledger**, not a rate. Chosen by
  a three-judge panel over four independent designs (2/3 for "the ledger", with the runner-up's
  explicit `underlyingPrice` derivation, dividend / unexplained growth split and typed refusals
  grafted on). `netYieldBps` exists only on a step paired with an issuer cash dividend; `totals`
  exist only when the ledger *closes* (last step's `newMultiplier == uiMultiplier()` at the head);
  annualised, trailing and forward figures are absent from the shape and listed under
  `notComputed` with a reason code. Library `packages/core/src/yield.ts`, tests on SGOV's real
  three-step history.
- 2026-09-02 — `/v1/:chain/tokens/:addr/pending` separates `scheduled` (announced on chain, ~9 min
  out) from `awaiting` (declared, inside the 4-day window) and `declared_complete_not_on_chain`
  (the issuer says COMPLETED, the multiplier has not moved). Cash owed per token is stated because
  it needs no price (`rate × uiMultiplier`); the step a full payment would produce is a
  **projection** at the latest round, flagged `notAMeasurement`; the landing date and the surviving
  fraction are refused under `notComputed`. Library `packages/core/src/pending.ts`.
- _(append decisions here as they are made)_

## Status

- [x] Phase 0 verification report — `docs/phase-0-verification.md`
- [x] **M1 indexer + status page** — 194 tokens polled, 35 feeds live, 12 multiplier events, page
      renders real mainnet data, tests green. API: `/v1/health`, `/v1/chains`,
      `/v1/:chain/tokens`, `/v1/:chain/tokens/:address`, `/v1/:chain/events`, `/v1/status`,
      `/v1/calendar`.
- [x] **M2 net yield + calendar** — `/v1/calendar` serves the issuer's upcoming rows;
      `/v1/:chain/tokens/:addr/yield` serves the distribution ledger (see decision log). The status
      page does not render the ledger yet.
- [x] **M3 reconciliation + pending** — `reconciliations` table computed live by the poller and served at
      `/v1/:chain/reconciliations`; the observed haircut and the never-applied dividends are on the
      status page, and `/v1/:chain/tokens/:addr/pending` reports what is owed and has not arrived.
- [ ] M4 signed webhooks
- [ ] M5 SDK + docs

### Known gaps

- `multiplier_events.kind` is still always `unknown`. The pairing now exists in
  `packages/core/src/pairing.ts`, so writing the issuer's action type back onto the event row is a
  small remaining step.
- `feed_rounds` accumulates one row per distinct Chainlink round and nothing prunes it.
- The poller re-reads all 194 tokens every interval; only rows that changed need writing.
- `packages/indexer` has no tests of its own (the poller, the sweep and the reconcile pass are
  only exercised by running it). `packages/api` has route and serializer tests.
- The status page does not surface `/yield` or `/pending`; both are API-only for now.
- The reconciliation covers cash dividends only. A split matched to a step is written as
  `unsupported_action_type` rather than forced through a per-share model that does not fit it.
