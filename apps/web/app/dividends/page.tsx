import type { Metadata } from 'next'
import { Footer, LedgerHead, Nav } from '../components/Chrome'
import { Subscribe } from '../components/Subscribe'
import { dateLong, delay, pctInt } from '../../lib/format'
import { ledgerMatched, ledgerRows, unexplainedChanges } from '../../lib/ledger'
import { calendar, cents, observed } from '../../lib/observed'

/**
 * The whole measured ledger, which the home page now excerpts (audit
 * 2026-09-05, F17): every dividend that reached the chain and what it
 * delivered, then every multiplier change whose declaration is gone.
 */
export const metadata: Metadata = {
  title: 'Every dividend, measured — exdate',
  description:
    'Every Stock Token dividend that reached Robinhood Chain: what was declared, what arrived, how much never did, and the changes with no issuer record.',
}

const stepWords = (bps: number) => (bps >= 10_000 ? `×${(1 + bps / 10_000).toFixed(0)} split` : `+${(bps / 100).toFixed(3)}% shares`)

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="ledger-title">
          <div className="wrap">
            <div className="token-head">
              <div data-reveal>
                <p className="token-kind">Across all Robinhood Stock Tokens</p>
                <h1 id="ledger-title">Every dividend so far, measured.</h1>
              </div>
              <div className="stat" data-reveal style={delay(120)}>
                <div className="v">{ledgerRows.length}</div>
                <div className="k">
                  dividends reached the chain; {ledgerMatched.length} reconcile cleanly, as of {dateLong(observed.lastObservedAt)}
                </div>
              </div>
            </div>
            <Subscribe icsPath="/calendar.ics" site={observed.links.site} what="every declared dividend and every change on chain" />
          </div>
        </section>

        <section className="block" aria-labelledby="measured-title">
          <div className="wrap">
            <h2 className="small" id="measured-title" data-reveal>
              Declared, and what arrived
            </h2>
            <p className="lead" data-reveal>
              Priced at the moment each step took effect. A gap is stated only where the step reconciles
              against the declared amount; where a token has no price feed, or the step is too far from
              what a full payment implies, the row says so and no gap is claimed.
            </p>
            <LedgerHead cols={['Token', 'Declared', 'Arrived', 'Never arrived']} />
            <ul className="ledger">
              {ledgerRows.map((row, index) => (
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
              Each token&rsquo;s page opens every row on how it was measured.{' '}
              <a href="/calendar/">{calendar.total} more dividends are declared and not yet on chain</a>.
            </p>
          </div>
        </section>

        {unexplainedChanges.length > 0 ? (
          <section className="block" aria-labelledby="unexplained-title">
            <div className="wrap">
              <h2 className="small" id="unexplained-title" data-reveal>
                Moved on chain, nothing declared
              </h2>
              <p className="lead" data-reveal>
                The issuer&rsquo;s feed keeps about a month of history. These changes are on chain with their
                transactions, and their declarations fell out of that window before exdate archived it, so
                what each was worth cannot be recovered from any first-party source and is not guessed.
              </p>
              <LedgerHead cols={['Token', 'Before', 'After', 'Step']} />
              <ul className="ledger">
                {unexplainedChanges.map((change, index) => (
                  <li key={`${change.token}:${change.effectiveAt}`} data-reveal style={delay(Math.min(index, 8) * 50)}>
                    <div className="who">
                      <a className="name" href={`/t/${change.token}/`}>
                        {change.name}
                      </a>
                      <span className="sym">
                        {change.symbol} · {dateLong(change.effectiveAt)} ·{' '}
                        <a href={change.txUrl} rel="noopener">
                          transaction
                        </a>
                      </span>
                    </div>
                    <div className="amt">
                      <span className="k">Before</span>
                      <span className="v">{change.from}</span>
                    </div>
                    <div className="amt">
                      <span className="k">After</span>
                      <span className="v">{change.to}</span>
                    </div>
                    <div className="gap">
                      <span className="state">{stepWords(change.stepBps)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  )
}
