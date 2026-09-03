import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Footer, Nav } from '../../components/Chrome'
import { dateLong, delay, pctInt } from '../../../lib/format'
import { observed, tokenPage } from '../../../lib/observed'

/**
 * One page per token, all 194 generated at build time from the committed
 * data. This is what a holder actually comes for: what their token represents
 * today, what was declared, what arrived, what is still owed, and whether a
 * price feed exists for it at all.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return observed.tokens.map((token) => ({ address: token.address.toLowerCase() }))
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params
  const token = tokenPage(address)
  if (!token) return { title: 'exdate' }
  return {
    title: `${token.name} (${token.symbol}) — exdate`,
    description: `What the ${token.symbol} Robinhood Stock Token represents today, every dividend declared for it, what arrived on chain, and what is still owed.`,
  }
}

type Dividend = NonNullable<ReturnType<typeof tokenPage>>['dividends'][number]

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

const stepText = (bps: number) => (bps >= 10_000 ? `×${(1 + bps / 10_000).toFixed(0)}` : `+${(bps / 100).toFixed(3)}%`)

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const token = tokenPage(address)
  if (!token) notFound()

  const owed = token.dividends.filter((d) => d.state === 'pending' && !d.upcoming && d.owedPerToken)

  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="token-title">
          <div className="wrap">
            <p className="crumb">
              <a href="/#find">← Find another token</a>
            </p>
            <div className="token-head">
              <div data-reveal>
                <p className="token-kind">Robinhood Stock Token</p>
                <h1 id="token-title">{token.name}</h1>
                <p className="token-meta">
                  <span>{token.symbol}</span>
                  {token.isin ? <span>ISIN {token.isin}</span> : null}
                  <a href={token.explorerUrl} rel="noopener">
                    {token.address}
                  </a>
                </p>
              </div>
              <div className="stat" data-reveal style={delay(120)}>
                <div className="v">{token.multiplier}</div>
                <div className="k">
                  {token.moved
                    ? `shares per token, since ${dateLong(token.lastChangedAt)}`
                    : 'share per token, unchanged since launch'}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="block" aria-labelledby="dividends-title">
          <div className="wrap">
            <h2 className="small" id="dividends-title" data-reveal>
              {owed.length > 0
                ? `${owed.length === 1 ? 'One dividend is' : `${owed.length} dividends are`} owed and not yet on chain`
                : 'Dividends'}
            </h2>
            {token.dividends.length > 0 ? (
              <ul className="ledger">
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
          </div>
        </section>

        {token.steps.length > 0 ? (
          <section className="block" aria-labelledby="steps-title">
            <div className="wrap">
              <h2 className="small" id="steps-title" data-reveal>
                Multiplier history
              </h2>
              <ul className="ledger">
                {token.steps.map((step, index) => (
                  <li key={step.date} data-reveal style={delay(index * 50)}>
                    <div className="who">
                      <span className="name">{dateLong(step.date)}</span>
                      <span className="sym">took effect on chain</span>
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
            <p className="note-box big" data-reveal>
              {token.feed
                ? `This token has a Chainlink price feed, paired by ticker${
                    token.feed.corroborated ? ' and corroborated by its own dividend step' : ''
                  }. The feed is total return: it already includes the multiplier, so never multiply it again.`
                : 'This token has no Chainlink price feed. A lending protocol cannot price it from Chainlink, and exdate can state what is owed but cannot measure a gap.'}
            </p>
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
