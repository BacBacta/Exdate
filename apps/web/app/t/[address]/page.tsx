import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Footer, LedgerHead, Nav } from '../../components/Chrome'
import { CopyAddress } from '../../components/CopyAddress'
import { Subscribe } from '../../components/Subscribe'
import { tokensWithCalendar } from '../../../lib/feeds'
import { dateLong, delay, pctInt } from '../../../lib/format'
import { observed, tokenPage } from '../../../lib/observed'

/**
 * One page per token, all 194 generated at build time from the committed
 * data. This is what a holder actually comes for: what their token represents
 * today, what was declared, what arrived, what is still owed, and whether a
 * price feed exists for it at all. Each row opens to show how it was measured.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return observed.tokens.map((token) => ({ address: token.address.toLowerCase() }))
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params
  const token = tokenPage(address)
  if (!token) return { title: 'exdate' }
  const title = `${token.name} (${token.symbol}) — exdate`
  const description = `What the ${token.symbol} Robinhood Stock Token represents today, every dividend declared for it, what arrived on chain, and what is still owed.`
  // og:title read "exdate" on every token page, so a shared SGOV link said
  // nothing about SGOV (audit 2026-09-05, F14).
  return { title, description, openGraph: { title, description } }
}

type Token = NonNullable<ReturnType<typeof tokenPage>>
type Dividend = Token['dividends'][number]

/**
 * Says what actually backs the pairing, in a reader's words. The two kinds are
 * not interchangeable: a step that moved this feed is causal evidence about
 * this token's own dividends, while a traded price that sits closest to it
 * identifies the underlying and could in principle be shared by two assets.
 * Claiming the first when only the second holds would be a number about
 * nothing, which is the one thing this site must not print.
 */
function pairingEvidence(by: readonly string[]): string {
  const step = by.includes('multiplier-step')
  const price = by.includes('traded-price')
  if (step && price) return ' and confirmed twice over: by its own dividend step and by the price it trades at'
  if (step) return ' and confirmed by its own dividend step'
  if (price) return ' and confirmed by the price it trades at on chain'
  return ''
}

function stateOf(dividend: Dividend): { text: string; on: boolean } {
  switch (dividend.state) {
    case 'matched':
      return { text: `${pctInt(dividend.haircutBps)}% never arrived`, on: true }
    case 'anomaly':
      return { text: dividend.hasFeed ? 'doesn’t add up' : 'no price feed to measure against', on: false }
    case 'pending':
      return dividend.upcoming
        ? { text: `declared for ${dateLong(dividend.processDate)}`, on: false }
        : { text: dividend.issuerCompleted ? 'issuer says paid, not on chain' : 'declared, not on chain yet', on: false }
    default:
      return { text: 'moved on chain, nothing declared', on: false }
  }
}

/**
 * The answer to the question a holder came with - did I get my dividend? -
 * before any mechanism. The page used to open on the multiplier and reach
 * "34% never arrived" two and a half screens down (audit 2026-09-05, F03).
 * Every sentence here is one of the ledger's own states, restated; nothing is
 * computed that the rows below do not show, and the link leads to them.
 */
