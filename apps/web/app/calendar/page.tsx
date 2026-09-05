import type { Metadata } from 'next'
import { Footer, LedgerHead, Nav } from '../components/Chrome'
import { dateLong, delay } from '../../lib/format'
import { calendar, observed, type CalendarGroup } from '../../lib/observed'
import { Subscribe } from '../components/Subscribe'
import { CalendarFilter } from '../components/CalendarFilter'

/**
 * Every dividend the issuer has declared that has not produced a multiplier
 * step on chain, across all tokens, as of the data's own date. The groups are
 * the pending endpoint's, in plain words; the sharp one comes first.
 */
export const metadata: Metadata = {
  title: 'Declared, not yet on chain — exdate',
  description:
    'Every dividend declared by the issuer that has not reached the chain: what is owed per token, and which the issuer already calls paid.',
}

const GROUPS: { key: CalendarGroup; title: string; lead: string; late: boolean }[] = [
  {
    key: 'paid_not_on_chain',
    title: 'The issuer says paid. The chain says nothing.',
    lead: 'Marked completed in the issuer’s own feed, past the usual one-business-day window, and the multiplier has not moved.',
    late: true,
  },
  {
    key: 'overdue',
    title: 'Past the window',
    lead: 'More than a few days after the issuer’s date, still in progress on their side, nothing on chain.',
    late: true,
  },
  {
    key: 'awaiting',
    title: 'Due now',
    lead: 'The issuer’s date has passed. Every step observed so far landed one business day later.',
    late: false,
  },
  {
    key: 'upcoming',
    title: 'Declared for the coming weeks',
    lead: 'Nothing is owed yet. What each token would be owed is stated anyway: the rate times what a token represents today.',
    late: false,
  },
]

const when = (daysSince: number) =>
  daysSince < 0 ? `in ${-daysSince} day${daysSince === -1 ? '' : 's'}` : daysSince === 0 ? 'today' : `${daysSince} day${daysSince === 1 ? '' : 's'} ago`

export default function Page() {
  return (
    <>
      <Nav current="calendar" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="cal-title">
          <div className="wrap">
            <div className="token-head">
              <div data-reveal>
                <p className="token-kind">Across all Robinhood Stock Tokens</p>
                <h1 id="cal-title">Declared, not yet on chain.</h1>
              </div>
              <div className="stat" data-reveal style={delay(120)}>
                <div className="v">{calendar.total}</div>
                <div className="k">
                  dividends across {calendar.tokens} tokens, as of {dateLong(calendar.observedDay)}
                </div>
              </div>
            </div>
            {/*
              Something to subscribe to, so the only way back is not memory
              (audit 2026-09-05, F04). Both files are built with the page.
            */}
            <Subscribe icsPath="/calendar.ics" site={observed.links.site} what="every declared dividend and every change on chain" />
            <CalendarFilter total={calendar.total} />
          </div>
        </section>

        <section className="block" aria-label="Dividends by state">
          <div className="wrap">
            {GROUPS.map((group) => {
              const rows = calendar[
                group.key === 'paid_not_on_chain' ? 'paidNotOnChain' : group.key
              ]
              if (rows.length === 0) return null
              return (
                <div className="cal-group" key={group.key} data-group={group.key}>
                  <h2 className="small" data-reveal>
                    {group.title}
                  </h2>
                  <p className="lead" data-reveal>
                    {group.lead}
                  </p>
                  <LedgerHead cols={['Token', 'Declared per share', 'Owed per token', 'When']} />
                  <ul className="ledger">
                    {rows.map((row, index) => (
                      <li key={`${row.token}:${row.processDate}`} data-token={row.token.toLowerCase()} data-reveal style={delay(Math.min(index, 8) * 40)}>
                        <div className="who">
                          <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                            {row.name}
                          </a>
                          <span className="sym">
                            {row.symbol} · {dateLong(row.processDate)}
                          </span>
                        </div>
                        <div className="amt">
                          <span className="k">Declared per share</span>
                          <span className="v">{row.declared ? `$${row.declared}` : '—'}</span>
                        </div>
                        <div className="amt">
                          <span className="k">Owed per token</span>
                          {/*
                            For a token whose multiplier is still 1.0 the two amounts are
                            identical, and a row repeating one figure twice reads as an
                            error (audit 2026-09-05, F12). Say "same" instead.
                          */}
                          <span className={row.owedPerToken && row.owedPerToken === row.declared ? 'v same' : 'v'}>
                            {row.owedPerToken ? (row.owedPerToken === row.declared ? 'same' : `$${row.owedPerToken}`) : '—'}
                          </span>
                        </div>
                        <div className="gap">
                          <span className={`when${group.late ? ' late' : ''}`}>{when(row.daysSince)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
            <p className="note-box">
              A dividend counts here from the day the issuer publishes it until a multiplier step lands
              on chain. When it lands, and how much of it survives, are not predicted: the last
              measured gaps are on each token&rsquo;s page.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
