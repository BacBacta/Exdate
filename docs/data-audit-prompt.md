# exdate — data integrity audit brief

A prompt to hand to an auditor, human or model. It is written to produce a forensic,
evidence-backed verdict on every figure exdate publishes about Stock Tokens: whether it is
**right**, **traceable to a primary source**, **reproducible by someone else**, **complete**, and
**worded no more strongly than the measurement allows**. The report is to be delivered in
**French**. Everything the auditor needs to avoid auditing the wrong thing is in section 1.

---

## 0. Role and stance

You are a data-quality lead and forensic auditor with fifteen years across market-data vendors,
corporate-action processing, fund administration and on-chain analytics. You have signed off
datasets that risk desks price against and that tax preparers file from, and you have been the
person a journalist called when a published number turned out to be wrong. You are being paid for a
**critical** audit: the owner has heard that the data is "careful" and does not need to hear it
again.

Your stance:

- **Reproduce, never trust.** A figure is verified when you have re-derived it from the primary
  source yourself, on a machine the owner does not control, and it matches. Reading the code that
  produced it is not verification.
- **Two witnesses.** An on-chain fact is confirmed when two independent endpoints agree on it; a
  first-party fact when the issuer's or Chainlink's own endpoint answers it today. One witness is a
  reading, not a confirmation.
- **Evidence or nothing.** Every finding cites the surface, the exact displayed text, the dataset
  field, the script, the primary-source call, and the value you obtained. "The number looks
  plausible" is not a finding, and neither is "the code seems correct".
- **Words are claims.** A correct number under an overreaching sentence is a wrong claim. Audit the
  sentence as strictly as the figure.
- **Say what you could not verify.** An audit that reports only what it checked has hidden the
  most useful part.

## 1. What you are auditing

### 1.1 The product in one paragraph

exdate is an open-core data layer for Robinhood Chain Stock Tokens (ERC-20 + ERC-8056, 194 tokens,
issuer Robinhood Assets (Jersey) Limited). A dividend never lands in a wallet: the token's
`uiMultiplier()` rises. exdate reads every `UIMultiplierUpdated` log, the ERC-8056 views, the
Chainlink feeds and the issuer's own REST API, pairs each declared corporate action with the
observed multiplier step, prices the step at the instant it took effect, and publishes the
**effective haircut**: what was declared against what arrived. Around that sit: the off-hours share
of transfers, net creation per token, the traded-price-to-oracle gap, and the token-to-feed pairing
with the evidence behind it.

### 1.2 Where the data is published

Every surface below shows figures; every one is in scope.

| Surface | What it shows |
|---|---|
| `https://www.exdate.me/` | the headline haircut, the dividend counts, the three measured figures |
| `/t/<address>/` × 194 | per token: shares per token, owed, last dividend, feed; every dividend with its state and detail |
| `/dividends/` | 37 declared not on chain (owed per token, state), 12 landed (declared, arrived, gap), the timing figures, the method |
| `/market/` | traded vs oracle per token, oracle age, pool depth, pairing evidence; by session; net creation |
| `/wallet/` | live: balances, shares represented, owed; history: shares gained per step, dollars declared and arrived; CSV export |
| `/about/` | timing figures, coverage per chain |
| `https://api.exdate.me/v1/*` | every route in `docs/api.md`; the reconciliation rows are the differentiating dataset |
| `/tokenlist.json` | 194 tokens with extensions: shares per token, owed, pending, feed proxy, corroboration |
| `/calendar.ics`, `/t/<address>/calendar.ics`, `/feed.xml` | every declared dividend and every observed change, dated |
| `/badge/<address>.svg`, `/badge.svg`, `/t/<address>/opengraph-image` | one figure per token, rendered |
| `/data/*.json` | the committed observations, served as files |
| `@exdate/core`, `@exdate/sdk` on npm | the arithmetic (WAD conversion, reconciliation, pending, yield) and the typed contract |

### 1.3 The datasets, and what each claims to be

All in `data/`. Group A is copied from a first party; group B is observed by exdate on chain or at
an endpoint; group C is derived from A and B; group D is the second issuer.

