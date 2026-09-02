# Phase 0 — onchain verification report

Run on **2026-09-02**, against Robinhood Chain mainnet at block **52 597 339**.
Everything below was read from the chain or from a first-party publisher. Nothing here is inferred.

Reproduce with:

```bash
node scripts/phase0/check-chain.mjs
node scripts/phase0/check-tokens.mjs AAPL SGOV CRWD
node scripts/phase0/check-feeds.mjs
node scripts/phase0/find-multiplier-events.mjs
node scripts/phase0/map-feeds.mjs
node scripts/phase0/check-corporate-actions.mjs
node scripts/phase0/feed-price-at.mjs 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 2026-08-14T15:12:46Z
```

> **Addendum, same day.** §9 originally listed two blockers. Both dissolved once the issuer's
> REST API was read — see §11 and §12. The original findings are kept as written; §9 is
> superseded.

---

## 1. Verdict table

| # | Claim in the kickoff prompt | Verdict | Detail |
|---|---|---|---|
| 1 | `chainId = 4663`, Arbitrum Orbit, ETH gas | **Confirmed** | `eth_chainId` → `0x1237` |
| 2 | Public RPC exists | **Confirmed, with a blocker** | `https://rpc.mainnet.chain.robinhood.com`. See §7 |
| 3 | Twelve token addresses (third-party source) | **Confirmed** | All 12 match the issuer's own registry, byte for byte |
| 4 | Stock Tokens are ERC-20, 18 decimals | **Confirmed** | 194/194 tokens report 18 decimals |
| 5 | USDG has 6 decimals | **Confirmed** | `decimals()` → 6 |
| 6 | ERC-8056 views exist | **Confirmed** | `uiMultiplier`, `newUIMultiplier`, `effectiveAt`, `oraclePaused` all answer |
| 7 | Chainlink feeds, 8 decimals, 24/5 | **Confirmed** | 35 tokenized-equity feeds, `us_equities_24/5`, 8 decimals |
| 8 | "200+ Stock Tokens" | **Corrected** | **194** active deployments, all on chain 4663 |
| 9 | "No `UIMultiplierUpdated` has fired yet; all multipliers read 1.0" | **FALSE** | **12 logs across 9 tokens** at report time; the full scan in §13 makes it 13 logs, 12 distinct changes, 10 tokens. See §4 |
| 10 | "The multiplier is applied two to four weeks after the ex-date" | **FALSE onchain** | Announcement → application is **9–10 minutes**. See §5 |
| 11 | "`newUIMultiplier()` is the scheduled, not-yet-active value" | **Corrected** | It mirrors `uiMultiplier()` when nothing is pending. See §5 |
| 12 | Dividends move the multiplier 0.05 %–2 % | **Corrected** | Observed range **0.0064 % – 2.15 %**, plus one ×4 split |
| 13 | Chainlink price is total return, already multiplied | **Confirmed by Chainlink** | "Token Price = Underlying Equity Market Price × Multiplier" |
| 14 | ERC-721 `Transfer` shares topic0 with ERC-20 | **Confirmed by construction** | Both are `keccak("Transfer(address,address,uint256)")`. See §8 |
| 15 | "Distribution fees and withholding are documented nowhere" | **Confirmed — and now measurable** | The issuer publishes each dividend's gross rate. Two reconciled events show a **~34–36 % haircut**. See §12 |
| 16 | "A corporate-actions data source has to be bought" *(my own §9)* | **Withdrawn** | `api.robinhood.com/rhj/corporate-actions` is first-party, free, address-keyed. See §11 |

---

## 2. Chain

| | |
|---|---|
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| `eth_chainId` | `0x1237` = **4663** |
| Head at report time | block 52 597 339, 2026-09-02T13:05Z |
| Block 1 | 2026-04-30T16:52:11Z |
| Cadence (last 10 000 blocks) | **0.1008 s/block** → ≈ **857 000 blocks/day** |
| Explorer | `https://robinhoodchain.blockscout.com` — behind a Cloudflare interstitial, **not usable as a programmatic source** |

