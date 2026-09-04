import type { CSSProperties } from 'react'
import { CountUp } from './components/CountUp'
import { Footer, LedgerHead, Nav } from './components/Chrome'
import { Finder } from './components/Finder'
import { dateLong, delay, pctInt } from '../lib/format'
import { calendar, cents, observed, timing } from '../lib/observed'

const { hero, reconciled, chains, links } = observed

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
      <Nav current="tokens" />

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div>
              <h1 id="hero-title" data-reveal>
                See what your Stock Tokens actually paid you.
              </h1>
              <p className="lede" data-reveal style={delay(90)}>
                When a Stock Token pays a dividend, nothing lands in your wallet. The token
                quietly becomes worth a little more. exdate measures exactly how much, and how
                much went missing on the way.
              </p>
              <div className="hero-find" data-reveal style={delay(180)}>
                <Finder tokens={observed.tokens} />
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
                <strong>{heroPct}%</strong> of{' '}
                <a href={`/t/${hero.token.toLowerCase()}/`}>{hero.name}</a>&rsquo;s last dividend
                never arrived on chain.
                <span className="fig-detail">
                  Declared ${cents(hero.declared)} · Arrived ${cents(hero.received)} ·{' '}
                  {dateLong(hero.effectiveAt)}
                </span>
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block tight" aria-label="What you can do here">
          <div className="wrap index">
            <a href="#find" data-reveal>
              <h3>Find your token</h3>
              <p>What it represents today, what it was paid, what it is still owed.</p>
            </a>
            <a href="/wallet/" data-reveal style={delay(90)}>
              <h3>Read your wallet</h3>
              <p>What an address holds and is owed. No signature, nothing sent to us.</p>
            </a>
            <a href="/calendar/" data-reveal style={delay(180)}>
              <h3>Calendar</h3>
              <p>
                {calendar.total} dividends declared and not yet on chain
                {calendar.paidNotOnChain.length > 0 ? `, ${calendar.paidNotOnChain.length} already called paid.` : '.'}
              </p>
            </a>
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
                <p>The issuer states what each share pays, and on which day.</p>
              </li>
              <li data-reveal style={delay(110)}>
                <span className="step-n">02</span>
                <h3>The token adjusts</h3>
                <p>
                  No cash lands. The token&rsquo;s multiplier rises: your balance is unchanged,
                  what it represents grows.
                </p>
              </li>
              <li data-reveal style={delay(220)}>
                <span className="step-n">03</span>
                <h3>exdate measures the gap</h3>
                <p>What was declared, against what really arrived, priced at the moment it happened.</p>
              </li>
            </ol>
            <p className="steps-note" data-reveal>
              Measured so far: the announcement comes about {timing.medianLeadMinutes} minutes
              before the change, and the change lands one business day after the issuer&rsquo;s
              date in {timing.lagOneDay} of {timing.lagCases} measured cases.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="proof" aria-labelledby="proof-title">
          <div className="wrap">
            <div className="block-head" data-reveal>
              <h2 id="proof-title">Every dividend so far, measured.</h2>
              <p>
                {matched.length} reconcile cleanly. {rows.length - matched.length} don&rsquo;t, and
                we say so rather than guess.
              </p>
            </div>

            <LedgerHead cols={['Token', 'Declared', 'Arrived', 'Never arrived']} />
            <ul className="ledger">
              {rows.map((row, index) => (
                <li key={`${row.token}:${row.processDate}`} data-reveal style={delay(index * 60)}>
                  <div className="who">
                    <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                      {row.name}
                    </a>
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
              Priced at the moment each step took effect. Where a token has no price feed, no gap
              is claimed.{' '}
              <a href="/calendar/">{calendar.total} more dividends are declared and not yet on chain</a>.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="statement" aria-label="Principle">
          <div className="wrap">
            <p className="statement-text" data-reveal>
              Every number here was read from the blockchain and dated. Nothing is estimated,
              modelled or annualised.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="coverage" aria-labelledby="coverage-title">
          <div className="wrap">
            <div className="block-head" data-reveal>
              <h2 id="coverage-title">Where it looks today</h2>
              <p>Built for every issuer of tokenized real-world assets such as Stock Tokens. Measured wherever there is something real to measure.</p>
            </div>
            <LedgerHead cols={['Chain', 'Tokens', 'Price feeds', '']} />
            <ul className="ledger">
              <li data-reveal>
                <div className="who">
                  <span className="name">{chains.robinhood.name}</span>
                  <span className="sym">{chains.robinhood.issuer}</span>
                </div>
                <div className="amt">
                  <span className="k">Tokens</span>
                  <span className="v">{chains.robinhood.tokens}</span>
                </div>
                <div className="amt">
                  <span className="k">Price feeds</span>
                  <span className="v">{chains.robinhood.feeds}</span>
                </div>
                <div className="gap">
                  <span className="tag on">measured live</span>
                </div>
              </li>
              <li data-reveal style={delay(90)}>
                <div className="who">
                  <span className="name">{chains.base.name}</span>
                  <span className="sym">{chains.base.issuer}</span>
                </div>
                <div className="amt">
                  <span className="k">Tokens</span>
                  <span className="v">{chains.base.tokens}</span>
                </div>
                <div className="amt">
                  <span className="k">Price feeds</span>
                  <span className="v">{chains.base.feeds}</span>
                </div>
                <div className="gap">
                  <span className="tag">verified, nothing to measure yet</span>
                </div>
              </li>
            </ul>
            <p className="after" data-reveal>
              On Base no dividend has moved a token yet. The moment one does, the same measurement
              applies.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block dev" id="developers" aria-labelledby="dev-title">
          <div className="wrap dev-grid">
            <div data-reveal>
              <h2 id="dev-title">Built to integrate.</h2>
              <p>
                A REST API, a typed SDK and signed webhooks over the same records. Every value is
                exact; anything not observed is null, never zero. The token list imports the whole
                registry into a wallet in one URL, carrying what each token represents in shares
                and what it is owed.
              </p>
              <p className="links">
                <a href={links.apiDocs}>API reference</a>
                {links.api ? <a href={`${links.api}/v1/health`}>Live API</a> : null}
                <a href={links.sdkDocs}>SDK</a>
                <a href="/tokenlist.json">Token list</a>
                <a href={links.data}>Data</a>
                {links.github ? <a href={links.github}>Source</a> : null}
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

      <Footer />
    </>
  )
}
