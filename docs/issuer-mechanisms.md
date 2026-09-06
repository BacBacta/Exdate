# What each issuer actually does

**Generated. Do not edit — run `node scripts/build-issuer-mechanisms.mjs`.**

3 of 6 issuers have been read; the rest are listed as unread rather
than left out, because a table of three reads as *these are the issuers* when the honest claim is
*these are the ones exdate has looked at*.

This table exists **before** any common interface does. An interface extracted from one
implementation encodes that implementation's assumptions as though they were the domain's, and
reading a third issuer already broke one: **xStocks' `balanceOf()` is the adjusted view where
Robinhood's is the constant.** A contract written after Robinhood alone would have said "balanceOf
is the raw amount", and been wrong in the direction that reports a post-dividend balance as a
pre-dividend one.

## The whole table

| | Robinhood Assets (Jersey) | Coinbase (B20) | Backed Finance (xStocks) | Ondo | Dinari | Swarm |
|---|---|---|---|---|---|---|
| **Product** | Stock Tokens | Tokenized stocks on Base | xStocks | Ondo Global Markets | dShares | Swarm Markets |
| **Chains** | Robinhood Chain (4663) | Base (8453) | 11 networks, incl. Ethereum (1) and BNB Chain (56) | — not probed | — not probed | — not probed |
| **Standard** | ERC-8056 Scaled UI Amount | B20 Beryl — ERC-8056 documented, not live until Cobalt | Backed AutoFeeToken — a rebasing ERC-20 | — not probed | — not probed | — not probed |
| **Constant view** | `balanceOf()` | — not probed — ERC-8056 views revert | `sharesOf()` | — not probed | — not probed | — not probed |
| **Adjusted view** | `balanceOfUI()` | — not probed | `balanceOf()` — **inverted vs ERC-8056** | — not probed | — not probed | — not probed |
| **Multiplier** | `uiMultiplier()` | `multiplier()` | `getCurrentMultiplier()` (3 words, first is the WAD); `multiplier()` also answers | — not probed | — not probed | — not probed |
| **Announcement** | `UIMultiplierUpdated`, ~9–10 min ahead | — not probed — no step has ever happened | — not probed — needs a log scan over a known step | — not probed | — not probed | — not probed |
| **Application event** | none — nothing is emitted when it takes effect | — not probed | — not probed | — not probed | — not probed | — not probed |
| **Declared cash rate** | yes — `/rhj/corporate-actions`, a one-month window with no pagination | no corporate-action feed found | no — the issuer publishes the step, not the cash rate | — not probed | — not probed | — not probed |
| **Declared step history** | no — a row that falls out is unrecoverable | n/a | yes — every step back to 2025, with its reason | — not probed | — not probed | — not probed |
| **Tokens** | 194 | 13 | 726 | — not probed | — not probed | — not probed |
| **Steps observed** | 13 | 0 | 305 of 726 tokens have moved; 603 declared steps (3 Administrative, 590 Dividend, 2 ReverseSplit, 8 Split) | — not probed | — not probed | — not probed |
| **What exdate could produce** | **haircuts** — declared rate and observed step both available | **nothing yet** — every multiplier is exactly 1.0 | **a step ledger** — a haircut needs a cash rate from a source that is not the issuer | — not probed | — not probed — their page names dividends, splits, ticker changes and mergers; the mechanism is not stated | — not probed |
| **Evidence** | `data/robinhood-assets.snapshot.json`, `data/multiplier-events.observed.json` | `data/base-b20-verification.json` | `data/xstocks-verification.json`, `data/xstocks-steps.observed.json` | not read | not read | not read |

## The three things that differ, and why each one matters

**1. Which view is constant.** Robinhood: `balanceOf()` is constant, `balanceOfUI()` adjusts.
Backed: `sharesOf()` is constant, `balanceOf()` adjusts. Coinbase: neither, until Cobalt ships.
A common interface must name the two roles and let each adapter say which selector fills them —
it must never assume ERC-20's own `balanceOf` is one or the other.

**2. What the issuer publishes.** Robinhood gives the **declared cash rate** and a one-month window
that loses rows; Backed gives the **full step history** and no cash rate. So the same measurement
has opposite gaps: exdate archives Robinhood's feed daily because it disappears, and would need a
non-issuer source for a rate on Backed. **Only Robinhood supports a haircut end to end today.**

**3. Whether anything has moved.** Coinbase: nothing, ever — 13 tokens at exactly 1.0. Backed:
305 of 726 tokens, 603 declared steps. Robinhood: 13 distinct steps.
An adapter for an issuer with no events is untestable against reality, which is why Base is
verified and unwired.

**And one thing only Backed has, which chantier 2 was waiting for.** Robinhood's 45 archived actions
are all cash dividends — zero splits, zero reverse splits, zero anything else, which is why no
handler for them exists here. Backed's history holds
8 splits, 2 reverse splits and 3 administrative steps,
each labelled by the issuer. `reconcileSplit()` has existed and been tested since M3 and has never
run end to end for want of a declared ratio; these are the first real instances exdate has seen.

## What this says about the interface

Not yet. The roadmap's order is 1c (wire xStocks as a **second concrete implementation**, with no
interface) then 1d (**extract** the interface from the two). This table is the argument for that
order rather than a substitute for it: three issuers, three spellings of one idea, and the one
assumption everybody would have shared turned out to be inverted between the first two that have
real events.

One thing already generalises, measured rather than assumed: **`multiplier()` — the same four
bytes — answers on both Coinbase B20 and Backed, and on Backed it agrees with
`getCurrentMultiplier()`'s first word.** One selector, one meaning, two unrelated issuers.