Block 0 carries timestamp `0`; use block 1 for any genesis math.

The chain has been producing blocks since 2026-04-30, i.e. two months **before** the 2026-07-01
public mainnet date. Block ≈ 900 000 is the first block on 2026-07-01. The earliest event we care
about (CRWD, §4) is at block 978 630, so `RHC_START_BLOCK=900000` is a safe indexing floor and
saves 900 k blocks of nothing.

## 3. Tokens

**The address list is no longer a `TODO_VERIFY`.** Robinhood publishes a first-party registry:

```
GET https://api.robinhood.com/rhj/assets
```

This is the exact endpoint `docs.robinhood.com/chain/contracts` calls to render its own table
(confirmed by reading the doc site's `AssetsTable` bundle). It returns, per asset: `tokenSymbol`,
`tokenName`, `tokenDecimals`, `isin`, `status`, `currentMultiplier`, `pendingMultiplier`, a logo
URL, trading capabilities per session, and `deployments[].contractAddress` + `chainId`.

Snapshot committed at `data/robinhood-assets.snapshot.json` (194 assets, 2026-09-02).

- **194** assets, **all** `ASSET_STATUS_ACTIVE`, **all** on `chainId` 4663, **all** 18 decimals.
- All twelve prompt addresses match the registry exactly. Zero divergence.
- Every Stock Token is a **beacon proxy**: 283 bytes of runtime code, EIP-1967 beacon slot →
  `0xe10b6f6b275de231345c20d14ab812db62151b00`. The implementation slot and the admin slot are
  empty. **Consequence:** all 194 tokens share one implementation, so one ABI covers the whole
  set — and Robinhood can change that ABI for all of them at once, without a per-token event.
  The indexer must tolerate an implementation swap.
- `USDG` (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals) and
  `WETH` (`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`) are plain tokens: every ERC-8056 view
  reverts on them. They must never be routed through the Stock Token code path.

Spot reads on the twelve prompt tokens (all `oraclePaused() == false`):

| Ticker | Address | `uiMultiplier()` |
|---|---|---|
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | 1.0 |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 1.0 |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | **1.000566080061092436** |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | 1.0 |
| AMZN | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` | 1.0 |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | 1.0 |
| META | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | 1.0 |
| COIN | `0x6330D8C3178a418788dF01a47479c0ce7CCF450b` | 1.0 |
| SPCX | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` | 1.0 |
| SPY | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | 1.0 |
| QQQ | `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68` | 1.0 |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | *reverts — not a Stock Token* |

## 4. Multiplier events — the prompt's central assumption is wrong

**Twelve `UIMultiplierUpdated` logs, nine tokens, since 2026-07-02** — as found by the targeted
scan at report time. The full-chain sweep the same afternoon (§13) found a thirteenth, F, which the
committed `data/multiplier-events.observed.json` now includes: 13 logs, 12 distinct changes, 10
tokens.

`topic0 = 0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055`

| Announced (UTC) | Token | Effective (UTC) | Lead | Multiplier | Step |
|---|---|---|---|---|---|
| 2026-07-02 01:01:22 | CRWD | 2026-07-02 13:30:00 | 748.6 min | 1.0 → 4.0 | +30 000 bps |
| 2026-07-02 12:15:44 | CRWD | 2026-07-02 13:30:00 | 74.3 min | 1.0 → 4.0 | *re-announcement* |
| 2026-07-08 20:05:10 | SGOV | 2026-07-08 20:14:32 | 9.4 min | 1.0 → 1.000957519890990718 | +9.58 bps |
| 2026-07-24 15:00:40 | MU | 2026-07-24 15:10:24 | 9.7 min | 1.0 → 1.000074823219171086 | +0.75 bps |
| 2026-07-27 15:00:45 | ORCL | 2026-07-27 15:10:23 | 9.6 min | 1.0 → 1.002210914971013375 | +22.11 bps |
| 2026-08-03 15:00:48 | DELL | 2026-08-03 15:10:23 | 9.6 min | 1.0 → 1.000063708620124549 | +0.64 bps |
| 2026-08-06 15:01:01 | ASML | 2026-08-06 15:10:25 | 9.4 min | 1.0 → 1.000101323251417769 | +1.01 bps |
| 2026-08-07 15:00:36 | SGOV | 2026-08-07 15:10:24 | 9.8 min | 1.000957… → 1.002981519346766532 | +20.22 bps |
| 2026-08-10 15:01:06 | COST | 2026-08-10 15:10:24 | 9.3 min | 1.0 → 1.000612040296259656 | +6.12 bps |
| 2026-08-14 15:03:06 | AAPL | 2026-08-14 15:12:46 | 9.7 min | 1.0 → 1.000566080061092436 | +5.66 bps |
| 2026-08-31 15:01:22 | CCL | 2026-08-31 15:10:26 | 9.1 min | 1.0 → 1.021486444855206408 | +214.86 bps |
| 2026-08-31 23:50:51 | SGOV | 2026-09-01 00:00:26 | 9.6 min | 1.002981… → 1.005101770003214918 | +21.14 bps |

What this changes:

- **The "capture the very first event" thesis is gone.** The first one landed on 2026-07-02 and we
  missed it by two months. What replaces it is better: there is already a real, reconstructable
  history to reconcile against — 11 distinct corporate actions with exact onchain amounts.
- **SGOV has three events.** It is the reference token for building and testing the reconciliation
  logic: a monthly distribution with a visible chain of multipliers (1.0 → 1.000957 → 1.002981 →
  1.005101).
- **CCL at +214.86 bps is outside the 0.05 %–2 % band** the prompt states. CRWD at +30 000 bps is
  a ×4 corporate action. The `kind` classifier cannot key off a magnitude band; it needs the
  traditional-world action to say what it was.
- **A schedule can be re-announced.** CRWD emitted the same `(newMultiplier, effectiveAt)` pair
  twice, 11 hours apart. `multiplier_events` must be keyed on `(token, effectiveAt)` and upsert on
  re-announcement, keeping every announcement tx — not append blindly, or CRWD becomes two
  corporate actions.
- **Eight of the twelve events fire at 15:00–15:03 UTC and land at 15:10:2x UTC** (11:10 ET). That
  is a daily batch. The exceptions are both SGOV (20:14 UTC in July, 00:00 UTC in September) and
  CRWD. Do not hardcode the window, but a poller can be cheap outside it.

## 5. `newUIMultiplier` / `effectiveAt` do not mean what the prompt says

Read on all 194 tokens, right now: **`newUIMultiplier() == uiMultiplier()` everywhere**, and
`effectiveAt()` is a timestamp **in the past** for the nine tokens that have moved, `0` for the
rest.

So these views are not "pending value / activation date". They are **"the last scheduled change and
when it took effect"**. A pending update exists only while:

```
effectiveAt() > block.timestamp   AND   newUIMultiplier() != uiMultiplier()
```

**And there is no event at application time.** Scanning 200 000 blocks *after* the activation
timestamp of both SGOV and CCL returns **zero** `UIMultiplierUpdated` logs. The change is announced
once, then takes effect silently when the clock passes `effectiveAt`.

Two consequences for the architecture, both load-bearing:

1. **Ponder alone cannot produce the `applied` row.** An indexer only sees logs, and there is no
   application log. `multiplier_events.applied_at` has to be derived from `effectiveAt` by a
   scheduler, or `applied_tx` has to be dropped from the model. I would drop it: the honest schema
   is `announced_tx` + `announced_at` + `effective_at`, and an `applied` boolean derived from the
   clock.
2. **The alerting window is ~9 minutes, not weeks.** A `multiplier.scheduled` webhook that fires on
   the log gives a curator nine minutes of warning. That is still the only such warning anyone
   publishes, and it is enough to pause a market — but it must be sold as a 9-minute head start,
   not a 2-week one.

**The "pending dividend" product does not come from `effectiveAt` at all.** The weeks-long window
the prompt describes is ex-date (traditional) → multiplier step (onchain). Only the second half is
onchain. The first half comes from the issuer's own corporate-actions feed (§11) — and that feed
shows seven dividends the issuer marks *completed* that have **not** reached the chain after four
weeks (§12). The window is real; it is just measured from the issuer's `processDate`, not from
`effectiveAt`.

## 6. Chainlink feeds

Source: `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json` — the file
`docs.chain.link` itself renders. Snapshot at `data/chainlink-feeds.snapshot.json`.

- **57 feeds** on Robinhood Chain, of which **35 tokenized-equity** (`marketHours:
  "us_equities_24/5"`), the rest crypto/FX.
- All equity feeds: **8 decimals**, heartbeat **86 400 s**, deviation threshold **0.5 %**.
- Chainlink documents the methodology as `Token Price = Underlying Equity Market Price × Multiplier`
  and documents `oraclePaused()` as halting publication during corporate actions. **This confirms
  rule 5: never multiply a feed price by `uiMultiplier()`.**

Live reads (2026-09-02T13:05Z) — the staleness problem is not theoretical:

| Ticker | Price | `updatedAt` | Age |
|---|---|---|---|
| COIN | 174.7914 | 12:57:16Z | 8 min |
| ASML | 1658.2740 | 12:55:08Z | 10 min |
| MSFT | 500.7996 | 12:54:07Z | 11 min |
| AAPL | 326.6872 | 12:00:08Z | 65 min |
| SPCX | 142.0454 | 11:38:36Z | 87 min |
| QQQ | 704.7437 | 08:51:57Z | **4 h 13** |
| SPY | 759.6150 | 2026-09-01 18:46:04Z | **18 h 19** |
| USDG | 0.9998 | 2026-09-01 15:29:15Z | **21 h 36** |

SPY and QQQ are hours stale during a live US session. Whatever a lending market is doing with those
feeds, it is doing it on yesterday's number. That is the `feed.stale` product, visible on day one.

**Feed coverage is 35 / 194 = 18 %.** Only 35 Stock Tokens have a Chainlink feed at all. Among the
nine tokens that have actually moved their multiplier, **CRWD, CCL and COST have no feed** — three
of the eleven real corporate actions are invisible to any oracle-based tool. This is a bigger
finding than it looks: for 159 tokens exdate's multiplier data is the *only* pricing-relevant signal
that exists.

Token → feed pairing is committed at `data/token-feed-map.json`, generated by
`scripts/phase0/map-feeds.mjs`. **Every row is `verified: false`.** Chainlink names its feeds
"Robinhood AAPL / USD", "RHTSLA / USD", "Robinhood SGOV-USD" — inconsistently — and there is no
onchain link from a token to its aggregator. The mapping is ticker-derived, which violates
`CLAUDE.md` rule 4 (identify by address, never symbol). It is committed as a heuristic, marked as
one, and must not be promoted without an issuer- or Chainlink-published statement.

## 7. Blocker — the public RPC cannot back the indexer

| Symptom | Evidence |
|---|---|
| Aggressive rate limiting | HTTP 429 after a handful of consecutive calls; every Phase 0 script runs behind a 350 ms global gap |
| `eth_getLogs` result cap | `logs matched by query exceeds limit of 10000` (and, from other nodes in the pool, `50000` — the limit is inconsistent across the load balancer) |
| `eth_getLogs` timeout | `log query timed out` on a 400 000-block address-filtered query |
| No usable explorer API | `robinhoodchain.blockscout.com` returns a Cloudflare JS challenge |

Volume, measured on AAPL alone:

| Window | All logs | `TransferWithScaledUI` |
|---|---|---|
| 2 000 blocks (3.3 min) | 631 | 303 |
| 10 000 blocks (16.7 min) | 4 529 | 2 087 |
| 20 000 blocks (33.3 min) | 8 649 | 4 046 |

≈ **375 000 logs/day for one token**, ≈ 175 000 of them `TransferWithScaledUI`. Extrapolated across
194 tokens over the 63 days since 2026-07-01, a full transfer backfill is in the **hundreds of
millions of logs**. On a rate-limited public endpoint capped at 10 000 logs per query, that is
tens of thousands of successful requests minimum, and it will not complete.

**Two conclusions.**

1. A dedicated archive RPC (QuickNode / Chainstack / dRPC all advertise Robinhood Chain) is a hard
   requirement before any backfill. Budget item, needed before M1 finishes.
2. **More importantly: M1 should not index transfers at all.** The entire differentiating dataset —
   12 multiplier events, 194 token rows, 35 feed states, pause events — is a few hundred rows. It
   backfills in minutes even on the public endpoint. Transfers are 99.999 % of the volume and 0 % of
   the product right now. The "46 % of transfers happen off-hours" statistic is a *marketing* fact
   about why feed staleness matters; it does not require indexing every transfer to state.

   Proposed M1 scope: multiplier events (full history, cheap) + a poller for the ERC-8056 views and
   the feeds + the status page. Transfers become an explicit later decision, gated on a paid RPC.

## 8. Traps — status

- **ERC-721 / ERC-20 `Transfer` topic0 collision — real, and structural.** Both standards declare
  `Transfer(address,address,uint256)`, so `topic0` is identical by construction:
  `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`. The ERC-721 version indexes
  `tokenId`, giving a **fourth topic and empty `data`**; the ERC-20 version carries the amount in
  `data`. Filter: **drop any `Transfer` log with `topics.length == 4`.** This is not specific to
  Robinhood Punks — it applies to every NFT on the chain — so filter on topic arity, never on a
  collection address. Since M1 will not index transfers (§7), this lands in the test suite now and
  in the ingest path when transfers do.
- **A `Transfer` is not a trade.** Unchanged, and still correct. A provable trade needs both legs in
  one `transactionHash`.
- **Mint = from `0x0`, burn = to `0x0`.** Unchanged.
- **Identify by address, never symbol.** Now enforceable: the issuer registry is address-keyed. The
  one place we currently violate it is the Chainlink feed map (§6), and it is marked as such.
- **New trap — beacon proxy.** All 194 tokens delegate to one beacon
  (`0xe10b6f6b275de231345c20d14ab812db62151b00`). A single upgrade changes the ABI of every token
  simultaneously. Worth a monitor.
- **New trap — `effectiveAt` is retrospective.** See §5. Anything treating a non-zero `effectiveAt`
  as a pending update will report 9 phantom pending dividends today.

## 9. What is blocking, ranked — SUPERSEDED, see §11

Original list, kept for the record:

| # | Item | Status after §11 / §12 |
|---|---|---|
| 1 | Corporate-actions data source | **Resolved.** First-party, free: `GET api.robinhood.com/rhj/corporate-actions`. Gap: history starts 2026-08-05, so five July events need a one-off manual seed. |
| 2 | Dedicated archive RPC | **Not needed for M1–M3.** Multiplier history is 12 logs. Historical feed prices come from `getRoundData()` on current storage (§12), no archive required. Only a transfer indexer would need it. |
| 3 | Confirmation of the token → feed mapping | Still a heuristic, still `verified: false`. Now lower stakes: `/rhj/prices` gives a first-party reference price for all 194 tokens, feed or not. |
| 4 | Fee/withholding documentation | Still undocumented. Now **measured** instead: §12. |

Nothing on this list requires a purchase or a vendor decision before M3.

## 10. Recommended change to the data model

Based on §4 and §5:

```diff
 multiplier_events(id pk, token fk, chain_id, old_m, new_m, effective_at,
-                  scheduled_tx, scheduled_at, applied_tx, applied_at, kind)
+                  announced_tx, announced_at, announced_block,
+                  superseded_by,          -- re-announcement chain (see CRWD)
+                  applied bool,           -- derived: effective_at <= now()
+                  kind)                   -- dividend | split | reverse_split | unknown
+  unique (chain_id, token, effective_at)
```

`applied_tx` and `applied_at` are removed because no such transaction or log exists. Keeping them
would mean showing a column exdate can never fill — exactly what the honesty policy forbids.

Everything else in the proposed model survives Phase 0 unchanged, with one addition from §11:
`corporate_actions.source` gets the literal value `robinhood:/rhj/corporate-actions` and the row
keeps the issuer's `id` (a 0x + 66-hex uid, stable across chains) for deduplication.

## 11. The issuer's REST API — resolves both blockers

`docs.robinhood.com/chain/stock-token-apis` documents three read-only endpoints under
`https://api.robinhood.com/rhj/`. No auth. Documented limit 60 req/s; in practice `/prices`
answers `local_rate_limited` after ~5 rapid calls, so poll gently.

| Endpoint | Cache | What it gives exdate |
|---|---|---|
| `GET /rhj/assets` | — | The registry (§3). Also `pendingMultiplier` and `pendingMultiplierEffectiveTime` (RFC-3339, present only while a change is pending) — an offchain mirror of `newUIMultiplier()` / `effectiveAt()`. |
| `GET /rhj/prices/{symbol}` | 15 s | **Raw underlying-equity bid/ask, not multiplier-adjusted**, plus `isTradingHalt`, daily volume, and undocumented `mintBurnTokenVolume` / `mintBurnUsdVolume`. A first-party reference price for all 194 tokens, including the 159 with no Chainlink feed. |
| `GET /rhj/corporate-actions` | 1 h | **Every dividend and split the issuer processes**, with `cashDividend.rate` (USD per share), `forwardSplit.oldRate/newRate`, `processDate`, `status`, and the token's contract address. The docs say it outright: *"Use this endpoint to reconcile why a token's multiplier changed onchain."* |

Snapshot at `data/robinhood-corporate-actions.snapshot.json` (43 rows, 2026-09-02). Reconcile
with `node scripts/phase0/check-corporate-actions.mjs`.

What the corporate-actions feed contained on 2026-09-02:

- **43 rows, all `CASH_DIVIDEND`**: 12 `COMPLETED`, 31 `IN_PROGRESS` with a `processDate` and a
  rate. The 31 upcoming rows — F, KLAC, PFE, JBL, UPS, BND, SHY, … NVDA on 2026-10-01 — **are
  `/v1/calendar`**, ready today.
- **History is shallow.** The oldest `COMPLETED` row is `processDate` 2026-08-05. Six onchain
  events from July and early August (CRWD ×4, SGOV 07-08, MU, ORCL, DELL) and SGOV's 09-01 step
  have no row. Robinhood keeps roughly a month; exdate keeping it forever is itself part of the
  product. The five July actions need a one-off manual seed from issuer/company filings.
- **The CRWD ×4 split is absent** even though `FORWARD_SPLIT` is listed as "active at launch".
- **`processDate` is not the ex-date or the pay-date** (the docs say so). Empirically it is the
  business day *before* the onchain `effectiveAt`: AAPL 08-13 → 08-14, SGOV 08-06 → 08-07, ASML
  08-05 → 08-06, COST 08-07 (Fri) → 08-10 (Mon), CCL 08-28 (Fri) → 08-31 (Mon). Match on address
  plus a 0–4 day window.
- **Rate limit behaviour**: `local_rate_limited` is returned as plain text with HTTP 200 on
  `/prices`. Parse defensively.

## 12. First reconciliation — with every input sourced

Five completed dividends match an onchain multiplier step. For the three whose token has a
Chainlink feed, the price at the instant the multiplier took effect is readable **without an
archive node**: `getRoundData(roundId)` reads the aggregator's round history from current storage
(`scripts/phase0/feed-price-at.mjs`).

Method: a cash dividend of *R* USD/share reinvested at price *P* raises the multiplier by *R / P*.
`expected_step = R / P`; `observed_step` is the onchain log; `received = P × observed_step`;
`haircut = 1 − received / R`.

| Token | Gross rate *R* (issuer) | Price *P* (Chainlink, last round ≤ `effectiveAt`) | Expected | Observed | Received / share | **Haircut** |
|---|---|---|---|---|---|---|
| AAPL | $0.27 | 305.1710 @ 08-14 14:21 UTC | 8.85 bps | 5.66 bps | $0.1728 | **36.0 %** |
| SGOV | $0.306812 | 100.5712 @ 08-07 00:01 UTC | 30.51 bps | 20.22 bps | $0.2034 | **33.7 %** |
| ASML | $1.817086 | 1726.3000 @ 08-06 14:12 UTC | 10.53 bps | 1.01 bps | $0.1749 | 90.4 % → **anomaly** |
| COST | $1.47 | *no feed* | — | 6.12 bps | — | implied *P* = $2 401.80 vs ~$933 spot → **anomaly** |
| CCL | $0.15 | *no feed* | — | 214.86 bps | — | implied *P* = $6.98 vs ~$23.9 spot → **anomaly** |

Using the NYSE close of `processDate` instead of the `effectiveAt` round moves AAPL to 36.1 % and
SGOV to 33.7 % — the result is insensitive to the price choice at this precision.

Read this carefully:

- **AAPL and SGOV agree on a haircut in the mid-30s.** Two independent issuers' dividends, two
  independent feeds, one number. The US statutory withholding on dividends paid to a non-treaty
  foreign holder is 30 %; a Jersey issuer holding US equities would be exactly that. The extra
  4–6 points are unexplained — fees, price slippage on the reinvestment, or rounding. exdate
  reports the observed number and does **not** claim the decomposition.
- **ASML, COST and CCL do not reconcile** under the reinvestment model. ASML's step is a tenth
  of what its rate implies; CCL's is three times larger than its rate could produce; COST's
  implies a reinvestment price two and a half times spot. These are `status: anomaly` rows — the
  first three the product will ever show — and they are worth more than the matches: either the
  issuer's rate is wrong, the model is wrong for ETFs/ADRs, or something is being processed that
  the feed does not describe. I have not guessed which.
- **Seven completed dividends have not reached the chain.** BND (08-05), SHY, UMC (08-06), SIMO
  (08-20), FIX (08-24), CTSH, HWM (08-25) are `COMPLETED` in the issuer's feed, yet on
  2026-09-02 each token reads `uiMultiplier() == 1.0`, `newUIMultiplier() == 1.0`,
  `effectiveAt() == 0`, nothing pending. Four weeks for BND. This is the pending-dividend window
  the prompt described, observed rather than assumed — and exdate is the only thing that can show
  it, because it needs both sides.
- **Confidence**: `low` on every row above, by the kickoff's own rule (fewer than three events
  per token). `P` is the oracle price at activation, not the issuer's execution price, and the
  issuer does not publish the latter. The numbers are reproducible, sourced, and observed; they are
  not official.

