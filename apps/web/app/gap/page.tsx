import type { Metadata } from 'next'
import { Footer, LedgerHead, Nav } from '../components/Chrome'
import { delay } from '../../lib/format'
import { gap } from '../../lib/observed'

/**
 * The one figure a lending-market curator has to know and cannot get anywhere: how far
 * the price a token trades at sits from the oracle their protocol liquidates against.
 */
export const metadata: Metadata = {
  title: 'Oracle gap — exdate',
  description:
    'How far each Robinhood Stock Token trades from the Chainlink price a lending market liquidates against, and how old that price is.',
}

/** Rounds first: `(-0.4).toFixed(0)` is "-0", which reads as a direction that is not there. */
const bps = (value: number) => {
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded === 0 ? '0' : rounded} bps`
}
const age = (seconds: number | null) => {
  if (seconds === null) return '—'
  if (seconds < 90) return `${seconds}s old`
  const minutes = Math.round(seconds / 60)
  return minutes < 90 ? `${minutes} min old` : `${Math.round(minutes / 60)} h old`
}
/**
 * "975 minutes" is a number nobody reads as a duration; "16 h 15 min" is.
 * Minutes stay minutes below an hour and a half, which is where people stop
 * converting in their head (audit 2026-09-05, F16).
 */
const ageWords = (minutes: number | null | undefined) => {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 90) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes - h * 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
/** Whole dollars: the pool's size is context for the gap, not a figure to the cent. */
const money = (value: string | undefined) =>
  value === undefined ? null : `$${Math.round(Number(value)).toLocaleString('en-US')}`

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(iso),
  )

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="gap-title">
          <div className="wrap">
            <div className="token-head">
              <div data-reveal>
                <p className="token-kind">Traded price against the oracle</p>
                <h1 id="gap-title">What it trades at, and what the oracle says.</h1>
              </div>
              <div className="stat" data-reveal style={delay(120)}>
                <div className="v">{gap.maxAbsDeviationBps?.toFixed(0) ?? '—'}</div>
                <div className="k">
                  basis points at the widest, across {gap.withFeed} tokens, read during{' '}
                  {gap.sessionLabel} on {when(gap.observedAt)} UTC
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="block tight" aria-label="Why this matters">
          <div className="wrap">
            <p className="note-box big" data-reveal>
              A lending market liquidates against the Chainlink price. That feed runs 24/5 and
              holds its last answer outside market hours; the chain never stops trading. The
              distance between the two is the risk a curator carries, and it is widest exactly
              when the feed is stalest. At this reading the median feed was{' '}
              <strong>{ageWords(gap.medianFeedAgeMinutes)} old</strong> and the median token traded{' '}
              <strong>{gap.medianAbsDeviationBps?.toFixed(0)} basis points</strong> from it.
            </p>
          </div>
        </section>

        <section className="block" aria-labelledby="tokens-title">
          <div className="wrap">
            <h2 className="small" id="tokens-title" data-reveal>
              Every token that trades and has a feed
            </h2>
            <LedgerHead cols={['Token', 'Traded', 'Oracle', 'Gap']} />
            <ul className="ledger">
              {gap.measured.map((row, index) => (
                <li key={row.token} data-reveal style={delay(Math.min(index, 8) * 50)}>
                  <div className="who">
                    <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                      {row.name}
                    </a>
                    <span className="sym">
                      {row.symbol} · oracle {age(row.feedAgeSeconds)}
                      {money(row.poolValueUsd) ? ` · pool ${money(row.poolValueUsd)}` : ''}
                    </span>
                  </div>
                  <div className="amt">
                    <span className="k">Traded</span>
                    <span className="v">${row.tradedPrice}</span>
                  </div>
                  <div className="amt">
                    <span className="k">Oracle</span>
                    <span className="v">${row.feedPrice}</span>
                  </div>
                  <div className="gap">
                    <span className="big">{bps(row.deviationBps!)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="note-box" data-reveal>
              Positive means the token trades above the oracle. The price is taken from the
              deepest USDG pool, and every pool and every feed is read at the same instant —
              otherwise the number would measure the delay between two reads rather than a gap.
              Both sides quote the token itself, which already includes the multiplier, so
              neither is adjusted. Each row states what its pool holds, because a wide gap on a
              pool with a few hundred dollars in it is a price nobody can trade, and a wide gap
              on a deep one is a dislocation.
            </p>
          </div>
        </section>

        {gap.unpriced.length > 0 ? (
          <section className="block" aria-labelledby="unpriced-title">
            <div className="wrap">
              <h2 className="small" id="unpriced-title" data-reveal>
                And {gap.unpriced.length} that trade with no oracle at all
              </h2>
              <p className="cal-group lead" data-reveal>
                These have a pool with real liquidity and no Chainlink feed. There is nothing to
                compare a price against, and a lending market has nothing to liquidate against
                either.
              </p>
              <LedgerHead cols={['Token', 'Traded', '', '']} />
              <ul className="ledger">
                {gap.unpriced.slice(0, 12).map((row, index) => (
                  <li key={row.token} data-reveal style={delay(Math.min(index, 8) * 40)}>
                    <div className="who">
                      <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                        {row.name}
                      </a>
                      <span className="sym">{row.symbol}</span>
                    </div>
                    <div className="amt">
                      <span className="k">Traded</span>
                      <span className="v">${row.tradedPrice}</span>
                    </div>
                    <div className="amt" />
                    <div className="gap">
                      <span className="state">no oracle</span>
                    </div>
                  </li>
                ))}
              </ul>
              {gap.unpriced.length > 12 ? (
                <p className="note-box" data-reveal>
                  And {gap.unpriced.length - 12} more.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="block" aria-labelledby="session-title">
          <div className="wrap">
            <h2 className="small" id="session-title" data-reveal>
              Does the gap widen when the feed freezes?
            </h2>
            {gap.sessionsComparable ? (
              <>
                <LedgerHead cols={['Session', '', 'Samples', 'Median gap']} />
                <ul className="ledger">
                  {gap.sessions.map((session, index) => (
                    <li key={session.key} data-reveal style={delay(index * 60)}>
                      <div className="who">
                        <span className="name">{session.label}</span>
                      </div>
                      <div className="amt" />
                      <div className="amt">
                        <span className="k">Samples</span>
                        <span className="v">{session.samples}</span>
                      </div>
                      <div className="gap">
                        <span className="big">
                          {session.medianAbsDeviationBps === null ? '—' : `${session.medianAbsDeviationBps.toFixed(0)} bps`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="note-box big" data-reveal>
                Not yet. That question needs a reading in every market session, and there{' '}
                {gap.samples === 1 ? 'has been one so far' : `have been ${gap.samples} so far`}. The
                measurement runs hourly and the answer will appear here once each session has at
                least {gap.minimumSamples}. Until then this page shows a reading, not a rate.
              </p>
            )}
          </div>
        </section>

        <section className="block" aria-labelledby="pairing-title">
          <div className="wrap">
            <h2 className="small" id="pairing-title" data-reveal>
              What else these readings settle
            </h2>
            <p className="note-box big" data-reveal>
              Nobody states which feed belongs to which token. Chainlink's directory carries no
              token address, the token contract answers with none, and the issuer publishes no
              mapping — so the pairing starts as a guess from the ticker, and every measurement
              built on it inherits that. These readings test it: a token's traded price should sit
              closer to its own feed than to any of the other {gap.pairing.total - 1}.{' '}
              <strong>
                {gap.pairing.byPrice} of {gap.pairing.total} pairings
              </strong>{' '}
              now hold up that way, across repeated readings.
            </p>
            <p className="after" data-reveal>
              It is the weaker of the two tests and it is labelled as such: two unrelated assets can
              trade at one price. Only {gap.pairing.byStep === 1 ? 'one pairing' : `${gap.pairing.byStep} pairings`} — SGOV
              — has been confirmed the strong way, by its own dividend step moving its own feed. The{' '}
              {gap.pairing.neither.length} that fail here are mostly the volatile names
              ({gap.pairing.neither.slice(0, 4).join(', ')} and others): their traded price is
              genuinely far from the feed, so the test has nothing to recognise. That is the premise
              failing, not the pairing.
            </p>
          </div>
        </section>

        <p className="wrap observed-line">
          Read from Robinhood Chain on {when(gap.observedAt)} UTC. {gap.tokensQuotable} tokens have
          a pool with liquidity; {gap.withFeed} of them have a feed to compare against.
        </p>
      </main>
      <Footer />
    </>
  )
}
