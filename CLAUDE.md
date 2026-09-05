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
  into ~30 requests. One `aggregate3` carrying 584 sub-calls (194 tokens × `balanceOf`,
  `balanceOfUI`, `uiMultiplier`, plus block and timestamp) is a single `eth_call`: 124 KB of
  calldata, 187 KB back, 140–340 ms, zero failures (measured 2026-09-03).
- **The public RPC answers browsers.** `access-control-allow-origin: *` on both the preflight and
  the POST (measured 2026-09-03), so a static page can read the chain with no server in between.
  That is what `/wallet/` on the public site does.
- **`block.number` inside the EVM is the parent chain's block, not this chain's.** Measured
  2026-09-03: Multicall3's `getBlockNumber()` answered 25 896 564 while `eth_blockNumber` and
  `ArbSys.arbBlockNumber()` (the Arbitrum precompile at `0x…64`, 1 byte of code) both answered
  53 391 912. A contract-side read that wants to date itself must go through ArbSys;
  `ROBINHOOD_CHAIN.blockNumberSource` carries the address and the computed selector.
- **Robinhood's own endpoint keeps no archive; the chain has one.** `eth_call` at
  `latest - 10 000` answers `metadata is not found` there, and that was recorded as a property of
  the chain for a month because nobody had looked at another endpoint. It is a property of that
  endpoint. The public chain registries list eight; **six answer, three serve state at any height,
  and two reach the oldest multiplier step** — but **which** two is not stable: measured again on the
  evening of 2026-09-04, `pocket.network` had lost archive since that morning and a newly listed
  `rpc.ordofi.network` had it, with a 10 000-block log cap against blockmachine's 1 000. Re-probe
  rather than trust the file's names. `data/rpc-endpoints.observed.json`,
  `node scripts/probe-rpc-endpoints.mjs`. Two independent endpoints agree at 20 M and 50 M blocks
  deep, three at 1 M, so the history is corroborated rather than taken from one witness.
  Set `RHC_RPC_URL_ARCHIVE` to use one.
  - **Production reads go to a third party first, Robinhood's endpoint only as the fallback** —
    since 2026-09-04, for a terms reason (`docs/terms-review.md`): the chain is outside Robinhood's
    Terms, its public RPC is a "Service" bound to testing and development and "not intended for
    production-grade" use. `scripts/phase0/rpc.mjs` (`makeFailoverRpc`, `RHC_RPC_URLS`) and the
    indexer's `failoverHttp` carry the same order: `robinhood.api.pocket.network`, then Robinhood's.
    The wallet page's balance read stays on Robinhood's RPC from the visitor's own browser, because
    the browser-answering third parties cap logs at 1 000 blocks — stated on the page.
  - Archive is tested as **state that differs from latest**, never `block.number`: Multicall3's
    `getBlockNumber()` answers on any node, and an endpoint serving head state at every height
    would pass a naive test. The decisive check is `reachesOldestStep`, not an arbitrary depth: a
    node with a million blocks of history looks archival and fails on exactly the reads that need it.
  - **Their capabilities do not overlap, so the project uses both.** Robinhood's own takes a
    2 000 000-block `eth_getLogs` and serves no state; `pocket.network` serves 53 M of history and
    refuses browsers; `blockmachine.io` serves 53 M and answers browsers but caps a log query at
    1 000 blocks. Wide log scans still go to Robinhood's; state reads go to an archive one.
  - They are **third parties with no service commitment**. Sound for history, which can be re-read
    at any time; never for a capture that cannot be re-read, which is why the effective-price
    watcher does not depend on one.
- Primary quote asset is **USDG** (6 decimals), not USDC.
- Deployed: Uniswap (v3 + v4 hooks), Morpho, Rialto (propAMM), Lighter (orderbook), Chainlink.
- **The DEX addresses are nowhere first-party.** `docs.robinhood.com/chain/protocol-contracts`
  lists the rollup, the bridge and the precompiles and **no venue at all**. So the venue was found
  by behaviour: Transfer counterparties holding code that answer `token0()`, `token1()` and
  `slot0()`. Uniswap v3 factory **`0x1f7d7550b1b028f7571e69a784071f0205fd2efa`** (24 535 bytes) then
  confirmed it by returning exactly those pools from its own `getPool` - which makes pool → factory
  a **first-party on-chain link**, unlike token → feed. Fee tiers 100/500/3000/10000; quote asset
  USDG. A second contract at `0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3` (4 917 bytes) answers pool
  selectors on its own pools but not `getPool`; it is recorded as an unidentified second venue
  rather than named. `scripts/phase0/discover-pools.mjs`, `data/dex-pools.json`: **277 pools across
  192 tokens, 105 with liquidity, 65 tokens quotable**.

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
- **It is a window, not a history.** ~1 month deep (oldest row 2026-08-05), and `limit` is the only
  request field it accepts — `limit=500` returns the same 43 rows, and `startDate`, `processDate`,
  `symbol`, `cursor`, `offset` are all rejected by name (the service is gRPC-transcoded and answers
  `Could not find field X in the type GetCorporateActionsRequest`). **A row that falls out is
  unrecoverable from every first-party source.** That is what happened to the five July actions
  behind CRWD, SGOV, MU, ORCL and DELL: their steps are on chain and will never have a declared
  rate, so they stay `unmatched` — and no seed can fix it without inventing numbers.
- The fix from here on is `data/corporate-actions.archive.json`, a committed cumulative archive
  keyed on `(issuer id, processDate)` with `firstSeenAt`/`lastSeenAt` and the status history.
  `node scripts/archive-corporate-actions.mjs` merges today's window into it (refusing to write on
  a bad read), a daily GitHub Action keeps it alive, and the poller seeds it into a fresh database
  with `source = 'robinhood:/rhj/corporate-actions#archived'` — the live feed reclaims the plain
  source for anything still in the window.
- **The issuer's `id` names a dividend series, not a payment.** SGOV, SHY and BND carry the same
  `id` on their August and September rows, with a different `processDate`, `rate` and `status` on
  each (3 of 40 ids in the 2026-09-02 snapshot). One action is `(id, processDate)`; keying on `id`
  alone silently dropped the pending month.
- `processDate` ≠ ex-date ≠ pay-date. Empirically the onchain `effectiveAt` lands the **next
  business day at ~15:10 UTC**. Match on address + 0–4 day window.
- Rate limiting is real despite the documented 60 req/s: `/prices` returns the plain-text body
  `local_rate_limited` with HTTP 200. Parse defensively, poll slowly.
- **`/prices` publishes the UNDERLYING equity price, and that is measured, not assumed.**
  `scripts/phase0/check-quote-basis.mjs` decides it against the 35 feeds: Chainlink publishes
  `P_token = P_equity x multiplier`, so only a token whose multiplier is far from 1.0 can separate
  the hypotheses, and only if its own price noise is smaller than that distance. **SGOV alone
  qualifies today** (multiplier 51 bps, treasury ETF): quote x multiplier lands **1.0 bps** from the
  feed, the bare quote **51.7 bps**. Every other mapped token has a multiplier under 23 bps and is
  inconclusive by construction. `data/issuer-quote-basis.json`.
- **The quote cannot be read back.** `/prices` serves the present only, so a price at a past instant
  is gone for good - the same one-way loss as the corporate-action window.
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
  staleness bound. Measured again 2026-09-04 at 06:15 UTC (pre-market): **median feed age 59
  minutes, 1 of 35 fresher than five minutes**, while the issuer's own quotes were live throughout.
  A price read from a feed off-hours dates from the last session; a quote does not. Also check the token's `oraclePaused()` — when true the feed stops publishing.
  Observed on 2026-09-02 during a live session: SPY 18 h stale, QQQ 4 h stale, USDG 21 h stale.
- **Every feed is published through two proxies.** The directory gives `proxyAddress` and
  `secondaryProxyAddress` (SVR, Smart Value Recapture); exdate reads the primary. Measured on all
  35 pairs: same `aggregator()`, same `description()`, same decimals, same answer, same `updatedAt`
  — **but a different phase**, so the encoded `roundId` is NOT portable (SGOV: phase 1 round 49 vs
  phase 2 round 49, identical answer). Never pass a roundId from one proxy to `getRoundData` on the
  other. `node scripts/phase0/check-svr-proxies.mjs`, `data/svr-proxy-check.json`.
- Token → feed mapping: `data/token-feed-map.json`, every row `verified: false`, and it stays that
  way: **no first-party, address-level statement links a token to a feed.** Measured, not assumed —
  the token implementation answers with no address at all (24 selectors probed by
  `scripts/phase0/probe-oracle-link.mjs`), Chainlink's directory carries no token address, and
  `/rhj/oracles` and `/rhj/feeds` do not exist. On the aggregator side `aggregator()` does resolve,
  so proxy → aggregator is on-chain verifiable.
- What the mapping now rests on instead (`scripts/phase0/verify-feed-map.mjs`, full output in
  `data/feed-map-verification.json`, method in `docs/phase-0-verification.md` §14):
  **35/35 aggregators name their ticker in their own on-chain `description()`** (three spellings:
  `Robinhood AAPL / USD`, `RHAMD / USD`, `Robinhood SGOV-USD`), and the issuer's registry carries
  **194 distinct tickers for 194 assets**, so a ticker resolves to exactly one address. Each half is
  first-party; only the join is inference.
- **23 of 35 pairings are corroborated by behaviour, in two different ways** — and the two are
  never merged, because they are not the same claim. `corroboratedBy` names which, everywhere the
  fact travels: the map, the generated registry, `reconcile()`, the API, the SDK and both sites.
  - **Causal — `multiplier-step`, SGOV alone.** Its 2026-07-08 step moved its feed by +9.5778 bps
    against an expected +9.5752, on a feed whose round-to-round noise is 0.0094 bps — and across
    all 35 mapped feeds at that instant, the assigned one is uniquely closest (next: 40.59 bps
    away). The other five equity tokens with steps are inconclusive by construction: a 0.5 %
    deviation threshold puts ~50 bps between consecutive rounds, so a dividend-sized step is
    invisible. SGOV's 2026-09-01 step disagrees (−3.03 vs +21.14 bps) and is reported as such: the
    equity leg is unobservable from here, and a total-return feed is designed to stay flat through
    a step.
  - **Identification — `traded-price`, 23 pairings** (SGOV among them, so it carries both).
    The token's on-chain traded price sits far closer to this feed's answer than to any other
    mapped feed, on a majority of at least three readings. Weaker on purpose: two unrelated assets
    can trade at one price. The 12 that fail are the informative half — CLSK, COIN, CRCL, CRWV,
    EWY, GME, IONQ, MSTR, NBIS, ORCL, RGTI, RKLB — almost all high-volatility names whose traded
    price is genuinely dislocated from the feed (GME's gap has been read at 664 bps on a pool
    holding $809 046). The test fails there because the premise fails, not because the pairing is
    wrong.
- Confidence ladder, in `reconcile.ts`: ticker match only → `low` always; `feedCorroborated` →
  `medium` from three events; a first-party address link → `high` from ten, which nothing reaches.
  **Both kinds of corroboration land on `medium`** — `medium` already means "believed on
  behaviour, not stated by anyone", which is true of both — and the row publishes
  `feedCorroboratedBy` so the weaker never borrows the stronger's standing.

## Known traps

- **`newUIMultiplier()` / `effectiveAt()` are retrospective, not prospective.** With nothing
  pending, `newUIMultiplier() == uiMultiplier()` and `effectiveAt()` is a past timestamp (or `0`
  for a token that never moved). A pending update exists **only** while
  `effectiveAt() > block.timestamp && newUIMultiplier() != uiMultiplier()`. Treating a non-zero
  `effectiveAt` as "pending" reports 9 phantom dividends today.
  **This is a property of ERC-8056, not of Robinhood** — found here by measurement, then
  confirmed in Base's own B20 changelog: "a nonzero `effectiveAt()` that's `<= block.timestamp`
  means *already applied*, not *pending*". Same for the missing application event: "No event
  fires at maturation."
- **There is no application event.** `UIMultiplierUpdated` fires once, at announcement, carrying a
  future `effectiveAt`. Nothing is emitted when the change takes effect (verified: zero logs in the
  200 000 blocks after activation for SGOV and CCL). An indexer alone cannot produce it — but with
  an archive endpoint the application is **observed rather than derived**: `uiMultiplier()` read at
  `effectiveBlock - 1` and at `effectiveBlock` shows the transition, and **12 of 12 steps confirm**
  against their announcement log. `node scripts/verify-multiplier-history.mjs`,
  `data/multiplier-state-verification.json`. The same reads observe the retrospective trap below at
  each announcement block, 12 of 12.
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
- **Transfer volume, measured across all 194 tokens on 2026-09-02**: two 750-block windows (75 s
  each, 20 minutes apart) held 6 425 and 11 032 ERC-20 transfers — **7.3 M and 12.6 M per day**. The
  order of magnitude is the fact; a 75-second window is not a day. AAPL alone measured ≈394 k/day,
  which confirms the ≈375 k figure from Phase 0. The busiest token is not AAPL: ZM, COST and SPCX
  each exceeded 1 M/day in a sample. `node scripts/phase0/measure-transfers.mjs`,
  `data/transfer-volume.observed.json`.
- **Primary flows are cheap to read and nobody publishes them.** Mint is a `Transfer` from
  `address(0)`, burn is a `Transfer` to it, so net creation - the signal an ETF publishes as net
  flow - is exact on chain. Measured 2026-09-04: a 5.6 h window across all 194 tokens took **6
  requests and 2.4 s** (372 mints, 101 burns, 62 tokens, net +703 255 tokens, of which AMC alone
  +687 395). A full day is ~20 requests. The issuer's own `/rhj/prices` carries
  `mintBurnTokenVolume` and `mintBurnUsdVolume`, but that is gross turnover with no sign and no
  history. `scripts/measure-primary-flows.mjs`, `data/primary-flows.observed.json`, daily Action.