**A. First-party snapshots**
- `robinhood-assets.snapshot.json` — the issuer's registry (`GET /rhj/assets`): 194 assets, addresses, ISINs, multipliers.
- `robinhood-corporate-actions.snapshot.json` — the issuer's corporate-action window (`GET /rhj/corporate-actions`): about one month deep, no pagination, no date filter.
- `corporate-actions.archive.json` — exdate's cumulative archive of that window, keyed on `(issuer id, processDate)`, with `firstSeenAt`/`lastSeenAt` and status history. **Rows that fell out of the window before the archive began are unrecoverable from any first-party source.**
- `chainlink-feeds.snapshot.json` — Chainlink's feed directory for the chain (57 feeds, 35 tokenized-equity).

**B. Observations**
- `multiplier-events.observed.json` — every `UIMultiplierUpdated` log since public mainnet, from a whole-chain scan (13 logs, 12 distinct changes, 10 tokens).
- `multiplier-state-verification.json` — `uiMultiplier()` read at `effectiveBlock − 1` and `effectiveBlock` for each change, from an archive endpoint.
- `effective-blocks.json` — the block at which each change took effect, resolved by bisection over block headers.
- `effective-prices.observed.json` — the issuer's quote sampled at `effectiveAt −30 s, 0, +30 s` by the capture watcher; per step: quotes or a stated reason for none.
- `reconciliations.observed.json` — each declared action against its step: status (`matched`, `anomaly`, `pending`, `unmatched`), price used and its source, expected vs observed step, received per share, implied haircut, implied reinvestment price, spot plausibility.
- `session-share.observed.json` — hourly samples of transfer rate by ET market session; the published share is hour-weighted; refused below 3 samples per session.
- `primary-flows.observed.json` — mint minus burn per token per contiguous window.
- `dex-feed-gap.observed.json` — per token: deepest USDG pool's price vs Chainlink answer at one instant, feed age, pool balance; per session medians.
- `transfer-volume.observed.json` — transfer counts over sampled windows.
- `capture-cadence.observed.json` — how often GitHub actually ran the capture job.
- `rpc-endpoints.observed.json` — every public RPC endpoint probed: archive depth, log caps, browser CORS, agreement per depth.

**C. Derived**
- `token-feed-map.json` — token → feed pairing by ticker, with `corroboratedBy` (`multiplier-step`, `traded-price`) per row; `verified: false` everywhere by design.
- `feed-map-verification.json`, `svr-proxy-check.json`, `issuer-quote-basis.json` — the checks behind the pairing, the SVR proxies, and whether `/rhj/prices` is multiplier-adjusted.
- `dex-pools.json` — 277 pools across 192 tokens discovered by behaviour and confirmed by the factory.
- `exdate.tokenlist.json` — the published token list, validated against the schema before writing.

**D. Second issuer**
- `base-b20-verification.json`, `base-coinbase-feeds.snapshot.json` — Coinbase's 13 tokens, oracle registry and feeds on Base, read back on chain. No multiplier has ever moved there.

### 1.4 Rules the data is built under — audit against them, do not relitigate them

1. Never invent an address, ABI, RPC endpoint or feed ID.
2. Never invent a market number. No data → the surface says so. Every displayed yield traces to a real on-chain event.
3. Official docs beat the repository's own notes.
4. Tokens are identified by address, never by symbol.
5. Chainlink prices for these tokens are **total return**: they already include the multiplier and are never multiplied by it.
6. Every bigint is a decimal string; anything not observed is `null`, never `0`, never absent.
7. Every published figure is dated, and its sample size is stated where it is a statistic.
8. No rate, annualisation, projection or landing date is ever computed; refusals carry a reason code.

### 1.5 Primary sources, and their limits

- **Robinhood Chain** (chainId 4663). Robinhood's public RPC `https://rpc.mainnet.chain.robinhood.com` serves no archive state and takes 2 000 000-block `eth_getLogs`; third-party endpoints serve archive state and cap logs at 1 000–10 000 blocks; the set changes without notice. `data/rpc-endpoints.observed.json` and `node scripts/probe-rpc-endpoints.mjs` are the current picture. `block.number` inside the EVM is the parent chain's; use `ArbSys.arbBlockNumber()`. Block 0 has timestamp 0.
- **Issuer API** `https://api.robinhood.com/rhj/` — `/assets`, `/prices/{symbol}` (raw underlying, not multiplier-adjusted, serves the present only), `/corporate-actions` (a one-month window). Rate-limited despite the documented 60 req/s; `/prices` answers `local_rate_limited` as HTTP 200 text.
- **Chainlink** — `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`; `AggregatorV3Interface`, 8 decimals, heartbeat 86 400 s, deviation 0.5 %, 24/5; `roundId` is phase-encoded and not portable between the primary and SVR proxies; `getRoundData` reads history from the head without an archive node.
- **Explorer** `robinhoodchain.blockscout.com` — behind Cloudflare, not scriptable; usable by a person.
- **Base / Coinbase B20** — `docs.base.org/specifications/b20/tokenized-stocks-on-base`; oracle registry `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD`.

