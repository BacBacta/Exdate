# Robinhood Chain Terms of Service, read against what exdate does

**Not legal advice.** Written to make counsel's hour count: the Terms are quoted, exdate's use is
inventoried from the code rather than described from memory, the two are laid against each other,
and what is decided is separated from what only a lawyer can answer. Everything quoted below was
read from `https://docs.robinhood.com/chain/terms-of-service` on 2026-09-04; the page says
**Last Updated: August 24, 2026**. The provider is **RHDA, LLC**. Governing law is **Delaware**
(§13); disputes go to **mandatory arbitration** under the FAA with a class waiver (§12); Robinhood
may amend the Terms at any time by posting, effective on posting (§15).

## 1. The finding that reorders everything: what is inside the Terms and what is not

§2.1 draws the line itself:

> Robinhood Chain itself, including its protocol smart contracts and any associated bridging
> contracts […] nor any associated cross-chain oracle, verification services or other infrastructure
> (each, a "Third Party Provider") **is not part of the Services**.

So the on-chain record — `UIMultiplierUpdated` logs, the ERC-8056 views, transfers, the Chainlink
aggregator state that exdate reads with `latestRoundData` / `getRoundData` — is **outside the
Terms as data**. It is public chain state, and Robinhood says so. That covers the multiplier
history, every effective block, the state verification, the wallet page's reads, the DEX gap, the
primary flows and the session share.

What *is* a Service, per §2.1, is the **pipe** and the **issuer's off-chain API**:

- **Public RPC** — "subject to rate limits and is not intended for production-grade,
  high-throughput, or latency-sensitive applications"; Robinhood "may throttle, suspend, modify, or
  discontinue the Robinhood Chain Public RPC at any time and without notice."
- **Documentation and Developer Tools** — "developer documentation, SDKs, **APIs**, and related
  tools through https://docs.robinhood.com/chain". The Stock Token API (`api.robinhood.com/rhj/`)
  is documented on that site, on a page that carries no terms of its own. The page says only that
  the endpoints are "read-only", "rate-limited to 60 requests/second and cached". There is no
  authentication, no licence header on the responses, and `api.robinhood.com/robots.txt` is empty.

The conservative reading, and the one this document assumes: **`/rhj` responses are "Robinhood
Materials"** under §5.1 — "all content, software, code, documentation, interfaces, designs,
graphics, text, audiovisual elements, and other materials made available through the Services".
The alternative reading (that "through docs.robinhood.com/chain" means the documentation itself,
and an API served from `api.robinhood.com` sits under some other agreement) has nothing in writing
behind it. **Question for counsel #1.**

## 2. The two clauses that bite

### 2.1 The purpose covenant, §2.4(a)

> you will use the Services solely for lawful **testing, experimentation, evaluation, and
> development purposes**;

This is the broadest constraint in the document and it attaches to *every* Service, the Public RPC
included. A public data product — `api.exdate.me`, `www.exdate.me`, a token list wallets import —
is not, on its face, testing, experimentation, evaluation or development. On the on-chain side this
is entirely a question of **which pipe** is used: the chain is outside the Terms, but reading it
*through Robinhood's RPC* is a use of a Service. Reading it through a node exdate runs, or through
one of the six third-party endpoints the project already probed (`data/rpc-endpoints.observed.json`),
is not. On the `/rhj` side there is no equivalent substitute: the issuer's declared rates exist
nowhere else.

### 2.2 The licence and its restrictions, §5.2

> a non-exclusive, limited, **revocable**, terminable, **personal**, non-transferable, and
> **non-sublicensable** license to access and use the Services and Robinhood Materials solely for
> their intended purpose.

> Except as expressly permitted, you may not: (a) copy, reproduce, **distribute**, sell, lease,
> sublicense, or otherwise **make the Services or Robinhood Materials available to any third
> party**; (b) modify, adapt, translate, or **create derivative works** from the Services or
> Robinhood Materials; (c) frame, mirror, or **incorporate the Services or Robinhood Materials into
> any website, application, or other work**; (d) reverse engineer […]; (e) use the Services or
> Robinhood Materials to develop or operate **a competing product or service**; (f) use the
> Services or Robinhood Materials for any purpose not expressly permitted by these Terms; or
> (g) imply any affiliation with, or endorsement by, Robinhood without prior written consent.

