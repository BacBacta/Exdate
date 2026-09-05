import type { CSSProperties } from 'react'
import { CountUp } from './components/CountUp'
import { Footer, Nav } from './components/Chrome'
import { Finder } from './components/Finder'
import { Chip, Links, Section, Stats, Table } from './components/Ui'
import { dateLong, dateRange, dateShort, delay, pctInt, tokenCount, usd } from '../lib/format'
import { ledgerMatched, ledgerRows } from '../lib/ledger'
import { calendar, cents, changes, flows, observed, timing } from '../lib/observed'

/**
 * The home page makes a reader look up a token, then shows what the site
 * knows in two screens: the dividends, and the three measured figures. Every
 * figure is a tile with a label and a date; the method is one click away.
 */
const { hero, sessionShare } = observed
const RING_RADIUS = 140
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const heroPct = pctInt(hero.haircutBps)!

export default function Page() {
  return (
    <>
      <Nav current="tokens" />

      <main id="main">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div>
              <h1 id="hero-title">See what your Stock Tokens actually paid you.</h1>
              <p className="lede">
                A dividend on a Stock Token never lands in your wallet: the token becomes worth a little more.
                exdate measures how much, and how much went missing.
              </p>
              <div className="hero-find">
                <Finder tokens={observed.tokens} />
              </div>
            </div>

            <figure className="ring-figure" data-reveal style={delay(200)}>
              <div className="ring" style={{ '--c': RING_CIRCUMFERENCE, '--gap': hero.gapFraction } as unknown as CSSProperties}>
                <svg viewBox="0 0 320 320" role="img" aria-label={`${heroPct} percent of ${hero.name}'s last dividend never arrived on chain`}>
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
                <strong>{heroPct}%</strong> of <a href={`/t/${hero.token.toLowerCase()}/`}>{hero.name}</a>&rsquo;s last dividend never
                arrived on chain.
                <span className="fig-detail">
                  Declared ${cents(hero.declared)} · Arrived ${cents(hero.received)} · {dateLong(hero.effectiveAt)}
                </span>
              </figcaption>
            </figure>
          </div>
        </section>

        <Section id="dividends" title="Dividends">
          <Stats
            items={[
              { value: calendar.total, label: 'declared, not on chain', note: `${calendar.paidNotOnChain.length} the issuer calls paid`, href: '/dividends/' },
              { value: changes.length, label: 'landed on chain', note: `since ${dateShort(changes[0]?.effectiveAt)}`, href: '/dividends/#landed' },
              { value: ledgerMatched.length, label: 'measured cleanly', note: `${ledgerRows.length - ledgerMatched.length} cannot be`, href: '/dividends/#landed' },
              { value: `~${timing.medianLeadMinutes} min`, label: 'warning before a change', note: `${timing.changes} changes`, href: '/dividends/#method' },
            ]}
          />
          <Table
            caption="The dividends that reached the chain, newest first"
            cols={[
              { key: 'token', label: 'Token', primary: true },
              { key: 'date', label: 'Date' },
              { key: 'declared', label: 'Declared', align: 'right', numeric: true },
              { key: 'arrived', label: 'Arrived', align: 'right', numeric: true },
              { key: 'gap', label: 'Never arrived', align: 'right' },
            ]}
            rows={ledgerRows.slice(0, 6).map((row) => ({
              key: `${row.token}:${row.processDate}`,
              cells: {
                token: (
                  <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                    {row.name} <span className="sym">{row.symbol}</span>
                  </a>
                ),
                date: dateShort(row.processDate),
                declared: usd(cents(row.declared)),
                arrived: usd(cents(row.received)),
                gap:
                  row.status === 'matched' && row.haircutBps != null ? (
                    <span className="big">{pctInt(row.haircutBps)}%</span>
                  ) : (
                    <Chip tone="off">{row.hasFeed ? 'doesn’t add up' : 'no price feed'}</Chip>
                  ),
              },
            }))}
          />
          <Links>
            <a href="/dividends/">All dividends</a>
            <a href="/calendar.ics">Subscribe (.ics)</a>
            <a href="/feed.xml">RSS</a>
          </Links>
        </Section>

        <Section id="measured" title="What we measured" line="Three figures that exist nowhere else, each dated and sized.">
          <Stats
            ariaLabel="Measured figures"
            items={[
              {
                id: 'haircut',
                lead: true,
                value: `${heroPct}%`,
                label: `of ${hero.name}’s last dividend never arrived`,
                note: `${dateShort(hero.effectiveAt)} · priced at the instant of the step`,
                href: `/t/${hero.token.toLowerCase()}/`,
              },
              ...(sessionShare.offHoursPct
                ? [
                    {
                      id: 'off-hours',
                      lead: true,
                      value: `${sessionShare.offHoursPct}%`,
                      label: 'of transfers outside US market hours',
                      note: `${sessionShare.sampleCount} samples · ${dateRange(sessionShare.firstSampleAt, sessionShare.lastSampleAt)}${sessionShare.claimPct !== null ? ` · the figure to check was ${sessionShare.claimPct}%` : ''}`,
                      href: '/data/session-share.observed.json',
                    },
                  ]
                : []),
              ...(flows && !flows.incomplete
                ? [
                    {
                      id: 'creation',
                      lead: true,
                      value: tokenCount(flows.netCreated, true),
                      label: `tokens created net, ${Math.round(flows.hours)} h`,
                      note: `${flows.tokensWithFlow} tokens · to ${dateShort(flows.to)}`,
                      href: '/market/#creation',
                    },
                  ]
                : []),
            ]}
          />
          <Links>
            <a href="/about/#method">How we measure</a>
            <a href="/data/">The data behind every figure</a>
          </Links>
        </Section>
      </main>

      <Footer />
    </>
  )
}
