import type { Metadata } from 'next'
import { Footer, LedgerHead, Nav } from '../components/Chrome'
import { delay } from '../../lib/format'
import { observed, timing } from '../../lib/observed'

/**
 * The explanation, moved off the home page (audit 2026-09-05, F17): how a
 * dividend reaches a token, what was measured about the timing, the one
 * principle, and where exdate looks today.
 */
export const metadata: Metadata = {
  title: 'How a dividend reaches a token — exdate',
  description:
    'A dividend on a Stock Token never lands in a wallet: the multiplier rises. How that happens, how much warning it gives, and what exdate measures about it.',
}

const { chains } = observed

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="how-title">
          <div className="wrap">
            <div data-reveal>
              <p className="token-kind">The mechanism, in three steps</p>
              <h1 id="how-title">How a dividend reaches a token.</h1>
            </div>
            <p className="lede" data-reveal style={delay(120)}>
              A Stock Token is a debt security that tracks a share. When the share pays a dividend, no cash
              moves on chain: what each token represents grows instead, by a number the issuer publishes
              nine minutes before it takes effect. exdate reads that number and prices it.
            </p>
          </div>
        </section>

        <section className="block tight" aria-label="The three steps">
          <div className="wrap">
            <ol className="steps">
              <li data-reveal style={delay(0)}>
                <span className="step-n">01</span>
                <h2 className="step-title">A dividend is declared</h2>
                <p>The issuer states what each share pays, and on which day, in its own corporate-action feed.</p>
              </li>
              <li data-reveal style={delay(110)}>
                <span className="step-n">02</span>
                <h2 className="step-title">The token adjusts</h2>
                <p>
                  No cash lands. The token&rsquo;s multiplier rises: your balance is unchanged, what it
                  represents grows. A <em>step</em> is one such change.
                </p>
              </li>
              <li data-reveal style={delay(220)}>
                <span className="step-n">03</span>
                <h2 className="step-title">exdate measures the gap</h2>
                <p>What was declared, against what really arrived, priced at the moment the step took effect.</p>
              </li>
            </ol>
            <p className="steps-note" data-reveal>
              Measured so far: the announcement comes about {timing.medianLeadMinutes} minutes before the
              change, and the change lands one business day after the issuer&rsquo;s date in {timing.lagOneDay} of{' '}
              {timing.lagCases} measured cases. <a href="/record/">The delivery record</a> keeps the count.
            </p>
          </div>
        </section>

        <section className="statement" aria-label="Principle">
          <div className="wrap">
            <p className="statement-text" data-reveal>
              Every number here was read from the blockchain and dated. Nothing is estimated,
              modelled or annualised.
            </p>
          </div>
        </section>

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
              applies. What exdate refuses to compute is listed with a reason in every API answer: a
              landing date, a surviving fraction before it lands, anything annualised.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