Against the inventory in §3, if `/rhj` output is Materials: (a) is met by republishing the archive
and the registry snapshot; (b) by the reconciliations, which are derived from the declared rates;
(c) by the site and the API; (e) is weak — Robinhood publishes no haircut and exdate measures the
issuer rather than competing with it, but "competing" is undefined and §5.11(f) speaks of a
"direct competitor".

Two things narrow this, and both are for counsel to weigh (**#2**):

- **The restrictions are contractual, not copyright.** A declared dividend rate, a process date, an
  ISIN, a contract address are facts, and facts are not copyrightable (US: *Feist*). What binds
  exdate is the agreement it entered by using the Service. That means the exposure is **personal
  to exdate** — revocation (§5.1: "your license will immediately cease and you must promptly stop
  using and, at Robinhood's option, delete or destroy any copies of Robinhood Materials"),
  blocking (§6, including "restricting or blocking specific wallet addresses"), and the indemnity
  (§10) — and not a claim against the data in a downstream recipient's hands, who never agreed to
  anything. It also means "delete or destroy any copies" is a live obligation on the committed
  archive should access ever be revoked.
- **"Non-sublicensable" decides what exdate can license.** exdate can put its own measurements
  under any licence it likes. It cannot pass on rights it does not hold in the `/rhj` fields it
  republishes. Any data licence, paid or free, has to carve those fields out or be conditioned on
  them — which is the question TODO item 7 was pointing at.

## 3. What exdate actually does with the Services (from the code, 2026-09-04)

### 3.1 Calls

| Endpoint | Caller | Cadence | What is kept |
|---|---|---|---|
| `GET /rhj/corporate-actions` | indexer poller; `archive-corporate-actions.yml` | hourly-ish; daily | the whole window, merged into `data/corporate-actions.archive.json` — **45 rows** today, cumulative, committed |
| `GET /rhj/assets` | `scripts/phase0/snapshot-registry.mjs`; tests | on demand | `data/robinhood-assets.snapshot.json`, 194 rows, and the generated registry built from it |
| `GET /rhj/prices/{symbol}` | capture watcher (systemd, 30 s scan, samples only at a step); `capture-effective-prices.yml` (every 5 min nominal); `measure-dex-feed-gap.yml` (hourly); reconciliation build | continuous | three quotes per step at effect; one quote per quotable token per hour in the gap file |
| Public RPC | indexer (194 tokens, ~30 Multicall requests per ~60 s); watcher (one `eth_getLogs` per 30 s); every visitor of `/wallet/` from their own browser; the collectors | continuous | on-chain observations |

The `/rhj` calls are well inside the documented 60 req/s. The Public RPC use is exactly what §2.1
says the endpoint is "not intended for" — production-grade and continuous — and §2.3 lists "use
of automated tools (such as bots, scrapers, or spiders)" under activity that "interferes with,
disrupts, degrades, or attempts to circumvent" the Services. The qualifier matters: an indexer that
respects the limiter is not interference, and the project measured and absorbed the limiter's
behaviour rather than working around it (`packages/core/src/transport.ts`). But "not intended for
production" is a plain sentence, and the watcher's capture — the one thing that cannot be re-read —
depends on that endpoint today.

### 3.2 What is republished, and where

- Every `data/*.json` is copied into the site and served at `www.exdate.me/data/` with CORS. That
  includes the corporate-action archive and the registry snapshot: `/rhj` content, verbatim, with
  its source named on every row.
- `www.exdate.me/tokenlist.json`: 194 tokens; every `logoURI` points at `cdn.robinhood.com`
  (the API page calls it a "Public CDN logo"); the list's own description reads "tokenized stocks".
- `api.exdate.me/v1/*` serves, from the issuer feed: `isin`, `issuer`, `logoUrl`, `rate`
  (declared gross per share), `processDate`, `issuerId`, the action `type` and `status`.
- Everything else the site and API publish — haircuts, corroboration, effective blocks, state
  verification, session share, DEX gap, primary flows, the wallet's record — is exdate's own
  measurement from on-chain data. The haircut takes the declared rate as one input.

### 3.3 What is not done

No Robinhood credential is used or held. No scraping of `robinhoodchain.blockscout.com` (it is
behind Cloudflare and the project never scripted it). No brokerage or customer data. Nothing is
sold or licensed today, and both package READMEs say the packages are unpublished.

## 4. The trademark licence, §§5.5–5.12: three concrete findings

The site uses "Robinhood Chain" and "Robinhood" to say what it measures. That is a pre-approved
use — §5.6(a) factual identification, §5.6(c) "factually accurate editorial, journalistic, academic,
research, or educational content", and §5.6(d)(iii) names **"ecosystem directories, token lists, or
blockchain explorer listings"** outright. But §5.7 makes the licence conditional, and "failure to
comply with any condition automatically terminates the license […] with respect to the
non-compliant use, without notice". Three conditions touch the site as it stands:

1. **§5.7(j), terminology — the site's own title breaks it.**
   > You must not describe, refer to, or market "Stock Tokens" […] as "tokenized stocks,"
   > "tokenized equities," or similar characterizations. Approved terminology for external-facing
   > content is "Stock Tokens" or "tokenized real-world assets such as Stock Tokens."

   Counted on 2026-09-04: `apps/web/app/layout.tsx` ×3 (the `<title>` is *see what your
   tokenized stock actually paid you*, and the OG description), `page.tsx` ×3, the OG image ×2,
   `Chrome.tsx` ×1, `observed.ts` ×1, the token list description ×1, the README ×1, and
   "tokenized-equity" in `core/src/chains.ts` and `staleness.ts` (Chainlink's own name for the
   feed category — code, not external-facing, but the same words). This is a product-wording
   decision for the owner, not a code fix: the phrase is the pitch. The Terms are explicit that
   the condition applies "regardless" of whether the use would otherwise be editorial.

2. **§5.7(b)(ii), the disclaimer — absent.**
   > community-operated channels, websites, or initiatives must include a prominent disclaimer such
   > as: "This [community/project/initiative] is not affiliated with, endorsed by, or officially
   > connected with Robinhood Markets, Inc."

   Not present anywhere on the site or in the README. One line in the footer satisfies it.

3. **§5.7(k), metrics — already met by design.** Every figure on the site names how it was derived,
   the period, and the source file, and Robinhood Chain figures are never blended with any other
   Robinhood product. This is the site's founding rule and happens to be the Terms' condition.

Also checked: §5.7(c)/(d) — exdate is the primary brand and the domain contains no Robinhood mark
(fine); §5.7(l) — no reference to `$HOOD` anywhere public (fine); the 194 company logos hotlinked
from Robinhood's CDN are **third-party** marks (Apple's, not Robinhood's) — §8.4 says Robinhood
disclaims liability for users' use of third-party IP. Hotlinking logos in a token list is standard
practice and low risk, but it is a question about Apple and Ford, not about Robinhood.

## 5. Two things the Terms do not cover, and one that is time-limited

- **EU database right.** The operator is in the EU. Directive 96/9/EC, art. 7, gives the maker of
  a database a *sui generis* right against "extraction and/or re-utilisation of the whole or of a
  substantial part" and against "repeated and systematic extraction and/or re-utilisation of
  insubstantial parts" (art. 7(5)). Merging the whole `/rhj/corporate-actions` window daily into a
  public archive is systematic extraction and re-utilisation of a database. Whether **RHDA, LLC**, a
  Delaware entity, is a qualifying rightholder in the EU (art. 11 limits the right to EU nationals,
  residents and companies with a registered office and real link in the EU — Robinhood's European
  entity is a separate company) is genuinely open. **Question for counsel #3**, and it is one the US
  Terms say nothing about. The chain itself has no "maker" in the directive's sense.
- **Chainlink's terms were not readable from this workspace** — `chain.link/terms` renders in
  JavaScript and returned only page metadata. The fact that matters: exdate reads feed data from
  the aggregator contracts on chain, never from Chainlink's website or any Chainlink API, which is
  the same footing as the chain's own state in §1. **Question for counsel #4**: whether any
  Chainlink data-feed licence reaches on-chain reads and their republication.
- **The arbitration opt-out has a clock.** §12.13: reject by mailing a signed notice to RHDA, LLC,
  85 Willow Road, Menlo Park, CA 94025, "Attn: ROBINHOOD CHAIN Arbitration Rejection Notice",
  **within sixty calendar days after first accessing or using the Services**. First access was on
  or about 2026-09-01/02 (Phase 0). Sixty days from 2026-09-01 is **2026-10-31**. Whether to opt out
  is for counsel; the deadline is a fact, and the Terms say "this is the only manner".

## 6. exdate's own licence position, which is the other half of "before any of it is sold"

- **There is no `LICENSE` file in the repository.** `package.json` at the root, `@exdate/core` and
  `@exdate/sdk` declare `"license": "MIT"`; `@exdate/api`, `@exdate/indexer`, `@exdate/status` and
  `@exdate/web` declare nothing, which in law means all rights reserved. `CLAUDE.md` calls the
  project "open-core". A `license` field with no licence text is a defect npm will publish
  unchanged; it must be fixed before TODO item 6.
- **The data has no licence at all.** If the token list and the datasets are meant to be used by
  wallets and aggregators — that is the point of serving them — they need a stated data licence
  (CC-BY-4.0 or ODbL are the usual choices), separate from the code licence, and it can only cover
  exdate's own measurements. The issuer-sourced fields are non-sublicensable under §5.2 on the
  conservative reading, so the licence has to say which columns it covers. Rows already name their
  `source`, which makes the carve-out mechanical.

## 7. What is decided, what is cheap, what needs counsel

**Engineering can do now, no lawyer needed:**

- Add the §5.7(b)(ii) disclaimer to the site footer and the README.
- Add a `LICENSE` file matching the MIT claim (owner's choice of licence, one minute once chosen).
- Move production chain reads off the Public RPC — a node exdate runs, or a third-party endpoint —
  so the on-chain product is outside every clause of the Terms. TODO item 3 called this optional;
  §2.1 and §2.4 make it the terms-driven answer. The capture watcher is the priority, since its
  reads cannot be re-done.
- Decide the wording: "Stock Tokens" in the title, OG image, token list and README, or accept the
  §5.7(j) risk knowingly. This is the owner's call because it is the product's sentence.

**For counsel, in order of consequence:**

1. Is `/rhj` a Service and its output Robinhood Materials? (§1) Everything below turns on it.
2. Does §2.4(a) — "solely for testing, experimentation, evaluation, and development" — permit a
   production product to use `/rhj` at all, and what does "intended purpose" in §5.2 mean for a
   read-only public API with no auth? (§2)
3. The republication as it stands: the committed archive, the registry snapshot, `/data/` on the
   site, the fields served by `/v1`. What of it must go behind a carve-out, and what "delete or
   destroy any copies" would mean for a public git history if access were revoked. (§2.2, §3.2)
4. The EU database right, and whether RHDA, LLC can hold it. (§5)
5. Selling or licensing: which columns can carry a licence and which cannot. (§6)
6. The arbitration opt-out, before 2026-10-31. (§5)
7. Chainlink's terms, unread here. (§5)

**One option that changes the whole picture:** ask. §5.11 gives `robinhoodchain@robinhood.com`
for uses that need written consent, and a one-paragraph description of exdate — an independent
measurement of the issuer's own distributions, published with sources — is either welcome or not.
A written permission for `/rhj` converts questions 1–3 and 5 from interpretation into a document.

## 8. The worst case, stated plainly

Even on every conservative reading at once, the exposure is **contractual and personal**:
Robinhood revokes exdate's licence, blocks its addresses and endpoints, and demands deletion of the
archive; exdate carries the §10 indemnity for any claim that arises from its use. It is not a claim
over facts already published, and it does not reach anyone who read exdate's data without touching
Robinhood's Services. The measurements — the haircuts, the state confirmations, the gaps — are
exdate's, made from public chain state. What is at stake is the *pipe* and the *declared rates*,
and the first of those has a substitute today.
