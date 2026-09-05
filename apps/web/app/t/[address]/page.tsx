import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Footer, Nav } from '../../components/Chrome'
import { CopyAddress } from '../../components/CopyAddress'
import { Embed } from '../../components/Embed'
import { Chip, Links, Method, Section, Stats, Table } from '../../components/Ui'
import { tokenBadgeText } from '../../../lib/badge'
import { tokensWithCalendar } from '../../../lib/feeds'
import { dateLong, dateShort, pctInt, usd } from '../../../lib/format'
import { observed, tokenPage } from '../../../lib/observed'

/**
 * One page per token, generated at build from the committed data. It opens
 * on the answer a holder came for, then shows four figures, then one table
 * of dividends. The mechanism (the multiplier's history, the price feed) is
 * a click away, closed.
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
  return { title, description, openGraph: { title, description } }
}

type Token = NonNullable<ReturnType<typeof tokenPage>>
type Dividend = Token['dividends'][number]

/** The answer to "did I get my dividend?", before any mechanism. Each sentence restates one of the ledger's own states. */
function Answer({ token }: { token: Token }) {
  const lines: React.ReactNode[] = []
  const { lead, lastMeasured: measured, lastMoved: moved } = token
  if (lead.kind === 'owed' && lead.count === 1) {
    lines.push(
      <>
        <strong>One dividend is owed and not yet on chain</strong>: declared for {dateLong(lead.processDate)}, ${lead.owedPerToken} per token
        {lead.issuerCompleted ? ', and the issuer already calls it paid' : ''}.
      </>,
    )
  } else if (lead.kind === 'owed') {
    lines.push(
      <>
        <strong>{lead.count} dividends are owed and not yet on chain</strong>, the oldest declared for {dateLong(lead.oldestProcessDate)}
        {lead.anyIssuerCompleted ? '; the issuer already calls some of them paid' : ''}.
      </>,
    )
  } else if (lead.kind === 'next') {
    lines.push(
      <>
        <strong>Next dividend declared for {dateLong(lead.processDate)}</strong>: ${lead.declared} per share. Nothing is owed yet.
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
          Last dividend on chain, {on}: ${measured.declared} declared, {measured.hasFeed ? 'and the step doesn’t add up against its price feed' : 'and no price feed to measure what arrived'}.
        </>
      ),
    )
  }
  if (moved && (!measured || (moved.effectiveAt ?? '') > (measured.effectiveAt ?? ''))) {
    lines.push(
      <>
        The multiplier {measured ? 'moved again' : 'last moved'} on {dateLong(moved.effectiveAt)} with no dividend declared in the issuer&rsquo;s feed.
      </>,
    )
  }
  if (lines.length === 0) lines.push(<>No dividend has been declared for this token, and its multiplier has never moved.</>)
  return (
    <div className="token-answer">
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  )
}

const stateOf = (d: Dividend): { text: string; tone: 'on' | 'warn' | 'off' | 'plain' } => {
  switch (d.state) {
    case 'matched':
      return { text: `${pctInt(d.haircutBps)}% never arrived`, tone: 'on' }
    case 'anomaly':
      return { text: d.hasFeed ? 'doesn’t add up' : 'no price feed', tone: 'off' }
    case 'pending':
      return d.upcoming ? { text: 'upcoming', tone: 'plain' } : d.issuerCompleted ? { text: 'issuer says paid', tone: 'warn' } : { text: 'due', tone: 'warn' }
    default:
      return { text: 'nothing declared', tone: 'off' }
  }
}