What this settles: **the reconciliation table can be built and populated today**, with zero
third-party vendors. Five completed dividends paired with a step — two reconcile, three are
anomalies — plus seven pending and six onchain-only.

## 13. What M1 measured, and what it changed

Building the indexer produced four facts Phase 0 had not reached. All are from the same public
endpoint on 2026-09-02.

**Multicall3 is deployed** at the canonical address `0xcA11bde05977b3631167028862bE2a173976CA11`
(3 808 bytes of code). The poller reads five ERC-8056 views on 194 tokens plus 35 feeds in about
thirty requests instead of 1 005.

**There is no archive at all.** `eth_call` pinned to `latest - 1 000` works; at `latest - 10 000`
the node answers `metadata is not found`. State history is a few thousand blocks — minutes, not
days. This is why the poller declares `startBlock: "latest"`: a historical poll is not merely
wasteful here, it is impossible.

**The rate limiter is cost-based, not rate-based.** Measured:

| Call | Shape | Rejections |
|---|---|---|
| `eth_blockNumber` | 25 serial, no gap | 0 / 25 |
| `eth_blockNumber` | 8 in parallel, 4 rounds | 0 / 32 |
| `eth_getLogs`, 51 addresses, 25 blocks | serial, no gap | 4 / 8 |
| `eth_getLogs`, 51 addresses, 25 blocks | serial, 150 ms gap | 1 / 8 |
| `eth_getLogs`, 194 addresses, 2 000 000 blocks | serial, 150 ms gap | 2 / 8 |