- **74 % of transactions that move a Stock Token also move USDG in the same transaction** — the
  provable-trade share, ≈2 M/day. Most on-chain activity is trading, not custody movement.
- Indexing transfers is still the one thing an archive endpoint does **not** unlock on its own:
  7–13 M logs/day is 85–145 logs/second sustained, and the endpoints that serve history cap a log
  query at 1 000 to 2 000 000 blocks with their own rate limits (blockmachine's keyless tier is
  300 req/min per IP). The binding cost is storage, not the node: at roughly 250 bytes an indexed
  row — an estimate, not a measurement — 10 M rows/day is ~2.5 GB/day, ~75 GB/month.
- A `Transfer` proves custody moved, not that a trade happened. A provable trade needs both legs
  (Stock Token + USDG) in the same `transactionHash`.
- **One wallet's history is cheap for a person and impossible for a bot** (measured 2026-09-03,
  `eth_getLogs` with the 194 addresses and the wallet as a topic, whole chain in 5 M-block ranges):
  67 and 350 transfers → 22 requests, 1.2–1.5 s, zero rejections; 74 000 transfers → 38 requests
  with range halving, 27 rejections, 62 s; 88 000+ → still not done after 80 requests, and a bot
  receiving 9 600 transfers in 30 minutes times out on any range. A browser feature must cap its
  requests and refuse with a reason past that, never show a partial total.
- Mint = transfer from `address(0)`. Burn = transfer to `address(0)`.
- The kickoff brief states that ~46% of transfers happen outside NYSE hours, weekends included.
  **exdate is now measuring it** rather than repeating it — see "Off-hours share" below. Until that
  file says `sufficient: true` the figure stays the brief's, not an observation. Correctness during
  off-hours windows is a requirement either way, not a nice-to-have.

## Off-hours share — measured: 74.3 % (57 samples, 2026-09-03 → 09-05)

The one number left in the product that traced back to the brief rather than to a measurement,
now answered: **74.3 % of transfers and 76.4 % of provable trades fall outside the regular
session**, against the brief's 46 %. Published on the home page under *What we measured* since
2026-09-05, from `data/session-share.observed.json` and only while it says `sufficient: true`.
`scripts/measure-session-share.mjs` takes one sample per run — a ~40 s window of `Transfer` logs
across all 194 tokens, its rate in transfers per second, and the ET market session it fell in — and
appends it to `data/session-share.observed.json`. `.github/workflows/measure-session-share.yml`
runs it hourly.

- The published statistic is **a rate weighted by clock hours**, not a pooled count:
  `mean transfers/second in a session × that session's hours per week`, normalised across the five.
  An uneven sampling schedule therefore biases it far less. The pooled, uncorrected share is
  published beside it so the two can be compared.
- Sessions, in `America/New_York` so DST is not an offset anyone has to maintain: pre-market
  04:00–09:30 (27.5 h/week), regular 09:30–16:00 (32.5), after-hours 16:00–20:00 (20), overnight
  20:00–04:00 (40), weekend (48) — 168 h, and off-hours is 135.5 of them.
- **The share is refused until every session has ≥3 samples**, under
  `notComputed: insufficient_session_coverage`. Rule 2: a share computed before the regular session
  has been sampled would be a number about the sampling schedule.
- The classifier is `scripts/lib/market-session.mjs` — plain ESM with no dependencies, so the hourly
  Action runs it on a bare `node` with no install step and the sampling outlives the workspace. It
  is unit-tested in `packages/core/test/market-session.test.mjs` (18 tests: every boundary, the
  weekend, both DST directions, the 168 slots).
- A run whose window overlaps the last recorded sample appends nothing, so a duplicate fire is a
  no-op rather than a double count.
- Market holidays and half-days are **not** modelled and the file says so: a holiday counts as an
  ordinary weekday, so its quiet regular session drags that bucket's rate down slightly.

First sample 2026-09-03 07:48 UTC (overnight): 1 517 transfers in 41 s = **37 transfers/second**,
464 of the 630 token-moving transactions also moved USDG.

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
| `packages/indexer` | Ponder + PGlite/Postgres. Indexes `UIMultiplierUpdated`, polls the ERC-8056 views, the Chainlink feeds and the issuer's corporate actions, drains the webhook outbox, and serves the API. |
| `packages/api` | `@exdate/api` — Hono routes over a `Repository` interface, so it never builds SQL and stays deployable on its own. |
| `apps/status` | Next.js App Router status page. Reads the API and nothing else. |
| `apps/web` | `@exdate/web` — the public site. Static export (`output: 'export'`); every published figure is read at build time from `data/*.json` by `lib/observed.ts`, never from the API, so it deploys as plain files and cannot show a number that is not committed. The one runtime read is `/wallet/`: the visitor's own browser asks the chain what an address holds (one Multicall3 `eth_call` through `@exdate/core/holdings`, no server, no signature) and joins it with the committed record. Geist Sans/Mono self-hosted via the `geist` package. |
| `packages/sdk` | `@exdate/sdk` — typed client + webhook verifier over `@exdate/core` only, so a consumer never installs the server. Response shapes are hand-declared and compiled against the API's serialisers in `test/contract.assert.ts`. |

Vitest lives in `packages/core` (raw↔UI conversion, reconciliation, pairing, rounds, staleness,
NFT log filtering, the transport, the webhook scheme, the committed dataset, opt-in live checks),
`packages/api` (serialisation of every state the retrospective/prospective trap can produce) and `packages/sdk`
(URL building, typed errors, and a webhook round trip). `pnpm test`.

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

## Base — Coinbase B20, verified 2026-09-03

Read back by address on chain, not taken from the page:
`node scripts/phase0/verify-base-b20.mjs`, `data/base-b20-verification.json`. Full write-up in
`docs/second-issuer-base.md`.

- **Oracle registry `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD`** (chain 8453, 1 548 bytes).
  Chainlink names it and gives no address; Base gives the address and no ABI, so its 19 public
  selectors were read out of its own dispatcher. Three are OpenZeppelin AccessControl (confirmed by
  keccak). The fourth, **`0xd4197e82`, matched no candidate signature and stays unnamed** — but
  called with a token address it returns two words, the WAD multiplier and a pause flag, matching
  the token's own `multiplier()` on **13/13**. Called with WETH, or with an address holding no code,
  it **reverts**. That control is what makes the agreement mean something: the registry knows
  exactly those 13 addresses. It is a first-party address-level link, which Robinhood Chain has
  nowhere.
- **13 tokens**, `0xb2…` variant prefix, `symbol()` matching the documented ticker 13/13,
  **8 decimals** (not 18), **every multiplier still exactly 1.0** — no Coinbase corporate action
  has ever happened, so there is nothing on Base to reconcile yet.
- **A token address holds 1 byte of code, not 0.** They are B20 native precompiles: no per-asset
  contract, nothing verified on Basescan. An `extcodesize > 0` screen passes them by luck.
- **ERC-8056 is documented but not live.** `uiMultiplier`, `newUIMultiplier`, `effectiveAt`,
  `totalSupplyUI` and `WAD_PRECISION` **revert on all 13 tokens today**; only the Beryl
  `multiplier()` `0x1b3ed722` answers. Base lists the Cobalt hardfork as *Planning, September 2026*
  on both Sepolia and mainnet, which is consistent. A Base module must try both and let the revert
  decide.
- **4/4 ERC-8056 selectors agree** between exdate's own computed values and Base's frozen ABI —
  two independent first-party sources for numbers exdate already dials.
- **13/13 feeds name their ticker in `description()`**, 8 decimals, and **no SVR secondary proxy**
  anywhere. Ages at 04:08 ET ranged from 1 minute to 12 hours: the documented off-hours freeze.
- Still open: any Coinbase corporate-action feed, and the feed → token link, which remains a ticker
  join (`AAPLc` ↔ `Coinbase AAPL`) and so would rate `low` on the same confidence ladder.

Multi-chain from day one — Base / Coinbase B20 is a planned second issuer, so keep `chain_id` and
`issuer` in every table and never hardcode a single chain.

## Running it

```bash
pnpm install
pnpm dev          # Ponder indexer + API on http://localhost:42069
pnpm dev:status   # status page on http://localhost:3000
pnpm dev:web      # public site on http://localhost:3001 (static export: pnpm --filter @exdate/web build -> apps/web/out)
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
- 2026-09-02 — Name: **exdate**. Repo `exdate`, SDK `@exdate/sdk`.
  *(2026-09-03: `exdate.xyz` turned out to belong to someone else — see the entry of that day. The
  name stands; the domain did not. 2026-09-04: the domain is **`exdate.me`**, and the canonical host
  is `https://www.exdate.me` — the apex 308-redirects there. `api.exdate.me` and `status.exdate.me`
  are reserved and not yet live.)*
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
  out) from `awaiting` (declared, past the process date, inside the 4-day window; `upcoming` before
  that date — added 2026-09-03) and `declared_complete_not_on_chain`
  (the issuer says COMPLETED, the multiplier has not moved). Cash owed per token is stated because
  it needs no price (`rate × uiMultiplier`); the step a full payment would produce is a
  **projection** at the latest round, flagged `notAMeasurement`; the landing date and the surviving
  fraction are refused under `notComputed`. Library `packages/core/src/pending.ts`.
- 2026-09-02 — Webhooks are an **outbox**, not an inline send: events are written to
  `webhook_events` with a deterministic id and drained at the START of the poll cycle, like the
  reconcile pass and for the same Ponder reason. An indexing function that awaits someone else's
  server would stall indexing. Endpoints live in `EXDATE_WEBHOOK_ENDPOINTS` (parsed at boot, https
  required off localhost, secret ≥ 16 chars) and never in a table the API serves; the outbox route
  publishes the host, never the URL or the secret. Signature: HMAC-SHA256 over `${t}.${rawBody}`,
  300 s tolerance, seven retries over ~12 h, then `failed` and kept.
- 2026-09-02 — The SDK depends on `@exdate/core` only, never on `@exdate/api`: a consumer must not
  install Hono to read a multiplier. Consequence: response shapes are declared twice, so
  `packages/sdk/test/contract.assert.ts` compiles them against the serialisers in both directions
  (assignable, and no key the API adds stays invisible). It immediately caught `/v1/status`
  serving `ageSeconds`/`beyondHeartbeat` as `undefined` — dropped entirely by `JSON.stringify`,
  where the rule is null.
- 2026-09-02 — Webhook payloads are a typed contract in `@exdate/core` (`WebhookData`), and the
  indexer's `enqueueWebhook` is generic over it. A payload that drifts from what the SDK promises
  consumers is now a compile error.
- 2026-09-02 — Gaps closed: `multiplier_events.kind` is written back from the pairing on every
  reconcile pass (6 of 12 events classify as `dividend`; the other 6 predate the issuer's
  one-month feed and stay `unknown`); `dividend.pending` carries `backlog: true` for rows already
  outstanding at first run rather than hiding them; `feed_rounds` keeps 30 days
  (`EXDATE_FEED_ROUNDS_RETENTION_DAYS`, newest round per feed always kept) — it is an observation
  log, not the price history, which is read back from `getRoundData`; the static `tokens` row is
  written only when it changes; the outbox has unit tests against a fake Ponder store
  (`ponder:schema` aliased in `packages/indexer/vitest.config.ts`).
- 2026-09-04 — **A second kind of evidence for the token → feed pairing: the price it trades at.**
  `confidence` was `low` on 34 of 35 pairings, which undercut every haircut, and only SGOV had
  causal evidence. A pool price identifies its feed by ranking: measured at the first reading, the
  assigned feed is **uniquely the closest of all 26** in 24 cases, with separations of 3× to 15×.
  The test is a **ratio, not a distance** - feeds freeze off-hours, so the absolute gap is large for
  legitimate reasons while the ranking survives - and it refuses below 3×. It is weaker than the
  step test and labelled as such: two unrelated assets at one price defeat it, which MSTR ($142.68)
  and USO ($141.99) do to each other, and PLTR and ASML were also refused at the first reading. A
  pairing lifts only on **≥3 readings with a two-thirds majority**, so one lucky crossing cannot
  carry it; at one reading nothing is lifted and the map says `needs 3 readings, has 1`.
  `corroboratedBy` names which evidence carries a pairing, because `corroborated: true` alone would
  hide that the two are not the same claim. Neither reaches `high`, which stays reserved for a
  first-party address-level statement that does not exist.
- 2026-09-02 — The token → feed map is corroborated rather than verified, and the two words now
  mean different things in code. `verified` stays false everywhere (no first-party address-level
  statement exists, and that was probed, not assumed); `corroborated` means the token's own
  multiplier step was seen moving that feed by the step's own size, above the feed's noise, with no
  other mapped feed closer — true for SGOV alone. `reconcile()` takes `feedCorroborated` and lets it
  reach `medium`; `high` stays reserved for a first-party link.
- 2026-09-02 — The five July corporate actions **cannot be seeded**: the issuer's endpoint is a
  window with no pagination and no date filter (probed, not assumed), so their declared rates exist
  nowhere first-party. Inventing them would break rule 2, so those steps stay `unmatched` and the
  work went into making the loss impossible from now on: a committed cumulative archive, refreshed
  daily by CI, seeded into the database on first run.
