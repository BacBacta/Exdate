import type { Metadata } from 'next'
import { CalendarFilter } from '../components/CalendarFilter'
import { Footer, Nav } from '../components/Chrome'
import { Segments } from '../components/Segments'
import { Chip, Links, Method, Section, Stats, Table } from '../components/Ui'
import { ledgerMatched } from '../../lib/ledger'
import { dateLong, dateShort, pctInt, usd } from '../../lib/format'
import { calendar, capture, changes, delivery, observed, type CalendarGroup } from '../../lib/observed'

/**
 * Every dividend, in two lists: the ones declared and not yet on chain, and
 * the ones that landed. One page where there were three (declared, landed,
 * and how long it takes); the timing is a row of figures and the method one
 * closed block.
 */
export const metadata: Metadata = {
  title: 'Dividends — exdate',
  description: 'Every Stock Token dividend: declared and not yet on chain, with what each token is owed; landed on chain, with what arrived and how much never did.',
}

const GROUP: Record<CalendarGroup, { chip: string; tone: 'warn' | 'plain' | 'off' }> = {
  paid_not_on_chain: { chip: 'issuer says paid', tone: 'warn' },
  overdue: { chip: 'overdue', tone: 'warn' },
  awaiting: { chip: 'due', tone: 'plain' },
  upcoming: { chip: 'upcoming', tone: 'off' },
}
const when = (days: number) => (days < 0 ? `in ${-days} day${days === -1 ? '' : 's'}` : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`)
const coming = [...calendar.paidNotOnChain, ...calendar.overdue, ...calendar.awaiting, ...calendar.upcoming]
const landed = [...changes].reverse()

export default function Page() {
  return (
    <>
      <Nav current="dividends" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="div-title">
          <div className="wrap">
            <p className="token-kind">Across all {observed.counts.tokens} Robinhood Stock Tokens · as of {dateLong(calendar.observedDay)}</p>
            <h1 id="div-title">Dividends.</h1>
          </div>
        </section>

        <div className="wrap">
          <Stats
            items={[
              { value: calendar.total, label: 'declared, not on chain', note: `${calendar.tokens} tokens`, href: '#coming' },
              { value: calendar.paidNotOnChain.length, label: 'the issuer calls paid', note: delivery.outstanding.longestOutstandingDays ? `oldest ${delivery.outstanding.longestOutstandingDays} days` : null, href: '#coming' },
              { value: landed.length, label: 'landed on chain', note: `since ${dateShort(changes[0]?.effectiveAt)}`, href: '#landed' },
              { value: ledgerMatched.length, label: 'measured cleanly', note: `${landed.length - ledgerMatched.length} cannot be`, href: '#landed' },
              { value: `~${delivery.announced.medianLeadMinutes} min`, label: 'warning before a change', note: `${delivery.announced.withinTenMinutes} of ${delivery.announced.changes} within 10 min`, href: '#method' },
              { value: delivery.landed.medianLagDays === null ? '—' : `${delivery.landed.medianLagDays} day`, label: 'after the issuer’s date', note: `${delivery.landed.cases} datable cases`, href: '#method' },
            ]}
          />
          <CalendarFilter total={calendar.total} />
          <Segments items={[{ id: 'coming', label: `Coming (${coming.length})` }, { id: 'landed', label: `Landed (${landed.length})` }]} />
        </div>

        <Section id="coming" title="Coming" tight line="Declared by the issuer, no multiplier change on chain yet. Owed is the rate times what a token represents today; it needs no price.">
          <div data-group="coming">
            <Table
              caption="Dividends declared and not yet on chain"
              cols={[
                { key: 'token', label: 'Token', primary: true },
                { key: 'date', label: 'Issuer’s date', short: 'Date' },
                { key: 'declared', label: 'Declared / share', short: 'Declared', align: 'right', numeric: true },
                { key: 'owed', label: 'Owed / token', short: 'Owed / token', align: 'right', numeric: true },
                { key: 'state', label: 'State', align: 'right' },
              ]}
              rows={coming.map((row) => ({
                key: `${row.token}:${row.processDate}`,
                data: { token: row.token.toLowerCase() },
                cells: {
                  token: (
                    <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                      {row.name} <span className="sym">{row.symbol}</span>
                    </a>
                  ),
                  date: (
                    <>
                      {dateShort(row.processDate)}
                      <span className="sub">{when(row.daysSince)}</span>
                    </>
                  ),
                  declared: usd(row.declared),
                  owed: row.owedPerToken && row.owedPerToken !== row.declared ? usd(row.owedPerToken) : 'same',
                  state: <Chip tone={GROUP[row.group].tone}>{GROUP[row.group].chip}</Chip>,
                },
              }))}
            />
          </div>
        </Section>

        <Section id="landed" title="Landed" tight line="Multiplier changes observed on chain, priced at the instant they took effect where a price exists.">
          <div data-group="landed">
            <Table
              caption="Dividends that reached the chain, newest first"
              cols={[
                { key: 'token', label: 'Token', primary: true },
                { key: 'date', label: 'Date' },
                { key: 'declared', label: 'Declared / share', short: 'Declared', align: 'right', numeric: true },
                { key: 'arrived', label: 'Arrived / share', short: 'Arrived', align: 'right', numeric: true },
                { key: 'gap', label: 'Never arrived', align: 'right' },
              ]}
              rows={landed.map((c) => ({
                key: `${c.token}:${c.effectiveAt}`,
                data: { token: c.token },
                cells: {
                  token: (
                    <a className="name" href={`/t/${c.token}/`}>
                      {c.name} <span className="sym">{c.symbol}</span>
                    </a>
                  ),
                  date: (
                    <>
                      {dateShort(c.effectiveAt)}
                      <span className="sub">{c.stepBps >= 10_000 ? `×${(1 + c.stepBps / 10_000).toFixed(0)} split` : `+${(c.stepBps / 100).toFixed(3)}%`}</span>
                    </>
                  ),
                  declared: usd(c.declared),
                  arrived: usd(c.arrived),
                  gap:
                    c.state === 'matched' ? (
                      <span className="big">{pctInt(c.haircutBps)}%</span>
                    ) : (
                      <Chip tone="off">{c.state === 'anomaly' ? (c.hasFeed ? 'doesn’t add up' : 'no price feed') : 'nothing declared'}</Chip>
                    ),
                },
              }))}
            />
          </div>
          <Links>
            <a href="/calendar.ics">Subscribe (.ics)</a>
            <a href="/feed.xml">RSS</a>
          </Links>
        </Section>

        <div className="wrap stack" id="method">
          <Method>
            <p>
              A dividend counts as <em>coming</em> from the day the issuer publishes it until a multiplier step lands on chain. <em>Due</em> is inside the {calendar.windowDays}-day window after the issuer&rsquo;s date; <em>overdue</em> is past it; <em>issuer says paid</em> means the issuer&rsquo;s own feed marks it completed while the multiplier has not moved.
            </p>
            <p>
              A change is announced on chain before it takes effect: {delivery.announced.withinTenMinutes} of {delivery.announced.changes} came {delivery.announced.shortestLeadMinutes} to {delivery.announced.medianLeadMinutes} minutes ahead
              {delivery.announced.outlierSymbol ? `, one (${delivery.announced.outlierSymbol}) ${delivery.announced.longestLeadMinutes} minutes ahead` : ''}. Nothing is emitted when it takes effect. Where the issuer&rsquo;s date and the step can both be dated, the step landed{' '}
              {delivery.landed.byLagDays.map((b, i) => `${i > 0 ? ', ' : ''}${b.days === 1 ? 'the next business day' : `${b.days} business days later`} in ${b.cases} case${b.cases === 1 ? '' : 's'}`).join('')}.
            </p>
            <p>
              A gap is stated only where the step reconciles against the declared amount at the price in force at that instant: {delivery.measurable.reconciled} of {delivery.measurable.steps} steps. {delivery.measurable.noPriceFeed} have no price feed, {delivery.measurable.doesNotAddUp} does not add up against its feed, and {delivery.measurable.noDeclaration} predate the issuer&rsquo;s one-month feed and can never be matched. {delivery.measurable.tokensWithFeed} of {delivery.measurable.tokens} tokens have a feed at all; from the next dividend on, the issuer&rsquo;s own quote is captured at the instant of each step, which covers every token.
            </p>
            <p>
              {capture.watcher && !capture.watcher.stale
                ? `A watcher process${capture.watcher.host ? ` on ${capture.watcher.host}` : ''} does that capture and last reported in on ${dateLong(capture.watcher.heartbeatAt)}.`
                : 'That capture runs on GitHub’s schedule, which is best-effort.'}{' '}
              Landing dates and surviving fractions are not predicted.
            </p>
          </Method>
        </div>
      </main>
      <Footer />
    </>
  )
}
