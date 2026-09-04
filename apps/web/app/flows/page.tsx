import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Footer, LedgerHead, Nav } from '../components/Chrome'
import { delay } from '../../lib/format'
import { flows } from '../../lib/observed'

/**
 * Creations and redemptions per token. An ETF publishes this daily as net flow; for
 * these tokens nobody does. It is exact on chain - mint is a transfer from the zero
 * address, burn is a transfer to it - and it needs no oracle and no declaration,
 * which makes it the one figure here that cannot be argued with.
 */
export const metadata: Metadata = {
  title: 'Creations and redemptions — exdate',
  description:
    'Net creation per Robinhood Stock Token, read from the chain: how much was minted, how much redeemed, and which way the wrapper is growing.',
}

const amount = (value: string) => {
  const n = Number(value)
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
const signed = (value: string) => (Number(value) > 0 ? `+${amount(value)}` : amount(value))

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso))

type Flows = NonNullable<typeof flows>
type FlowRow = Flows['created'][number]

export default function Page() {
  if (!flows) notFound()
  const side = (rows: FlowRow[], title: string, lead: string, column: string) =>
    rows.length > 0 ? (
      <div className="cal-group">
        <h2 className="small" data-reveal>
          {title}
        </h2>
        <p className="lead" data-reveal>
          {lead}
        </p>
        <LedgerHead cols={['Token', 'Minted', 'Redeemed', column]} />
        <ul className="ledger">
          {rows.slice(0, 20).map((row, index) => (
            <li key={row.token} data-reveal style={delay(Math.min(index, 8) * 50)}>
              <div className="who">
                <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                  {row.name}
                </a>
                <span className="sym">
                  {row.symbol ?? ''} · {row.mints + row.burns} transfer{row.mints + row.burns === 1 ? '' : 's'}
                </span>
              </div>
              <div className="amt">
                <span className="k">Minted</span>
                <span className="v">{amount(row.minted)}</span>
              </div>
              <div className="amt">
                <span className="k">Redeemed</span>
                <span className="v">{amount(row.burned)}</span>
              </div>
              <div className="gap">
                <span className="big">{signed(row.net)}</span>
              </div>
            </li>
          ))}
        </ul>
        {rows.length > 20 ? (
          <p className="note-box" data-reveal>
            The other {rows.length - 20} moved less.
          </p>
        ) : null}
      </div>
    ) : null

  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="flows-title">
          <div className="wrap">
            <div className="token-head">
              <div data-reveal>
                <p className="token-kind">Read from the chain, no oracle involved</p>
                <h1 id="flows-title">Created and redeemed.</h1>
              </div>
              <div className="stat" data-reveal style={delay(120)}>
                <div className="v">{signed(flows.netCreated)}</div>
                <div className="k">
                  tokens created net across {flows.tokensWithFlow} tokens, in the {flows.hours} hours to{' '}
                  {when(flows.to)} UTC
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="block tight" aria-label="What this is">
          <div className="wrap">
            <p className="note-box big" data-reveal>
              A Stock Token is minted when an authorised participant deposits the underlying and
              burned when they redeem it. Minting is a transfer from the zero address, redeeming a
              transfer to it, so the difference is exact: it is the same signal an ETF publishes
              daily as net flow, and it says whether the wrapper is growing. Nobody publishes it for
              these tokens — the issuer&rsquo;s own feed carries gross turnover, with no sign and no
              history.
            </p>
            <p className="note-box" data-reveal>
              {flows.mints} creation{flows.mints === 1 ? '' : 's'} and {flows.burns} redemption
              {flows.burns === 1 ? '' : 's'} in this window, which runs from {when(flows.from)} to{' '}
              {when(flows.to)} UTC.
              {flows.incomplete
                ? ' Part of the range could not be read, so these totals are a floor rather than a count.'
                : ''}
              {flows.precededByGap ? ' The window before this one was never read.' : ''} Amounts are
              tokens; the shares they represent are these times each token&rsquo;s multiplier.
            </p>
          </div>
        </section>

        <section className="block" aria-label="Flow by token">
          <div className="wrap">
            {side(
              flows.created,
              'Created',
              'More was minted than redeemed: new money entered the wrapper.',
              'Net created',
            )}
            {side(
              flows.redeemed,
              'Redeemed',
              'More was redeemed than minted: the wrapper shrank.',
              'Net redeemed',
            )}
            <p className="note-box" data-reveal>
              Windows are contiguous by construction, each reading from the block after the last one
              stopped, so nothing is counted twice and a delayed reading loses nothing. The ledger
              holds {flows.windows} window{flows.windows === 1 ? '' : 's'} so far, covering{' '}
              {flows.ledgerHours} hours.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
