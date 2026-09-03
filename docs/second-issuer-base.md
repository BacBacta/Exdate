# A second issuer: Coinbase B20 on Base — reconnaissance, updated 2026-09-03

exdate is multi-chain in its schema and single-issuer in its data. This is what a second issuer
would actually take, established the same way Phase 0 was: read the sources, read the chain, and
write down what is verified and what is not.

The 2026-09-02 version of this document listed three unknowns and said answering the first two was
"one search away from someone with Coinbase's developer documentation". That turned out to be
right. `docs.base.org` publishes a full B20 specification, and one page of it —
[Tokenized Stocks on Base](https://docs.base.org/specifications/b20/tokenized-stocks-on-base) —
carries the oracle registry address, the thirteen token addresses and the thirteen feed proxies in
one first-party table. **Two of the three unknowns are now closed, and both were checked against
Base mainnet rather than taken on the page's word.**

Every address below was read back by address on chain:
[`data/base-b20-verification.json`](../data/base-b20-verification.json),
`node scripts/phase0/verify-base-b20.mjs`. Nothing here is wired into the codebase yet.

## What is verified on chain

### The oracle registry — `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD`

Chainlink names a registry and publishes no address; Base publishes the address and no ABI. So the
contract was asked to describe itself: solc emits every public selector as a `PUSH4` immediate, so
its 1 548 bytes of code state their own surface — 19 selectors, 4 of which answer.

| Selector | Signature | What it answers |
|---|---|---|
| `0xa217fddf` | `DEFAULT_ADMIN_ROLE()` | zero |
| `0xe63ab1e9` | `PAUSER_ROLE()` | a role hash |
| `0x248a9ca3` | `getRoleAdmin(bytes32)` | zero |
| `0xd4197e82` | **unknown** | **two words: the WAD multiplier, and a flag** |

The three named ones are OpenZeppelin AccessControl, confirmed by keccak (`toFunctionSelector`)
rather than recognised by eye. `0xd4197e82` matched none of the 46 candidate signatures tried, so it
stays **unnamed** — naming it would be inventing an ABI, and rule 1 forbids that. What it *does* is measured:

- Called with each of the 13 token addresses it returns `1e18` and `0` — the multiplier and the
  pause flag Chainlink describes, **13/13 agreeing with what the token itself reports**.
- Called with **WETH on Base** it reverts. Called with an address holding no code it reverts.

That control is the point. All thirteen multipliers are `1.0` today, so agreement alone would prove
almost nothing — a contract returning `1e18` for any address would look identical. It does not:
**the registry knows exactly these thirteen addresses and refuses everything else.** That is a
first-party, address-level link between the registry and the token set — the thing that does not
exist anywhere on Robinhood Chain.

### The thirteen B20 tokens

`AAPLc` `0xb200000000000000000000C2e324d24d7eEcd1fb`, and twelve more with the same `0xb2` variant
prefix; the full table is in the verification file. Read back on chain:

- `name()`, `symbol()`, `decimals()`, `totalSupply()` and `multiplier()` all answer.
- **13/13 `symbol()` values match the documented ticker**, so the published table is not stale.
- **Decimals are 8**, not Robinhood's 18. The multiplier is still WAD (`1e18`); only balances differ.
- **Every multiplier reads exactly 1.0.** No corporate action has ever moved a Coinbase token, so
  there is nothing on Base for exdate to reconcile *yet*.
- **Each token reports 1 byte of code, not 0.** They are B20 native precompiles, not deployed
  contracts — there is no per-asset contract and nothing verified on Basescan. An indexer that
  screens candidates with `extcodesize > 0` passes them by luck; one that expects real bytecode, or
  a proxy, finds neither.

### The thirteen Chainlink proxies

8 decimals, total return, `latestRoundData()` on the proxy, **13/13 naming their ticker in their own
on-chain `description()`** (`Coinbase AAPL`, …) — the same test the Robinhood map rests on. On
2026-09-03 at 08:08 UTC (04:08 ET, pre-market) ages ranged from 1 minute to 12 hours, which is the
documented off-hours freeze behaving exactly as described, and exactly the staleness exdate exists
to surface.

Unlike Robinhood's, **none of the 13 has a secondary SVR proxy.**

### The ERC-8056 selectors, cross-checked

Base's Cobalt changelog states the ERC-8056 selectors as the values from its own frozen ABI. exdate
computed the same four from the signatures for Robinhood Chain in Phase 0. **4/4 agree** —
`uiMultiplier` `0xa60bf13d`, `newUIMultiplier` `0xdc767007`, `effectiveAt` `0x97a4064f`,
`totalSupplyUI` `0x9bea6429`. Two independent first-party sources for numbers exdate has been
dialling for two days.

The changelog also documents the retrospective-`effectiveAt` trap in its own words: "a nonzero
`effectiveAt()` that's `<= block.timestamp` means *already applied*, not *pending*", and "No event
fires at maturation." exdate found both by measurement on Robinhood Chain and recorded them as
chain quirks. **They are properties of ERC-8056 itself, not of Robinhood** — corrected in
`CLAUDE.md` accordingly.

## What changed in the verdict

The 2026-09-02 conclusion was that a second issuer needs *a source module, not a config entry*,
because the read path, the event names and the identity model all differ. Two of those three have
now moved.

**The convergence.** At the Cobalt hardfork, "the B20 Asset multiplier surface becomes ERC-8056
conformant", with `updateUIMultiplier(newMultiplier, effectiveAt)` as the canonical corporate-action
path, `UIMultiplierUpdated(old, new, effectiveAt)` as the canonical event, and the same
`newUIMultiplier` / `effectiveAt` pending pair. That is the *same surface* exdate already indexes —
same selectors, same event, same trap.

**But it is not live yet, and that is measured, not assumed.** Every ERC-8056 view — `uiMultiplier`,
`newUIMultiplier`, `effectiveAt`, `totalSupplyUI`, `WAD_PRECISION` — **reverts on all 13 tokens
today**. Only the Beryl surface answers: `multiplier()` `0x1b3ed722`. Base's own upgrade page gives
Cobalt as *Planning, September 2026* on both Sepolia and mainnet, which is exactly consistent. So
the documentation describes a hardfork that has not shipped.

The practical consequence: a Base source module must dial `multiplier()` today and `uiMultiplier()`
after Cobalt, and must not assume which. Both are cheap to try; the answer is which one reverts.

| | Robinhood Chain | Coinbase B20 on Base |
|---|---|---|
| Token standard | ERC-20 + ERC-8056 | B20 precompile; ERC-8056 at Cobalt, **not live 2026-09-03** |
| Multiplier read | `uiMultiplier()` per token, via Multicall3 | `0xd4197e82(token)` on the registry, or `multiplier()` per token |
| Pause flag | `oraclePaused()` on the token | the registry's second word |
| Change event | `UIMultiplierUpdated(old, new, effectiveAt)` | `MultiplierUpdated(uint256)` today; the same ERC-8056 event at Cobalt |
| Announcements | none | `Announcement` / `EndAnnouncement`, atomically bundled with the change |
| Decimals | 18 | 8 |
| Code at the token address | 283-byte beacon proxy | **1 byte** — a precompile |
| Identity | ticker per contract; the feed map is a ticker heuristic | by contract address, and the registry proves the token set |
| Corporate actions seen | 12 across 10 tokens | **none — every multiplier still reads 1.0** |

## What is still not known

- **Whether Coinbase publishes a corporate-action feed.** This was the third unknown and it stays
  open. Robinhood's `/rhj/corporate-actions` is what makes the reconciliation possible at all;
  `coinbase.com/tokenize` is named as the product page but nothing address-keyed and machine-readable
  turned up alongside the B20 specification. Without an equivalent, Base yields observed multiplier
  steps with no declared side — the permanent state of the five lost July actions.
- **The token → feed link, still a ticker join.** It is a *better* one: both tables sit in the same
  first-party document, the token's own `symbol()` is `AAPLc` and the feed's own `description()` is
  `Coinbase AAPL`, and both were verified on chain. But no first-party statement pairs a feed
  address with a token address, so the join is `AAPLc` ↔ `Coinbase AAPL` and the confidence ladder
  in `reconcile.ts` would rate it `low`, exactly as on Robinhood Chain. The registry closes
  registry ↔ token, not feed ↔ token.
- **When Cobalt actually activates**, and therefore when the two issuers share one read path.

## The verdict for the codebase

Unchanged in substance, narrower in scope. A second issuer still needs a **source module** rather
than a configuration entry — its own read path (a registry call instead of 194 per-token views), its
own event ABI until Cobalt, and its own corporate-action ingest if one ever exists. The
`Repository` interface and the API shapes would not move, `chain_id` is already on every table, and
the reconciliation is arithmetic over (declared rate, observed step, underlying price) with nothing
Robinhood-specific in it.

What is new is that the module is smaller than it looked: after Cobalt it shares exdate's existing
event decoder and view selectors outright, and 8-decimal balances plus a registry read are the only
real differences left. And there is nothing to reconcile on Base until a Coinbase token's multiplier
moves for the first time.

## How to reproduce

```bash
node scripts/phase0/verify-base-b20.mjs        # every address above, read back on Base mainnet
curl https://docs.base.org/specifications/b20/tokenized-stocks-on-base.md
curl https://docs.base.org/base-chain/specs/reference/b20/changelog/02-cobalt-b20asset-multiplier.md
curl https://docs.base.org/upgrades/cobalt/overview.md
curl https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase.md
```

`BASE_RPC_URL` overrides the public endpoint. Both snapshots —
[`data/base-b20-verification.json`](../data/base-b20-verification.json) and
[`data/base-coinbase-feeds.snapshot.json`](../data/base-coinbase-feeds.snapshot.json) — carry every
address, so each row can be checked against the chain without trusting this file.
