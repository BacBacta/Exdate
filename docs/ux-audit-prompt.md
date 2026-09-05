# exdate — critical UI/UX and product audit brief

A prompt to hand to an auditor, human or model. It is written to produce a harsh,
evidence-backed audit rather than a compliment. Everything the auditor needs to
avoid recommending the impossible is in section 1. The report is to be delivered
in **French**.

---

## 0. Role and stance

You are a principal product designer and UX researcher with fifteen years across
fintech, market-data terminals, blockchain explorers and developer tooling. You
have shipped consumer products used by people who do not know what a decimal
place is, and B2B data products that risk desks rely on. You are being paid for a
**critical** audit: the owner has already heard that the site is "clean" and
"minimal" and does not need to hear it again.

Your stance:

- **Adversarial by default.** Assume every screen fails a first-time visitor
  until you have evidence it does not.
- **Evidence or nothing.** Every finding cites a URL, the exact visible text or
  element, the viewport and theme it was seen in, and a measurement where one
  exists. "The hierarchy could be clearer" is not a finding.
- **Severity, not volume.** Ten findings that change adoption beat forty that
  change a margin.
- **Respect the constraints in section 1 absolutely.** A recommendation that
  breaks one of them is not a recommendation; it is a misunderstanding of the
  product. Say when a constraint itself is the problem, but say it separately.
- **Distinguish observed from inferred.** What you saw, what you measured, what
  you believe a user would do, and what you could not test are four different
  categories and are labelled as such.
- **No praise padding.** One paragraph of what works, at the end, only if it
  genuinely informs what to protect while changing the rest.

## 1. What you are auditing

### 1.1 The product in one paragraph

exdate measures what Robinhood Chain Stock Tokens actually pay their holders. A
dividend on such a token never lands in a wallet as cash: the token's on-chain
multiplier steps up and the holder ends up representing slightly more of the
underlying share. exdate catches each step at the instant it takes effect, prices
it, matches it against the issuer's own declared dividend, and publishes the
difference — the **effective haircut**, a number published nowhere else (the two
reconciled cases so far: 36.0 % and 33.7 % of the declared amount never arrived).
Around that core it publishes the pending dividends and what they are owed per
token, the gap between the traded price and the Chainlink oracle, net token
creation, and the share of activity that happens outside US market hours
(measured at 73.9 %, against a widely repeated 46 %). It serves a public site, a
REST API, a signed-webhook outbox, an npm SDK, and a token list.

### 1.2 Surfaces

| Surface | URL | What it is |
|---|---|---|
| Public site | `https://www.exdate.me` | Static export. Every figure read at build time from committed data files, each carrying a date. |
| Status page | `https://status.exdate.me` | Live operational view over the indexer. Linked from the site, not duplicated. |
| API | `https://api.exdate.me` | REST, documented at `/docs/api/` on the site. Rate-limited, keyed tiers. |
| SDK | `@exdate/sdk`, `@exdate/core` on npm | Typed client and webhook verifier. Docs at `/docs/sdk/`. |
| Token list | `https://www.exdate.me/tokenlist.json` | Uniswap-schema list, 194 tokens, with extensions no other list carries. |

### 1.3 Pages on the public site

| Route | Header label | Purpose |
|---|---|---|
| `/` | — | Home: the promise, a token finder, the proof so far, coverage, developer entry. |
| `/t/<address>/` | reached via *Find your token* | One page per token (194): what it represents today, every dividend declared → arrived → state, what is owed, multiplier history, whether a price feed exists. |
| `/wallet/` | *Your wallet* | Paste an address or connect: holdings, shares represented, what is owed, and the history of what each past dividend delivered to that address. CSV export. No signature, nothing sent to a server. |
| `/calendar/` | *Calendar* | Every declared dividend not yet on chain, grouped *issuer says paid / due now / coming weeks*. |
| `/record/` | *Delivery record* | How reliably exdate itself captured the instant of each step: cadence, catch rate, the watcher's heartbeat. |
| `/flows/` | *Creations* | Net token creation per day (mints minus burns). |
| `/gap/` | *Oracle gap* | Traded price versus Chainlink feed, per token, with feed age and pool depth. |
| `/docs/api/`, `/docs/sdk/` | *Developers* | Rendered reference. |
| `/data/` | — | The committed datasets, listed. |
| `/#how`, `/#proof`, `/#coverage`, `/#developers` | header anchors | Sections of the home page. |

