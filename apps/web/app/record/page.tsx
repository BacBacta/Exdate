import type { Metadata } from 'next'
import { Footer, LedgerHead, Nav } from '../components/Chrome'
import { dateLong, delay } from '../../lib/format'
import { capture, delivery } from '../../lib/observed'

/**
 * What the issuer declared, and what reached the chain. Every figure is a count with
 * its denominator: twelve changes and six datable landings are a record, not a rate,
 * and a percentage here would describe the sample rather than the issuer.
 */
export const metadata: Metadata = {
  title: 'Delivery record — exdate',
  description:
    'How long dividends take to reach Robinhood Chain, how much warning a multiplier change gives, and what the issuer already calls paid but has not delivered.',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function Page() {
  const { announced, landed, outstanding, measurable, observedDay } = delivery
  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="record-title">
          <div className="wrap">
            <div className="token-head">
              <div data-reveal>
                <p className="token-kind">Robinhood Assets (Jersey) Limited</p>
                <h1 id="record-title">Declared, and delivered.</h1>
              </div>
              <div className="stat" data-reveal style={delay(120)}>
                <div className="v">{outstanding.issuerSaysPaid}</div>
                <div className="k">
                  dividends the issuer calls paid that have not moved a multiplier, as of{' '}
                  {dateLong(observedDay)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="block" aria-labelledby="warning-title">
          <div className="wrap">
            <h2 className="small" id="warning-title" data-reveal>
              How much warning the chain gives
            </h2>
            <p className="note-box big" data-reveal>
              A multiplier change is published on chain before it takes effect. Of the{' '}
              {plural(announced.changes, 'change')} seen so far,{' '}
              <strong>
                {announced.withinTenMinutes} came {announced.shortestLeadMinutes} to{' '}
                {announced.medianLeadMinutes} minutes ahead
              </strong>
              {announced.outlierSymbol ? (
                <>
                  {' '}
                  and one, {announced.outlierSymbol}, came {announced.longestLeadMinutes} minutes
                  ahead
                </>
              ) : null}
              . Nothing is emitted when the change actually takes effect, so the announcement is
              the only signal there is.
            </p>
          </div>
        </section>

        <section className="block" aria-labelledby="lag-title">
          <div className="wrap">
            <h2 className="small" id="lag-title" data-reveal>
              How long after the issuer&rsquo;s own date
            </h2>
            {landed.cases > 0 ? (
              <>
                <LedgerHead cols={['Business days after the process date', '', '', 'Cases']} />
                <ul className="ledger">
                  {landed.byLagDays.map((row, index) => (
                    <li key={row.days} data-reveal style={delay(index * 60)}>
                      <div className="who">
                        <span className="name">
                          {row.days === 1 ? 'The next business day' : `${row.days} business days later`}
                        </span>
                        <span className="sym">measured on chain</span>
                      </div>
                      <div className="amt" />
                      <div className="amt" />
                      <div className="gap">
                        <span className="big">{row.cases}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="note-box" data-reveal>
                  {plural(landed.cases, 'case')} where the issuer&rsquo;s process date and an
                  on-chain step can both be dated. That is a record, not a rate: it is too few to
                  say what share arrives on time, and this page will not turn it into a percentage.
                </p>
              </>
            ) : (
              <p className="empty">No dividend has been datable on both sides yet.</p>
            )}
          </div>
        </section>

        {outstanding.rows.length > 0 ? (
          <section className="block" aria-labelledby="outstanding-title">
            <div className="wrap">
              <h2 className="small" id="outstanding-title" data-reveal>
                The issuer says paid. The chain says nothing.
              </h2>
              <p className="cal-group lead" data-reveal>
                Marked completed in the issuer&rsquo;s own feed, and no multiplier has moved. The
                oldest has stood for {plural(outstanding.longestOutstandingDays ?? 0, 'day')}.
              </p>
              <LedgerHead cols={['Token', 'Declared per share', '', 'Outstanding']} />
              <ul className="ledger">
                {outstanding.rows.map((row, index) => (
                  <li key={`${row.token}:${row.processDate}`} data-reveal style={delay(Math.min(index, 8) * 50)}>
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
                    <div className="amt" />
                    <div className="gap">
                      <span className="state on">{plural(row.daysSince, 'day')}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="note-box" data-reveal>
                {plural(outstanding.declared, 'dividend')} in total are declared and not yet on
                chain. <a href="/calendar/">The calendar has all of them</a>, with what each token
                would be owed.
              </p>
            </div>
          </section>
        ) : null}

        <section className="block" aria-labelledby="measurable-title">
          <div className="wrap">
            <h2 className="small" id="measurable-title" data-reveal>
              What can be measured, and what stops the rest
            </h2>
            <LedgerHead cols={['Of the multiplier steps observed', '', '', 'Steps']} />
            <ul className="ledger">
              {[
                { label: 'Reconciled against a declared amount', sub: 'a gap is stated', n: measurable.reconciled, on: true },
                { label: 'The numbers do not add up', sub: 'no gap is claimed', n: measurable.doesNotAddUp, on: false },
                { label: 'No price feed for the token', sub: 'nothing to price the step against', n: measurable.noPriceFeed, on: false },
                { label: 'No declaration left to match', sub: "the issuer's feed keeps about a month", n: measurable.noDeclaration, on: false },
              ]
                .filter((row) => row.n > 0)
                .map((row, index) => (
                  <li key={row.label} data-reveal style={delay(index * 60)}>
                    <div className="who">
                      <span className="name">{row.label}</span>
                      <span className="sym">{row.sub}</span>
                    </div>
                    <div className="amt" />
                    <div className="amt" />
                    <div className="gap">
                      <span className={`big${row.on ? '' : ' muted'}`}>{row.n}</span>
                    </div>
                  </li>
                ))}
            </ul>
            <p className="note-box" data-reveal>
              {measurable.tokensWithFeed} of {measurable.tokens} tokens have a Chainlink price feed
              at all, which is the ceiling on what a feed can price. exdate now also captures the
              issuer&rsquo;s own quote at the instant a step takes effect, which covers every token
              — from the next dividend onward, since that price cannot be read back afterwards.
            </p>
            <p className="after" data-reveal>
              {capture.watcher && !capture.watcher.stale
                ? `A watcher process${capture.watcher.host ? ` on ${capture.watcher.host}` : ''} is doing that capture and last reported in on ${dateLong(capture.watcher.heartbeatAt)}.`
                : capture.watcher
                  ? `A watcher process was doing that capture and has been silent since ${dateLong(capture.watcher.heartbeatAt)}; GitHub's schedule is capturing in its place.`
                  : capture.cadence
                    ? `That capture runs today on GitHub's schedule, which is asked for every ${capture.cadence.nominalMinutes} minutes and is best-effort: measured over ${capture.cadence.runs} runs, the gap between two was ${capture.cadence.medianMinutes} minutes at the median and ${capture.cadence.maxMinutes} at the widest${capture.cadence.withinNominal === 0 ? ', and none came within five' : ''}. A run waits ${capture.cadence.budgetMinutes} minutes for a step it has seen announced, so a step landing at a random instant would be caught about ${capture.cadence.expectedCatchPercent}% of the time. A process that stays alive is written and waits for a machine.`
                    : `That capture runs today on GitHub's schedule, which is best-effort; how often it really fires is being measured.`}
            </p>
          </div>
        </section>

        <p className="wrap observed-line">
          Every figure read from the committed record on {dateLong(observedDay)}. Nothing here is
          estimated, and nothing is expressed as a rate that the sample cannot support.
        </p>
      </main>
      <Footer />
    </>
  )
}
