import { Fragment } from 'react'
import { observed } from '../lib/observed'

const { counts, observedAt, hero, reconciled, steps, stepRange, pendingExample, sessionShare, links } = observed

const bps = (value: number | null | undefined) => (value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`)
const usd = (value: string | null | undefined) => (value == null ? '—' : `$${value}`)
const pct = (value: number | null | undefined) => (value == null ? '—' : `${(value / 100).toFixed(1)} %`)
const day = (iso: string) => iso.slice(0, 10)

export default function Page() {
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <a className="wordmark" href="#top">
            exdate
          </a>
          <nav aria-label="Sections">
            <a href="#haircut">Haircut</a>
            <a href="#ledger">Ledger</a>
            <a href="#api">API</a>
            <a href={links.status}>Status</a>
            <a href={links.github}>GitHub</a>
          </nav>
        </div>
      </header>

      <main id="top">
        {/* ---------------------------------------------------------------- */}
        <section className="hero wrap">
          <p className="eyebrow">
            Robinhood Chain · {counts.tokens} Stock Tokens · observed, not assumed
          </p>
          <h1>The corporate-action layer for tokenized stocks.</h1>
          <p className="lede">
            Tokenized stocks do not pay dividends on chain. They raise a multiplier. exdate reads
            every step, pairs it with the dividend the issuer itself declared, and publishes the
            number that appears nowhere else: how much of it actually arrived.
          </p>

          <div className="figure">
            <div className="figure-value">
              {hero.haircutPct}
              <span className="unit">%</span>
            </div>
            <div className="figure-label">
              <p>
                Effective haircut on {hero.symbol}&rsquo;s dividend of {hero.processDate}.
              </p>
              <p>
                Declared {usd(hero.declared)} a share. The multiplier step, priced at the Chainlink
                round in force when it took effect, delivered {usd(hero.received)}.
              </p>
              <p className="src">
                onchain step {bps(hero.stepBps)} bps at {hero.effectiveAt} · price {usd(hero.priceAtEffect)}
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block">
          <div className="wrap">
            <div className="block-head">
              <div>
                <p className="kicker">What it makes legible</p>
                <h2>Three numbers a lending market cannot get anywhere else.</h2>
              </div>
              <div>
                <p className="intro">
                  A Stock Token is a debt security whose redemption ratio moves with corporate
                  actions. Its balance never changes; the ERC-8056 multiplier does. Everything
                  below is derived from that one number, the issuer&rsquo;s own feed, and Chainlink
                  round history — never from a model.
                </p>
              </div>
            </div>

            <div className="triptych">
              <div className="item">
                <p className="index">01</p>
                <h3>Pending dividend</h3>
                <p>
                  Between the issuer&rsquo;s process date and the multiplier step, a token is worth
                  more than its oracle says. What is owed per token is stated with no price at all:
                  the declared rate is per underlying share, and one raw token carries{' '}
                  <code>multiplier</code> of them.
                </p>
                {pendingExample ? (
                  <p className="fact">
                    {pendingExample.symbol} · {pendingExample.processDate}
                    <br />
                    <span>declared</span> ${pendingExample.grossPerShare} / share
                    <br />
                    <span>owed</span> ${pendingExample.grossPerToken} / token
                  </p>
                ) : null}
              </div>
              <div className="item">
                <p className="index">02</p>
                <h3>Observed haircut</h3>
                <p>
                  The declared gross, reinvested at the Chainlink price at the instant of effect,
                  against the step the chain actually delivered. Fees and withholding are
                  undocumented by the issuer. Measuring them is the product.
                </p>
                <p className="fact">
                  {reconciled
                    .filter((row) => row.status === 'matched' && row.haircutBps !== null)
                    .map((row) => (
                      <Fragment key={row.token}>
                        <span>{row.symbol}</span> {pct(row.haircutBps)}
                        <br />
                      </Fragment>
                    ))}
                  <span>on two independent tokens</span>
                </p>
              </div>
              <div className="item">
                <p className="index">03</p>
                <h3>Feed health</h3>
                <p>
                  Chainlink feeds are 24/5 and hold their last price off-hours; the chain does not
                  stop. Every feed&rsquo;s age is read against its heartbeat, and the token&rsquo;s
                  own pause flag, before anything is priced.
                </p>
                <p className="fact">
                  {counts.feeds} feeds <span>for {counts.tokens} tokens</span>
                  <br />
                  <span>2026-09-02, mid-session:</span> SPY 18 h stale
                  <br />
                  <span>off-hours share:</span>{' '}
                  {sessionShare.sufficient
                    ? 'measured'
                    : `being sampled, ${sessionShare.slotsCovered} of 168 hour slots`}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="haircut">
          <div className="wrap">
            <div className="block-head">
              <div>
                <p className="kicker">Reconciliation</p>
                <h2>Every declared dividend, against the step it produced.</h2>
              </div>
              <div>
                <p className="intro">
                  A dividend of <em>gross</em> per share, reinvested at <em>price</em>, should raise
                  the multiplier by gross ÷ price. The gap between that and the observed step is the
                  haircut. Where a token has no Chainlink feed, the step still implies a price — and
                  a reinvestment that really happened lands near spot.
                </p>
              </div>
            </div>

            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Process date</th>
                    <th className="num">Declared / share</th>
                    <th className="num">Observed step</th>
                    <th className="num">Price at effect</th>
                    <th className="num">Received / share</th>
                    <th className="num">Haircut</th>
                    <th className="num">Implied ÷ spot</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciled.map((row) => (
                    <tr key={`${row.token}:${row.processDate}`}>
                      <td className="sym">{row.symbol}</td>
                      <td className="mono muted">{row.processDate}</td>
                      <td className="num">{usd(row.declared)}</td>
                      <td className="num">{bps(row.stepBps)} bps</td>
                      <td className="num">{row.hasFeed ? usd(row.priceAtEffect) : <span className="dash">no feed</span>}</td>
                      <td className="num">{usd(row.received)}</td>
                      <td className={`num${row.haircutBps !== null ? ' big' : ''}`}>{pct(row.haircutBps)}</td>
                      <td className="num">{row.impliedOverSpot == null ? '—' : row.impliedOverSpot.toFixed(2)}</td>
                      <td>
                        <span className={`dot ${row.status === 'matched' ? 'ok' : 'warn'}`} />
                        {row.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="caption">
              Both matched rows land at an implied-over-spot ratio near 1.5; every anomaly is far
              outside it. Confidence is <code>low</code> on every row, because the token → feed
              pairing is a ticker heuristic that no first-party statement confirms — one pair is
              corroborated by behaviour, the rest are not, and the page says so rather than
              rounding up. {counts.reconciliations.pending} further actions are declared and not yet
              on chain; {counts.reconciliations.unmatched} steps have no declared rate left to match,
              because the issuer&rsquo;s feed keeps about a month and those fell out of it.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="ledger">
          <div className="wrap">
            <div className="block-head">
              <div>
                <p className="kicker">The ledger</p>
                <h2>
                  {counts.distinctEvents} multiplier changes across {counts.tokensMoved} tokens.
                </h2>
              </div>
              <div>
                <p className="intro">
                  Every <code>UIMultiplierUpdated</code> log on the chain since mainnet, from a full
                  scan and a live indexer. The announcement arrives about{' '}
                  {Math.round(stepRange.medianLeadMinutes)} minutes before the change takes effect,
                  and nothing is emitted when it does — application is derived from the clock.
                </p>
                <p className="intro">
                  Steps run from {bps(stepRange.min.stepBps)} bps ({stepRange.min.symbol}) to{' '}
                  {bps(stepRange.max.stepBps)} bps ({stepRange.max.symbol}), plus one ×4 split. The
                  kind of an action is never inferred from its size.
                </p>
              </div>
            </div>

            <div className="ledger">
              {steps.map((step) => (
                <div className="row" key={`${step.token}:${step.date}`}>
                  <span className="date">{step.date}</span>
                  <span className="sym">{step.symbol}</span>
                  <span className="pair">
                    {step.from} → <b>{step.to}</b>
                  </span>
                  <span className="step">{bps(step.stepBps)} bps</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block">
          <div className="wrap">
            <div className="block-head">
              <div>
                <p className="kicker">Method</p>
                <h2>Four rules, none negotiable.</h2>
              </div>
              <div>
                <p className="intro">
                  The value of a number like {hero.haircutPct} % is entirely in how it was obtained.
                  These are the constraints every line of exdate is written under.
                </p>
              </div>
            </div>

            <div className="rules">
              <div className="rule">
                <span className="n">1</span>
                <div>
                  <h3>Never invent an address, ABI or feed.</h3>
                  <p>
                    Every contract is read back on chain and checked against the issuer&rsquo;s own
                    registry. Anything that cannot be verified is marked, surfaced, and left out.
                  </p>
                </div>
              </div>
              <div className="rule">
                <span className="n">2</span>
                <div>
                  <h3>Never invent a market number.</h3>
                  <p>
                    No data means the page says so. Every yield traces to a real log with a real
                    transaction hash; a rate that cannot be computed is refused with a reason code.
                  </p>
                </div>
              </div>
              <div className="rule">
                <span className="n">3</span>
                <div>
                  <h3>Tokens are addresses, not tickers.</h3>
                  <p>
                    Symbols are mutable and duplicated. The only stable identity a token has is its
                    contract address, and that is the only key the data is stored under.
                  </p>
                </div>
              </div>
              <div className="rule">
                <span className="n">4</span>
                <div>
                  <h3>Chainlink prices are total return.</h3>
                  <p>
                    They already include the multiplier. Multiplying a feed answer by it again
                    double-counts every dividend ever paid — the most common mistake in the space.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="api">
          <div className="wrap">
            <div className="block-head">
              <div>
                <p className="kicker">Integration</p>
                <h2>One request. Every bigint a string; everything unobserved, null.</h2>
              </div>
              <div>
                <p className="intro">
                  A REST API over the same tables the status page reads, a typed SDK that depends on
                  nothing but the core library, and signed webhooks for the seven events that
                  matter. Nothing is annualised; every refusal names its reason.
                </p>
              </div>
            </div>

            <div className="duo">
              <div className="code">
                <div className="bar">
                  <span>GET /v1/robinhood/tokens/:address/pending</span>
                  <span>json</span>
                </div>
                <pre>{`{
  "token": { "symbol": "${pendingExample?.symbol ?? 'SGOV'}", "address": "${pendingExample?.token ?? ''}" },
  "multiplier": { "currentDecimal": "${pendingExample?.multiplier ?? ''}" },
  "scheduled": null,
  "declared": [{
    "state": "upcoming",
    "processDate": "${pendingExample?.processDate ?? ''}",
    "grossPerUnderlyingShare": "${pendingExample?.grossPerShare ?? ''}",
    "grossPerToken": "${pendingExample?.grossPerToken ?? ''}",
    "projection": { "notAMeasurement": true, "…": "…" }
  }],
  "notComputed": [
    { "field": "expectedEffectiveAt", "reasonCode": "announcement_lead_is_minutes" },
    { "field": "expectedStepBps",     "reasonCode": "haircut_not_forecastable" }
  ]
}`}</pre>
              </div>
              <div className="code">
                <div className="bar">
                  <span>@exdate/sdk</span>
                  <span>typescript</span>
                </div>
                <pre>{`import { createClient } from '@exdate/sdk'

const exdate = createClient({ baseUrl: '${links.api}' })

const owed = await exdate.pending('${pendingExample?.token ?? ''}')
owed.declared[0].grossPerToken   // '${pendingExample?.grossPerToken ?? ''}'
owed.history.lastObservedHaircutBps
owed.notComputed                 // what it refuses, and why

const { token } = await exdate.token(owed.token.address)
token.multiplier.scheduled       // null unless genuinely pending
token.events.last?.applied       // derived from the clock`}</pre>
              </div>
            </div>
            <p className="caption">
              Webhooks are an outbox, HMAC-SHA256 signed over <code>{'${t}.${rawBody}'}</code> with a
              300-second replay window, and the SDK verifies them with the sender&rsquo;s own
              function. Full reference with a captured response for every route:{' '}
              <a href={links.apiDocs}>docs/api.md</a>.
            </p>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      <footer>
        <div className="wrap">
          <div className="grid">
            <div>
              <p className="wordmark">exdate</p>
              <p className="fine">
                An open-core data layer for tokenized stocks: indexer, API, webhooks, status page.
                Robinhood Chain today; Coinbase B20 on Base verified on chain, and next. MIT licensed.
              </p>
            </div>
            <div className="cols">
              <div className="observed">
                <h4>Observed</h4>
                <ul>
                  <li>
                    <b>{counts.tokens}</b> tokens · registry {day(observedAt.registry)}
                  </li>
                  <li>
                    <b>{counts.distinctEvents}</b> multiplier changes · scanned {day(observedAt.events)}
                  </li>
                  <li>
                    <b>{counts.archivedActions}</b> corporate actions · archived {day(observedAt.archive)}
                  </li>
                  <li>
                    <b>{counts.mappedFeeds}</b> feeds paired · {counts.corroboratedFeeds} corroborated
                  </li>
                </ul>
              </div>
              <div>
                <h4>Read</h4>
                <ul>
                  <li>
                    <a href={links.status}>Live status</a>
                  </li>
                  <li>
                    <a href={links.apiDocs}>API reference</a>
                  </li>
                  <li>
                    <a href={links.sdkDocs}>SDK</a>
                  </li>
                  <li>
                    <a href={links.verification}>Verification report</a>
                  </li>
                  <li>
                    <a href={links.github}>Source on GitHub</a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <p className="fine">
            Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited,
            not equity. Nothing on this page is investment advice; every figure is an observation
            with a date, reproducible from the repository.
          </p>
        </div>
      </footer>
    </>
  )
}
