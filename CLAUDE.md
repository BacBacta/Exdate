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
- **Public RPC cannot backfill.** 429s under light load; `eth_getLogs` caps at 10 000 results (and
  50 000 on some nodes in the pool — inconsistent) and times out on wide ranges. AAPL alone emits
  ≈ 375 000 logs/day. A dedicated archive endpoint is required before indexing transfers.
- A `Transfer` proves custody moved, not that a trade happened. A provable trade needs both legs
  (Stock Token + USDG) in the same `transactionHash`.
- Mint = transfer from `address(0)`. Burn = transfer to `address(0)`.
- ~46% of observed transfers happen outside NYSE hours, weekends included. Correctness during
  those windows is a requirement, not a nice-to-have.

## Observed corporate actions

12 `UIMultiplierUpdated` logs across 9 tokens since 2026-07-02, full data in
`data/multiplier-events.observed.json`. Rescan: `node scripts/phase0/find-multiplier-events.mjs`.

Observed step range: **+0.64 bps (DELL) to +214.86 bps (CCL)**, plus CRWD at ×4 (a split). The
"0.05 %–2 %" band from the kickoff prompt does not hold — do not classify `kind` by magnitude.

**SGOV is the reference token**: three chained events (1.0 → 1.000957 → 1.002981 → 1.005101),
which makes it the right fixture for reconciliation tests.

First reconciliation against the issuer's own rates (`docs/phase-0-verification.md` §12), price =
Chainlink round at `effectiveAt`, confidence `low`:

| Token | Gross | Received | Haircut | Status |
|---|---|---|---|---|
| AAPL | $0.27 | $0.1728 | **36.0 %** | matched |
| SGOV | $0.306812 | $0.2034 | **33.7 %** | matched |
| ASML | $1.817086 | $0.1749 | 90.4 % | anomaly |
| COST, CCL | — | no feed | — | anomaly (implied price far from spot) |
| BND, SHY, UMC, SIMO, FIX, CTSH, HWM | — | `COMPLETED` by issuer, multiplier still 1.0 | — | **pending** (BND: 4 weeks) |

Mid-30s on two independent tokens is consistent with 30 % US non-resident withholding plus
something unexplained. Report the observed number; never claim the decomposition.

## Stack

pnpm workspaces. `packages/indexer` (Ponder + Postgres), `packages/api` (Hono),
`packages/sdk` (`@exdate/sdk`, viem + fetch), `apps/status` (Next.js App Router). Vitest, focused
on: raw↔UI conversion, reconciliation logic, staleness detection, NFT log filtering.

Multi-chain from day one — Base / Coinbase B20 is a planned second issuer, so keep `chain_id` and
`issuer` in every table and never hardcode a single chain.

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
  `corporate_actions.source = 'robinhood:/rhj/corporate-actions'`, keep the issuer `id`.
- 2026-09-02 — No archive RPC before a transfer indexer exists. Nothing in M1–M3 needs one.
- _(append decisions here as they are made)_

## Status

- [x] Phase 0 verification report — `docs/phase-0-verification.md`
- [ ] M1 indexer + status page — **waiting on greenlight**, nothing else blocks it
- [ ] M2 net yield + calendar — calendar input exists today (31 upcoming rows)
- [ ] M3 reconciliation + pending dividend — 5 matched, 3 anomalies, 7 pending, already observable
- [ ] M4 signed webhooks
- [ ] M5 SDK + docs
