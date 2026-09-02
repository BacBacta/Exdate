# A second issuer: Coinbase B20 on Base — reconnaissance, 2026-09-02

exdate is multi-chain in its schema and single-issuer in its data. This is what a second issuer
would actually take, established the same way Phase 0 was: read the sources, read the chain, and
write down what is verified and what is not.

Nothing here has been wired into the codebase. That is deliberate — the model differs enough that
adding a chain entry would be a guess, and this document is what has to exist first.

## What is verified

**13 Coinbase tokenized-equity feeds on Base (chain 8453).** From Chainlink's directory
(`feeds-ethereum-mainnet-base-1.json`, 183 feeds, 13 of them Coinbase tokenized equities) and then
read back on chain by address: `description()`, `decimals()` and `latestRoundData()` on every proxy.
**13/13 descriptions match the directory name exactly** (`Coinbase TSLA`, `Coinbase AAPL`, …) and
13/13 decimals agree. Snapshot: [`data/base-coinbase-feeds.snapshot.json`](../data/base-coinbase-feeds.snapshot.json).

Same feed parameters as Robinhood's: 8 decimals, 86 400 s heartbeat, 0.5 % deviation threshold,
`us_equities_24/5`. Unlike Robinhood's, **none of the 13 has a secondary SVR proxy**.

**The economic model is the same.** Chainlink documents Base tokenized equity feeds with the
identical formula — `Token Price = Underlying Equity Market Price × Multiplier` — and the same
consequence: the multiplier is already in the answer, so multiplying by it again double-counts. The
same pause discipline applies, with the feed freezing at the last good value through a corporate
action.

**Dividends are converted to shares, not paid as cash.** Chainlink's wording: "Cash dividends are
converted to shares of the underlying equity and reflected as a multiplier increase, rather than
distributed as cash to the token holder", and "Holder balances never change". That is the same
mechanism exdate measures on Robinhood Chain — which means **the haircut question transfers
unchanged**, and so does the reconciliation model.

## What differs, and why it is not a config entry

| | Robinhood Chain | Coinbase B20 on Base |
|---|---|---|
| Token standard | ERC-20 + ERC-8056 (Scaled UI Amount) | B20, "Base's native token standard for real-world assets, an extension of ERC-20" |
| Multiplier read | `uiMultiplier()` on the token | an **on-chain oracle registry**, "which returns the multiplier and pause state for each token in a single call" |
| Change event | `UIMultiplierUpdated(old, new, effectiveAt)` | `MultiplierUpdated`, plus `Announcement` / `EndAnnouncement` wrappers that can be atomically bundled with the update |
| Pause flag | `oraclePaused()` on the token | `paused` per token in the registry |
| Identity | ticker per contract; exdate's map is a ticker heuristic | "identified by its **contract address** rather than its ticker" |
| Chain | 4663, single sequencer, no archive | 8453, public RPCs, archive available |

Three of these matter to the design:

1. **The registry is a single call for every token.** exdate polls 194 tokens × 5 views through
   Multicall3 on Robinhood Chain. On Base the same information is one call — cheaper, and with an
   address-keyed answer.
2. **The events are named differently and carry an announcement wrapper.** `multiplier-events.ts`
   filters one topic0; a second issuer needs its own source module, not a second address list.
3. **Identity is by contract address.** The one place exdate resolves a token by symbol — the
   token → feed map, corroborated for exactly one pair out of 35 (see
   [`phase-0-verification.md`](phase-0-verification.md) §14) — may simply not have an equivalent
   problem here. Worth confirming: it would be the first first-party address-level link in the
   product.

## What is not known yet

Probed and not found, so stated as open rather than assumed:

- **The registry address.** Chainlink names the registry but publishes no address for it. The same
  probe that works on Robinhood Chain was run against Base: the Coinbase TSLA proxy names its
  aggregator (`aggregator()` → `0x0288…aa82`, 22 337 bytes) and nothing else address-shaped; the
  aggregator names no token and no registry. So the link is off-chain from Chainlink's side here
  too.
- **The B20 token addresses.** Chainlink's directory carries none, exactly as on Robinhood Chain.
- **Whether Coinbase publishes a corporate-action feed.** Robinhood's `/rhj/corporate-actions` is
  what makes the reconciliation possible at all. Without an equivalent, Base would give observed
  multiplier steps with no declared side to reconcile them against — the state the five lost July
  actions are in, permanently.

Answering the first two is one search away from someone with Coinbase's developer documentation;
the third decides whether a second issuer produces haircuts or only a step ledger.

## The verdict for the codebase

The abstractions hold. `chain_id` is on every table, the multiplier is a WAD everywhere, staleness
and pause are already modelled, and the reconciliation is arithmetic over (declared rate, observed
step, underlying price) with no Robinhood-specific assumption in it.

What a second issuer needs is a **source module**, not a configuration entry: its own event ABI, its
own read path (registry instead of per-token views), and its own corporate-action ingest. The
`Repository` interface and the API shapes would not move.

## How to reproduce

```bash
node /path/to/base-probe.mjs                 # address-level probe of a Coinbase proxy on Base
curl https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json
curl https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase.md
```

The snapshot in `data/base-coinbase-feeds.snapshot.json` carries every address, so each row can be
checked against the chain without trusting this file.
