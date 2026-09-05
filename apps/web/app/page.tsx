import type { CSSProperties } from 'react'
import { CountUp } from './components/CountUp'
import { Footer, LedgerHead, Nav } from './components/Chrome'
import { Finder } from './components/Finder'
import { dateLong, dateRange, delay, pctInt, tokenCount } from '../lib/format'
import { ledgerMatched, ledgerRows } from '../lib/ledger'
import { calendar, cents, flows, observed } from '../lib/observed'

const { hero, chains, links, sessionShare } = observed

const RING_RADIUS = 140
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * The home page's job is to make a reader look up a token. It held eight
 * screens on a phone - doors that repeated the header, three steps, six
 * ledger rows, a principle band, a coverage table and a code block (audit
 * 2026-09-05, F17). What stays: the hero and the finder, the figure, what
 * was measured, three dividends with a link to all of them, and one line
 * each for coverage and developers. The steps live at /how/, the full
 * ledger at /dividends/, the code at /docs/.
 */
const EXCERPT = 3
const excerpt = ledgerRows.slice(0, EXCERPT)
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
        {/*
          The three figures nobody else publishes, each with its date, its sample
          and its method one click away (audit 2026-09-05, F05). The off-hours
          share renders only while the file says sufficient. Each row has a
          permanent anchor so a figure can be cited by URL.
        */}
        <section className="block measured" id="measured" aria-labelledby="measured-title">
          <div className="wrap">
            <div className="block-head" data-reveal>
              <h2 id="measured-title">What we measured</h2>
              <p>Three figures that exist nowhere else. Each one is dated, sized, and one click from how it was read.</p>
            </div>
            <ol className="figures">
              <li id="haircut" data-reveal>
                <span className="fig">{heroPct}%</span>
                <p>
                  <strong>of {hero.name}&rsquo;s last dividend never arrived on chain.</strong> ${cents(hero.declared)}{' '}
                  declared per share, ${cents(hero.received)} arrived, priced at the instant of the step on{' '}
                  {dateLong(hero.effectiveAt)}.{' '}
                  <a href={`/t/${hero.token.toLowerCase()}/#dividends`}>How this was measured</a>
                </p>
                <a className="anchor" href="#haircut" aria-label="Permanent link to this figure">
                  #
                </a>
              </li>
              {sessionShare.offHoursPct ? (
                <li id="off-hours" data-reveal style={delay(90)}>
                  <span className="fig">{sessionShare.offHoursPct}%</span>
                  <p>
                    <strong>of Stock Token transfers happen outside the US regular session</strong> (09:30–16:00 New
                    York time). {sessionShare.sampleCount} samples over {sessionShare.slotsCovered} of{' '}
                    {sessionShare.slotsTotal} weekly hour-slots, {dateRange(sessionShare.firstSampleAt, sessionShare.lastSampleAt)}
                    {sessionShare.provableOffHoursPct ? `; ${sessionShare.provableOffHoursPct}% of provable trades` : ''}.
                    {sessionShare.claimPct !== null ? ` The figure exdate was given to check was ${sessionShare.claimPct}%.` : ''}{' '}
                    <a href="/data/session-share.observed.json">The samples</a>
                  </p>
                  <a className="anchor" href="#off-hours" aria-label="Permanent link to this figure">
                    #
                  </a>
                </li>
              ) : null}
              {flows && !flows.incomplete ? (
                <li id="creation" data-reveal style={delay(180)}>
                  <span className="fig">{tokenCount(flows.netCreated, true)}</span>
                  <p>
                    <strong>tokens created net, across {flows.tokensWithFlow} tokens in {Math.round(flows.hours)} hours</strong>{' '}
                    to {dateLong(flows.to)}: {flows.mints} creations, {flows.burns} redemptions
                    {flows.created[0] ? `, ${flows.created[0].name} alone ${tokenCount(flows.created[0].net, true)}` : ''}. Read from the
                    chain, no oracle involved. <a href="/flows/">Per token</a>
                  </p>
                  <a className="anchor" href="#creation" aria-label="Permanent link to this figure">
                    #
                  </a>
                </li>
              ) : null}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block" id="proof" aria-labelledby="proof-title">
          <div className="wrap">
            <div className="block-head" data-reveal>
              <h2 id="proof-title">Every dividend so far, measured.</h2>
              <p>
                {ledgerMatched.length} reconcile cleanly. {ledgerRows.length - ledgerMatched.length} don&rsquo;t, and
                we say so rather than guess. The {EXCERPT} most recent:
              </p>
            </div>

            <LedgerHead cols={['Token', 'Declared', 'Arrived', 'Never arrived']} />
            <ul className="ledger">
              {excerpt.map((row, index) => (
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
              <a href="/dividends/">All {ledgerRows.length} measured dividends, and every change with no issuer record</a>.{' '}
              <a href="/calendar/">{calendar.total} more are declared and not yet on chain</a>.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block oneline" id="coverage" aria-labelledby="coverage-title">
          <div className="wrap">
            <h2 className="small" id="coverage-title" data-reveal>
              Where it looks
            </h2>
            <p className="line" data-reveal>
              {chains.robinhood.name}: {chains.robinhood.tokens} Stock Tokens and {chains.robinhood.feeds} price feeds, measured
              live. {chains.base.name}: {chains.base.tokens} Coinbase tokens verified on chain, nothing to measure until a
              multiplier moves there. Every number is read from the chain and dated; nothing is estimated, modelled or
              annualised. <a href="/how/">How a dividend reaches a token</a>
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="block oneline" id="developers" aria-labelledby="dev-title">
          <div className="wrap">
            <h2 className="small" id="dev-title" data-reveal>
              Built to integrate
            </h2>
            <p className="line" data-reveal>
              A REST API, a typed SDK and signed webhooks over the same records; a token list that imports the whole
              registry into a wallet in one URL. Every value exact, anything not observed null.
            </p>
            <p className="links" data-reveal>
              <a href="/docs/">Developers</a>
              <a href={links.apiDocs}>API reference</a>
              <a href={links.sdkDocs}>SDK</a>
              <a href="/tokenlist.json">Token list</a>
              <a href={links.data}>Data</a>
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}