### 1.6 Known gaps — already on the owner's list, do not rediscover them as findings

- Five July actions (CRWD, SGOV, MU, ORCL, DELL) have no declared rate and never will; their steps are `unmatched` and say so.
- 12 of 35 feed pairings rest on a ticker match alone; 22 more on the traded price; 1 (SGOV) on its own step. No first-party address-level link exists.
- No split has been reconciled end to end (CRWD ×4 has no issuer row).
- 35 of 194 tokens have a Chainlink feed; the issuer quote capture covers all 194 from the next dividend on, and three historical steps carry no quote for a stated reason (UPS: first sample 350 s late, on a halted market).
- The off-hours share rests on two days of hourly samples; the page states the sample beside the share.
- Base is verified and unwired.

Confirm each of these is stated where a reader would need it; that is in scope. Reporting them as new is not.

## 2. Who relies on the data, and what a wrong number costs

1. **A lending-market curator** sizing a haircut on a Stock Token collateral: prices the token against the Chainlink feed; needs the gap, the feed age, and whether the pairing is the right feed. A mispaired feed is a liquidation against the wrong asset.
2. **A tax preparer** with the wallet CSV: files "dollars declared" and "dollars arrived" per step. A rounding or a price-at-effect error is a wrong return.
3. **A journalist** quoting "36 % of Apple's dividend never arrived": needs the exact claim boundary (implied haircut at the price in force at the instant of the step, one event) or will overstate it.
4. **A wallet product** importing `/tokenlist.json`: shows "owed per token" to millions of holders; a stale multiplier or a wrong extension is a wrong number in a wallet.
5. **A developer** on webhooks and the SDK: relies on `null` meaning unobserved and on ids being deterministic.

## 3. Standards and frameworks to apply

Apply each where it bites; cite it in the finding.

- **ISO/IEC 25012** data-quality model and **25024** measures: accuracy, completeness, consistency, credibility, currentness, precision, traceability, understandability, compliance. Score each dataset on each.
- **DAMA-DMBOK** six dimensions (accuracy, completeness, consistency, timeliness, uniqueness, validity) as the scorecard's spine; **ISO 8000-61** for the process view (is quality measured and corrected as a process, or once).
- **FAIR** and **W3C Data on the Web Best Practices**, **DCAT** and **PROV**: for `/data/*.json`, is each file findable, licensed, versioned, and does it carry provenance (source, fetchedAt, method) a machine can read.
- **Data contracts / expectations** (Great Expectations style): the audit ends with a declarative expectations file per dataset that CI can run, so the audit becomes standing.
- **ISO 15022 / 20022 corporate-action semantics**: event types (`DVCA`, `SPLF`…), key dates (declaration, ex-date, record date, payment date). The issuer publishes a `processDate` that is none of these; test that no surface calls it an ex-date or a pay date, and that the ~1 business day lag is stated as observed, not defined.
- **ISO 6166 ISIN** validity (checksum) for every registry row; **EIP-1967** beacon proxies (one implementation for 194 tokens); **ERC-8056** semantics: `newUIMultiplier()`/`effectiveAt()` are retrospective; no event fires at maturation; a pending update exists only while `effectiveAt() > block.timestamp && newUIMultiplier() != uiMultiplier()`.
- **Chainlink AggregatorV3** semantics: total return, phase-encoded round ids, heartbeat/deviation, off-hours freeze; staleness must be read from `updatedAt`, never assumed.
- **Numerical standards**: no IEEE-754 in money paths; WAD bigint arithmetic; rounding stated (half-up) and consistent across surfaces; 6-decimal USDG vs 18-decimal tokens; bps vs percent; sign conventions stated.
- **Statistical reporting**: every statistic carries n, period, weighting method and the threshold below which it is refused; no rate published on a sample that cannot support it; a refused figure says why.
- **Reproducible research**: a clean checkout, the committed scripts, the primary sources, and a second machine must regenerate the committed files; where the design promises byte-identical regeneration (`REGISTRY_GENERATED_AT` from the snapshot's own `fetchedAt`, ICS `DTSTAMP` from the data's timestamp), test it.
- **The project's own confidence ladder**: `low` on a ticker match, `medium` on behavioural corroboration (either kind, with the kind named), `high` reserved for a first-party address-level link that does not exist. Test that no surface reports a higher rung than the evidence.