The header currently carries ten entries: *Find your token, Your wallet, Calendar,
How it works, Proof, Delivery record, Creations, Oracle gap, Coverage,
Developers*. The site's title is *"exdate — see what your Stock Tokens actually
paid you"*.

### 1.4 Constraints that are not negotiable

These are properties of the product, some contractual, some the reason the
product is trusted. Do not recommend against them. If one of them is what makes
a screen fail, say so explicitly as a *tension*, in its own section.

1. **No number that was not measured.** Every displayed figure traces to a
   committed observation with a date. Where there is no data, the interface says
   so in words. Do not propose estimates, projections, annualised yields,
   forward-looking figures or "indicative" values. Do not propose filling gaps
   with issuer or vendor numbers exdate did not observe.
2. **The site is a static export.** There is no server behind the pages. The only
   runtime reads are on `/wallet/`, from the visitor's own browser to the chain.
   Do not propose live tickers, server-rendered personalisation, accounts, or
   anything requiring a backend on the site itself. (The API and status page are
   separate, hosted surfaces; proposals that route through them are fair.)
3. **Tokens are identified by contract address**, never by ticker alone. A ticker
   may be displayed, but the address is the identity and must remain reachable.
4. **Wording bound by the issuer's terms.** Robinhood's product is called *Stock
   Tokens*; the phrases "tokenized stock" and "tokenized equity" must not describe
   it. A "not affiliated with, endorsed by, or officially connected with Robinhood
   Markets, Inc." disclaimer must remain visible. Coinbase's product on Base keeps
   Base's own wording.
5. **No dead links.** A link renders only when its target exists. Links to the
   status page and API are shown only when those hosts are configured.
6. **No signature, no address sent to exdate.** The wallet page's promise is that
   the address goes to the chain's RPC and nowhere else. Do not propose analytics
   on wallet addresses, server-side history, or "sign in with wallet".
7. **Measured, never asserted.** A claim about behaviour ("gaps widen off-hours")
   is shown only once the data supports it, with the sample size beside it.
   Refusals ("not enough samples yet") are a feature. Do not propose hiding them.

### 1.5 What is entirely negotiable

Structure, hierarchy, navigation, copy, naming, page composition, what is on the
home page and what is not, visual language, motion, onboarding, empty and error
states, how numbers are formatted, what is shown by default and what is behind
disclosure, what triggers a return visit, what makes the site something a wallet,
a curator or an aggregator embeds rather than visits. Everything the owner has
built is up for removal if you show it does not earn its place.

### 1.6 Known gaps — already on the owner's list

Do not present these as discoveries. Do assess how they rank against what you
find, and whether the owner's framing of them is right.

- The off-hours share (73.9 %) is computed and committed but **rendered nowhere**
  on the site.
- The nine-minute pre-announcement of a multiplier change exists as a signed
  webhook but **no notification channel is armed**, so no one receives it.
- 159 of 194 tokens have **no Chainlink feed**; the site says "no price feed" on
  those rather than a number.
- The token → feed pairing is causally corroborated for 1 token, corroborated by
  traded price for 22, and a bare ticker match for 12. Every haircut rests on it.
- The five July dividends lost their issuer record for good and are published as
  *unmatched*.

## 2. Who arrives, and what they are trying to get done

Audit against these five, not against "the user". For each, state task success
or failure with the evidence, time-to-first-answer, and the moment they would
leave.

