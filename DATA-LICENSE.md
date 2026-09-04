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
names and logo URLs. Every such value carries a `source` that begins with `robinhood:`, and two
files are entirely that source: `data/robinhood-assets.snapshot.json` and
`data/robinhood-corporate-actions.snapshot.json`; `data/corporate-actions.archive.json` is a
cumulative archive of the same rows.

Robinhood's terms grant exdate a personal, non-sublicensable licence to that content
(`docs/terms-review.md`). exdate cannot pass on rights it does not hold, so **the CC BY 4.0 grant
above does not cover any field whose `source` begins with `robinhood:`, nor the three files
named**. They are reproduced here with their source stated so that every measurement can be
checked against what the issuer declared; what you may do with them is between you and the
issuer's terms.

## How to tell the two apart

Every dataset in `data/` names its `source` per row or per file, and `www.exdate.me/data/` lists
them. A field with a `source` of `onchain:…` or a file that describes its own measurement is
exdate's. A field with `source: robinhood:…` is not.