function Answer({ token, owed }: { token: Token; owed: Dividend[] }) {
  const lines: React.ReactNode[] = []
  const upcoming = token.dividends.filter((d) => d.state === 'pending' && d.upcoming)
  const measured = token.dividends.find((d) => d.state === 'matched' || d.state === 'anomaly') ?? null
  const moved = token.dividends.find((d) => d.state === 'unmatched') ?? null

  if (owed.length === 1) {
    const one = owed[0]!
    lines.push(
      <>
        <strong>One dividend is owed and not yet on chain</strong>: declared for {dateLong(one.processDate)}, ${one.owedPerToken} per
        token{one.issuerCompleted ? ', and the issuer already calls it paid' : ''}.
      </>,
    )
  } else if (owed.length > 1) {
    const oldest = owed[owed.length - 1]!
    lines.push(
      <>
        <strong>{owed.length} dividends are owed and not yet on chain</strong>, the oldest declared for {dateLong(oldest.processDate)}
        {owed.some((d) => d.issuerCompleted) ? '; the issuer already calls some of them paid' : ''}.
      </>,
    )
  } else if (upcoming.length > 0) {
    const next = upcoming[upcoming.length - 1]!
    lines.push(
      <>
        <strong>Next dividend declared for {dateLong(next.processDate)}</strong>: ${next.declared} per share
        {next.owedPerToken && next.owedPerToken !== next.declared ? `, $${next.owedPerToken} per token if it arrives in full` : ''}.
        Nothing is owed yet.
      </>,
    )
  }

  if (measured) {
    const on = dateLong(measured.processDate ?? measured.effectiveAt)
    lines.push(
      measured.state === 'matched' ? (
        <>
          Last dividend on chain, {on}:{' '}
          <strong>
            ${measured.arrived} arrived of ${measured.declared} declared, {pctInt(measured.haircutBps)}% never arrived.
          </strong>
        </>
      ) : (
        <>
          Last dividend on chain, {on}: ${measured.declared} declared,{' '}
          {measured.hasFeed ? 'and the step doesn’t add up against its price feed' : 'and no price feed to measure what arrived'}.
        </>
      ),
    )
  }
  if (moved && (!measured || (moved.effectiveAt ?? '') > (measured.effectiveAt ?? ''))) {
    lines.push(
      <>
        The multiplier {measured ? 'moved again' : 'last moved'} on {dateLong(moved.effectiveAt)} with no dividend declared in the
        issuer&rsquo;s feed.
      </>,
    )
  }
  if (lines.length === 0) {
    lines.push(<>No dividend has been declared for this token in the issuer&rsquo;s feed, and its multiplier has never moved.</>)
  }
  return (
    <div className="token-answer">
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
      {token.dividends.length > 0 ? (
        <a className="how" href="#dividends">
          How this was measured ↓
        </a>
      ) : null}
    </div>
  )
}

