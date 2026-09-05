# @exdate/core

The measurement library behind [exdate](https://www.exdate.me) — the corporate-action layer for
Robinhood Chain Stock Tokens. No I/O of its own: chains and ABIs, WAD arithmetic, feed staleness,
reconciliation, the ERC-8056 traps, and the generated token registry. The indexer, the API, the SDK
and the public site all compute from this and nothing else.

exdate is an independent measurement. It is not affiliated with, endorsed by, or officially
connected with Robinhood Markets, Inc.

```bash
pnpm add @exdate/core
```

## What it knows that a general library does not

Stock Tokens pay no cash dividend on chain. They raise an **ERC-8056 multiplier**, so a raw balance
stays put while the underlying shares it represents grow. Three things about that are easy to get
wrong, and this library encodes the measured answer to each.

**A pending change is not what the contract seems to say.** With nothing pending,
`newUIMultiplier() == uiMultiplier()` and `effectiveAt()` is a timestamp in the *past*. Treating a
non-zero `effectiveAt` as "pending" reports phantom dividends.

```ts
import { pendingChange } from '@exdate/core'

pendingChange({ uiMultiplier, newUIMultiplier, effectiveAt, now })
// null unless effectiveAt > now AND newUIMultiplier !== uiMultiplier
```

**Nothing is emitted when a change takes effect.** `UIMultiplierUpdated` fires once, at
announcement, about nine minutes ahead, carrying a future `effectiveAt`. No log marks the moment
itself — verified on chain, and confirmed in Base's own B20 changelog.

**A Chainlink price for these tokens is already total return.** It is
`underlying × multiplier`; multiplying it by `uiMultiplier()` again double-counts every dividend
ever paid.

## Reconciling one distribution

```ts
import { reconcile } from '@exdate/core'

const row = reconcile({
  declaredRate: '0.306812',      // the issuer's gross per underlying share
  oldMultiplier, newMultiplier,  // the observed step, WAD
  priceWad,                      // the feed's answer at effectiveAt
  feedCorroboratedBy: ['multiplier-step'],
})

row.impliedHaircutBps   // 3378 — what did not arrive, in basis points
row.confidence          // 'low' | 'medium' — never 'high': no first-party token→feed link exists
row.feedCorroboratedBy  // which behaviour earned that confidence, never merged into one word
```

Every function refuses rather than guesses: a value that cannot be measured is `null` with a reason,
never zero. `high` confidence is reserved for a first-party address-level statement linking a token
to its feed, and nothing has one.

## Entry points

| Import | What |
|---|---|
| `@exdate/core` | chains, ABIs, WAD maths, reconciliation, staleness, the generated registry |
| `@exdate/core/yield` | the distribution ledger — growth split into dividend and unexplained |
| `@exdate/core/pending` | what is declared and has not landed, and what it owes per token |
| `@exdate/core/holdings` | balances through Multicall3, hand-encoded, importing nothing |
| `@exdate/core/webhooks` | the signed payload contract and its verifier |
| `@exdate/core/pools` | exact bigint pool pricing against a 6-decimal quote asset |
| `@exdate/core/quotes`, `/chains`, `/tokenlist` | issuer quotes, chain constants, token-list validation |

`@exdate/core/holdings` deliberately imports nothing at all, so a browser page can read a balance
without bundling an RPC library.

## Licence

MIT for the code. The datasets exdate publishes are CC BY 4.0 with the issuer's own fields carved
out — see `DATA-LICENSE.md` in the repository.