| | Who | What they know | The question they arrive with | Success looks like | They leave when | What would bring them back |
|---|---|---|---|---|---|---|
| **P1 Holder** | Holds AAPL or SGOV Stock Tokens in a Robinhood-Chain wallet. Arrived from a post or a search. | Nothing of multipliers, oracles, basis points. Knows what a dividend is. | *"Did I get my dividend? Where is it?"* | Within 60 seconds understands that the dividend became a slightly larger share count, finds their token, sees what was declared and what arrived, sees what is still owed. | The first screen shows *bps*, *ERC-8056*, *reconciliation*, *oracle*, or a ring with no sentence under it. | A dividend declared on a token they hold and not yet on chain: a date to come back for, or a notice. |
| **P2 Curator** | Runs a lending market or vault that lists Stock Tokens as collateral. | Everything technical. Short on time. | *"How far is the traded price from the oracle, how stale is the feed, and can I trust the token → feed pairing?"* | Reaches the gap page in one click, reads median and widest gap, feed age, pool depth, and the corroboration kind per token; finds the API and the webhook catalogue. | Cannot tell measured from inferred, or cannot find the number per token. | A gap widening, a feed pausing, a new feed — i.e. something that reaches them, not something they must check. |
| **P3 Wallet / aggregator PM** | Deciding whether to import the token list and show "owed" inside their app. | Product-minded, technical enough. | *"What do I get by integrating, how stable is it, under what licence?"* | Ten minutes to an integration decision: list URL, schema, the extension fields, API stability, versioning, licence, provenance. | Anything reads like a hobby project: unclear versioning, no licence, no changelog, no contact. | Nothing — the integration is the retention. |
| **P4 Analyst / journalist** | Writing about tokenized-stock dividends or off-hours trading. | Financially literate, not technical. | *"What is the number, how was it measured, can I cite it?"* | Finds the headline figures (36 %, 73.9 %, net creation) with method, date, sample size and a permalink; the shared link renders a card that carries the number. | The method is a click too deep, or a figure has no date. | A new reconciled dividend or a new month of data. |
| **P5 Developer** | Evaluating the SDK for a dashboard or bot. | Full. | *"Types, examples, rate limits, keys, webhook verification — in five minutes."* | Copies a working example, knows the limits and the failure modes, verifies provenance. | Docs describe endpoints but not workflows; no example runs as pasted. | New endpoints, new event types. |

## 3. Standards and frameworks to apply

Use these by name in findings so the owner can look them up. Where a framework
is a draft or opinion rather than a standard, say so.

**Usability**
- Nielsen Norman Group's ten usability heuristics, with NN/g's severity scale
  (0 not a problem · 1 cosmetic · 2 minor · 3 major · 4 catastrophic).
- Cognitive walkthrough on the six tasks in phase 3.
- Five-second test and first-click test on each landing surface.
- Tree test of the header and footer labels (phase 4).

**Accessibility**
- **WCAG 2.2 Level AA** as the bar (W3C Recommendation, October 2023), with
  explicit attention to the criteria new in 2.2: 2.4.11 Focus Not Obscured,
  2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum, 24 × 24 CSS px),
  3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication.
  Plus 1.4.3 contrast, 1.4.10 reflow at 320 px, 1.4.12 text spacing, 2.4.7 focus
  visible, 2.3.3 animation from interactions, 4.1.2 name/role/value.
- EN 301 549 and the European Accessibility Act (in application since
  28 June 2025) as the EU exposure the owner has.
- WCAG 3.0 only as a working draft indicating direction; do not score against it.

**Performance**
- Core Web Vitals at the 75th percentile on mobile: LCP ≤ 2.5 s, INP ≤ 200 ms,
  CLS ≤ 0.1. Report field data if any exists, otherwise lab data with the device
  profile stated.

**Language and cognition**
- Plain-language grade for every sentence a holder (P1) meets before scrolling:
  target Flesch-Kincaid grade ≤ 8. Report the actual grade per page.
- A jargon inventory: every term of art on each page, whether it is defined on
  first use, and whether a holder needs it at all.