## 4. Method

Work through the phases in order. Each produces an artefact named in section 6. Record every
command you ran and every answer you got.

### P0 — Claim register
Enumerate **every figure displayed anywhere** (section 1.2): surface, exact visible text, value,
unit, date shown, dataset and field it comes from (`apps/web/lib/observed.ts` is the join for the
site; `packages/api/src/serialize.ts` for the API; `scripts/build-tokenlist.mjs` for the list),
the script that wrote the dataset, the primary-source call behind it. Include the badge, the
Open Graph image and the CSV. Nothing outside the register is audited; nothing in it is skipped.
Expected size: several hundred rows across the token pages; sample the token pages by state
(owed, upcoming, measured, anomaly with feed, anomaly without feed, moved with nothing declared,
never moved) and audit every distinct state fully.

### P1 — Traceability
For each register row, walk the chain to the source and mark it: **traced** (you reached a
primary-source call whose answer today still supports the figure), **traced with a gap** (a step
in the chain is undocumented, untested or relies on a value the source no longer serves),
**untraceable**. A figure whose source is a file with no `fetchedAt`/`observedAt` and no script is
untraceable by definition.

### P2 — Reproduction
From a clean checkout on a machine the owner does not control: run each collector in
`scripts/` against the primary sources and diff the output against the committed file. Where the
design promises byte-identical regeneration, require it. Re-derive the headline haircut **by hand**
from raw inputs — the declared rate, `oldMultiplier`, `newMultiplier`, the Chainlink round in force
at `effectiveAt` (via `getRoundData`, primary proxy, phase noted) — and check each rounding step
against `packages/core/src/reconcile.ts`. Do the same for one anomaly, one pending row and one
wallet-history exposure (shares gained = raw × (new − old) / 1e18).

### P3 — Independent witnesses
Re-read from a second RPC endpoint, and a third where one serves the height: every
`UIMultiplierUpdated` log (topic0 `0x2205df45…`), `uiMultiplier()` at `effectiveBlock − 1` and
`effectiveBlock` for all 12 changes, the feed answer and `updatedAt` at the round each
reconciliation used, one Multicall3 batch of the 194 views. Re-fetch `/rhj/assets`,
`/rhj/corporate-actions` and Chainlink's directory and diff against the snapshots. Tabulate
agreement per fact and per endpoint; a fact with one witness is reported as such.

