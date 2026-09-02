# exdate

**The corporate-action layer for tokenized stocks.**

Robinhood Stock Tokens don't pay cash dividends onchain — they raise an ERC-8056 multiplier that
changes how many underlying shares each token represents, while raw balances stay put. Standard
tooling ignores this, which is why public data on these assets has been off by 10x to 100x.

exdate indexes what actually happens: every multiplier update, every corporate action, the dividend
that is owed but not yet reflected, the net yield after the fees and withholding nobody documents,
and the health of every Chainlink feed.

> **Status: Phase 0 complete, nothing shipped yet.** The chain has been verified, the token registry
> and feed registry are committed, and the 12 real multiplier events that exist so far are recorded.
> The API, SDK and status page below describe the target, not something you can call today.
> Read [`docs/phase-0-verification.md`](docs/phase-0-verification.md) for what is actually known.

## Why it matters

| | |
|---|---|
| **Pending dividend** | Between ex-date and multiplier application, a token is worth more than the oracle says. Undervalued collateral, predictable DEX/NAV premium. |
| **Observed haircut** | Reconciling declared dividends against observed multiplier steps measures the real cost of the structure. Published nowhere else. |
| **Feed health** | Feeds are 24/5 and freeze off-hours, but ~46% of transfers happen outside NYSE hours. Lending protocols need to know before they liquidate. |

None of that is hypothetical. On 2026-09-02, mid-session, the SPY feed was **18 hours** stale and
the QQQ feed **4 hours** stale. Nine tokens have already moved their multiplier — steps ranging from
0.64 bps to 214.86 bps — and the onchain warning before a change takes effect is **nine minutes**.
Only 18% of Stock Tokens have a Chainlink feed at all. Reconciling the issuer's own dividend rates
against the onchain steps gives a **~34–36 % haircut** on AAPL and SGOV, three events that don't
reconcile at all, and seven dividends marked *completed* that have not reached the chain after up
to four weeks. Every input is sourced; see the report.

## What is verified today

```bash
node scripts/phase0/check-chain.mjs            # chainId 4663, cadence, head
node scripts/phase0/check-tokens.mjs AAPL SGOV # ERC-20 + ERC-8056 views
node scripts/phase0/check-feeds.mjs            # every Chainlink feed + its age
node scripts/phase0/find-multiplier-events.mjs # every UIMultiplierUpdated ever emitted
node scripts/phase0/snapshot-registry.mjs      # refresh + diff the issuer registry
node scripts/phase0/check-corporate-actions.mjs # issuer dividends vs onchain steps
node scripts/phase0/feed-price-at.mjs <feed> <iso> # Chainlink price at an instant, no archive
```

Committed artifacts, all first-party or read from the chain:

| File | What |
|---|---|
| `data/robinhood-assets.snapshot.json` | 194 Stock Tokens from the issuer's own registry |
| `data/robinhood-corporate-actions.snapshot.json` | 43 dividends from the issuer's own feed (12 done, 31 upcoming) |
| `data/chainlink-feeds.snapshot.json` | 57 Chainlink feeds on Robinhood Chain |
| `data/token-feed-map.json` | token → feed pairing, **every row `verified: false`** |
| `data/multiplier-events.observed.json` | the 12 `UIMultiplierUpdated` logs that exist |

## Target shape

```ts
import { exdate } from '@exdate/sdk'

const y = await exdate.yield('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC')
// { gross, observed, impliedHaircutBps, confidence }
```

```
GET /v1/:chain/tokens                      verified address → ticker registry
GET /v1/:chain/tokens/:addr                multiplier, scheduled update, feed state, premium
GET /v1/:chain/tokens/:addr/yield          gross, observed, implied haircut, confidence
GET /v1/:chain/tokens/:addr/pending        dividend owed but not yet reflected
GET /v1/calendar                           upcoming ex-dates and scheduled updates
GET /v1/reconciliations                    expected vs observed, per event
GET /v1/status                             every feed: live, stale, paused
```

Webhooks: `multiplier.scheduled`, `multiplier.applied`, `feed.stale`, `feed.resumed`,
`pause.changed`, `dividend.pending`, `dividend.reconciled`.

## Repo layout

```
scripts/phase0    verification scripts — the only runnable code today
data              committed snapshots of first-party registries and observed events
docs              Phase 0 report
packages/indexer  Ponder + Postgres, multi-chain from day one   (M1)
packages/api      Hono                                          (M2)
packages/sdk      @exdate/sdk                                   (M5)
apps/status       Next.js status page                           (M1)
```

## Development

```bash
cp .env.example .env      # RPC URL, database URL, market-data API key
node scripts/phase0/check-chain.mjs
```

`pnpm install` / `pnpm dev` / `pnpm test` arrive with M1. The Phase 0 scripts are dependency-free —
plain Node 22, `fetch`, and hand-rolled ABI encoding — so they run against a bare checkout.

See `CLAUDE.md` for verified onchain facts, known traps, and the decision log.

## Honesty policy

exdate never displays a number it cannot trace to an onchain event. Where no event has been
observed yet, the API returns an explicit `confidence` field and the UI says so. Fees and
withholding on onchain distributions are undocumented by the issuer; everything exdate reports
about them is **observed**, never official.

The same rule applies to this repository. Anything derived rather than read — currently the
token → feed mapping — is committed with `verified: false` and named as a heuristic.