const pct3 = (value: number | null) => (value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(3)}%`)
const stepText = (bps: number) => (bps >= 10_000 ? `×${(1 + bps / 10_000).toFixed(0)}` : pct3(bps / 100))

/** How the row was measured. Opened by the reader; every value is from the same record. */
function Detail({ dividend }: { dividend: Dividend }) {
  const d = dividend.detail
  const measured = dividend.state === 'matched' || dividend.state === 'anomaly'
  return (
    <details className="row-detail">
      <summary>{measured ? 'How this was measured' : 'Details'}</summary>
      <dl>
        {measured ? (
          <>
            <div>
              <dt>Price when the step took effect</dt>
              <dd>
                {d.priceAtEffect ? `$${d.priceAtEffect}` : 'no feed'}
                {d.priceAgeAtEffectMinutes != null ? `, ${d.priceAgeAtEffectMinutes} min old` : ''}
              </dd>
            </div>
            <div>
              <dt>Step a full payment implies</dt>
              <dd>{pct3(d.expectedStepPct)}</dd>
            </div>
            <div>
              <dt>Step observed on chain</dt>
              <dd>{pct3(d.observedStepPct)}</dd>
            </div>
            <div>
              <dt>Price the step implies</dt>
              <dd>
                {d.impliedPrice ? `$${d.impliedPrice}` : '—'}
                {d.impliedOverSpot != null && d.spotToday ? ` (${d.impliedOverSpot.toFixed(2)}× today’s $${d.spotToday})` : ''}
              </dd>
            </div>
            <div>
              <dt>After the issuer’s date</dt>
              <dd>{d.lagDays != null ? `${d.lagDays} business day${d.lagDays === 1 ? '' : 's'}` : '—'}</dd>
            </div>
            {d.txUrl ? (
              <div>
                <dt>Proof</dt>
                <dd>
                  <a href={d.txUrl} rel="noopener">
                    transaction on chain
                  </a>
                </dd>
              </div>
            ) : null}
            {dividend.state === 'anomaly' ? (
              <div className="wide">
                {dividend.hasFeed
                  ? 'A dividend reinvested at the price in force should have moved the multiplier by the implied step. The observed step is too far from it to call this a measurement, so no gap is claimed.'
                  : 'Without a price feed there is nothing to price the step against. The implied price is the only check: a reinvestment that really happened lands near today’s price.'}
              </div>
            ) : null}
          </>
        ) : dividend.state === 'pending' ? (
          <>
            <div>
              <dt>Declared by the issuer for</dt>
              <dd>{dateLong(dividend.processDate)}</dd>
            </div>
            <div>
              <dt>Owed per token</dt>
              <dd>{dividend.owedPerToken ? `$${dividend.owedPerToken}, rate × what a token represents today` : '—'}</dd>
            </div>
            <div className="wide">
              {dividend.issuerCompleted
                ? 'The issuer’s own feed marks this dividend completed, and the multiplier has not moved. Every observed step so far landed one business day after the issuer’s date.'
                : 'No multiplier change has been announced on chain yet. Announcements come about nine minutes before a change; exdate does not predict the date.'}
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Step observed on chain</dt>
              <dd>{pct3(d.observedStepPct)}</dd>
            </div>
            {d.txUrl ? (
              <div>
                <dt>Proof</dt>
                <dd>
                  <a href={d.txUrl} rel="noopener">
                    transaction on chain
                  </a>
                </dd>
              </div>
            ) : null}
            <div className="wide">
              The issuer’s feed keeps about a month of history. This step’s declaration is no longer in
              it, so its declared amount cannot be recovered from any first-party source.
            </div>
          </>
        )}
      </dl>
    </details>
  )
}

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const token = tokenPage(address)
  if (!token) notFound()

  const owed = token.dividends.filter((d) => d.state === 'pending' && !d.upcoming && d.owedPerToken)

  return (
    <>
      <Nav current="tokens" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="token-title">
          <div className="wrap">
            <p className="crumb">
              <a href="/#find">← Find another token</a>
            </p>
            <div className="token-head">
              <div data-reveal>
                <p className="token-kind">Robinhood Stock Token · {token.symbol}</p>
                <h1 id="token-title">{token.name}</h1>
                <Answer token={token} owed={owed} />
                <p className="token-meta">
                  {token.isin ? <span>ISIN {token.isin}</span> : null}
                  {/*
                    Short to the eye, whole to the clipboard: forty characters
                    wrapped over two lines with nothing to press was the worst
                    way to offer the one string every visitor copies (audit
                    2026-09-05, F09).
                  */}
                  <CopyAddress address={token.address} href={token.explorerUrl} />
                </p>
              </div>
              {/* The mechanism, one rung below the answer: what a token represents today. */}
              <div className="stat" data-reveal style={delay(120)}>
                <div className="v">{token.multiplier}</div>
                <div className="k">
                  {token.moved ? `shares per token today, since ${dateLong(token.lastChangedAt)}` : 'share per token, unchanged since launch'}
                </div>
                {token.sinceLaunch ? (
                  <p className="since">
                    {/*
                      "1 dividend reconciled, 2 steps unexplained" read as a
                      fault report to a holder (audit 2026-09-05, F24): neither
                      word is defined anywhere above it. Say what each count is.
                    */}
                    +{token.sinceLaunch.growthPct}% since launch, from {token.steps.length} change{token.steps.length === 1 ? '' : 's'}:{' '}
                    {token.sinceLaunch.reconciled} dividend{token.sinceLaunch.reconciled === 1 ? '' : 's'} matched to what the
                    issuer declared
                    {token.sinceLaunch.unexplained > 0
                      ? `, ${token.sinceLaunch.unexplained} change${token.sinceLaunch.unexplained === 1 ? '' : 's'} with no issuer record`
                      : ''}
                    .
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="block" id="dividends" aria-labelledby="dividends-title">
          <div className="wrap">
            <h2 className="small" id="dividends-title" data-reveal>
              {owed.length > 0
                ? `${owed.length === 1 ? 'One dividend is' : `${owed.length} dividends are`} owed and not yet on chain`
                : 'Dividends'}
            </h2>
            {token.dividends.length > 0 ? (
              <ul className="ledger labelled">
                {token.dividends.map((dividend, index) => {
                  const state = stateOf(dividend)
                  const pending = dividend.state === 'pending'
                  return (
                    <li key={dividend.key} data-reveal style={delay(index * 50)}>
                      <div className="who">
                        <span className="name">{dateLong(dividend.processDate ?? dividend.effectiveAt)}</span>
                        <span className="sym">{dividend.processDate ? 'issuer’s process date' : 'on chain'}</span>
                      </div>
                      <div className="amt">
                        <span className="k">Declared per share</span>
                        <span className="v">{dividend.declared ? `$${dividend.declared}` : '—'}</span>
                      </div>
                      <div className="amt">
                        <span className="k">{pending ? 'Owed per token' : 'Arrived per share'}</span>
                        <span className="v">
                          {pending
                            ? dividend.owedPerToken
                              ? `$${dividend.owedPerToken}`
                              : '—'
                            : dividend.arrived
                              ? `$${dividend.arrived}`
                              : '—'}
                        </span>
                      </div>
                      <div className="gap">
                        <span className={`state${state.on ? ' on' : ''}`}>{state.text}</span>
                      </div>
                      <Detail dividend={dividend} />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="empty">
                No dividend has been declared for this token in the issuer&rsquo;s feed, and its
                multiplier has never moved.
              </p>
            )}
            <p className="note-box">
              <em>Declared</em> is per underlying share, from the issuer&rsquo;s own feed.{' '}
              <em>Owed per token</em> is that rate times what one token represents today, so it needs
              no price. <em>Arrived</em> is what the multiplier step actually delivered, priced at the
              moment it took effect.
            </p>
            {tokensWithCalendar.includes(token.address.toLowerCase()) ? (
              <Subscribe
                icsPath={`/t/${token.address.toLowerCase()}/calendar.ics`}
                site={observed.links.site}
                what={`${token.symbol}’s declared dividends and every change on chain`}
              />
            ) : null}
          </div>
        </section>

        {token.steps.length > 0 ? (
          <section className="block" aria-labelledby="steps-title">
            <div className="wrap">
              <h2 className="small" id="steps-title" data-reveal>
                Multiplier history
              </h2>
              {/* The word is defined where it is first used (audit 2026-09-05, F03). */}
              <p className="lead" data-reveal>
                A <em>step</em> is one change of the multiplier: the moment a dividend is folded into what
                each token represents. Nothing is emitted on chain when it takes effect, so each one was
                read back in the chain&rsquo;s own state.
              </p>
              <LedgerHead cols={['Change', 'Before', 'After', 'Step']} />
              <ul className="ledger">
                {token.steps.map((step, index) => (
                  <li key={step.date} data-reveal style={delay(index * 50)}>
                    <div className="who">
                      <span className="name">{dateLong(step.date)}</span>
                      <span className="sym">
                        announced {step.leadMinutes} min before ·{' '}
                        <a href={step.txUrl} rel="noopener">
                          transaction
                        </a>
                        {/*
                          Nothing is emitted on chain when a change takes effect, so this
                          says the change was read in the chain's own state at that block
                          rather than worked out from the clock.
                        */}
                        {step.confirmedAtBlock === null ? null : <> · confirmed in state at block {step.confirmedAtBlock}</>}
                      </span>
                    </div>
                    <div className="amt">
                      <span className="k">Before</span>
                      <span className="v">{step.from}</span>
                    </div>
                    <div className="amt">
                      <span className="k">After</span>
                      <span className="v">{step.to}</span>
                    </div>
                    <div className="gap">
                      <span className="state on">{stepText(step.stepBps)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="block" aria-labelledby="feed-title">
          <div className="wrap">
            <h2 className="small" id="feed-title" data-reveal>
              Price feed
            </h2>
            <div data-reveal>
              <p className="note-box big">
                {token.feed
                  ? `This token has a Chainlink price feed, paired by ticker${pairingEvidence(token.feed.corroboratedBy)}. The feed is total return: it already includes the multiplier, so never multiply it again. It holds its last price outside market hours, so always check how old a price is before relying on it.`
                  : 'This token has no Chainlink price feed. A lending protocol cannot price it from Chainlink, and exdate can state what is owed but cannot measure a gap.'}
              </p>
              {token.feed ? (
                <p className="feed-params">
                  {token.feed.marketHours ? <span>{token.feed.marketHours}</span> : null}
                  {token.feed.heartbeatHours ? <span>updates at least every {token.feed.heartbeatHours} h</span> : null}
                  {token.feed.deviationPercent != null ? <span>or on a {token.feed.deviationPercent}% move</span> : null}
                  <a href={token.feed.proxyUrl} rel="noopener">
                    {token.feed.proxy}
                  </a>
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <p className="wrap observed-line">
          Observed {dateLong(token.observedAt)} from Robinhood Chain and the issuer&rsquo;s own feed.
          Nothing here is estimated.
        </p>
      </main>
      <Footer />
    </>
  )
}