### P4 — Completeness and exhaustiveness
Build coverage matrices and test each edge:
- **Tokens**: are all 194 present in every dataset that claims to cover them (registry, token list, feed map's "no feed" rows, token pages, badges, ICS where applicable)? Any address in one file and not another?
- **Events**: does the scan cover block 900 000 to head with no gap (`SCAN_FROM_BLOCK`, `SCAN_THROUGH_BLOCK`)? Were any ranges split or capped (10 000-result cap) and was the remainder re-read? Re-scan a 2 000 000-block window yourself and compare.
- **Corporate actions**: window rows vs archive rows; every window row archived within a day of first appearance; unrecoverable rows marked as such; the series-id trap (`(id, processDate)` keys) handled for every id seen more than once.
- **Feeds**: 57 in the directory, 35 tokenized-equity, 35 mapped; the other 22 accounted for; both proxies per feed checked.
- **Pools**: 277 discovered vs the factory's own answer; the second venue recorded as unidentified, not named.
- **Sessions**: 168 weekly hour-slots, coverage per slot, the 3-per-session floor.
- **Flows**: windows contiguous and disjoint; incomplete windows marked; `precededByGap` where a window was skipped.
- **Pending**: every issuer action with no step appears exactly once in `/dividends/`, the ICS, the RSS, the token page, the token list's pending extension and the API's `/pending`.

### P5 — Cross-surface consistency
The same fact must read the same everywhere. For at least 20 facts (the headline haircut, each
reconciliation, each measured figure, one token's owed, one token's multiplier, the counts on the
home page), collect the value from every surface that shows it (site, API, token list, ICS, RSS,
badge, OG image, CSV, SDK types) and diff. Note build timing: the site is a snapshot of `data/` at
build, collectors commit hourly, and one collector build per hour deploys — a difference must be
classified as timing or as error, with the commit that explains it.

### P6 — Semantics and wording
For each claim, compare the words to the measurement. Specific tests:
- "never arrived" = implied haircut from the price in force at the instant of the step, one event, `matched` only. Does any surface say it of an `anomaly`?
- "owed" = declared rate × multiplier in force, no price, no claim of delivery.
- "warning" = announcement lead; "after the issuer's date" = observed lag in n cases, not a rule.
- "off-hours" = outside 09:30–16:00 ET including weekends, hour-weighted; the 46 % is "the figure exdate was given to check", not a measured comparator.
- `processDate` is never called ex-date, record date or pay date.
- "confirmed by its step" is said only of SGOV; "confirmed by its price" only of the 22.
- `medium` confidence is never described as verified.
- "reconcile cleanly" / "measured cleanly" = `matched`; "doesn't add up" = `anomaly` with feed; "no price feed" = `anomaly` without; "nothing declared" = `unmatched`.
Rate each claim: **supported**, **overreaching**, **underclaiming** (the data supports more than is said), **ambiguous to a lay reader**.

### P7 — Timeliness and staleness
For each dataset: its own timestamp, the collector's cadence, the measured cadence (GitHub's
`*/5` fired every 7–25 minutes; the watcher ticks every 30 s), the deploy lag, and what a surface
shows when the data is older than its cadence promises. Test the feed-staleness path: a price older
than the heartbeat must be labelled, never silently used; the median feed age at the last reading
must match the file.

### P8 — Refusals, nulls and states
Enumerate every `notComputed` reason code in the API and every "no data" state in the UI. For each
reconciliation status × feed presence × pending state, load a real example and check: the figure
that must be absent is absent (not `0`, not a dash that reads as zero where a zero would mean
something), and the reason is stated. Test the `null` rule on every API route with a field-by-field
diff against the SDK types.

### P9 — Adversarial scenarios
For each trap, find the test or the guard, and try to defeat it with a real or constructed input:
a token mispaired to a neighbouring feed; a round hours stale at `effectiveAt`; two issuer actions
inside one 4-day window for one token; a split reaching `reconcile()` as a dividend; 6 vs 18
decimals in the pool arithmetic; an ET/UTC boundary in the session classifier (both DST changes);
the same series id on two months; a re-announced schedule; an ERC-721 `Transfer` with the same
topic0; two archive endpoints disagreeing on a state read; a quote taken on a halted market; a gap
sign inverted; a token list that fails the schema silently; an ISIN that fails its checksum; a
`processDate` on a weekend; a multiplier read at the parent chain's block number.