const pct3 = (value: number | null) => (value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(3)}%`)
const stepText = (bps: number) => (bps >= 10_000 ? `×${(1 + bps / 10_000).toFixed(0)}` : pct3(bps / 100))

/** How the row was measured. Every value is from the same record. */
function Detail({ d }: { d: Dividend }) {
  const x = d.detail
  if (d.state === 'matched' || d.state === 'anomaly') {
    return (
      <>
        <dl>
          <dt>Price at the step</dt>
          <dd>
            {x.priceAtEffect ? `$${x.priceAtEffect}` : 'no feed'}
            {x.priceAgeAtEffectMinutes != null ? `, ${x.priceAgeAtEffectMinutes} min old` : ''}
            {x.priceSource === 'issuer' ? ', the issuer’s quote' : ''}
          </dd>
          <dt>Step a full payment implies</dt>
          <dd>{pct3(x.expectedStepPct)}</dd>
          <dt>Step observed</dt>
          <dd>{pct3(x.observedStepPct)}</dd>
          <dt>Price the step implies</dt>
          <dd>
            {x.impliedPrice ? `$${x.impliedPrice}` : '—'}
            {x.impliedOverSpot != null && x.spotToday ? ` (${x.impliedOverSpot.toFixed(2)}× today’s $${x.spotToday})` : ''}
          </dd>
          <dt>After the issuer’s date</dt>
          <dd>{x.lagDays != null ? `${x.lagDays} business day${x.lagDays === 1 ? '' : 's'}` : '—'}</dd>
          {x.txUrl ? (
            <>
              <dt>Proof</dt>
              <dd>
                <a href={x.txUrl} rel="noopener">
                  transaction on chain
                </a>
              </dd>
            </>
          ) : null}
        </dl>
        {d.state === 'anomaly' ? (
          <p>
            {d.hasFeed
              ? 'The observed step is too far from what a full payment implies to call this a measurement, so no gap is claimed.'
              : 'Without a price feed there is nothing to price the step against; the implied price is the only check.'}
          </p>
        ) : null}
      </>
    )
  }
  if (d.state === 'pending') {
    return (
      <>
        <dl>
          <dt>Declared for</dt>
          <dd>{dateLong(d.processDate)}</dd>
          <dt>Owed per token</dt>
          <dd>{d.owedPerToken ? `$${d.owedPerToken} = rate × what a token represents today` : '—'}</dd>
        </dl>
        <p>
          {d.issuerCompleted
            ? 'The issuer’s own feed marks this dividend completed and the multiplier has not moved.'
            : 'No multiplier change has been announced on chain yet; announcements come about nine minutes before a change.'}
        </p>
      </>
    )
  }
  return (
    <>
      <dl>
        <dt>Step observed</dt>
        <dd>{pct3(x.observedStepPct)}</dd>
        {x.txUrl ? (
          <>
            <dt>Proof</dt>
            <dd>
              <a href={x.txUrl} rel="noopener">
                transaction on chain
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      <p>The issuer’s feed keeps about a month of history; this step’s declaration is no longer in it, so its amount cannot be recovered.</p>
    </>
  )
}

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const token = tokenPage(address)
  if (!token) notFound()
  const key = token.address.toLowerCase()
  const { lead, lastMeasured } = token

  const owedTile =
    lead.kind === 'owed'
      ? { value: lead.count === 1 ? `$${lead.owedPerToken}` : lead.count, label: lead.count === 1 ? 'owed per token, not on chain' : 'dividends owed, not on chain', note: `declared for ${dateShort(lead.count === 1 ? lead.processDate : lead.oldestProcessDate)}` }
      : lead.kind === 'next'
        ? { value: `$${lead.declared}`, label: 'per share, declared', note: `for ${dateShort(lead.processDate)} · nothing owed yet` }
        : { value: '—', label: 'owed', note: 'nothing declared and unpaid' }
  const lastTile = lastMeasured
    ? lastMeasured.state === 'matched'
      ? { value: `${pctInt(lastMeasured.haircutBps)}%`, label: 'of the last dividend never arrived', note: dateShort(lastMeasured.processDate ?? lastMeasured.effectiveAt) }
      : { value: '—', label: 'last dividend not measurable', note: lastMeasured.hasFeed ? 'doesn’t add up' : 'no price feed' }
    : { value: '—', label: 'no dividend measured yet', note: token.steps.length > 0 ? `${token.steps.length} change${token.steps.length === 1 ? '' : 's'} on chain` : null }

  return (
    <>
      <Nav current="tokens" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="token-title">
          <div className="wrap">
            <p className="crumb">
              <a href="/#find">← Find another token</a>
            </p>
            <p className="token-kind">Robinhood Stock Token · {token.symbol}</p>
            <h1 id="token-title">{token.name}</h1>
            <Answer token={token} />
            <p className="token-meta">
              {token.isin ? <span>ISIN {token.isin}</span> : null}
              <CopyAddress address={token.address} href={token.explorerUrl} />
            </p>
          </div>
        </section>

        <div className="wrap">
          <Stats
            items={[
              { value: token.multiplier, label: 'shares per token today', note: token.moved ? `since ${dateShort(token.lastChangedAt)}` : 'unchanged since launch' },
              owedTile,
              lastTile,
              { value: token.feed ? 'yes' : 'no', label: 'Chainlink price feed', note: token.feed ? `paired by ${token.feed.corroboratedBy.length > 0 ? 'ticker, confirmed by ' + token.feed.corroboratedBy.map((b) => (b === 'multiplier-step' ? 'its step' : 'its price')).join(' and ') : 'ticker only'}` : 'nothing to price a step against' },
            ]}
          />
        </div>

        <Section id="dividends" title="Dividends" tight>
          <Table
            caption={`Every dividend declared for ${token.symbol} and every multiplier change observed, newest first`}
            empty="No dividend declared in the issuer’s feed, and the multiplier has never moved."
            cols={[
              { key: 'when', label: 'Date', primary: true },
              { key: 'declared', label: 'Declared / share', short: 'Declared', align: 'right', numeric: true },
              { key: 'arrived', label: 'Arrived / share', short: 'Arrived', align: 'right', numeric: true },
              { key: 'owed', label: 'Owed / token', short: 'Owed', align: 'right', numeric: true },
              { key: 'state', label: 'State', align: 'right' },
            ]}
            rows={token.dividends.map((d) => {
              const state = stateOf(d)
              return {
                key: d.key,
                cells: {
                  when: (
                    <>
                      <span className="name">{dateShort(d.processDate ?? d.effectiveAt)}</span>
                      <span className="sub">{d.processDate ? 'issuer’s date' : 'on chain'}</span>
                    </>
                  ),
                  declared: usd(d.declared),
                  arrived: d.state === 'pending' ? '—' : usd(d.arrived),
                  owed: d.state === 'pending' ? usd(d.owedPerToken) : '—',
                  state: <Chip tone={state.tone}>{state.text}</Chip>,
                },
                detail: <Detail d={d} />,
              }
            })}
          />
          <Links>
            {tokensWithCalendar.includes(key) ? <a href={`/t/${key}/calendar.ics`}>Calendar (.ics)</a> : null}
            <a href="/feed.xml">RSS</a>
            <a href={`/badge/${key}.svg`}>Badge</a>
            <a href={token.explorerUrl} rel="noopener">
              Explorer
            </a>
          </Links>
        </Section>

        <div className="wrap stack">
          {token.steps.length > 0 ? (
            <Method title={`Multiplier changes (${token.steps.length})`}>
              <p>A change is one step of the multiplier: the moment a dividend is folded into what each token represents. Nothing is emitted on chain when it takes effect, so each one was read back in the chain&rsquo;s own state.</p>
              <Table
                caption="Multiplier changes, newest first"
                cols={[
                  { key: 'date', label: 'Date', primary: true },
                  { key: 'before', label: 'Before', align: 'right', numeric: true },
                  { key: 'after', label: 'After', align: 'right', numeric: true },
                  { key: 'step', label: 'Step', align: 'right', numeric: true },
                ]}
                rows={token.steps.map((step) => ({
                  key: step.date,
                  cells: {
                    date: (
                      <>
                        <span className="name">{dateShort(step.date)}</span>
                        <span className="sub">
                          announced {step.leadMinutes} min before ·{' '}
                          <a href={step.txUrl} rel="noopener">
                            tx
                          </a>
                          {step.confirmedAtBlock === null ? '' : ' · confirmed in state'}
                        </span>
                      </>
                    ),
                    before: step.from,
                    after: step.to,
                    step: stepText(step.stepBps),
                  },
                }))}
              />
            </Method>
          ) : null}
          <Method title="Price feed">
            {token.feed ? (
              <>
                <p>
                  A Chainlink feed, paired by ticker
                  {token.feed.corroboratedBy.includes('multiplier-step') && token.feed.corroboratedBy.includes('traded-price')
                    ? ' and confirmed twice over: by this token’s own dividend step moving it, and by the price the token trades at'
                    : token.feed.corroboratedBy.includes('multiplier-step')
                      ? ' and confirmed by this token’s own dividend step moving it'
                      : token.feed.corroboratedBy.includes('traded-price')
                        ? ' and confirmed by the price the token trades at'
                        : ''}
                  . The feed is total return: it already includes the multiplier, so never multiply it again. Off-hours it holds its last price.
                </p>
                <dl>
                  {token.feed.marketHours ? (
                    <>
                      <dt>Hours</dt>
                      <dd>{token.feed.marketHours}</dd>
                    </>
                  ) : null}
                  {token.feed.heartbeatHours ? (
                    <>
                      <dt>Updates</dt>
                      <dd>
                        at least every {token.feed.heartbeatHours} h{token.feed.deviationPercent != null ? `, or on a ${token.feed.deviationPercent}% move` : ''}
                      </dd>
                    </>
                  ) : null}
                  <dt>Proxy</dt>
                  <dd>
                    <a href={token.feed.proxyUrl} rel="noopener">
                      {token.feed.proxy}
                    </a>
                  </dd>
                </dl>
              </>
            ) : (
              <p>No Chainlink price feed. A lending protocol cannot price this token from Chainlink, and exdate can state what is owed but not measure a gap.</p>
            )}
          </Method>
          <Embed site={observed.links.site} address={key} name={token.name} alt={tokenBadgeText(token.address)?.title ?? `${token.name} on exdate`} />
          <p className="observed-line">Observed {dateLong(token.observedAt)} from Robinhood Chain and the issuer&rsquo;s own feed. Nothing here is estimated.</p>
        </div>
      </main>
      <Footer />
    </>
  )
}
