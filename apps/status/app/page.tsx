import { ApiUnreachable, API_URL, getCalendar, getTokens, type TokenView } from '../lib/api'
import { age, bps, multiplier, price, shortAddress, utc } from './format'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function FeedCell({ token }: { token: TokenView }) {
  if (!token.feed) {
    return (
      <>
        <span className="pill none">no feed</span>
      </>
    )
  }
  return (
    <>
      <span className={`pill ${token.feed.status}`}>{token.feed.status}</span>
      {token.feed.verified ? null : <span className="addr"> derived</span>}
    </>
  )
}

export default async function Page() {
  let data: Awaited<ReturnType<typeof getTokens>>
  let calendar: Awaited<ReturnType<typeof getCalendar>> | null = null
  try {
    data = await getTokens()
    calendar = await getCalendar().catch(() => null)
  } catch (error) {
    if (!(error instanceof ApiUnreachable)) throw error
    return (
      <main className="wrap">
        <header className="masthead">
          <h1>exdate</h1>
          <p>The corporate-action layer for tokenized stocks.</p>
        </header>
        <div className="banner">
          <h3>No data</h3>
          <p>
            The exdate API at <code>{API_URL}</code> did not answer, so this page has nothing to show.
            It will not display a number it cannot trace to an on-chain event.
          </p>
          <p>
            Start the indexer with <code>pnpm dev</code>, or point <code>EXDATE_API_URL</code> at a
            running instance.
          </p>
          <p className="addr">{(error as Error).message}</p>
        </div>
      </main>
    )
  }

  const tokens = data.tokens
  const polled = tokens.filter((token) => token.state === 'indexed')
  const moved = polled.filter((token) => token.multiplier.currentDecimal !== '1')
  const withFeed = tokens.filter((token) => token.feed !== null)
  const tally = (status: string) => withFeed.filter((token) => token.feed?.status === status).length
  const scheduled = polled.filter((token) => token.multiplier.scheduled !== null)
  const upcoming = calendar?.chains.flatMap((chain) => chain.upcomingCorporateActions) ?? []
  const observedAt = polled
    .map((token) => token.multiplier.sampledAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)

  return (
    <main className="wrap">
      <header className="masthead">
        <h1>exdate</h1>
        <p>
          Robinhood Stock Tokens do not pay cash dividends on chain. They raise an ERC-8056
          multiplier, so a raw balance stays put while the underlying shares it represents grow.
          Every number below is read from Robinhood Chain or from the issuer&rsquo;s own API.
        </p>
        <p className="observed">
          chain 4663 · {data.count} tokens · last poll {observedAt ? utc(observedAt) : 'pending'}
        </p>
      </header>

      {polled.length === 0 ? (
        <div className="banner">
          <h3>Indexer has not polled yet</h3>
          <p>
            The registry lists {data.count} tokens, but the poller has not read the ERC-8056 views
            yet, so there is nothing observed to show. This page stays empty rather than guessing.
          </p>
        </div>
      ) : null}

      <section className="cards">
        <div className="card">
          <div className="value">{data.count}</div>
          <div className="label">Stock Tokens</div>
          <div className="note">{polled.length} polled</div>
        </div>
        <div className="card">
          <div className="value">{moved.length}</div>
          <div className="label">multiplier above 1.0</div>
          <div className="note">a corporate action has landed</div>
        </div>
        <div className="card">
          <div className="value">{withFeed.length}</div>
          <div className="label">with a Chainlink feed</div>
          <div className="note">{tokens.length - withFeed.length} have none at all</div>
        </div>
        <div className="card">
          <div className="value">
            {tally('live')} <span className="dash">/</span> {tally('stale') + tally('paused')}
          </div>
          <div className="label">feeds live / stale or paused</div>
          <div className="note">24/5, 86 400 s heartbeat</div>
        </div>
        <div className="card">
          <div className="value">{scheduled.length}</div>
          <div className="label">updates pending now</div>
          <div className="note">announced ~9 min ahead</div>
        </div>
      </section>

      {scheduled.length > 0 ? (
        <>
          <h2>
            Pending multiplier updates
            <span className="sub">announced on chain, not yet in effect</span>
          </h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Current</th>
                  <th>Scheduled</th>
                  <th>Effective at</th>
                  <th>In</th>
                </tr>
              </thead>
              <tbody>
                {scheduled.map((token) => (
                  <tr key={token.address}>
                    <td>
                      <span className="sym">{token.symbol}</span>
                    </td>
                    <td className="num">{multiplier(token.multiplier.currentDecimal)}</td>
                    <td className="num up">{multiplier(token.multiplier.scheduled!.valueDecimal)}</td>
                    <td className="num">{utc(token.multiplier.scheduled!.effectiveAt)}</td>
                    <td className="num">{age(token.multiplier.scheduled!.secondsRemaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2>
        Tokens that have moved
        <span className="sub">
          {moved.length} of {data.count} — every other multiplier still reads exactly 1.0
        </span>
      </h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Multiplier</th>
              <th>Last step</th>
              <th>Applied</th>
              <th>Events</th>
              <th>Feed</th>
              <th>Price (USD)</th>
              <th>Feed age</th>
            </tr>
          </thead>
          <tbody>
            {moved.map((token) => (
              <tr key={token.address}>
                <td>
                  <div className="sym">{token.symbol}</div>
                  <a className="addr" href={token.explorerUrl} target="_blank" rel="noreferrer">
                    {shortAddress(token.address)}
                  </a>
                </td>
                <td className="num">{multiplier(token.multiplier.currentDecimal)}</td>
                <td className="num">{bps(token.events.last?.stepBps)}</td>
                <td className="num">{utc(token.multiplier.lastChangeEffectiveAt)}</td>
                <td className="num">
                  {token.events.count}
                  {token.events.last && token.events.last.announcementCount! > 1 ? (
                    <span className="addr"> ({token.events.last.announcementCount} announcements)</span>
                  ) : null}
                </td>
                <td>
                  <FeedCell token={token} />
                </td>
                <td className="num">{price(token.feed?.price ?? null)}</td>
                <td className="num">{age(token.feed?.ageSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {upcoming.length > 0 ? (
        <>
          <h2>
            Declared, not yet on chain
            <span className="sub">
              from the issuer&rsquo;s /rhj/corporate-actions — the on-chain step lands a business day
              after processDate
            </span>
          </h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Process date</th>
                  <th>Token</th>
                  <th>Type</th>
                  <th>Gross rate (USD/share)</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.slice(0, 40).map((action) => (
                  <tr key={action.id}>
                    <td className="num">{action.processDate ?? '—'}</td>
                    <td className="sym">{action.symbol}</td>
                    <td>{action.type.replace('CORPORATE_ACTION_TYPE_', '').toLowerCase().replace('_', ' ')}</td>
                    <td className="num">{action.rate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2>
        Every feed
        <span className="sub">
          {withFeed.length} of {data.count} tokens have one; token → feed pairing is ticker-derived
          and unverified
        </span>
      </h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Status</th>
              <th>Price (USD)</th>
              <th>Updated at</th>
              <th>Age</th>
              <th>Past heartbeat</th>
              <th>Oracle paused</th>
            </tr>
          </thead>
          <tbody>
            {withFeed.map((token) => (
              <tr key={token.address}>
                <td>
                  <span className="sym">{token.symbol}</span>{' '}
                  <span className="name">{token.name.replace(' • Robinhood Token', '')}</span>
                </td>
                <td>
                  <FeedCell token={token} />
                </td>
                <td className="num">{price(token.feed?.price ?? null)}</td>
                <td className="num">{utc(token.feed?.updatedAt ?? null)}</td>
                <td className="num">{age(token.feed?.ageSeconds)}</td>
                <td className="num">{token.feed?.beyondHeartbeat ? 'yes' : 'no'}</td>
                <td className="num">{token.feed?.oraclePaused === null ? '—' : token.feed?.oraclePaused ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer>
        <p>
          Chainlink prices for these tokens are total return: the feed answer already includes the
          multiplier. Multiplying one by the other double-counts every dividend ever paid.
        </p>
        <p>
          Feed pairings are derived from the feed&rsquo;s display name because no on-chain link from a
          token to its aggregator exists. They are marked <em>derived</em> until an issuer or
          Chainlink statement confirms them.
        </p>
        <p>
          Fees and withholding applied to on-chain distributions are undocumented by the issuer.
          Anything exdate reports about them is observed, never official.
        </p>
      </footer>
    </main>
  )
}