- 2026-09-02 — `REGISTRY_GENERATED_AT` now comes from the snapshot's own `fetchedAt` rather than
  from the codegen run, so regenerating from unchanged data is byte-identical and CI can tell a
  stale artifact from a rebuild. The generated archive carries only fields that change when the
  issuer changes something — copying `lastSeenAt` through would rewrite the file daily to say
  nothing.
- 2026-09-02 — The SVR proxy is published alongside the primary (`feedSvrProxy`) rather than
  chosen between: both answer identically, so a consumer reading either sees the same price, and the
  one thing that differs — the phase-encoded `roundId` — is flagged as proxy-specific in the API.
- 2026-09-02 — Splits reconcile as a **ratio**, not a per-share amount: `reconcileSplit()` compares
  the declared `oldRate:newRate` against the observed multiplier ratio, needs no price and no
  oracle, and tolerates one basis point. It refuses when the issuer declares no ratio, which is the
  state of every split today: the only split ever observed (CRWD ×4) lost its issuer row, and all 43
  archived actions are cash dividends, so **no split payload has ever been seen** and none is
  guessed. Tested on CRWD's real step with constructed declared ratios, labelled as such.
- 2026-09-02 — Pause and feed-status transitions moved out of the poller into
  `pauseTransition()` / `feedStatusTransition()` in core, where they are tested. The distinction
  that matters: a token already paused the first time exdate looks is a **baseline**, not a pause,
  or every restart would announce a corporate action that did not happen.
- 2026-09-02 — Second issuer reconnaissance: `docs/second-issuer-base.md`. Coinbase B20 on Base has
  the same economics (multiplier, dividends converted to shares, total-return feed) but a different
  read path (an on-chain oracle registry, one call for all tokens), different event names
  (`MultiplierUpdated` + `Announcement` wrappers) and — notably — identity **by contract address
  rather than ticker**. It needs a source module, not a config entry. Not wired: the registry
  address, the token addresses and any corporate-action feed are all still unknown.
- 2026-09-03 — **Two of those three unknowns are closed, on chain.**
  `docs.base.org/specifications/b20/tokenized-stocks-on-base` publishes the oracle registry
  address, the 13 token addresses and the 13 feed proxies in one first-party table, and
  `scripts/phase0/verify-base-b20.mjs` checked every row against Base mainnet
  (`data/base-b20-verification.json`). See `docs/second-issuer-base.md`; the headline facts are in
  "Base — Coinbase B20" below. The corporate-action feed remains unknown, and it is the one that
  decides whether Base produces haircuts or only a step ledger.
- 2026-09-03 — The off-hours share is **measured hourly, not asserted**. The brief's ~46 % was the
  last product number sourced from nobody; a single window cannot answer it, because the answer is a
  rate that varies across the week. So: one sampled window per hour into a committed file, a share
  weighted by each session's clock hours rather than pooled, and the share itself **refused** until
  every session has three samples. The classifier is dependency-free plain ESM so the Action needs
  no install step, and unit-tested in `packages/core` because a boundary or a DST error would be
  larger than the effect.
- 2026-09-03 — `/pending` is on the status page, and it **replaces** the narrower "declared
  complete, never applied" table rather than sitting next to it: the endpoint serves the same rows
  plus the two states that table dropped (`awaiting`, `overdue`) and the one figure that needs no
  oracle, `grossPerToken = rate × uiMultiplier`. The page fetches `/pending` only for tokens that
  can have something pending — those in an unmatched declared action, plus those with a change
  announced on chain — so it is a handful of requests, not 194.
- 2026-09-03 — `/pending` grows a fourth declared state, `upcoming`, for a process date that has
  not arrived. Found by rendering the endpoint: the status page showed rows reading
  `awaiting, -21 / 4 days`, because `daysSinceProcessDate` goes negative for a future date and the
  `pastWindow` test then fell through to `awaiting`. That is not a display bug — `awaiting` asserts
  the chain should move within the window, which is false for a date two weeks out. The test suite
  had encoded the same mistake (its SGOV fixture is dated two days ahead and expected `awaiting`),
  so the fix is in `pending.ts` with the test corrected and both cases now covered.
- 2026-09-03 — **Public site, `apps/web`.** One page, static export, no runtime data: every
  figure is derived at build time from the committed observations (`lib/observed.ts` reads
  `data/*.json` and does its WAD arithmetic in BigInt), so the site can only ever show a number
  that is in git with a date on it — rule 2 by construction. The hero figure is not hardcoded: it
  is the most recent *matched* reconciliation (AAPL, 36.0 %), and the pending example is SGOV
  picked by address, its `grossPerToken` recomputed from the archive rate × the last on-chain
  multiplier. The status page stays the live tool and is linked, not duplicated. Design: Geist
  Sans/Mono self-hosted, warm off-white / near-black, hairlines, one large tabular figure, no
  accent colour — the number is the accent. Two bugs found by rendering: a `var(--font-sans)`
  that did not exist invalidated the whole `font-family` (serif fallback everywhere), and anomaly
  rows carry an *absent* `impliedHaircutBps` rather than `null`, which rendered `NaN %`.
- 2026-09-03 — The public site deploys on Vercel from a root `vercel.json`: build
  `pnpm --filter @exdate/web build`, serve `apps/web/out`, `framework: null`. Two things learned
  by deploying rather than by reading: `cleanUrls: true` **breaks the root** on a Next static
  export — `/index.html` redirects to `/index`, `/index` to `/`, and `/` then 404s while still
  returning the 404 page's body with a 200-shaped payload, so the site looked deployed and was
  not. Dropped, since Next's export already emits the layout Vercel serves correctly by default.
  And `.vercelignore` must exclude artifacts only, never sources: `pnpm install --frozen-lockfile`
  verifies the lockfile against **every** workspace `package.json`, so omitting one package fails
  the install. Verified live: `/` 200 with the real figures, `/_next/static` immutable, an unknown
  path 404.
- 2026-09-03 — **Site v2: for a reader who is not an engineer.** v1 was documentation in a
  nicer typeface — a nine-column table, twelve ledger rows, six dense sections, and jargon on
  every line (bps, ERC-8056, oracle, reconciliation, confidence). v2 says one thing in plain
  words — *a dividend on a tokenized stock never lands in your wallet; the token becomes worth a
  little more; exdate measures how much, and how much went missing* — in five screens and ~440
  visible words (from ~890). The hero's single visual is data: a ring whose drawn arc is the share
  of Apple's last dividend that never arrived on chain, `--gap` fed from the reconciliation.
  Companies are named from the registry (by address, suffix stripped), amounts shown to the cent,
  percentages as whole numbers; a gap is shown **only** on `matched` rows — an anomaly reads
  "doesn't add up", a feedless token "no price feed", never a number. Everything technical sits
  behind one *Developers* block. Motion is restrained and progressive: `data-reveal` elements
  fade and rise once on scroll, the ring draws, the number counts up — driven by an inline script
  that sets `data-js` before first paint so there is no flash, fully present without JavaScript,
  and switched off under `prefers-reduced-motion` (the full-page screenshots are taken in that
  mode, which tests the path). Accessibility floor: no text under 13 px, muted text ≥ 4.5:1 in
  both schemes, skip link, visible focus, landmarks, the ring labelled for screen readers and its
  animated number `aria-hidden` beside the static one.