- Progressive disclosure, Hick's law on the header, Miller's limit on
  simultaneous figures.

**Data presentation and trust**
- Tufte's data-ink ratio; Cleveland and McGill's ranking of perceptual encodings
  (position > length > angle > area > colour) — the site's signature visual is an
  arc, which is an angle encoding.
- Number hygiene: units, precision, tabular figures, sign conventions, dates with
  time zones, and whether every figure carries *when* and *how many samples*.
- Fogg's Stanford web credibility guidelines, applied to financial data:
  provenance, method one click away, contact, currency of the data, what the
  site says about its own limits.

**Adoption and retention**
- Jobs-to-be-Done outcome statements for the five personas (section 2).
- Time-to-value and the "aha" moment per persona: what is the first screen on
  which each one gets their answer, and how many interactions away is it.
- The Hook Model (trigger → action → variable reward → investment) to assess
  return behaviour honestly — and to say where a static, measured-only product
  should *not* try to manufacture habit.
- AARRR (acquisition, activation, retention, referral, revenue) as a checklist,
  with the honest note that the site has no accounts and no analytics on
  addresses by design.
- Distribution surfaces that make a data product indispensable rather than
  visited: token list, API, webhooks, embeds, badges, calendar feeds (ICS), RSS,
  shareable cards, permalinks, CSV.

**Benchmarks** — name the specific product and the specific screen you compared,
and verify the comparison against the live product on the day of the audit; do
not rely on memory of what these products look like:
- Chain explorers: Etherscan, Blockscout.
- On-chain data products: DefiLlama, Dune, Token Terminal, Messari.
- Portfolio and wallet views: Zerion, Zapper, Rabby, Rainbow.
- Market data for non-specialists: Yahoo Finance, TradingView, the Nasdaq and
  Dividend.com dividend calendars, the Robinhood app itself.
- Documentation and developer surfaces: Stripe, Linear, Vercel.

## 4. Method

Run the phases in order. Each produces a named output that feeds the report.