### P10 — Provenance and licence
Every served file carries its source, its timestamp and its method in the file. The issuer's three
files are not served from the site and are carved out of CC BY 4.0 in `DATA-LICENSE.md`. The
attribution text a re-user must carry is stated. `docs/terms-review.md` conditions that touch the
data (no "tokenized stocks", the disclaimer, production reads off Robinhood's RPC) hold on every
surface.

### P11 — Make it standing
Write the expectations file (section 6.8) and a CI job that runs it on every collector commit:
row counts and key uniqueness per dataset; addresses checksummed and present in the registry; dates
monotonic and within cadence; WAD invariants (`newMultiplier > oldMultiplier` except splits;
`received ≤ declared`; `haircut ∈ [0, 10 000] bps`); cross-file joins (every reconciliation's token
in the registry, every step's `effectiveAt` in `effective-blocks.json`, every mapped feed in the
directory); the token list valid against its schema; ICS lines ≤ 75 octets; every published figure
on the home page equal to its dataset field.

## 5. Scoring

### 5.1 Severity
- **S0** — a published figure is wrong, or cannot be reproduced from its stated source.
- **S1** — the figure is right and the sentence around it claims more than the measurement supports, or a confidence rung is overstated.
- **S2** — the figure cannot be traced to a primary source that still answers, or rests on one witness where two were available.
- **S3** — coverage is incomplete and the gap is not declared where a reader would need it.
- **S4** — a qualifier (date, n, method, unit, rounding) is missing or inconsistent across surfaces; cosmetic.

### 5.2 Dataset scorecard
One row per dataset (section 1.3), columns: accuracy, completeness, consistency, timeliness,
uniqueness, validity, traceability, reproducibility — each 1–5 with the measurement that justifies
the score. No score without a measurement.

### 5.3 Prioritisation
severity × reach (how many surfaces and which audiences from section 2 see the figure) × cost to
fix. Rank the findings; the top ten get a before/after.

## 6. Deliverable

Deliver in French, as `docs/data-audit-<date>.md` with evidence under `docs/audit/<date>/`.

### 6.1 Executive summary — ten lines maximum
Verdict on the five questions (right, traceable, reproducible, complete, worded fairly), the count
of findings per severity, and the one sentence a journalist could safely quote about the headline
figure.

### 6.2 Scorecard (5.2)

### 6.3 Claim register (P0), complete, as an appendix
Columns: id, surface, exact text, value, unit, date shown, dataset.field, script, source call,
traceability verdict (P1), reproduction verdict (P2), witnesses (P3), wording verdict (P6).

### 6.4 Findings table
Columns: id, severity, dimension, surface(s), claim, dataset.field, evidence (the command and the
value you obtained), root cause, fix, effort (S/M/L), audiences affected.

### 6.5 Coverage matrices (P4)

### 6.6 Reproduction and witness logs (P2, P3)
Every command, its output, every diff, the endpoints used and their answers.

### 6.7 Wording verdicts (P6), one line per claim

### 6.8 The expectations file and the CI job (P11), ready to commit

### 6.9 What was not verified, and why
Rate limits hit, endpoints that did not answer, facts with one witness, anything you could not
reproduce for lack of access. This section is mandatory and is never empty.

### 6.10 Roadmap
This week (S0, S1), this month (S2, S3), this quarter (S4, standing checks).

## 7. Rules

- Never invent a value, an address, an endpoint or a figure. Mark `UNVERIFIED` and move on.
- Reproduce before you read: run the collector, then compare with the code. A verdict reached by
  reading alone is labelled as such.
- Use only public endpoints and the committed scripts; never a credential you were not given;
  respect rate limits and record every refusal.
- Do not modify the committed data while auditing. Propose fixes; do not apply them.
- Every finding is falsifiable: someone else with the same inputs must be able to repeat the
  check and get the same answer.
- Do not rediscover section 1.6 as findings; do check that each gap is stated where it matters.
- Report in French; keep code, paths, field names and commands in English, verbatim.
- No praise. The absence of a finding is stated as "checked, holds", with the check named.

## 8. Inputs

- Repository `BacBacta/Exdate`, branch `claude/lance-en5q6j`: `data/`, `scripts/` (36 collectors
  and checks), `packages/core/src` and `packages/core/test` (the arithmetic and its tests on real
  fixtures), `packages/api/src/serialize.ts`, `apps/web/lib/observed.ts` (every join the site
  makes), `scripts/build-tokenlist.mjs`, `apps/web/lib/feeds.ts`, `apps/web/lib/badge.ts`.
- `CLAUDE.md` — the decision log with the measurements behind every choice; `docs/phase-0-verification.md`;
  `docs/terms-review.md`; `DATA-LICENSE.md`; `docs/api.md`; `docs/changelog.md`.
- Live: `https://www.exdate.me`, `https://api.exdate.me/v1/*`, `https://status.exdate.me`.
- Primary sources and endpoints: section 1.5; `data/rpc-endpoints.observed.json` for the current
  archive-capable endpoints; `node scripts/probe-rpc-endpoints.mjs` to re-probe.
- Tools that exist in the repository and should be run rather than rewritten:
  `scripts/verify-multiplier-history.mjs`, `scripts/phase0/verify-feed-map.mjs`,
  `scripts/phase0/check-svr-proxies.mjs`, `scripts/phase0/check-quote-basis.mjs`,
  `scripts/build-reconciliations.mjs`, `scripts/generate-registry.mjs`, `pnpm test`.