- 2026-09-03 — **The site is in production on Vercel**, project `exdate` on the user's team
  (`https://exdate-bactas-projects.vercel.app`, also aliased at the claimed
  `temporary-snappy-acacia-thqwm7n.vercel.app`). Four things learned by deploying, each measured:
  (1) the CLI's device-authorization login dies on the first dropped connection, and this
  container's proxy drops long polls every few minutes (`ws_closed_mid_exchange` in the proxy
  status) — so the OAuth device flow was driven directly (`curl` against `vercel.com`'s
  discovery document with the CLI's public client id, a poller that retries) and the access token
  handed to `vercel --token`; (2) `vercel deploy --temporary` needs no credentials and yields a
  deployment the user claims from a link, which is how the first deploy shipped; (3) after the
  claim, every deployment came back **`BLOCKED` with `TEAM_ACCESS_REQUIRED`: "the commit author
  doesn't have permission to create deployments for this project"** — the commits here are
  authored by the agent, and Vercel checks the author of the metadata the CLI attaches. The fix
  is `scripts/deploy-web.sh`: upload the same tree from a copy with no `.git`, so there is no
  author to check. Verified: the very next deployment reached the build stage instead of
  `BLOCKED`, then `READY`. Git-connected deploys from the dashboard do not have this problem;
  (4) a claimed project inherits `ssoProtection: all_except_custom_domains`, which would have put
  the production alias behind a Vercel login — set to `prod_deployment_urls_and_all_previews`
  (previews protected, production public). A fresh project (`exdate-site`) was created to isolate
  the block and deleted again once it had served its purpose.
- 2026-09-03 — Site: three things a reader noticed. (1) The "Live status" link led to an error:
  it defaulted to `localhost:3000`, and the status page is not hosted anywhere — it needs a
  running indexer, which Vercel cannot run. The link now renders **only** when
  `NEXT_PUBLIC_EXDATE_STATUS_URL` is set; otherwise the page points at the committed dataset on
  GitHub. A dead link is worse than no link. (2) The wordmark was bare text; the mark is now a
  ring open on 36 % of its circumference — the product's own measurement — inline in the nav and
  footer, as `app/icon.svg` (with a dark-scheme stroke via a media query inside the SVG), and in
  a build-time Open Graph image (`app/opengraph-image.tsx`, Satori: every multi-child `div` needs
  `display: flex`, and SVG `<text>` is unsupported, so the number is an HTML overlay).
  (3) "Does it cover every chain?" — no, and the site now says so in a *Coverage* section read
  from `data/`: Robinhood Chain, 194 tokens, 35 feeds, measured live; Base, 13 Coinbase tokens
  and 13 feeds verified on chain, nothing to measure yet because no multiplier has ever moved.
- 2026-09-03 — **The site becomes a tool.** "What does a visitor *do* here?" had no answer: a
  holder could not find their token, see what it is owed, what arrived, or whether it has a price
  feed — all of which sit in `data/`. Now: a **finder** in the hero (194 names, tickers and
  addresses baked into the page, results on every keystroke, plain links so it works by keyboard
  and without the button) and **one static page per token** at `/t/<address>/`, generated at
  build from the committed files: what a token represents in shares today (1 by construction for
  a token that never moved — the scan covered the whole chain), every dividend as declared →
  arrived → state, **owed per token** for a declared dividend that has not landed (rate × today's
  multiplier, no price), the multiplier history, and whether a Chainlink feed exists at all. A gap
  is shown only on `matched`; `anomaly`, `pending`, `unmatched` each get a plain-words state.
  "What you can do here" replaces "What it gives you", and every proof row links to its token.
  `trailingSlash: true` so `/t/<address>/` is a directory index that any static host serves
  without URL rewriting — the thing that broke the root once.
- 2026-09-03 — **What the code knew and the site did not, in three tiers.** An inventory of
  `data/` against the pages found the reconciliation record mostly unshown: the price at
  `effectiveAt` and its staleness, the expected step against the observed one, the implied price
  and its ratio over today's spot, the lag after the issuer's date, the transaction hash, the
  announcement lead, the feed's heartbeat and deviation, and the 37 declared dividends not yet on
  chain. The rule for adding them without the site becoming dense again: **the default view does
  not change**; everything new is closed, on its own page, or one sentence. (1) Every dividend row
  on a token page opens a `<details>` — *How this was measured* on a matched or anomaly row
  (price at effect with its age, implied step vs observed, implied price ×spot, business days after
  the issuer's date, the transaction), *Details* on a pending or unmatched row (owed per token
  spelled out as rate × multiplier; why an unmatched step's declared amount is unrecoverable). The
  stat gains one line — `+0.51% shares since launch: 1 dividend reconciled, 2 steps unexplained`
  — and the feed section its parameters (market hours, heartbeat, deviation, proxy address).
  (2) `/calendar/`: every declared dividend not yet on chain, grouped as *issuer says paid* /
  *due now* / *coming weeks*, each with owed per token and a relative date; the home page links it
  with a count. (3) One sentence in *How it works* carrying the measured timing — the announcement
  lead over the 12 changes, and the one-business-day lag in the cases where it was measured. All
  three come from `lib/observed.ts` reading the committed files, so the site still cannot show a
  figure that is not in git. Two things left absent on purpose, both refused in core as well: a
  landing date for a pending dividend, and the surviving fraction before it lands.
- 2026-09-03 — **`/wallet/`, step 1: what an address holds and what it is owed, read without a
  signature.** Reading a balance is public state; a signature would only prove ownership, and the
  page has nothing to prove. Two ways in, neither signs: paste an address, or "Use my wallet"
  (`eth_requestAccounts`, a connection prompt, shown only when a provider is injected). The read
  is one `eth_call` to Multicall3 built and decoded by `@exdate/core/holdings`, a module with **no
  imports at all** — the ABI encoding is hand-written and checked byte for byte against viem in
  the tests — because Turbopack does not follow the `.js` specifiers the rest of core uses when
  it transpiles the package, and a wallet page must not bundle an RPC library to read a number.
  What is shown: per token held, the balance and the shares it represents at one block (dated by
  `ArbSys.arbBlockNumber()`, since `block.number` is the parent chain's — see "Chain"), and
  **owed = the issuer's rate × those shares**, with no price; the sum of what is due is the
  headline, the sum declared for the coming weeks takes its place when nothing is due yet, and a
  wallet with nothing declared says so instead of showing `$0.00`. The joins (names, declared
  dividends, states) are the committed data; the only live figure is the balance, which cannot be
  committed in advance. Retries on the RPC's rejections (four, backing off), an error state with
  "Try again" rather than zeros, unreadable tokens counted and reported, dust said to be dust.
  Verified end to end in Chromium with the page's own calldata forwarded to the real RPC (NVDA,
  758.247 tokens, $0.25 × 758.247 = $189.56 for 1 October). **Not read yet: history** — what past
  steps delivered to the address needs its balance at each `effectiveAt`, which is its own
  transfer logs plus the effective block numbers; measured feasible for a person's wallet and
  refused for a bot's (see "Known traps"). That is step 2.
- 2026-09-03 — **Site v3: quieter.** Three things a reader noticed: the header carried six
  tabs that mostly named sections of the home page, every ledger row repeated its column labels,
  and hairlines separated everything. Now the header holds the three things a visitor *does* —
  Tokens, Wallet, Calendar — with the current one underlined, and the explanatory sections
  (how it works, proof, coverage, developers) live in a three-column footer. Ledgers have **one
  visual header row** (`LedgerHead`, `aria-hidden`) and each row keeps its own labels for screen
  readers, visually hidden on desktop and shown again on narrow screens where the columns stack;
  the token page's dividends keep their per-row labels (`ledger labelled`) because its third column
  alternates between *arrived* and *owed*. Sections are separated by space, not lines; the one
  principle sentence sits on a tone band (`--band`) instead of between two rules. The home page
  lost the four-card "what you can do" block in favour of three doors that mirror the header, and
  the timing sentence moved out of step 02 into one muted line under the steps. Buttons no longer
  lift and shadow on hover. Home page: 617 → 451 visible words. Muted text stays ≥ 4.5:1 in both
  schemes (`#6b6a63` on `#f6f5f1`, `#9d9c95` on `#0c0c0b`).
- 2026-09-03 — **`/wallet/`, step 2: what past dividends delivered to an address, rebuilt from
  its own transfers, still with no server.** The alternative was weighed and named: an archive
  node answers `balanceOf` at a past block in twelve calls for any wallet, but the public node
  keeps no archive and a paid one needs a key, hence a function that sees every address — the
  page's promise is that the address goes nowhere but Robinhood's own node. So: the twelve
  effective blocks are resolved **once** (`scripts/resolve-effective-blocks.mjs`, bisection over
  block headers, which the node serves at any height; `data/effective-blocks.json`, every step
  5 400–5 850 blocks after its announcement), and the browser reads the address's `Transfer`
  logs in the ten tokens that ever moved, from public mainnet to the last step, through a pure
  planner in core (`RangeScanner`: 5 M-block ranges, halved on a timeout, retried on a rejection,
  **refused past 40 requests** rather than shown as a partial total). `balancesAt` replays
  entries minus exits per token up to the block *before* the effective block — a transfer in
  that block already ran under the new multiplier. Per step the wallet was exposed to: shares
  held then, **shares gained = raw × (new − old) / 1e18** (exact, price-free), and, on a matched
  reconciliation only, dollars declared and arrived from the committed per-share figures, so the
  wallet's gap is the token page's gap. Anomaly, feedless and unmatched steps keep their
  plain-words state and no dollar claim; a holding declared under a cent gets no percentage.
  The twelve rebuilt balances are kept in the visitor's `localStorage` (a past block never
  changes, so the cache cannot go stale; the key carries the last step's block and the step
  count). Measured live with the page's own requests: a person's wallet holding 6.0143 SGOV
  shares at the August step → 22 requests, 1.7 s, 0.0122 shares gained, $1.85 declared, $1.22
  arrived, and 0 requests on the second visit; a trader's wallet with 3 184 transfers → 27
  requests, 6.8 s. Not seen, and said on the page: tokens held inside a protocol at the time.
- 2026-09-03 — **The API reviewed as a product, and what it took to make it usable.** Running the
  indexer against mainnet and calling every route in `docs/api.md`: all answer as documented, 50
  reconciliations, filters and counts right, 404s in JSON, CORS open. What was wrong sat around the
  API, not in it. (1) **The repository is private** (GitHub API: `"private": true`), so every link
  from the public site to GitHub 404s for anyone but the owner. The site now serves the reference
  itself: `/docs/api/` and `/docs/sdk/` render `docs/api.md` and the SDK README at build time
  (`marked`, links rewritten to the pages), and `/data/` lists the committed datasets, copied into
  `public/data/` before every build (`apps/web/scripts/sync-public.mjs`) and served with CORS. A
  GitHub link renders only when `NEXT_PUBLIC_EXDATE_REPO_URL` is set. (2) **No hosted instance**
  and the docs said `localhost`: `Dockerfile` + `docker-compose.yml` bring up Postgres and the
  indexer with `ponder start --schema`; the docs say plainly there is no public instance yet.
  (3) **`@exdate/sdk` is not on npm** and its README said `pnpm add` and `api.exdate.xyz`: both
  packages are now publishable (`publishConfig` swaps `exports` to a `dist/` built by
  `tsconfig.build.json`, verified with `pnpm pack`), and the README says they are not published.
  (4) **`exdate.xyz` belongs to someone else** — it serves "ExDate, The honest Indian Dividend
  Calendar" on Vercel — so the 2026-09-02 naming decision's domain is void; `metadataBase` still
  says it and must change with the domain. (5) Doc drift fixed: SGOV's row is `medium`, not `low`;
  `/v1/status` and `/v1/calendar` nest under `chains[]`; the reconciliations array is named.
  (6) The local first-run trap (Ponder's *schema previously used by a different app*) is written
  down: delete `.ponder/`. **Monetisation prerequisite built: keys and quotas** in `@exdate/api`
  (`limits.ts`): `EXDATE_API_KEYS` as `key:label:rpm`, anonymous quota per client address from
  `X-Forwarded-For`, the three `X-RateLimit-*` headers, `429` with `Retry-After`, an unknown key a
  `401` and never a silent downgrade, `/v1/me` uncounted, `/v1/health` exempt. Fixed one-minute
  windows in memory with an injectable clock; tested at the module and at the routes, and live.
  The SDK takes `apiKey` and has `me()`; the contract assert covers `MeResponse` both ways.
  **Terms, read rather than assumed**: Robinhood's developer-documentation terms (RHDA, LLC,
  2026-08-24) grant a personal, revocable licence and forbid distributing "Robinhood Materials" to
  third parties or building a competing product. Whether the archived `/rhj` rows are such
  material is for counsel to answer before any of it is sold; the README says so.
- 2026-09-03 — **The repository is public** (GitHub API: `"private": false`, checked without
  credentials), so `NEXT_PUBLIC_EXDATE_REPO_URL=https://github.com/BacBacta/Exdate` is set on the
  Vercel project and the Source / GitHub links render again, next to the docs the site serves
  itself. The default branch is still `claude/lance-en5q6j`; `blob/HEAD/…` links follow it.
- 2026-09-04 — **The haircut is priced from the issuer's own quote, captured at the instant of the
  step.** The differentiating asset rested on two reconciled events, and could never rest on many
  more: it prices a dividend from the Chainlink round in force at `effectiveAt`, which exists for
  35 of 194 tokens and can be hours old — SGOV's was 15 hours stale, and measured at 06:15 UTC the
  median feed age was 59 minutes. Counted against what is coming: of the **37 dividends declared and
  not yet on chain, 33 are on tokens with no feed at all**, so 89 % of the arriving flow was
  unmeasurable by construction. `/rhj/prices` covers all 194, refreshes every 15 s — and serves only
  the present, so the price at a past instant is unrecoverable, like the five lost July actions.
  What makes catching it possible is exdate's own finding: `UIMultiplierUpdated` fires **about nine
  minutes before** the change, carrying `effectiveAt`. `scripts/capture-effective-prices.mjs` scans
  for that announcement every five minutes (`.github/workflows/capture-effective-prices.yml`) and
  returns to sample the quote at `effectiveAt` −30 s, 0 s and +30 s; a run only waits out its own
  budget and hands the rest to the next through `data/effective-prices.observed.json`, so nothing
  depends on one process staying alive or on GitHub firing on time. Verified end to end against a
  synthetic step 45 s out: three quotes, closest **11 seconds** from the instant. The three
  historical steps in range are recorded with **zero quotes and a stated reason** rather than a
  price fetched days late. Which price a row used is now first-party in the data (`price.source`)
  and in the library (`Reconciliation.priceSource`): a quote goes into the new `underlyingPriceWad`
  and is used as it is, a Chainlink answer into `priceWad` and has its multiplier unwound, and the
  phase-floor refusal applies only to the latter because it is a property of a round. A quote
  published while `isTradingHalt` is true is refused, not priced: that is a last price, not a
  market. **No haircut changes today** — the capture pays off from the next dividend onward, and
  says so rather than backfilling.
- 2026-09-04 — **Net creation, per token, daily.** The one dataset here that needs no oracle, no
  issuer declaration and no interpretation: mint minus burn, from the chain, signed. It is what an
  ETF publishes as net flow and what says whether the wrapper is growing; the issuer publishes
  gross turnover with no sign and no history, and nobody publishes the rest. Windows are contiguous
  by construction - each run starts at the block after the last one stopped - so a delayed run
  loses nothing and none of them double count. A range the node times out on is halved; one that
  fails at the floor is listed and the window is marked `incomplete`, because a missing range is
  not a zero. A run that would have to cover more than three days reads the most recent three and
  records `precededByGap` rather than implying the ledger is continuous.
- 2026-09-04 — **The nine-minute lead is delivered to someone, without a host.** The signed webhook
  outbox has existed since M4 and has never delivered anything, because the indexer is not hosted.
  The lead is the most perishable thing exdate measures and the least useful sitting in a table.
  `scripts/notify.mjs` rides the capture run that is already watching every five minutes and posts
  to a Discord or Slack webhook, or Telegram, from repository secrets - no server, no deployment.
  Two notices: the announcement, and the moment it takes effect, which is the one **no log
  watcher can produce** because nothing is emitted on chain then. An announcement first seen more
  than an hour late is **refused with its reason** rather than sent: delivering it would report a
  lead rather than give one, which is the same distinction as a price fetched days after the
  instant it claims to price. Delivery is recorded in the capture file, so the committed history is
  the evidence that the lead was given. With no sink configured it does nothing and says so.
- 2026-09-04 — **The gap between the traded price and the oracle, hourly.** The signal a lending
  curator actually needs and nobody publishes: a market liquidates against the Chainlink feed, the
  feed is 24/5 and freezes off-hours, and the chain does not stop. First measurement, taken
  overnight: across the 26 quotable tokens that have a feed, **median |gap| 20 bps, widest 186 bps
  (GME)**, median feed age 150 minutes, and SPY's feed 16 hours old while its pool traded 48 bps
  above it. Both sides quote the **raw token** - Chainlink publishes `P_equity x multiplier` and the
  pool trades that same token - so nothing is unwound from either, which is rule 5 in the one place
  it would be easiest to double-count. Every pool and every feed is read in **one instant**, one
  Multicall3 batch each, or the number would measure the delay between two reads. The deepest pool
  per token wins, not the cheapest fee tier: a thin pool prints a price no size can trade at, and a
  pool with zero liquidity is skipped rather than ranked last because its `sqrtPriceX96` is whatever
  the last trade left behind. The arithmetic is exact bigint maths in `packages/core/src/pools.ts`
  (the 18-vs-6 decimal difference against USDG is where a naive reading is off by 1e12, and there is
  an exact test for it). The snapshot answers "how far apart now"; the **history**, labelled by
  market session with the same classifier as the off-hours share, is what will answer the claim
  worth making - that the gap runs wider when the feed is frozen. One sample is a reading, not a
  rate, and the file says so.
- 2026-09-04 — **A token list, which is distribution rather than another page.** A wallet or an
  aggregator learns a token exists by importing a list from a URL, so this is the cheapest way for
  exdate to end up inside someone else's product instead of waiting for visitors. Served at
  `/tokenlist.json` with CORS, 194 tokens. The value is in the **extensions**, which nobody else
  can fill: what one token represents in shares today, whether a dividend is declared and not yet
  delivered, what it owes per token (rate × multiplier, no price, so it holds for all 194), the
  Chainlink proxy a lending market would price against — `null` for the 159 that have none — and
  **which evidence corroborates that pairing**, by name. The schema's constraints were read from
  the published file, not remembered: a list name is capped at 30 characters and `^[\w ]+$`, which
  **forbids a hyphen**, and an invalid list is silently ignored by every consumer, which looks
  exactly like nobody wanting it. So `validateTokenList` is in core with tests and the builder
  **refuses to write** rather than publish something no one will load. The version is computed from
  the diff, because the standard reads it as a promise: removing a token is major, adding one
  minor, changing a detail a patch, and an unchanged rebuild keeps its timestamp so a commit means
  the data moved rather than that a job ran.
- 2026-09-04 — **The published site was about to drift away from the record.** Seven collectors
  now commit on their own schedules, and the Vercel project is **connected to no repository**: it
  only updates when someone deploys by hand. Checked, not assumed — the project API reports no
  link. So from the next hourly commit onward the pages would have shown older figures than the
  files they claim to read, and "every number traces to a committed observation" would have
  quietly stopped being true. `.github/workflows/deploy-site.yml` deploys on a push that touches
  `data/`, `apps/web/`, `packages/core/` or `vercel.json`, plus a six-hourly safety net, through
  the same `deploy-web.sh` that works around Vercel refusing a CLI deploy whose commit author is
  not a team member — and the commits are now made by the collectors, so that block applies more
  than before. It waits on a durable `VERCEL_TOKEN` and the two project ids, and until they exist
  it **says what is missing and exits cleanly** rather than failing every six hours. One trap
  caught while writing it: the `secrets` context is **not available in a step's `if`**, so the
  guard is lifted into the job's `env` — written the documented-looking way it evaluates to
  nothing and every step runs regardless.
- 2026-09-04 — **The wallet's dividend record, as a file.** Step 2 works out per past step what an
  address held, what it gained and what arrived, and it existed only on screen, where it cannot be
  handed to an accountant or reconciled against a broker statement. `Download as CSV` builds it in
  the browser from what is already computed - nothing is sent anywhere, the same promise the rest
  of the page makes. It lives in `holdings.ts` rather than its own module for the reason that file
  already carries: **Turbopack does not follow core's `.js` specifiers**, so anything the wallet
  bundles must import nothing, and a separate `statement.ts` broke the build on exactly that.
  Two things the export gets right that a naive one would not. **A non-zero amount never prints as
  zero**: AAPL against 0.0142 shares is worth thousandths of a cent, and `0.00` in a record reads
  as *nothing happened*, so money is written to six places and anything that would still round away
  falls back to full precision - COST's dust shows as `0.000000000000000126` rather than `0`. And
  every row carries a **`basis`** column saying in words why it has the figures it has, because a
  blank must never be mistaken for a zero months later by someone who was not here. CSV escaping is
  RFC 4180 with a test for a comma inside a token name, which would otherwise shift every later
  column of that row. The export states on its face that it values a distribution at the price
  exdate measured at the instant of the step, which is a measurement and **not any tax authority's
  method**.
- 2026-09-04 — **A gap without depth is not a finding.** The first cross-session readings arrived
  and the widest was GME at **664 bps**, which could equally have been a real dislocation or a
  price on a pool holding a few hundred dollars — the page gave a reader no way to tell. Uniswap's
  `liquidity` ranks pools correctly but means nothing to anyone, so each pool's **actual balances**
  are now read alongside and published as one figure: GME's gap sits on a pool holding **$809 046**,
  which settles it. The balances are context, not a selection rule: the deepest pool by `L` is
  still the one quoted, because that is what governs the price printed. Also the first evidence
  that the gap moves with the session — **median 20 bps overnight against 33 bps pre-market** — on
  two and one samples respectively, which is a hint and not yet the claim; the page still refuses
  to compare sessions until each has three. Verified the whole chain by dispatching the workflow
  by hand rather than assuming it: measure → corroborate → commit → push, all of it. 20 of 26
  pairings now agree in every reading and lift on the third.
- 2026-09-04 — **The site now deploys itself, and the fallback workflow is gone.** The Vercel
  project is linked to `BacBacta/Exdate` with `claude/lance-en5q6j` as its production branch, so
  the record and the published pages can no longer drift: a collector's commit deploys the pages
  that read it. Verified rather than assumed — the push at 08:33:55 produced a `git`-source
  deployment **two seconds later** that reached `READY`, `target: production`, with the production
  alias reassigned to it (`aliasAssigned: true`, `aliasError: null`), and the live root, the token
  list and an unknown path answer 200 / 200 / 404. That settles the open question behind
  `deploy-site.yml`: the `TEAM_ACCESS_REQUIRED` block is a property of **CLI** deploys, where
  Vercel checks the commit author in the metadata the CLI attaches, and a git-connected deploy is
  attributed to the installation instead — this deployment carried an agent-authored commit and
  was not blocked. So the workflow is deleted rather than kept as insurance: it never deployed
  anything (it waits on a `VERCEL_TOKEN` that does not exist), and a CI file that looks like it
  publishes the site while the site is published by something else is worse than no file. The
  durable-token path stays available in this entry if the link is ever removed: `VERCEL_ORG_ID`
  `team_yvcPXxh5OyD9bGT9ogPgtNEw`, `VERCEL_PROJECT_ID` `prj_k3kFLnvN5qsU47DHRGhowCN9Ev2n`, and
  `scripts/deploy-web.sh`, which uploads from a copy with no `.git` so there is no author to check.
- 2026-09-04 — **The traded-price test crossed its threshold, and turned a boolean into a lie.**
  The hourly gap collector reached three samples and 22 pairings became corroborated at once —
  1 of 35 to 23 of 35 in a single commit. Two things broke that a boolean cannot express. CI went
  red, correctly: `feedCorroborated` reaches the confidence ladder through the **generated
  registry**, not the map, and only `archive-corporate-actions` regenerated it, so the gap workflow
  now runs `generate-registry.mjs` too (plain node over committed JSON, no install) and commits it
  with the sample. And every surface that read the boolean alone went on saying *corroborated by
  its own dividend step* about 22 tokens whose step had never been seen moving anything — the token
  page, the status page's tooltip, the API's field documentation, the SDK's type. That is a claim
  about evidence that does not exist, which is rule 2 applied to a sentence rather than a number.
  So the kind travels with the fact now, end to end: `corroboratedBy` in the map, the registry,
  `reconcile()`'s input **and its output**, the API, the SDK and both sites, with a test that
  asserts a price-corroborated row never reports `multiplier-step`.
  **Both kinds still land on `medium`,** and a fourth rung was considered and rejected: `medium`
  already means "believed on behaviour, not stated by anyone", which is true of both, and splitting
  it would put the distinction in a word instead of in the field that names the evidence. What
  separates them is written down instead — causal versus identification, and that two unrelated
  assets can trade at one price. *(Corrected later the same day: "end to end" was half true — the
  reconciliation row dropped the kind at the database. See the hosting entry below.)* The 12
  pairings that fail the price test are the informative half:
  almost all high-volatility names (GME, MSTR, COIN, IONQ, RGTI…) whose traded price is genuinely
  dislocated from the feed, so the test fails because its premise fails, not because the pairing is
  wrong.
- 2026-09-04 — **The capture ran on a schedule that does not keep time, and the fix is a process,
  not a setting.** Asked what the cron jobs cost on GitHub (nothing: the repository is public), the
  measurement that answered it mattered more than the bill: GitHub fired the `*/5` capture job every
  **7 to 25 minutes** (median 11.1, none within five; `data/capture-cadence.observed.json`, from
  GitHub's own run log, refreshed daily by `measure-capture-cadence.yml`). Two of my own claims
  died on the numbers. First, the catch window was not the nine-minute lead but the run's
  **four-minute budget**, so a step landing at a random instant was caught about **one time in
  three** (Σ min(gap, budget) / Σ gap = 33 %). Second, "a run that watches ten minutes makes
  coverage continuous" is false: coverage is continuous only when the watch exceeds the *largest*
  gap, which means a job alive 24/7 — 43 000 runner-minutes a month, free on a public repo and
  squarely inside what GitHub's Actions terms name as prohibited (*serverless computing*), with one
  account restriction taking every collector down at once. So: the budget is nine minutes now
  (expected catch **70 %** on the measured gaps, inside `timeout-minutes: 12`, the concurrency group
  queueing the next run), which is the most a schedule can do — and the answer is
  **`scripts/watch-effective-prices.mjs`**, a persistent process for a machine, scanning every
  30 s, sampling at the instant, committing what it caught and a heartbeat every six hours. The
  logic moved into **`scripts/lib/effective-prices.mjs`** (plain ESM, 14 tests in
  `packages/core/test/effective-prices.test.mjs`) so the one-shot and the watcher cannot drift; the
  one-shot gained **`EXDATE_CAPTURE_MODE=watchdog`**, in which it checks the heartbeat, captures
  in the watcher's place only while that heartbeat is stale (> 7 h) and alerts on each transition
  — exercised through all four states. The two share one file and each owns one field in it
  (`watcher`, `watchdog`); steps are merged by key before every write, and a rebase conflict is
  resolved by taking the remote and rewriting from memory (`scripts/lib/git.mjs`). Also found: the
  original lookback comment was off by **100×** ("~15 min" for 900 000 blocks, which is a day at
  0.1 s/block) — harmless, since known steps are skipped by key, and corrected. `/record/` now
  states the measured cadence and the expected catch share, and will state the watcher's heartbeat
  once one exists. Still owner-blocked: the machine and a deploy key (`TODO.md`).
- 2026-09-04 — **"There is no archive" was true of one endpoint and recorded as true of the
  chain.** Asked what a paid node would buy, the answer turned out to be *almost nothing that is
  not already free*: the public chain registries list eight RPC endpoints for chain 4663 and the
  project had only ever used Robinhood's. Six answer; three serve state at any height; two reach
  the oldest multiplier step, 53 M blocks back. That belief had shaped real decisions — two-tier
  indexing, a browser replaying transfer logs, the application derived from the clock — so the
  endpoints are probed and committed like any other measurement
  (`scripts/probe-rpc-endpoints.mjs`, `data/rpc-endpoints.observed.json`).
  Three things the probe gets right that a naive one would not. Archive is tested as **state that
  differs from latest**, because Multicall3's `getBlockNumber()` answers on any node and an
  endpoint serving head state at every height would otherwise pass. The decisive field is
  **`reachesOldestStep`**, not a depth: the first version of the site's selector took a node with
  1 M blocks of history because it sorted on an arbitrary probe depth, and it would have failed on
  exactly the wallets the archive path exists for. And **agreement is reported per depth** — two
  independent endpoints at 20 M and 50 M, three at 1 M — so a lone witness is never published as
  corroboration. What this unlocked, both measured end to end: **every multiplier step confirmed in
  the chain's own state** (12/12, plus 12/12 of the retrospective trap at its announcement block),
  which closes the project's oldest limitation, ERC-8056 emitting nothing when a change takes
  effect; and **the wallet history read rather than rebuilt** — 12 requests, 1.9 s, for any address,
  where the log replay costs up to 40 and is refused past that. The replay stays as the fallback,
  and the page says which node answered, because one of them is not Robinhood's. What an archive
  does **not** unlock is transfer indexing: there the binding cost is storage, roughly 75 GB a
  month, not the node.
- 2026-09-04 — **The installer could never reach its second pass, and it took a rehearsal to see it.**
  The watcher's install script was written but had only ever been read, not run end to end; put on a
  real VPS it created the user and the deploy key and then stopped, and re-running it stopped in the
  same place. Two shell traps, both found by replaying the script here against stubs rather than by
  staring at it. **`set -o pipefail` made the auth gate always false**: GitHub answers `ssh -T` with
  the greeting *and* exit status 1 - it grants no shell - so `ssh … | grep -q "successfully
  authenticated"` reports failure on a match, from ssh's own status or from the SIGPIPE `grep -q`
  sends by exiting on the first one. The answer is captured into a variable before it is searched.
  And **under `curl … | bash` the script is bash's own stdin**, so any child that reads stdin - ssh
  above all, and `git clone` spawns ssh - swallows the rest of the source and bash silently stops
  where that child ran, exit 0. The whole body now lives in `main()` called as `main "$@"
  </dev/null`: bash parses the entire file before executing a line of it (so a truncated download
  cannot half-run either) and every child gets its own empty stdin. Rehearsed with stubbed
  `systemctl`/`apt-get`/`ssh` and a local origin: both passes now run through all seven steps, the
  unit's `User=`/`WorkingDirectory=`/`ExecStart=` substitutions land, and the preflight runs. The
  public key is also printed by its own `cat` between two markers rather than expanded inside the
  heredoc - an unreadable file must be an error on screen, not a blank line in the middle of
  otherwise perfect instructions - and the file is checked non-empty before the gate.
- 2026-09-04 — **The watcher is on a machine, and the day it went up paid for it.**
  `exdate-watcher.service` runs on a Hetzner box (`ubuntu-4gb-fsn1-1`, Ubuntu, 78 MB RSS), preflight
  8/8 — node, the checkout, push access proved with a dry run, the chain, a live AAPL quote, and the
  clock **0.5 s** from the issuer's own, which is the one that decides whether it wakes at the right
  second. Its first heartbeat is committed, so the record is its own evidence. Hours earlier,
  **UPS** had shown exactly what a scheduler loses: announced 15:00:41 UTC, effective 15:10:26 — a
  lead of 9 min 45 s — and GitHub's cron did not fire inside it. Its first quote landed at
  **15:16:15, 350 s after the instant**, outside the two-minute tolerance and carrying
  `isTradingHalt: true`, which is a last price and not a market. The step is published `givenUp`
  with its reason rather than priced from a quote taken six minutes late; the issuer keeps no price
  history, so that haircut cannot be recovered by anyone. A 30-second tick puts three samples inside
  that window. Both capture until the repository variable `EXDATE_CAPTURE_MODE=watchdog` is set:
  they share one file and each owns one field, steps merge by key, so the overlap costs work and
  loses nothing — what it does cost is the alarm, since nothing checks the heartbeat until the
  scheduled job is the watchdog.
- 2026-09-04 — **The site has a domain of its own, and the platform was the wrong place to ask for
  it.** `metadataBase` still read `https://exdate.xyz`, so - verified in the built HTML - every
  `og:image` and `twitter:image` on the live site was made absolute against a domain belonging to an
  unrelated business: sharing an exdate page anywhere fetched the preview from a stranger's server
  and credited them. Two more places named it as ours, the site's `links.api` (which nothing read)
  and the README's SDK example (which told a reader to point their client there); both gone, and the
  SDK tests moved to `example.com`, which is reserved for exactly that use. The first fix derived the
  host from `VERCEL_PROJECT_PRODUCTION_URL`, and the deployed build disproved it: Vercel filled that
  variable with the project's claimed `*.vercel.app` alias, not the custom domain, so the cards named
  the alias. **`exdate.me`** is now bought and serving, so the canonical host is written down rather
  than deduced - `https://www.exdate.me`, since the apex 308-redirects to `www` - with
  `NEXT_PUBLIC_EXDATE_SITE_URL` as the override. `api.exdate.me` and `status.exdate.me` are reserved
  and deliberately named nowhere in the product until something answers on them: publishing an
  endpoint that does not exist is the same failure as publishing a number nobody measured.
- 2026-09-04 — **The API and the status page are hosted, and building them found the one place the
  corroboration kind was not travelling.** `deploy/Caddyfile`, `deploy/status.Dockerfile`, two
  compose profiles (`public` for Caddy and the status page, `watcher` to stop the watcher service
  starting beside the systemd one on the same host) and `deploy/install-api.sh`. Rehearsed here
  against a real Docker daemon rather than read: both images build, `/v1/health` answers, 194 tokens
  poll, the three `X-RateLimit-*` headers and CORS are present, an unknown path is a JSON 404, the
  reconcile pass produces 51 rows and the status page renders them live. The installer's decisive
  check is that both names already resolve to the machine, because a failed ACME challenge is
  rate-limited per domain; it also refuses if 80 or 443 are taken, and never resets the watcher's
  checkout, which the watcher owns.
  Two real defects fell out of doing it. Both Dockerfiles omitted `tsconfig.base.json`, which every
  workspace tsconfig extends, so the status build failed on `extends … doesn't resolve correctly`.
  And the more important one: the entry above claims the corroboration kind travels "end to end …
  `reconcile()`'s input **and its output**, the API, the SDK and both sites". It did not. The poller
  passed it into `reconcile()`, `reconcile()` returned it — and the `reconciliations` table had **no
  column for it**, so it was dropped on write and the API's reconciliation row published
  `confidence: medium` with nothing saying which behaviour earned it.
  `/v1/:chain/reconciliations` is the differentiating dataset, so that is precisely where the
  conflation mattered, and `docs/api.md` pointed a reader at `feed.corroboratedBy`, which only the
  token route serves. Fixed at the break: a `feedCorroboratedBy` column (comma-joined over a closed
  two-value set, with the boolean **derived** in the serialiser rather than stored beside it — two
  columns that can disagree about one fact is how a row claims corroboration it cannot name), the
  write, the serialiser, the API row type, the SDK type and the reference. Verified live through the
  hosted API: SGOV `medium` with `['multiplier-step','traded-price']`, AAPL `low` with
  `['traded-price']` — corroborated but on one event, so the evidence is reported without lifting
  the confidence. The SDK's contract assert was checked to bite by removing the field and watching
  `tsc` fail with `Type '"feedCorroboratedBy"' does not satisfy the constraint 'never'`.
- 2026-09-04 — **Two owner-blocked items removed by making the defaults tell the truth.** The
  scheduled capture job needed a repository variable set to `watchdog` before it would stop
  capturing beside the machine that now does it. That variable existed only because the workflow's
  default described the world before the watcher, so the default is `watchdog` now and the variable
  still overrides it — `EXDATE_CAPTURE_MODE=capture` turns the job back into the capturer if the
  machine is ever retired. And the alert sink: with none configured a dead watcher was noticed by
  the watchdog and reported **to nobody**, which is the worst state of all, since the record keeps
  saying a process is there while nothing samples and the missed instants cannot be read back. A
  failed scheduled run emails the repository owner with no configuration whatsoever, so the job now
  fails on purpose when the heartbeat is stale and no notice was delivered — **after** the commit,
  because failing earlier would discard the capture the run made in the watcher's place. Exercised
  through all four states. A real sink is still better and still needs the owner: it carries the
  nine-minute lead, which is the perishable notice, and a failed cron run cannot.
  Also done here rather than asked for: `api.exdate.me` and `status.exdate.me` now resolve to the
  watcher machine. The zone is on Vercel DNS and carried a wildcard `*` ALIAS pointing every
  subdomain at Vercel, so explicit A records were needed to win on specificity; its CAA records
  already list `letsencrypt.org`, which is what makes Caddy's certificate possible and was checked
  rather than assumed.
- 2026-09-04 — **The API and the status page are live at `api.exdate.me` and `status.exdate.me`,
  and the first attempt failed silently, which is the part worth writing down.** The installer
  reused the watcher's checkout at `/opt/exdate` and only fetched, on the reasoning that the watcher
  owns that clone and must not be reset. No working tree was updated, so Docker built a
  `docker-compose.yml` that predated the public profile: **Caddy and the status page never started
  at all, and the watcher — ungated in that older file — came up a second time beside the systemd
  one**, on a host where two of them sample the same instants and race on one committed file. Every
  line printed as success. The API now takes its own checkout at `/opt/exdate-api` and resets it to
  the branch tip, which can lose nothing because nothing else writes there; `EXDATE_DIR` pointing at
  the watcher's directory is refused by name; anything still running out of it is brought down. And
  the check that turns this class of failure into a message: the script reads back the running
  services and dies unless `db`, `indexer`, `status` and `caddy` are all up — and dies if `watcher`
  is. "Containers up" was true of the run that got it wrong, which is exactly why a script must
  assert the shape it expected rather than the fact that a command returned zero.
  Verified from outside afterwards: `/v1/health` 200 over HTTP/2, CORS open, the three
  `X-RateLimit-*` headers, plain HTTP 308 to HTTPS, the status page 200. The Let's Encrypt
  certificate was validated by the machine's own `curl`, not from here — this workspace's egress
  proxy substitutes its own certificate, so checking TLS from here would prove nothing, and the
  distinction is stated rather than glossed. The zone's CAA records were read first and do list
  `letsencrypt.org`; without that Caddy could never have been issued anything.
  The site now renders its *Live status* and *Live API* links, hidden since the beginning for want
  of a host. Both stay behind env vars rather than becoming literals: the site is static and rebuilt
  on a commit, so a hardcoded host would go on being advertised for as long as nobody pushed after
  the machine went away.
- 2026-09-04 — **The Terms were read, not summarised, and they reorder the risk.** `docs/terms-review.md`.
  Three things the earlier one-line summary did not say. First, **§2.1 puts the chain itself
  outside the Terms**: "Robinhood Chain itself, including its protocol smart contracts […] is not
  part of the Services". Every on-chain measurement is public state; what is a Service is the
  Public RPC and the `/rhj` API. Second, the clause that bites is not the licence but the purpose
  covenant, **§2.4(a): "solely for lawful testing, experimentation, evaluation, and development
  purposes"** — it attaches to every Service including the RPC, so a production product reading
  the chain through Robinhood's endpoint is caught by it, and reading through a node of its own or
  a third-party endpoint is not. That turns TODO item 3 (an RPC exdate controls) from optional into
  the terms-driven answer, starting with the capture watcher, whose reads cannot be re-done. Third,
  the trademark licence has conditions that the site breaks today: **§5.7(j) forbids describing
  Stock Tokens as "tokenized stocks" or "tokenized equities"**, and the site's title is *see what
  your tokenized stock actually paid you* (counted: 15 occurrences across the public surfaces);
  **§5.7(b)(ii) requires a "not affiliated with, endorsed by, or officially connected with
  Robinhood Markets, Inc." disclaimer**, which is absent. Both are cheap; the first is the product's
  sentence and is the owner's decision, so neither was changed here. Also found: the repository has
  **no `LICENSE` file** while three packages claim MIT and the data has no licence at all; the
  §5.2 licence is contractual and non-sublicensable, so any data licence must carve out the
  issuer's columns; the EU *sui generis* database right is a separate question the US Terms never
  reach; and **the arbitration opt-out closes on 2026-10-31** (§12.13, by post, the only manner).
  Chainlink's terms render in JavaScript and could not be read from here — recorded as unread rather
  than paraphrased. The worst case is stated as what it is: contractual and personal to exdate —
  revocation, blocking, deletion of the archive, the indemnity — not a claim over facts.
- 2026-09-04 — **The terms review acted on, without counsel: what could be removed was removed,
  and the rest is named.** Six of Appendix A's eight items are in the repository. (1) Production
  reads leave Robinhood's RPC: an ordered failover — `makeFailoverRpc` in the dependency-free
  `scripts/phase0/rpc.mjs` for the watcher, the collectors and every script, and `failoverHttp`
  (viem `fallback` over the throttled transport, `rank: false`, outer `retryCount: 0` so the inner
  retries are not multiplied) for the indexer — puts `robinhood.api.pocket.network` first and
  Robinhood's endpoint last, with `RHC_RPC_URLS` as the override and a 25 s request timeout so a
  hanging endpoint cannot block the fallback behind it. Robinhood's own *Run a full node* page
  settled the alternative: 64 GB RAM, terabytes of NVMe, an L1 endpoint, and "use the public
  endpoints or a provider" — so a node was not built and a provider account is the owner's one
  remaining step. Verified: the helper answered from pocket in 714 ms, Ponder came up on the
  composed transport with 194/194 polled and a clean log. (3) The §5.7(b)(ii) disclaimer is in the
  footer and the README. (4) "tokenized stock(s)" is gone from every surface that describes
  Robinhood's product — title, OG image, lede, footer, README, token-list keyword — replaced by
  "Stock Tokens" and the Terms' own "tokenized real-world assets such as Stock Tokens"; Coinbase's
  product keeps Base's wording, which is Base's. (5) `LICENSE` exists, MIT, and every package
  declares it. (6) The site stops mirroring the issuer's three files at `/data/`; the `/data/` page
  lists them without a download, says whose they are, and links the repository. (7)
  `DATA-LICENSE.md`: CC BY 4.0 over exdate's observations, with every `source: robinhood:*` field
  and the three files carved out, because a non-sublicensable licence cannot be passed on. Also
  fixed on the way: the token list's own `logoURI` still pointed at the old Vercel alias. What only
  the owner can do is written where it belongs: the email to Robinhood (Appendix B), the
  arbitration notice by post before 2026-10-31 (Appendix C), and a keyed provider.
- 2026-09-04 — **"Which RPC provider, free or paid" answered by measuring the load, and two of my
  own claims died doing it.** A counting proxy in front of the endpoint, with Ponder running through
  it: **the indexer alone is 166 000 to 348 000 requests a day, 5-10 M a month, and ~90 % of that is
  `eth_getBlockByNumber` at the head.** The watcher is 5 760 a day and every GitHub collector
  together 1 232 — three orders of magnitude smaller. That split is the answer: the watcher and the
  collectors fit any free tier with room to spare, and the indexer does not fit most of them.
  First claim to die: I reasoned that Ponder polling the head every 2 s was waste, since the poller
  fires every 600 blocks and the nine-minute lead is caught by the watcher's own 30 s scan. Raising
  `pollingInterval` to 30 s **made the rate worse** — 4.03 calls/s against 1.92 — because the chain
  produces ten blocks a second and a longer interval leaves more to reconcile on each poll. Reverted,
  with the measurement written into the config so the next person does not re-derive the wrong answer
  from first principles.
  Second: `pocket.network`, which I made the default first endpoint that same afternoon **because it
  served state at any height and reached the oldest step**, had stopped doing both by the evening —
  re-probed, same script. Nothing broke, since the failover falls through to Robinhood's and the
  archive path is a separate variable, but the comment asserting that property was false within
  hours of being written. It now says what pocket is actually kept for — the 2 000 000-block
  `eth_getLogs` the watcher's 900 000-block scan needs, which no other third party offers
  (blockmachine caps at 1 000, ordofi at 10 000) — and says the degradation as the reason a machine
  that matters should point `RHC_RPC_URLS` at a keyed provider. A ninth endpoint appeared in the
  registries the same day. The set is not stable; the probe is, so re-run it rather than trusting
  a name.
- 2026-09-04 — **The watcher rescanned 900 000 blocks every thirty seconds, and that quietly tied it
  to the one endpoint the Terms say not to use.** Found while sizing an Alchemy key: the scan asks
  for a day of blocks on every tick, and almost no keyed provider accepts a range that wide — two of
  the three third-party endpoints measured here cap it at 10 000. So the watcher could only ever run
  on Robinhood's own RPC, which is exactly what `docs/terms-review.md` set out to avoid. Two fixes,
  both tested: `getLogsPaged` halves a range until the endpoint accepts it, discovering the cap from
  the refusal rather than being configured with it (caps differ per provider and change without
  notice), and raises anything that is not a range error rather than splitting forever; and
  `scanAnnouncements` takes a `fromBlock`, so a running watcher asks only for the blocks that
  appeared since its last tick. Proved against a real capped endpoint: a cold start over 120 000
  blocks split itself down to 7 500-block chunks and completed, then the next two ticks scanned 194
  and 199 blocks. The mark is kept in memory, not on disk, because a restart *should* rescan wide —
  a restart is when something may have been missed.
  **The gain is compatibility, not billing**, and the first version of this comment claimed
  otherwise before the published rates were checked: a provider charges per call — Alchemy lists
  `eth_getLogs` at 60 compute units flat — so the steady-state cost is one call either way.
  Sizing, against Alchemy's free tier of 30 M CU/month and 25 requests/second: **watcher 6.0 M
  (20 %), all GitHub collectors 1.5 M (5 %), indexer 102.6 M (342 %)**. So the watcher and the
  collectors — the reads that cannot be re-done — fit a free key with room to spare, and the indexer
  is the only thing that would need paying for, about $29 a month at $0.40/M beyond the free tier.
  `scripts/probe-endpoint.mjs` answers "where can this endpoint go" for a keyed URL without ever
  printing it: it prints the host with the path redacted, writes no file, and tests the two things
  that decide placement — the watcher's own span, and state at the oldest step.
- 2026-09-04 — **A keyed provider's free tier turned out to be a different product, and the probe
  is what showed it.** Run against a real Alchemy key on the watcher machine,
  `scripts/probe-endpoint.mjs` answered: chain, head and state at head fine, state **at the oldest
  multiplier step in 49 ms** — better than either third-party archive endpoint — no wildcard CORS,
  which is correct for a keyed URL, and **`eth_getLogs` refused at 900 000 blocks with "Under the
  Free tier plan, you can make eth_getLogs requests with up to a 10 block range"**. Alchemy's own
  documentation confirms it per chain: on **Robinhood Mainnet the range is 10 on Free and unlimited
  on Pay As You Go**. Ten is not a small cap, it is a different capability. Costed with their
  published 60 CU per `eth_getLogs`: the watcher's ~200-block delta scan would split into about 63
  calls a tick, **327 M CU a month against a 30 M free allowance**; on Pay As You Go the same scan
  is one call and the watcher is **6.0 M CU, every collector together 1.5 M, so about $3 a month**
  — with the indexer a further 102.6 M, about $41, which is why it stays on the public failover.
  So the answer to "free tier or paid" is neither of the obvious ones: free is not a cheaper version
  here, it is a version that cannot do the job at all, and the paid one costs about a coffee. Two
  things this vindicates: the paging fix committed hours earlier, without which the probe would have
  reported a flat failure instead of a cap; and building the probe at all rather than reading a
  pricing page — the 10-block limit is on a documentation page nobody would have thought to open.
- 2026-09-04 — **A three-minute trial in a container replaced the real machine's heartbeat in the
  committed record, and a `git add -A` published it.** The watcher writes `watcher: { host, tick,
  lookback, heartbeatAt }` into the shared state file whether or not it can push, so a test run with
  `EXDATE_WATCH_PUSH=false` — meant to prove the paging fix against a capped endpoint — left
  `host: "vm"`, `tickSeconds: 20`, `lookbackBlocks: 120000` where `ubuntu-4gb-fsn1-1` had been.
  Nothing measured was lost: only that block changed and the four steps with their quotes were
  untouched. But the record then said a machine that does not exist was watching, which `/record/`
  renders by name, and the fix is not "be careful with `git add`". The heartbeat is **a claim that a
  watcher is running on this host**, and the watchdog reads its absence as a dead machine. A run
  that cannot push is not making that claim, so it no longer writes the block at all — captures it
  makes are still merged, because those are real observations. Verified by running the trial again
  and diffing: the block is byte-identical afterwards.
- 2026-09-05 — **Three tries at the same permission bug, and only the third asked the machine
  instead of guessing.** One `git pull` run as root in `/opt/exdate` — a directory the `exdate`
  service account owns and pushes from — left the checkout unable to fetch: *insufficient permission
  for adding an object to repository database `.git/objects`*. The first fix looked for files not
  owned by the account; it found none on the real machine and the fetch still failed, because the
  mode can be wrong while the owner is right. The second wrote a probe file into `.git/objects`; it
  succeeded, because `.git/objects` is writable even when `objects/ab` is not — git does not write
  into `objects/` itself but into the 256 fan-out directories under it, and into `pack/` and
  `info/`. The third asks the kernel the actual question, as the account that will do the writing:
  `sudo -u exdate find .git -type d ! -writable`. Rehearsed against the real shape — a fan-out
  directory owned by root — where the second probe passes and repairs nothing while the third
  detects and fixes it. The operating rule is in `TODO.md`: that checkout is updated with the
  installer, never with `git` by hand as root.
- 2026-09-05 — **Secrets reach the machine through git, encrypted to the machine's own deploy key,
  and nobody types them anywhere.** An evening of applying one Alchemy key by hand from a phone
  produced three different corruptions - 20 characters where 32 belong, a quote riding along, half
  the URL echoed as its own command - and every one answered 401 exactly like a bad key. The
  channel: the value goes into a repository secret once, through a browser form that cannot wrap a
  line; `deliver-secrets.yml` encrypts it with `age` to every `deploy/keys/*.pub` (age takes
  ssh-ed25519 recipients as they are) and commits the ciphertext to `deploy/secrets/`; the
  installer, which now publishes the machine's public key on every run, decrypts with the private
  half that never left the machine and applies - an RPC endpoint through the same probe gate as
  `set-rpc.sh`, so a value that cannot serve the watcher's scan is never written, the rest straight
  into `.env`. Rehearsed end to end with a real ssh-ed25519 pair and a real service account, the
  commit gated on it, and the gate refused three times before it passed: twice on the harness (a
  root-run `git` in the service account's checkout, then an origin under a path the account could
  not traverse - both faults this file already documents), once on a real defect: a delivered
  two-URL value had its fallback appended a second time and the archive variable, which takes one
  endpoint, received the whole list. Found on the way and fixed: `systemctl enable --now` does
  **not** restart a running service, so three re-installs could update the checkout and never load
  the new code - the installer restarts explicitly now.
- 2026-09-05 — **A number I invented blocked the fix it was meant to protect.** `set-rpc.sh` refused
  any key that was not exactly 32 characters, and the probe refused anything under 20, on the
  strength of "an Alchemy key is 32 characters" - written from memory and never measured. Alchemy's
  documentation states no length anywhere, and the one example in their quickstart is 20 characters.
  On the machine the delivered secret carried a 26-character key and was refused **before a single
  request was made**, so the only authority on whether a credential works never got to speak. Rule 1
  is about addresses and feed IDs; this is the same failure one level down - an unmeasured constant
  presented as a fact, doing damage where a measurement would have cost one HTTP call. What survives
  is only what is certainly wrong and needs no measurement: an empty value, a literal placeholder,
  and a quote inside the value. Length is reported on a 401 as a hint about where to look, never as
  a verdict. The gated rehearsal also found the whitespace half of that check unreachable -
  `tr -d '[:space:]'` had already stripped it three lines earlier - so the repair is announced
  instead of silent, since a silent repair is how a wrong value gets in looking right.
- 2026-09-05 — **The rehearsal ran under a kinder kernel than the machine, and hid a bug for two
  rounds.** `set-rpc.sh` built its candidate `.env` with `mktemp` and chowned it to the service
  account so the probe could read it. On a stock Ubuntu that file is then writable by **neither**:
  `fs.protected_regular=2` stops root writing to a file it does not own inside a world-writable
  sticky directory, which `/tmp` is. The machine said `Permission denied` on a temp file root had
  just created, twice, and the delivered secret was refused for a reason that had nothing to do with
  the secret. This sandbox ships `fs.protected_regular=0`, so every rehearsal passed. The candidate
  now lives beside the real `.env` inside the checkout - owned by the service account, not sticky,
  so root can write it and the account can read it - with a `trap` removing it on any exit. The
  harness sets `fs.protected_regular=2` before it runs, because a rehearsal on a more permissive
  kernel than the target proves less than it appears to. Also fixed while reading that output: the
  proxy passthrough handed the service account a CA bundle under `/root` it cannot read, so node
  warned on every run and fell back to the system store anyway - a CA is now forwarded only if the
  account can actually read it.
- 2026-09-05 — **A check that answers yes without a credential, one line before a 403.** Two
  dispatches of the publish workflow were reported back as "publish done" while npm still served
  404 for both packages: a `type: boolean` input compared as `inputs.dry_run == false` is skipped
  whenever the value reaches the expression as the string `"false"`, and the run still reports
  success. A condition whose failure mode is silence is the wrong condition for an irreversible
  action, so the input is a string and publishing requires typing `PUBLISH`; the last step stopped
  narrating which branch it took and asks `registry.npmjs.org` what it actually holds. Run three
  then published for real and npm refused: `403 … PUT /@exdate%2fcore — You may not perform that
  action with these credentials`. The line printed immediately before it read *the @exdate scope is
  visible to this token* — worthless, because `npm access list packages @exdate` exits 0 with **no
  credential at all** (measured with an empty `HOME`: exit 0, no output). It said yes to everyone
  and said it right before the refusal. Same shape as the `.git/objects` probe: the thing probed
  was not the thing that had to be true. What replaced it asks endpoints that require the token and
  prints their answers, with the member roster as the discriminator — unauthenticated
  `/-/org/exdate/user` returns `{}` (checked against `@babel` and `@vercel` too, while a made-up
  scope answers 404 `Scope not found`), authenticated it names each member and role. It settled the
  question in one line: **`{"bacta16":"owner"}`**, so the account owns the scope. A second,
  freshly created token was refused identically, which is when guessing stopped being the
  instrument: **`/-/npm/v1/tokens` returns a granular token's own permissions**, and answers 401
  with no credential, so unlike the check it replaced its success depends on the thing checked.
  It ended the question: `permissions: [{package, read}, {org, read}]`, `scopes:
  [{package, null}, {org, "exdate"}]`, `bypass_2fa: true`, `cidr: []`. **Read on packages, and the
  grant made under *Organizations* rather than *Packages and scopes*** — which is npm's own
  documented trap: an organization grant "does not give the token the right to publish packages
  managed by the organization". Not 2FA, not an IP allowlist, not the account. The job now reads
  that verdict out of the JSON and **fails before attempting the publish**, naming the one setting
  to change, so a read-only token gives a sentence instead of a 403; rehearsed against seven
  answer shapes including two tokens, no prefix match, and unparseable JSON (which carries on
  rather than blocking a publish). Every introspection call prints its status code beside its
  body, because the three answers to one question are 200 `{}` unauthenticated, 401 with a wrong
  bearer, and the roster with a good one — a body alone cannot be told from a refusal. A refused
  `PUT` creates nothing, so re-running after fixing the token is free.
- 2026-09-05 — **`@exdate/core` and `@exdate/sdk` are on npm, and the flag that was supposed to
  prove where they came from did nothing.** The 403 that survived two tokens was read out of npm
  rather than guessed at: `/-/npm/v1/tokens` returned `permissions: [{package, read}, {org, read}]`
  with the grant made under *Organizations*, npm's own documented trap. Fixed, the same job printed
  `package=write org=write` and both packages went out. Verified the way the rest of this project
  verifies: installed fresh from the registry into an empty directory and run — 194 tokens, 13
  multiplier logs, `toUnderlyingShares`/`toRawAmount` lossless on SGOV's real 1.005101 multiplier,
  AAPL's published haircut recomputed at 3600 bps, and a webhook signed and verified through the
  published SDK, rejected when forged (`signature_mismatch`) and when replayed
  (`timestamp_outside_tolerance`).
  What that verification caught is the part worth keeping: the job's command line said
  `--provenance` and the registry answered `"attestations": null`. **`pnpm publish` accepts
  `--provenance` and silently ignores it** — measured, not inferred: `pnpm publish --help` on
  10.18.0 mentions provenance zero times, `npm publish --help` once. So the two 0.1.0 tarballs
  carry no attestation and, versions being immutable, never will. The fix publishes the **same
  tarballs that the inspection step already unpacked and checked**, with `npm publish` rather than
  a second pack nobody looked at. The reporting was never wrong — the final step read the registry
  back and printed `provenance no` — which is why the gap was visible at all: a step that asks the
  registry what it holds catches a flag that did nothing, where a step narrating its own command
  line would have reported success.
- 2026-09-05 — **Whether trusted publishing is configured cannot be read, and the probe that
  said it could was matching its own name.** npm publishes no endpoint for it — four candidate
  paths all 404 — and says why: *"npm does not verify your trusted publisher configuration when
  you save it"*, *"errors will only appear when you attempt to publish"*. So the question was put
  to `npm publish --dry-run` with the token stripped from the job's npmrc, and three runs found
  three checks that fire **before** authentication: a version collision (*"You cannot publish over
  the previously published versions"* — answered with no credential at all, so a published version
  can never rehearse the auth step), then a prerelease tag (*"You must specify a tag using --tag"*),
  and then **nothing**: the dry run exits 0 with no credential. A dry run does not authenticate, so
  it cannot answer the question; only a real publish can. On the way the rehearsal reported the
  opposite — *"npm reached for OIDC"* — because it grepped npm's output for `oidc` and the version
  it had packed was named `0.0.0-oidc-rehearsal`. **The probe matched its own filename**, the third
  time this shape has cost real time here after the `.git/objects` write test and `npm access list`
  answering without a credential. Fixed at the mechanism rather than the string: the outcome is
  decided first (exit 0 with no credential settles it whatever any text says), `npm notice` lines
  that echo the package name are stripped before searching, and the rehearsal version carries no
  word the search looks for. What is checkable on this side was checked against npm's own list and
  matches: bare workflow filename, `repository` equal to the canonical `BacBacta/Exdate`,
  `id-token: write`, npm gated at 11.5.1 (the runner installs 12.0.2 over the 10.x Node 22 ships).
  **Answered by the one test that works**, at no cost: a real publish of `0.1.1-oidc.0` under
  dist-tag `next` with the credential removed from the job's npmrc. npm signed a provenance
  statement and wrote it to Sigstore's transparency log (`logIndex 2723807089`) — so the OIDC
  identity is fine — and then refused the `PUT` with **`OIDC permission denied for this action`**,
  a different error from the token era's `You may not perform that action with these credentials`.
  So no Trusted Publisher is configured, or one is configured without the direct `npm publish`
  action (npm's form offers `npm stage publish` and direct publish separately). A refused PUT
  creates nothing: the registry still holds only `0.1.0`, so the prerelease number is not spent
  and the same run repeats once the setting exists. The prerelease-under-`next` shape is what made
  the test free — `latest` never moved, and `0.1.1` is still available for the next real release.
  **With the Trusted Publisher configured, the identical run published**: `@exdate/core@0.1.1-oidc.0`
  and `@exdate/sdk@0.1.1-oidc.0` under `next`, **with no token in the job at all**, and both carry
  provenance — read back from the registry as two attestations, the SLSA one naming
  `.github/workflows/publish-packages.yml` on `refs/heads/claude/lance-en5q6j` at
  `github.com/BacBacta/Exdate`, built by `actions/runner/github-hosted`, subject
  `pkg:npm/%40exdate/core@0.1.1-oidc.0`. So a consumer can now verify where a tarball was built,
  which the `0.1.0` pair can never offer. Installed from `@exdate/sdk@next` into an empty directory
  and run: 194 tokens, 13 logs, the WAD round trip lossless, AAPL at 3600 bps, webhook valid.
  `NPM_TOKEN` can be deleted.
- 2026-09-05 — **The site audited against its own brief, and the first fix could not ship because
  the data pipeline had spent the deploy quota.** `docs/ux-audit-prompt.md` is the brief (five
  personas, seven non-negotiable constraints, twelve phases, NN/g severity, WCAG 2.2 AA, CWV,
  Flesch-Kincaid, live-verified comparables); `docs/ux-audit-2026-09-05.md` is the audit, in French,
  with the evidence in `docs/audit/2026-09-05/`. Score **2.75 / 5**, 28 findings. Two were
  severity 4 and 3 and nobody had noticed: **`/t/<EIP-55 address>/` was a 404** — token pages exist
  under the lowercase form only, while the registry, every explorer, every wallet and the token
  page itself display the checksummed form, so every link from outside hit "This page could not be
  found" with no finder; and **the home page was 416 px wide on a 360 px phone** (a link row that
  could not wrap, then an `<input>` whose intrinsic ~230 px width flowed into the hero grid's
  min-content), so phones rendered the whole site zoomed out with the *Look up* button cut off.
  Found by my own capture script auditing 404s first, because it used checksummed addresses too.
  The "this week" list shipped in `32f0548`: a `not-found.tsx` that lowercases a token URL before
  paint and carries the finder; the two overflow causes plus `/data/` at 422 px and `/flows/` at
  361 px caught by the re-measure; focusable code blocks with distinct landmark names; a copy
  button on a truncated address; the wallet naming both reads before either runs, the archive one a
  checkbox; "2 steps unexplained" → "2 changes with no issuer record"; "975 minutes" → "16 h 15
  min"; licence and contact in the developers block; footer headings at h2; the SDK README no
  longer claiming the package is not on npm. All twelve routes re-measured on the built output: no
  overflow at 320 or 360, axe clean. **Then Vercel answered "Deployment rate limited — retry in 24
  hours."** The branch had received 125 commits in 24 h, 67 from collectors, and the Hobby plan
  allows 100 deployments a day: the collectors had deployed the site into its quota and a
  severity-4 fix waited a day. `scripts/vercel-ignore.sh`, wired as `ignoreCommand`, is the
  stateless answer: a person's or the agent's commit always builds; a collector's builds only when
  it is the first collector commit of its UTC hour (`git log -2`, which Vercel's checkout has). The
  obvious rule — "skip if the previous commit is recent" — was written first and is wrong: with
  commits every ten minutes every one has a recent predecessor and nothing builds again. Rehearsed
  against the day's real history: 67 collector commits → 33 builds, 34 skipped, and on a day
  without development pushes at most 24. The pages stay within an hour of the record, and every
  build still reads all of `data/`. Still owed by the audit's month list: the token page opening
  on the answer (F03), the wallet's post-read flow (F13), ICS and RSS (F04), a "what we measured"
  section carrying the 73.9 % (F05), per-token share cards (F14), the IA and a shorter home
  (F06/F17), the LCP (F10).
- 2026-09-05 — **The site was not late, it was down, and the audit's fixes are what brought it back.**
  Vercel refused the fixes' deployment with *"Deployment rate limited — retry in 24 hours"*, so the
  owner opened a second Vercel account and asked to deploy there. Looking properly at the old one
  found something worse than a quota: `www.exdate.me` and `exdate.me` answered **404
  `DEPLOYMENT_NOT_FOUND`**, the last production deployment answered **410 Gone**, and the team held
  **18 projects with no `exdate` among them** — the project had been deleted. `api.exdate.me` and
  `status.exdate.me` were untouched throughout, because they resolve to the Hetzner machine and not
  to Vercel.
  The move itself is worth writing down, because the obvious route is not the one that worked.
  `PATCH /v4/domains/exdate.me {op: move-out}` answers `{"moved": false, token}` — Vercel wants an
  email confirmation, which is a person's step with unknown latency. The shorter and less invasive
  route is to leave the domain where it is and **prove ownership**: add `exdate.me` and
  `www.exdate.me` to the new project, which returns two `_vercel.exdate.me` TXT challenges, then
  create those records with the OLD account's DNS API, which still held the zone. Verified in one
  pass, apex → www 308 restored, and the zone followed intact — the two `A` records for `api` and
  `status` never moved, which is what the whole operation had to protect. The zone was backed up
  before anything was touched; it was not needed.
  **Device-flow lesson, twice.** `vercel login` dies on this container's dropped connections, so the
  OAuth device flow is driven directly against `api.vercel.com/login/oauth/*` with the CLI's own
  public client id (`VERCEL_CLI_CLIENT_ID`, read out of the installed bundle, scope
  `openid offline_access`). The page authorises **whatever account the browser's cookie holds**,
  not the account the app is signed into: the first code came back as the old account, and after
  the owner switched, a code meant for the old account came back as the new one. So the poller now
  prints the username, the email and the teams the token reaches, and tests it against the target
  domain, rather than discovering the wrong account at the moment of the operation.
  **What is not fixed: the site no longer deploys itself.** The new project was created by API and
  is deployed from here by `scripts/deploy-web.sh`; linking it to the repository is refused with
  `repo_no_access`, because the GitHub identity on the new Vercel account is `lebbuilder16` and the
  repository is `BacBacta/Exdate`. Until the Vercel GitHub App is installed on `BacBacta` from the
  new account, a collector's commit changes `data/` without changing the pages. New coordinates:
  team `team_zE5m7D2OYawyE95SpJwB2LT4` (`lebbuilder16-5581s-projects`), project
  `prj_jhD59pmRJWMHnyU4af3leV0QyA11` (`exdate-site`). `ssoProtection` had to be set to null — Vercel
  gives a new project `all_except_custom_domains`, which answered 302 to everyone.
  **Resolved the same evening by not needing the link at all**: `.github/workflows/deploy-site.yml`
  runs `scripts/deploy-web.sh` on a push touching `data/`, `apps/web/`, `packages/core/` or
  `vercel.json`, six-hourly as a net, on one `VERCEL_TOKEN` repository secret — the org and project
  ids sit in the file, since they identify a project rather than authorise anything. Verified end
  to end: dispatched, deployed, and the site answers with the current build. Two things it gets
  right that the file it replaces did not. The token check is a job-level `env`, because the
  `secrets` context is unavailable in a step's `if` — which is how the previous `deploy-site.yml`
  ran every step whether or not it had a token. And the one-collector-build-per-hour rule applies
  to **pushes only**: on a schedule or a dispatch the branch tip is usually a collector commit the
  rule would skip, and those two events exist to catch up when the push path did not deploy, so
  applying it there would disable the safety net in exactly the case it is for — caught by
  rehearsing the decision for all three event names before committing. The first live run also
  caught the closing health check reporting `api.exdate.me/ -> 404`, which is correct and
  meaningless: the API serves `/v1/*` and its root has no route. Each name is now asked for the
  path that answers on it, because a check that calls a healthy service failing is a check nobody
  reads the day it is right.
- 2026-09-05 — **The one figure that contradicts a received idea was published nowhere, and the
  only way back to the site was memory.** Two of the audit's month items (F05, F04). The
  off-hours share had reached `sufficient: true` in `data/` and appeared on no page: the home page
  now carries a *What we measured* section — the haircut, the off-hours share, net creation — each
  dated, with its sample size and one click from how it was read, and a permanent anchor
  (`/#haircut`, `/#off-hours`, `/#creation`) so a figure can be cited by URL. The share renders only
  while the file says sufficient, and the number exdate was given to check (46 %) is stated beside
  the measurement rather than called "widely repeated", which nobody here measured. And three files
  to subscribe to, generated at build like every page so none can carry a date that is not in git:
  `/calendar.ics` (every declared dividend as an all-day event on its process date, every observed
  change as a timed event at `effectiveAt`, UIDs keyed on the issuer's action id and date or the
  token and instant), `/t/<address>/calendar.ics` for the 44 tokens that have anything to put in
  one, and `/feed.xml` (the same record newest first, a declaration dated by when the archive first
  saw it). `DTSTAMP` and `lastBuildDate` are the data's own timestamp, so an unchanged rebuild is
  byte-identical. Lines are folded at 75 **octets**, not characters, and the built files are
  checked for that, for CRLF, for escaped commas and semicolons and for one `DTSTART` per event
  before the commit. Route handlers under `output: 'export'` do produce plain files
  (`out/calendar.ics`, not a directory), which was the one thing not knowable without building.
  Found on the way: a measurement script that launched Chromium with the egress proxy set was
  measuring the proxy's 405 page, not the site — `bypass` did not take, every route "had no
  overflow" and axe reported the five violations of an empty document. Local pages are now
  measured with no proxy and axe injected from a local copy.
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
- [x] **M4 signed webhooks** — seven event types written to an outbox by the poller and the live
      indexer, drained at the start of each poll, HMAC-SHA256 signed with a replay window.
      `GET /v1/webhooks` (catalogue + scheme), `GET /v1/:chain/webhooks/events` (outbox).
      Verified end to end against a local receiver that checks the signature with `node:crypto`:
      43 deliveries, 43 valid, 0 failed, and a forged signature rejected.
- [x] **M5 SDK + docs** — `packages/sdk`: typed client for every route, `ExdateError` with the
      status, and the webhook verifier (`webhookFromRequest`, `parseWebhook`) reusing the sender's
      own function. `docs/api.md` documents every endpoint with a real captured response;
      `packages/sdk/README.md` documents the client. **Both packages are on npm** —
      `@exdate/core@0.1.0` and `@exdate/sdk@0.1.0`, published 2026-09-05, verified by installing
      them fresh from the registry and running them: 194 registry tokens, 13 multiplier logs,
      the WAD round trip lossless, AAPL's haircut recomputed at 3600 bps, and a webhook signature
      that verifies, is rejected when forged, and is rejected when replayed. **Publishing runs on
      trusted publishing (OIDC) since `0.1.1-oidc.0`** — no token in the job, provenance generated
      by npm and verified back out of the registry as a SLSA statement naming this workflow, this
      repository and this ref. The `0.1.0` pair carries none and never will; `latest` still points
      at it, `next` at the OIDC prerelease.

### Known gaps

- The five July actions have no declared rate and never will (see the decision log); their steps
  are published as `unmatched` with the reason stated rather than filled in.

- `/wallet/` history no longer refuses an automated wallet: with an archive endpoint it reads
  `balanceOf` at each effective block instead of replaying logs — measured end to end at **12
  requests, 1.9 s, for any address**. The log replay stays as the fallback. What remains is that
  the archive path shows the address to a **third party** rather than to Robinhood's node alone,
  which the page states, and that the history is still blind
  to tokens held inside a protocol at the time of a step. Both are stated on the page. An archive
  endpoint would lift the first; the second needs each protocol's own accounting.

- The capture of the issuer's quote at effect now runs on a machine as well as on GitHub's cron.
  What the cron alone loses was measured the same day: **UPS, 2026-09-04**, announced 15:00:41 and
  effective 15:10:26, first sampled at **15:16:15 — 350 s late**, so the instant is unrecoverable
  and the row says so. Until the repository variable `EXDATE_CAPTURE_MODE=watchdog` is set, both
  capture; they share one file and merge by key, so nothing is lost, but a dead machine raises no
  alarm. `/record/` states the measured cadence, the expected catch share and the watcher's
  heartbeat; nothing claims a capture that was not made.

- The off-hours share is answered (74.3 %, see the section above) but on two days of hourly
  samples covering 56 of 168 weekly hour-slots; the hourly Action keeps sampling, and the page
  states the sample every time it states the share.

- Base is unblocked but unwired. The registry address, the 13 token addresses and the 13 feed
  proxies are verified on chain; no source module exists, ERC-8056 does not answer there until the
  Cobalt hardfork, and no Coinbase corporate-action feed has been found — so Base would produce a
  step ledger and no haircuts. Also: no Coinbase multiplier has ever moved, so there is nothing to
  reconcile there yet.

- No split has ever been reconciled end to end. `reconcileSplit()` exists and is tested, but every
  split reaches it without a declared ratio — the only one ever observed (CRWD ×4) lost its issuer
  row, and all 43 archived actions are cash dividends — so it refuses and the row stays
  `unsupported_action_type` with the observed ratio stated.
- The token → feed pairing is **causally** corroborated for 1 of 35 tokens (SGOV, by its own step);
  22 more are corroborated only by their traded price, which identifies the underlying and does not
  test the mechanism a haircut depends on, and 12 are still a bare ticker match. No first-party link
  exists to close the gap; a second SGOV-like token (low-volatility underlying, large step) would
  causally corroborate another row. See `docs/phase-0-verification.md` §14.
- The poller and the gap sweep have no tests of their own: they need a chain and a Ponder process,
  so they are exercised by running the indexer. The webhook outbox is unit-tested
  (`packages/indexer/test/webhooks.test.ts`) and was also verified live against a local receiver.
- `tokenStates` is written every poll even when nothing moved. Deliberate: `sampledAt` is an
  observation, and skipping the write would make "checked, unchanged" read as "not checked since".
  The static registry row is no longer rewritten.
- The status page's hand-declared response subsets are now checked against core at compile time
  (`apps/status/lib/contract.assert.ts`), the same trick `@exdate/sdk` uses: both routes hand
  `buildYieldLedger` / `buildPendingView` straight to `c.json()`, so the function's return type IS
  the JSON. Verified to bite by retyping a field and watching `pnpm typecheck` fail.
