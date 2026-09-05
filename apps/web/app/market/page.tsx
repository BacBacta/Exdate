import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { GapControls } from '../components/GapControls'
import { Chip, Links, Method, Section, Stats, Table } from '../components/Ui'
import { dateShort, tokenCount } from '../../lib/format'
import { flows, gap } from '../../lib/observed'

/**
 * What a lending-market curator needs and nobody publishes: how far each
 * token trades from the oracle a market liquidates against, how stale that
 * oracle is, whether the pairing can be trusted; and, below, what is being
 * created and redeemed. One page where there were two.
 */
export const metadata: Metadata = {
  title: 'Market — exdate',
  description: 'How far each Robinhood Stock Token trades from its Chainlink price and how old that price is, and what is created and redeemed on chain.',
}

const bps = (value: number) => {
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded === 0 ? '0' : rounded}`
}
const age = (seconds: number | null) => {
  if (seconds === null) return '—'
  if (seconds < 90) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes - h * 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
const money = (value: string | undefined) => (value === undefined ? '—' : `$${Math.round(Number(value)).toLocaleString('en-US')}`)
const when = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso))
const PAIRING = {
  'step+price': { text: 'step + price', tone: 'on' as const },
  step: { text: 'step', tone: 'on' as const },
  price: { text: 'price', tone: 'plain' as const },
  ticker: { text: 'ticker only', tone: 'off' as const },
}
const amount = (value: string) => {
  const n = Number(value)
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
const widest = [...gap.measured].sort((a, b) => Math.abs(b.deviationBps!) - Math.abs(a.deviationBps!))[0]

export default function Page() {
  return (
    <>
      <Nav current="market" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="market-title">
          <div className="wrap">
            <p className="token-kind">Read from Robinhood Chain on {when(gap.observedAt)} UTC, during {gap.sessionLabel}</p>
            <h1 id="market-title">Market.</h1>
          </div>
        </section>

        <div className="wrap">
          <Stats
            items={[
              { value: gap.medianAbsDeviationBps === null ? '—' : `${gap.medianAbsDeviationBps.toFixed(0)} bps`, label: 'median gap, traded vs oracle', note: `${gap.withFeed} tokens`, href: '#gap' },
              { value: gap.maxAbsDeviationBps === null ? '—' : `${gap.maxAbsDeviationBps.toFixed(0)} bps`, label: 'widest gap', note: widest ? `${widest.symbol} · pool ${money(widest.poolValueUsd)}` : null, href: '#gap' },
              { value: age(gap.medianFeedAgeSeconds), label: 'median oracle age', note: `${gap.feedsBeyondHeartbeat} past the 24 h heartbeat`, href: '#gap' },
              { value: gap.unpriced.length, label: 'tokens trade with no oracle', note: `of ${gap.tokensQuotable} with a liquid pool`, href: '#method' },
            ]}
          />
        </div>

        <Section id="gap" title="Traded vs oracle" tight line="Positive: the token trades above the oracle. Both quote the token itself, which already includes the multiplier.">
          <GapControls listId="gap-table" total={gap.measured.length} />
          <Table
            id="gap-table"
            caption="Every token with a liquid pool and a Chainlink feed: traded price, oracle price, gap, oracle age, pool depth, what backs the pairing"
            cols={[
              { key: 'token', label: 'Token', primary: true },
              { key: 'traded', label: 'Traded', align: 'right', numeric: true },
              { key: 'oracle', label: 'Oracle', align: 'right', numeric: true },
              { key: 'gap', label: 'Gap, bps', short: 'Gap, bps', align: 'right', numeric: true },
              { key: 'age', label: 'Oracle age', short: 'Age', align: 'right', numeric: true },
              { key: 'pool', label: 'Pool', align: 'right', numeric: true },
              { key: 'pairing', label: 'Pairing', align: 'right' },
            ]}
            rows={gap.measured.map((row) => ({
              key: row.token,
              data: { token: row.token.toLowerCase(), name: `${row.name} ${row.symbol}`.toLowerCase(), gap: Math.abs(row.deviationBps!), age: row.feedAgeSeconds ?? -1, pool: row.poolValueUsd ?? 0 },
              cells: {
                token: (
                  <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                    {row.name} <span className="sym">{row.symbol}</span>
                  </a>
                ),
                traded: `$${row.tradedPrice}`,
                oracle: `$${row.feedPrice}`,
                gap: <span className="big">{bps(row.deviationBps!)}</span>,
                age: age(row.feedAgeSeconds),
                pool: money(row.poolValueUsd),
                pairing: <Chip tone={PAIRING[row.pairing].tone}>{PAIRING[row.pairing].text}</Chip>,
              },
            }))}
          />
        </Section>

        <Section id="sessions" title="By session" tight line={gap.sessionsComparable ? 'Median gap per market session, over every reading so far.' : `Compared once every session has ${gap.minimumSamples} readings; ${gap.samples} so far.`}>
          {gap.sessionsComparable ? (
            <Table
              caption="Median gap by market session"
              cols={[
                { key: 'session', label: 'Session', primary: true },
                { key: 'samples', label: 'Readings', align: 'right', numeric: true },
                { key: 'gap', label: 'Median gap', align: 'right', numeric: true },
              ]}
              rows={gap.sessions.map((s) => ({
                key: s.key,
                cells: { session: <span className="name">{s.label}</span>, samples: s.samples, gap: s.medianAbsDeviationBps === null ? '—' : `${s.medianAbsDeviationBps.toFixed(0)} bps` },
              }))}
            />
          ) : (
            <Table
              caption="Readings per market session so far"
              cols={[
                { key: 'session', label: 'Session', primary: true },
                { key: 'samples', label: 'Readings', align: 'right', numeric: true },
              ]}
              rows={gap.sessions.map((s) => ({ key: s.key, cells: { session: <span className="name">{s.label}</span>, samples: s.samples } }))}
            />
          )}
        </Section>

        {flows ? (
          <Section id="creation" title="Net creation" tight line="Minted minus redeemed, from the chain: the signal an ETF publishes as net flow.">
            <Stats
              items={[
                { value: tokenCount(flows.netCreated, true), label: 'tokens created net', note: `${Math.round(flows.hours)} h to ${dateShort(flows.to)}${flows.incomplete ? ' · part unread' : ''}`, lead: true },
                { value: flows.mints, label: 'creations', note: `${flows.tokensWithFlow} tokens moved` },
                { value: flows.burns, label: 'redemptions', note: flows.precededByGap ? 'the window before was not read' : 'contiguous with the last window' },
              ]}
            />
            <div className="two-col">
              <Table
                caption="Most created, net"
                cols={[
                  { key: 'token', label: 'Created', primary: true },
                  { key: 'net', label: 'Net', align: 'right', numeric: true },
                ]}
                rows={flows.created.slice(0, 8).map((row) => ({
                  key: row.token,
                  cells: {
                    token: (
                      <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                        {row.name} <span className="sym">{row.symbol ?? ''}</span>
                      </a>
                    ),
                    net: `+${amount(row.net)}`,
                  },
                }))}
              />
              <Table
                caption="Most redeemed, net"
                cols={[
                  { key: 'token', label: 'Redeemed', primary: true },
                  { key: 'net', label: 'Net', align: 'right', numeric: true },
                ]}
                rows={flows.redeemed.slice(0, 8).map((row) => ({
                  key: row.token,
                  cells: {
                    token: (
                      <a className="name" href={`/t/${row.token.toLowerCase()}/`}>
                        {row.name} <span className="sym">{row.symbol ?? ''}</span>
                      </a>
                    ),
                    net: amount(row.net),
                  },
                }))}
              />
            </div>
            <Links>
              <a href="/data/primary-flows.observed.json">Every window, as data</a>
            </Links>
          </Section>
        ) : null}

        <div className="wrap stack" id="method">
          <Method>
            <p>
              A lending market liquidates against the Chainlink price. That feed runs 24/5 and holds its last answer outside market hours; the chain never stops trading. The distance between the two is the risk a curator carries, and it is widest when the feed is stalest.
            </p>
            <p>
              The traded price is the deepest USDG pool&rsquo;s, and every pool and every feed is read at the same instant, or the figure would measure the delay between two reads. A pool&rsquo;s balance is shown because a wide gap on a few hundred dollars is a price nobody can trade at.
            </p>
            <p>
              <em>Pairing</em> says what backs the token-to-feed match, which no first-party source states: <em>step</em>, the token&rsquo;s own dividend step was seen moving this feed; <em>price</em>, its traded price sits closer to this feed than to any other over at least three readings; <em>ticker only</em>, nothing beyond the name. {gap.pairing.byPrice} of {gap.pairing.total} pairings hold up by price and {gap.pairing.byStep} by step; the {gap.pairing.neither.length} that fail ({gap.pairing.neither.slice(0, 5).join(', ')}
              {gap.pairing.neither.length > 5 ? '…' : ''}) are mostly volatile names whose traded price is genuinely far from any feed.
            </p>
            <p>
              {gap.unpriced.length} tokens have a liquid pool and no feed at all: {gap.unpriced.map((row) => row.symbol).join(', ')}. A market has nothing to liquidate them against.
            </p>
            <p>
              Net creation: a mint is a transfer from the zero address, a burn a transfer to it. Windows are contiguous by construction; a range the node could not read is listed and the window marked incomplete rather than published as zero. Amounts are tokens; shares are these times each token&rsquo;s multiplier.
            </p>
          </Method>
        </div>
      </main>
      <Footer />
    </>
  )
}
