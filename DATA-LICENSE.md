# Licence for the data in `data/`

The code in this repository is under the MIT licence in `LICENSE`. The data is a different
thing, made from two different sources, and only one of them is exdate's to license.

## What exdate grants

exdate's **own observations** — every figure it measured from Robinhood Chain's public state
(multiplier steps and their effective blocks, state confirmations, reconciliations and haircuts,
feed corroboration, the DEX-to-feed gap, primary flows, the session share, RPC probes, the
capture record and its cadence) — are licensed under **Creative Commons Attribution 4.0
International (CC BY 4.0)**: <https://creativecommons.org/licenses/by/4.0/>. Use them, republish
them, build on them, sell what you build; say they came from exdate and link back.

## What exdate cannot grant, and therefore excludes

Some rows and fields are **copied from the issuer's own API** (`api.robinhood.com/rhj`): declared
dividend rates, process dates, corporate-action ids and statuses, the token registry with its ISINs,
names and logo URLs, and the quotes the capture record samples.

Three files are entirely that content: `data/robinhood-assets.snapshot.json`,
`data/robinhood-corporate-actions.snapshot.json`, and `data/corporate-actions.archive.json`, which
is a cumulative archive of the same rows. Three more are exdate's own measurements built on top of
it and carry issuer fields inside them:

| File | The issuer's | exdate's |
|---|---|---|
| `data/reconciliations.observed.json` | `rows[].actionId`, `.type`, `.actionStatus`, `.processDate`, `.rate`, `.oldRate`, `.newRate`, `.symbol`, `.issuerSpotToday`, and `.price` where `price.source` is `robinhood:/rhj/prices` | everything else: the status, the note, the expected and observed steps, what arrived, the haircut, the implied reinvestment price, the feed pairing. The file's own `sources` block is the authoritative split. |
| `data/effective-prices.observed.json` | every quote under `steps[].quotes` (`bid`, `ask`, `mid`, `generatedAt`, `isTradingHalt`) | which quote was captured, when, how far from `effectiveAt` it landed, and the refusal and its reason when none was |
| `data/exdate.tokenlist.json` | `tokens[].name`, `.symbol`, `.logoURI`, `extensions.isin`, `extensions.dividendProcessDate`, and the declared rate inside `extensions.dividendOwedPerToken` | `extensions.underlyingSharesPerToken`, `extensions.priceFeed`, `extensions.priceFeedCorroboratedBy`, `extensions.dividendDeclaredNotOnChain`, and the arithmetic in `dividendOwedPerToken` |

The token list carries no `sources` block of its own on purpose: its schema rejects unknown
top-level fields, and an invalid list is silently ignored by every consumer.

Robinhood's terms grant exdate a personal, non-sublicensable licence to that content
(`docs/terms-review.md`). exdate cannot pass on rights it does not hold, so **the CC BY 4.0 grant
above does not cover the three issuer files, nor any field named as the issuer's in the table
above**. They are reproduced here with their source stated so that every measurement can be
checked against what the issuer declared; what you may do with them is between you and the
issuer's terms.

## How to tell the two apart

Every dataset in `data/` names its sources — per row, or in a `sources` block naming the fields —
and `www.exdate.me/data/` lists them. A value sourced `onchain:…` or `chainlink:…`, or a file that
describes its own measurement, is exdate's. A value sourced `robinhood:…`, or named as the
issuer's in the table above, is not.

## How to attribute

CC BY 4.0 asks for credit, a link to the licence, and a note of any changes. This is enough:

> Data from exdate (<https://www.exdate.me>), CC BY 4.0
> (<https://creativecommons.org/licenses/by/4.0/>). Figures copied from Robinhood's own API are
> excluded from that grant.

If you modified what you republish, say so. If you republish an issuer field alongside it —
a declared rate, a process date, an ISIN — that part is not covered, and it is yours to square
with the issuer's terms.