**Phase 0 — Setup and evidence discipline.**
Capture each page at 360 × 800 (mobile, the owner's own device), 768 × 1024 and
1440 × 900, in light, dark and system themes, with `prefers-reduced-motion`
on and off. Number every screenshot. Record the commit hash or the *last
observed* date shown in the footer, so findings are tied to a version. Output:
an evidence index.

**Phase 1 — First impression, per persona.**
Five-second test on `/`, `/t/<address>/` (use SGOV
`0x…` from the finder, and one token with no feed), `/wallet/`, `/gap/`. For
each persona write what they would say the page is for and what they would click
first, then the first-click test against the task in phase 3. Output: a table of
persona × page × understood purpose × first click × correct?

**Phase 2 — Heuristic evaluation.**
Every page against NN/g's ten heuristics. Each violation gets an ID, a
screenshot, the heuristic, the severity, and the personas it affects. Output: the
findings table (section 6.3), unranked.

**Phase 3 — Cognitive walkthrough of six tasks.**
1. P1: "Find whether my AAPL token has paid a dividend and what I actually got."
2. P1: "See what my wallet is owed right now, without connecting anything."
3. P2: "Judge whether the oracle for token X is safe to liquidate against
   today."
4. P3: "Decide whether to import the token list; find its licence and schema."
5. P4: "Cite the off-hours share with its method and date."
6. P5: "Verify a webhook signature with the SDK, from the docs alone."
For each step: will the user know what to do, see the control, connect the
control to the goal, and understand the feedback? Record where it breaks.
Output: per-task success, steps, time, break points.

**Phase 4 — Information architecture and content.**
Tree-test the ten header labels and the footer against the six tasks. Inventory
the home page section by section: what it asks the visitor to do, whether a
persona needs it there, word count, reading grade. Do the same for the token
page, which is the page a holder actually lands on from a search. Produce the
jargon inventory. Output: a proposed IA (labels, order, what moves off the home
page and where), with the reasoning, and the copy findings.

**Phase 5 — Accessibility.**
Automated pass (axe-core or equivalent, Lighthouse) on every route, then manual:
keyboard-only through the finder, the wallet form, the token page's disclosure
elements, and the CSV export; a screen reader on the same (VoiceOver on iOS or
NVDA); 200 % and 400 % zoom; forced-colours mode; the ring's accessible name and
whether its animated number is hidden from assistive tech. Output: WCAG 2.2 AA
findings with the success criterion number, and the automated report attached.

**Phase 6 — Performance and mobile.**
Lighthouse mobile on `/`, a token page, `/wallet/` before and after a read,
`/gap/`. Report LCP, INP, CLS, total transfer, and the size of the finder's
embedded 194-token index. On `/wallet/`, time the full history read for a real
address and assess what the visitor sees while waiting. Output: CWV table and
the waiting-state assessment.

**Phase 7 — Data presentation and number hygiene.**
For every figure on every page: unit, precision, date, sample size, sign, and
whether a novice can tell a measurement from a refusal. Assess the ring (an angle
encoding for a single share), the ledgers, the gap table, and the flows chart
against Cleveland–McGill. Check every empty and refused state renders as a
sentence a holder understands. Output: a per-figure table and the visual-encoding
findings.

**Phase 8 — Trust and credibility.**
Apply the Stanford credibility guidelines to a financial-data site: can a visitor
find who made it, why, what it measures and does not, how to contact, when the
data was last observed, what the licence is. Assess the disclaimer's placement.
Assess whether *confidence: low / medium* and *corroborated by* are
understandable to P2 and invisible-but-harmless to P1. Output: a credibility
checklist with gaps.

**Phase 9 — Retention and return triggers.**
Honestly: why would each persona return, and what on the site today would cause
it? Map the existing triggers (calendar dates, pending dividends, the nine-minute
announcement, new reconciliations) to how a persona would actually learn of them.
Apply the Hook Model and say where the product should *not* try to manufacture
habit. Output: a return-trigger matrix and the smallest set of changes that turns
a visit into a subscription (ICS feed, webhook sign-up, RSS, alerts), each
checked against the constraints in 1.4.

**Phase 10 — Ecosystem indispensability.**
What would make a wallet embed exdate rather than link to it, a curator wire its
webhooks rather than check its page, an analyst cite it rather than screenshot
it? Assess the token list, the API docs, the SDK docs, the OG cards, permalinks,
CSV, and the absence of embeds, badges, and calendar feeds. Benchmark each
against the named comparables (section 3), verified live. Output: the
distribution gap list with an effort estimate each.

**Phase 11 — Synthesis and roadmap.**
Score the dimensions (section 5.2), rank every finding by severity × persona
reach × ICE, and produce the top ten and a three-horizon roadmap. Output: the
report (section 6).

## 5. Scoring

### 5.1 Severity (NN/g)

| | Meaning |
|---|---|
| 4 | Catastrophic — blocks a persona's task or breaks a constraint in 1.4 |
| 3 | Major — most users of a persona fail or abandon; fix before anything else |
| 2 | Minor — slows or confuses; fix when convenient |
| 1 | Cosmetic |
| 0 | Not a problem |

### 5.2 Dimension scorecard

Score 1–5 with one sentence of evidence each. Weights reflect what decides
adoption for this product.

| Dimension | Weight | 5 means |
|---|---|---|
| Clarity for a first-time holder (P1) | 20 % | Understands the product and their own answer in one screen, no jargon required |
| Task success across the six tasks | 20 % | All six succeed on mobile without help |
| Information architecture | 10 % | Labels predict content; nothing a persona needs is more than two clicks deep |
| Readability and language | 10 % | Grade ≤ 8 above the fold on every holder page; every term defined on first use |
| Accessibility (WCAG 2.2 AA) | 10 % | No AA failures; keyboard and screen reader complete every task |
| Performance and mobile | 5 % | Green CWV at p75 on mobile; the wallet wait has a state |
| Data presentation and trust | 10 % | Every figure dated, sized, unit-ed; measurement and refusal look different |
| Retention and return triggers | 10 % | Every persona has a way to be told, not only a page to check |
| Ecosystem indispensability | 5 % | Integrations exist for the three surfaces others would embed |

### 5.3 Prioritisation

For each recommendation: Impact (1–5, on the persona's task), Confidence (1–5,
in your evidence), Ease (1–5, inverse of effort, estimated as S/M/L). Priority is
the product. Show the numbers; the owner will re-weight them.

## 6. Deliverable

Write it in **French**. Markdown. Cite evidence by screenshot number and URL.

### 6.1 Executive summary — ten lines maximum
The three things that most limit adoption today, the one thing to protect, the
overall scorecard total.

### 6.2 Scorecard
The table from 5.2 filled in, with the sentence of evidence per row.

### 6.3 Findings table
One row per finding, no prose around it:

`ID · Page/URL · Personas · Framework reference (heuristic #, WCAG SC, CWV
metric) · Severity 0–4 · Evidence (quoted text, element, screenshot #,
measurement) · Why it matters (which task, which moment) · Recommendation
(specific enough to implement, checked against 1.4) · Effort S/M/L · ICE`

Cap it at forty rows. If you have more, you have not ranked.

### 6.4 The top ten
Ranked. Each with a before/after: the sentence or screen as it is, and as you
propose it. Where you propose new copy, write the copy.

### 6.5 Proposed information architecture
Header, footer, home-page order, and what leaves the home page for where — as a
tree, with one line of reasoning per move.

### 6.6 Roadmap in three horizons
*This week* (S effort, high ICE), *this month*, *this quarter*. Each item names
the finding IDs it resolves.

### 6.7 Benchmark matrix
Rows: the six tasks or the closest equivalent. Columns: exdate and five
comparables you verified live. Cells: one line on how each handles it, and who
does it best.

### 6.8 Tensions with the constraints
Where a constraint in 1.4 is itself what makes a screen fail, name it here and
only here, with the trade-off stated in both directions.

### 6.9 Appendices
Evidence index; automated accessibility and performance reports; the jargon
inventory; the per-figure number-hygiene table; the persona × page
first-impression table.

## 7. Rules

- Do not write "improve", "enhance", "consider", "could be clearer". Write what
  to change, to what, and why, with the evidence.
- Do not recommend anything that breaks a constraint in 1.4. If you believe a
  constraint is wrong, section 6.8 is where that goes.
- Do not invent user research. You ran no study with real users unless you did;
  a cognitive walkthrough is an expert method and is labelled as one.
- Do not describe a comparable from memory. Open it, on the day, and cite the
  screen.
- Do not soften a 4 into a 3 because the fix is hard.
- If you could not test something (a screen reader you lack, a device you do not
  have, field CWV data that does not exist), list it under *Not tested* rather
  than omitting it.
- Where a finding depends on a number you measured (reading grade, contrast
  ratio, LCP), give the number and the tool.

## 8. Inputs

- Live: `https://www.exdate.me`, `https://status.exdate.me`,
  `https://api.exdate.me/v1/health`, `https://www.exdate.me/tokenlist.json`,
  `@exdate/sdk` on npm.
- Source, if you have it: `apps/web/` (pages under `app/`, all figures derived
  in `lib/observed.ts`), `data/*.json` (every observation the site can show),
  `docs/api.md`, `packages/sdk/README.md`, `CLAUDE.md` (the project's own
  record of what it has verified and decided).
- Viewports: 360 × 800, 768 × 1024, 1440 × 900. Themes: light, dark, system.
  Motion: both settings. Zoom: 100 %, 200 %, 400 %.
- Tools: a current browser's devtools, axe-core or Lighthouse for automated
  accessibility, Lighthouse or WebPageTest for CWV, a readability calculator
  for Flesch-Kincaid, VoiceOver or NVDA for screen-reader passes.
- A real wallet address holding Stock Tokens for the wallet task, or the one
  the owner provides.
