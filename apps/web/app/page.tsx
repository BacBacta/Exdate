import type { CSSProperties } from 'react'
import { CountUp } from './components/CountUp'
import { cents, observed } from '../lib/observed'

const { counts, hero, reconciled, links, lastObservedAt } = observed

/** Stagger for the reveal animation, as a CSS custom property. */
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as unknown as CSSProperties

const dateLong = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(iso),
      )
    : ''

/** Whole percent for a reader; the exact basis points stay in the data. */
const pctInt = (bps: number | null | undefined) => (bps == null ? null : Math.round(bps / 100))

const RING_RADIUS = 140
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** Reconciled dividends first, newest first; the rest after, newest first. */
const rows = [...reconciled].sort((a, b) => {
  const aClean = a.status === 'matched' ? 0 : 1
  const bClean = b.status === 'matched' ? 0 : 1
  return aClean - bClean || (b.processDate ?? '').localeCompare(a.processDate ?? '')
})
const matched = rows.filter((row) => row.status === 'matched')
const heroPct = pctInt(hero.haircutBps)!

export default function Page() {
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <a className="wordmark" href="#top" aria-label="exdate, home">
            exdate
          </a>
          <nav aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#proof">Proof</a>
            <a href="#developers">Developers</a>
            <a className="btn small" href={links.status}>
              Live status
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div>
              <h1 id="hero-title" data-reveal>
                See what your tokenized stock actually paid you.
              </h1>
              <p className="lede" data-reveal style={delay(90)}>
                When a tokenized stock pays a dividend, nothing lands in your wallet. The token
                quietly becomes worth a little more. exdate measures exactly how much — and how
                much went missing on the way.
              </p>
              <div className="actions" data-reveal style={delay(180)}>
                <a className="btn" href="#proof">
                  See the evidence
                </a>
                <a className="btn ghost" href="#how">
                  How it works
                </a>
              </div>
            </div>

            <figure className="ring-figure" data-reveal style={delay(260)}>
              <div
                className="ring"
                style={{ '--c': RING_CIRCUMFERENCE, '--gap': hero.gapFraction } as unknown as CSSProperties}
              >
                <svg
                  viewBox="0 0 320 320"
                  role="img"
                  aria-label={`${heroPct} percent of ${hero.name}'s last dividend never arrived on chain`}
                >
                  <circle className="ring-track" cx="160" cy="160" r={RING_RADIUS} />
                  <circle className="ring-gap" cx="160" cy="160" r={RING_RADIUS} />
                </svg>
                <div className="ring-center" aria-hidden="true">
                  <span className="ring-value">
                    <CountUp to={heroPct} />%
                  </span>
                  <span className="ring-label">never arrived</span>
                </div>
              </div>
              <figcaption>
                <strong>{heroPct}%</strong> of {hero.name}&rsquo;s last dividend never arrived on
                chain.
                <span className="fig-detail">
                  Declared ${cents(hero.declared)} · Arrived ${cents(hero.received)} ·{' '}
                  {dateLong(hero.effectiveAt)}
                </span>
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <h2 id="how-title" data-reveal>
              How a dividend reaches a token
            </h2>
            <ol className="steps">
              <li data-reveal style={delay(0)}>
                <span className="step-n">01</span>
                <h3>A dividend is declared</h3>
                <p>The issuer announces what each share pays, and on which day.</p>
              </li>
              <li data-reveal style={delay(110)}>
                <span className="step-n">02</span>
                <h3>The token adjusts</h3>
                <p>
                  Instead of cash, the token&rsquo;s multiplier rises. Your balance never changes;
                  what it represents does.
                </p>
              </li>
              <li data-reveal style={delay(220)}>
                <span className="step-n">03</span>
                <h3>exdate measures the gap</h3>
                <p>
                  What was declared, against what really arrived — priced at the moment it
                  happened, and dated.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="proof" aria-labelledby="proof-title">
          <div className="wrap">
            <div className="block-head" data-reveal>
              <h2 id="proof-title">Every dividend so far, measured.</h2>
              <p>
                {matched.length} reconcile cleanly. {rows.length - matched.length} don&rsquo;t —
                and we say so rather than guess.
              </p>
            </div>

            <ul className="ledger">
              {rows.map((row, index) => (
                <li key={`${row.token}:${row.processDate}`} data-reveal style={delay(index * 60)}>
                  <div className="who">
                    <span className="name">{row.name}</span>
                    <span className="sym">{row.symbol}</span>
                  </div>
                  <div className="amt">
                    <span className="k">Declared</span>
                    <span className="v">${cents(row.declared)}</span>
                  </div>
                  <div className="amt">
                    <span className="k">Arrived</span>
                    <span className="v">{row.received ? `$${cents(row.received)}` : '—'}</span>
                  </div>
                  <div className="gap">
                    {row.status === 'matched' && row.haircutBps != null ? (
                      <span className="big">{pctInt(row.haircutBps)}%</span>
                    ) : (
                      <span className="note">{row.hasFeed ? 'doesn’t add up' : 'no price feed'}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <p className="after" data-reveal>
              Each dividend is priced at the moment it took effect, with the oracle price in force
              then. Where a token has no price feed, no gap is claimed.{' '}
              <a href={links.status}>Full detail on the live status page</a>.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block statement" aria-label="Principle">
          <div className="wrap">
            <p className="statement-text" data-reveal>
              Every number here was read from the blockchain and dated. Nothing is estimated,
              modelled or annualised.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="value" aria-labelledby="value-title">
          <div className="wrap">
            <h2 id="value-title" data-reveal>
              What it gives you
            </h2>
            <div className="trio">
              <div data-reveal style={delay(0)}>
                <h3>What you&rsquo;re owed</h3>
                <p>A declared dividend that hasn&rsquo;t reached the chain yet — per token, with no price needed.</p>
              </div>
              <div data-reveal style={delay(110)}>
                <h3>What actually arrived</h3>
                <p>The real value each change delivered, against what was promised.</p>
              </div>
              <div data-reveal style={delay(220)}>
                <h3>Whether the price is fresh</h3>
                <p>
                  Price feeds pause overnight and at weekends. exdate tells you when a price is
                  stale, before you act on it.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block dev" id="developers" aria-labelledby="dev-title">
          <div className="wrap dev-grid">
            <div data-reveal>
              <h2 id="dev-title">Built to integrate.</h2>
              <p>
                A REST API, a typed TypeScript SDK and signed webhooks, over the same data you see
                here. Every value is exact, and anything not observed is null, never zero.
              </p>
              <p className="links">
                <a href={links.apiDocs}>API reference</a>
                <a href={links.sdkDocs}>SDK</a>
                <a href={links.github}>Source</a>
              </p>
            </div>
            <pre className="code" data-reveal style={delay(120)}>
              <code>
                {`const owed = await exdate.pending(token)\n\n`}
                {`owed.declared[0].grossPerToken\n`}
                <span className="c">{`// what is owed per token, no price needed`}</span>
                {`\n\nowed.notComputed\n`}
                <span className="c">{`// what it refuses to estimate, and why`}</span>
              </code>
            </pre>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      <footer>
        <div className="wrap foot">
          <div>
            <span className="wordmark">exdate</span>
            <p>The corporate-action layer for tokenized stocks.</p>
          </div>
          <nav aria-label="Footer">
            <a href={links.status}>Live status</a>
            <a href={links.apiDocs}>API</a>
            <a href={links.github}>GitHub</a>
          </nav>
          <p className="fine">
            Data read from Robinhood Chain: {counts.tokens} tokens, last observed{' '}
            {dateLong(lastObservedAt)}. Stock Tokens are debt securities issued by Robinhood
            Assets (Jersey) Limited, not equity. Nothing here is investment advice.
          </p>
        </div>
      </footer>
    </>
  )
}