Pacing barely moves the rejection rate. Retrying is what gets a query through, which is what the
Phase 0 scripts were doing all along without anyone noticing why they worked.
`packages/core/src/transport.ts` now does the same underneath the indexer.

**Ponder cannot walk this chain's history on this endpoint.** Its historical loop splits the 194
addresses into four `eth_getLogs` calls per sync round and sizes each round from the previous
round's duration — starting at 25 blocks, growing by at most half, and only when a round finishes
inside its target. Here a round takes 9 to 16 seconds, so the range never leaves its floor.
Measured at 25 blocks per 12 s, the 51.7 M blocks since the public mainnet date would take about
**300 days**. One wide query per 2 000 000 blocks scans the same range in **26 requests, roughly
two minutes** — `scripts/backfill-multiplier-events.mjs`.

So M1 indexes in two tiers, and the split is recorded per row rather than hidden:

| Tier | Who | `source` |
|---|---|---|
| History | `scripts/backfill-multiplier-events.mjs`, seeded by the poller on first run | `onchain:scan` |
| Live | Ponder, `startBlock: "latest"` | `onchain:indexer` |

Both are real logs with real transaction hashes; they differ only in which scanner found them, and
the indexer wins on conflict. Setting `RHC_RPC_URL_ARCHIVE` and `RHC_START_BLOCK=900000` hands the
whole history back to Ponder without touching code.

**The scan also found a thirteenth log.** A full-chain sweep on 2026-09-02 at 15:13 UTC returned 13
`UIMultiplierUpdated` logs, one more than §4's targeted scan: **F (Ford), announced 15:00:41 UTC,
effective 15:10:26 UTC, +1.46 bps** — that same afternoon, against an issuer row carrying
`processDate` 2026-09-01 and a declared rate of $0.15. Twelve distinct changes across ten tokens,
since CRWD announced one of them twice.

---

## Sources

- Robinhood Chain docs — [building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/), [token contracts](https://docs.robinhood.com/chain/contracts)
- Robinhood asset registry — `https://api.robinhood.com/rhj/assets` (the endpoint the doc site itself calls)
- Robinhood Stock Token APIs — [docs](https://docs.robinhood.com/chain/stock-token-apis): `/rhj/assets`, `/rhj/prices/{symbol}`, `/rhj/corporate-actions`
- Chainlink — [Robinhood tokenized equity feeds](https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood), reference-data-directory `feeds-robinhood-mainnet.json`
- Robinhood Chain mainnet RPC — `https://rpc.mainnet.chain.robinhood.com`
- [ERC-8056](https://eips.ethereum.org/EIPS/eip-8056)
