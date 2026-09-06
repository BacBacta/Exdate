# xStocks (Backed) — read on chain, not from the page

**Every fact below was read back with `eth_call` or fetched from the issuer's own endpoint.**
Re-run it: `node scripts/phase0/verify-xstocks.mjs`. Output: `data/xstocks-verification.json`.

This is the third issuer exdate has examined, after Robinhood (measured live) and Coinbase B20 on
Base (verified, nothing has moved). It is the first one that would produce **haircuts rather than
only a step ledger**, and the first whose mechanism differs from Robinhood's in a way that breaks
an assumption rather than adding a variant.

## What the roadmap assumed, and what reading it changed

`docs/roadmap-2026-09-05.md` recorded two things about xStocks, both from research summaries rather
than first-party reading, and flagged them as such. Both are now settled and both were wrong:

| Recorded | Measured |
|---|---|
| `docs.xstocks.fi` answers **403** to an automated reader | it answers **200**, and so does `api.xstocks.fi` |
| "the same mechanism as Robinhood — the whole method transposes" | **the mechanism is inverted on EVM.** See below. |

That is the same shape as Base, where reading the chain corrected the documentation. It is the
reason chantier 1 starts with a script and not with a design.

## The mechanism, stated first-party and confirmed on chain

The issuer's own page (`docs.xstocks.fi/developers/multipliers`) says of EVM chains:

> On EVM chains, the contract handles this automatically — when the multiplier updates, it adjusts
> all user balances directly, so `balanceOf()` always returns the current equity-adjusted value.

**That inverts ERC-8056.** Robinhood's `balanceOf()` is the constant and `balanceOfUI()` is the
adjusted view; Backed's `balanceOf()` is the adjusted view and `sharesOf()` is the constant. On 12
of 12 sampled tokens across two chains:

- `getCurrentMultiplier()` answers — **three 32-byte words**, of which the first is the WAD. The
  other two are recorded and deliberately **not named**: no first-party source says what they are.
- `sharesOf(address)` answers. The constant is here.
- `uiMultiplier()` and `balanceOfUI()` **revert**. This is not Robinhood's standard.
- `multiplier()` — Coinbase B20's bare selector on Base — **answers, with the same value**. One
  selector, one meaning, two unrelated issuers. The first run of the script asserted it would
  revert; it does not, and the finding is published as measured rather than as expected.

Anything built on "`balanceOf` is the raw amount" is wrong here, **in the direction that silently
reports a post-dividend balance as a pre-dividend one**. That is the single most important thing on
this page.

### A fee accrues in the multiplier

The reference implementation the issuer links is `BackedAutoFeeTokenImplementation.sol`, and the
name is not decorative: `feePerPeriod()`, `periodLength()` and `lastTimeFeeApplied()` all answer.
Measured on AAPLx: `periodLength` **604 800 s (7 days)**, `feePerPeriod` **0**, `lastTimeFeeApplied`
a recent timestamp. So the machinery is live and the rate is currently zero — which means a
reconciliation here has to read the fee at the instant of a step rather than assume it away, and
a non-zero fee would move the multiplier with no corporate action behind it at all.

## Coverage

**726 assets**, far more than Robinhood's 194, deployed across eleven networks from one
address-keyed registry at `https://api.xstocks.fi/api/v2/public/assets`:

| Network | Deployments |
|---|---|
| Ethereum, BNB Chain, Solana, TON, Ink, X Layer, Optimism | 726 each |
| Mantle | 718 |
| HyperEVM | 698 |
| Arbitrum | 697 |
| Tron | 74 |

Chain reads were taken on **Ethereum (chain 1)** and **BNB Chain (chain 56)**, each through a
public endpoint confirmed by asking `eth_chainId` and comparing the answer — an endpoint that names
itself is not evidence.

**The same address carries the same multiplier on both chains**, on 6 of 6 sampled. Deterministic
deployment plus synchronised state, which is a different integration problem from Robinhood's
single chain: one token has eleven homes and they must not be allowed to disagree in the record.

## Multipliers have moved — unlike Base

Base's thirteen B20 tokens all sit at exactly 1.0, so there is nothing there to reconcile. xStocks
is the opposite:

| Token | Multiplier on chain | Steps in the issuer's history |
|---|---|---|
| KOx | 1.0183317967386898 | 4 |
| SPYx | 1.005714560286254 | 4 |
| AAPLx | 1.0032690125398187 | 5 |
| NVDAx | 1.0009180758490996 | 4 |
| TSLAx | 1 | 0 |
| MSTRx | 1 | 0 |

Every step is labelled `Dividend`. KOx's last three run **44.9, 47.8 and 36.0 bps** — the same order
of magnitude as Robinhood's observed range.

## Two independent first-party sources, which Robinhood Chain has nowhere

The issuer publishes the multiplier per asset **and a full step history back to 2025**, each row
carrying its `reason`, `previousMultiplier` and `activationDateTime`. The contract answers with its
own multiplier. On 6 of 6 sampled tokens **the two agree to 1e-15**.

That changes what an archive is for. Robinhood's corporate-action feed is a one-month window with no
pagination, and five July actions are unrecoverable because they fell out of it before exdate
existed; the whole `data/corporate-actions.archive.json` machinery exists to stop that happening
again. Backed publishes the history, so there is nothing to lose — but there is something else
missing instead.

## What is missing here, and it is the haircut

Robinhood publishes **the declared cash rate per share** and the chain carries the step; the
haircut is the ratio between them, and it is the differentiating measurement.

Backed publishes **the step itself** — announced and historical — and no cash rate anywhere read
here. So the same reconciliation needs the underlying's declared dividend from a source that is not
the issuer, and a figure sourced there is not first-party in the sense this project uses the word.

**Until that source is named and read, exdate can produce a step ledger for xStocks and not a
haircut.** Stating it now is the point: it is exactly the assumption that, left unexamined, would
have been discovered after an adapter was written.

## Still open

- **The pending shape.** `newMultiplier`, `activationDateTime` and `reason` are in the API and were
  `0`/`null` on every sampled token, so the announced-but-not-applied state has not been seen. Note
  that `reason` is a field Robinhood's feed does not have.
- **The on-chain announcement.** Robinhood emits `UIMultiplierUpdated` about nine minutes ahead.
  Whether Backed emits anything, and with how much lead, has not been read — it needs a log scan
  over a window where a step is known to have landed, which the history above now makes possible.
- **The declared cash rate**, as above.
- **The fee at a step.** `feePerPeriod` is zero today on the one token read; whether it has ever
  been non-zero is a historical read, not a current one.
- **The terms.** Backed's own terms have not been read. Robinhood's took a full review to produce
  `docs/terms-review.md`, and every issuer added brings its own — which is why the roadmap puts the
  legal gate before wiring an adapter, not after.
