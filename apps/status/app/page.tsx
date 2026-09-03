import {
  ApiUnreachable,
  API_URL,
  getCalendar,
  getPending,
  getReconciliations,
  getTokens,
  getYield,
  type PendingView,
  type ReconciliationView,
  type TokenView,
  type YieldLedgerView,
} from '../lib/api'
import { age, bps, daysSince, multiplier, price, shortAddress, utc } from './format'

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
      {token.feed.verified ? null : (
        <span className="addr" title={
          token.feed.corroborated
            ? "the token's own multiplier step was seen moving this feed by the step's own size, and no other mapped feed moved closer"
            : 'paired by ticker; no first-party statement links this token to this feed'
        }>
          {' '}
          {token.feed.corroborated ? 'corroborated' : 'derived'}
        </span>
      )}
    </>
  )
}

export default async function Page() {
  let data: Awaited<ReturnType<typeof getTokens>>
  let calendar: Awaited<ReturnType<typeof getCalendar>> | null = null
  let recon: Awaited<ReturnType<typeof getReconciliations>> | null = null
  try {
    data = await getTokens()
    // The page must still render when a secondary endpoint is unavailable; the
    // sections it feeds simply do not appear.
    ;[calendar, recon] = await Promise.all([
      getCalendar().catch(() => null),
      getReconciliations().catch(() => null),
    ])
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
  const reconciled = (recon?.reconciliations ?? []).filter(
    (row) => row.status === 'matched' || row.status === 'anomaly',
  )
  /**
   * One ledger per token that has actually moved - a dozen requests today, not
   * 194, because a token whose multiplier still reads 1.0 has nothing to show.
   * A ledger that fails to load drops out of the table rather than taking the
   * page down with it.
   */
  const ledgers = (
    await Promise.all(moved.map((token) => getYield(token.address).catch(() => null)))
  ).filter((ledger): ledger is YieldLedgerView => ledger !== null)

  /**
   * `/pending` is per token, and only a token with an unmatched declared action
   * or a change already announced on chain can have anything pending - so the
   * candidates come from the two sources that know, not from all 194 tokens.
   * A request that fails drops its row rather than taking the page down.
   */
  const pendingCandidates = [
    ...new Set([
      ...(recon?.reconciliations ?? [])
        .filter((row) => row.status === 'pending' && row.token !== null)
        .map((row) => row.token as string),
      ...scheduled.map((token) => token.address),
    ]),
  ]
  const pending = (
    await Promise.all(pendingCandidates.map((address) => getPending(address).catch(() => null)))
  ).filter((view): view is PendingView => view !== null && !view.summary.nothingPending)

  /** One row per outstanding item, newest process date last, as the ledger reads. */
  const owedRows = pending
    .flatMap((view) => view.declared.map((row) => ({ view, row })))
    .sort((a, b) => (a.row.processDate ?? '').localeCompare(b.row.processDate ?? ''))
  /** Owed now, as opposed to merely on the issuer's calendar. */
  const owedNow = owedRows.filter(({ row }) => row.state !== 'upcoming')
  const longestOverdueDays = pending
    .map((view) => view.summary.longestOverdueDays)
    .filter((days): days is number => days !== null)
    .sort((a, b) => b - a)[0]

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
        {recon ? (
          <div className="card">
            <div className="value">
              {recon.counts.matched} <span className="dash">/</span> {recon.counts.anomaly}
            </div>
            <div className="label">reconciled / anomalous</div>
            <div className="note">{owedNow.length} declared, still not on chain</div>
          </div>
        ) : null}
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

      {reconciled.length > 0 ? (
        <>
          <h2>
            Observed haircut
            <span className="sub">
              what the issuer declared, against what the multiplier actually delivered
            </span>
          </h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Process date</th>
                  <th>Gross / share</th>
                  <th>Observed step</th>
                  <th>Price at effect</th>
                  <th>Received / share</th>
                  <th>Haircut</th>
                  <th>Implied price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reconciled.map((row) => (
                  <tr key={row.id}>
                    <td className="sym">{row.symbol}</td>
                    <td className="num">{row.declared?.processDate ?? '—'}</td>
                    <td className="num">{row.declared?.grossPerShare ?? '—'}</td>
                    <td className="num">{bps(row.observed?.stepBps)}</td>
                    <td className="num">{price(row.price?.value ?? null)}</td>
                    <td className="num">
                      {row.result.receivedPerShare === null
                        ? '—'
                        : Number(row.result.receivedPerShare).toFixed(4)}
                    </td>
                    <td className="num">
                      {row.result.impliedHaircutBps === null ? (
                        <span className="dash">—</span>
                      ) : (
                        `${(row.result.impliedHaircutBps / 100).toFixed(1)}%`
                      )}
                    </td>
                    <td className="num">
                      {row.result.impliedReinvestPrice === null
                        ? '—'
                        : Number(row.result.impliedReinvestPrice).toLocaleString('en-US', {
                            maximumFractionDigits: 2,
                          })}
                    </td>
                    <td>
                      <span className={`pill ${row.status === 'matched' ? 'live' : 'stale'}`}>{row.status}</span>{' '}
                      <span className="addr">{row.confidence}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            A dividend of <em>gross</em> per share, reinvested at <em>price</em>, would raise the
            multiplier by gross ÷ price. The gap between that and the observed step is the haircut.
            Where a token has no Chainlink feed there is no price to reconcile against, so the row
            reports the price its step <em>implies</em> instead — compare it to spot: a reinvestment
            that really happened lands near it. Every row is <code>confidence: low</code>, because
            the token → feed pairing is still a ticker heuristic and no token has three events yet.
          </p>
        </>
      ) : null}

      {owedRows.length > 0 ? (
        <>
          <h2>
            What is owed and has not arrived
            <span className="sub">
              declared by the issuer, no matching multiplier step on chain — from{' '}
              <code>/v1/:chain/tokens/:addr/pending</code>
            </span>
          </h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Process date</th>
                  <th>State</th>
                  <th>Days</th>
                  <th>Gross / share</th>
                  <th>Owed / token</th>
                  <th>Step if paid in full</th>
                  <th>Haircut measured here</th>
                </tr>
              </thead>
              <tbody>
                {owedRows.map(({ view, row }) => (
                  <tr key={`${view.token.address}:${row.key}`}>
                    <td className="sym">{view.token.symbol}</td>
                    <td className="num">{row.processDate ?? '—'}</td>
                    <td>
                      <span
                        className={`pill ${
                          row.state === 'upcoming'
                            ? 'live'
                            : row.state === 'awaiting'
                              ? 'unknown'
                              : row.state === 'overdue'
                                ? 'stale'
                                : 'paused'
                        }`}
                        title={row.note}
                      >
                        {row.state === 'declared_complete_not_on_chain'
                          ? 'completed, no step'
                          : row.state}
                      </span>
                    </td>
                    <td className="num">
                      {row.daysSinceProcessDate === null ? (
                        '—'
                      ) : row.state === 'upcoming' ? (
                        <span className="addr">in {-row.daysSinceProcessDate}</span>
                      ) : (
                        <>
                          {row.daysSinceProcessDate}
                          {row.state === 'awaiting' ? (
                            <span className="addr"> / {row.windowDays}</span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="num">{row.grossPerUnderlyingShare ?? '—'}</td>
                    <td className="num">
                      {row.grossPerToken === null
                        ? '—'
                        : Number(row.grossPerToken).toLocaleString('en-US', {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 6,
                          })}
                    </td>
                    <td className="num">
                      {row.projection === null ? (
                        <span className="dash">—</span>
                      ) : (
                        <span title="a projection at today's price, gross of every haircut ever measured — not a forecast of the step">
                          {bps(row.projection.stepBpsIfPaidInFull)}*
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {view.history.lastObservedHaircutBps === null ? (
                        <span className="dash">—</span>
                      ) : (
                        <>
                          {(view.history.lastObservedHaircutBps / 100).toFixed(1)}%
                          <span className="addr"> ({view.history.reconciledDividends})</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            Four states, kept apart because they carry different certainty.{' '}
            <em>upcoming</em> has a process date that has not arrived, so nothing is owed yet;{' '}
            <em>awaiting</em> is inside the observed next-business-day window and is not yet late;{' '}
            <em>overdue</em> is past it; <em>completed, no step</em> is the sharpest claim of the
            four — the issuer&rsquo;s own feed marks the action processed while the multiplier
            still reads what it read before.{' '}
            <strong>Owed / token</strong> is the one figure here that needs no oracle: the declared
            rate is per underlying share, one raw token carries <code>uiMultiplier</code> of them,
            and both numbers are known. The starred column is a projection at today&rsquo;s price
            and gross of the withholding every reconciled distribution has taken — it says what a
            payment in full would produce, not what will arrive. When the step will land, and how
            much of it survives, are refused outright: the endpoint lists them under{' '}
            <code>notComputed</code> with a reason code.
          </p>
          <p className="caption">
            {owedRows.length} {owedRows.length === 1 ? 'action' : 'actions'} across{' '}
            {pending.length} {pending.length === 1 ? 'token' : 'tokens'}, {owedNow.length} of them
            already due.{' '}
            {longestOverdueDays === undefined
              ? 'None is past the window yet.'
              : `The longest has been overdue ${longestOverdueDays} days.`}
          </p>
        </>
      ) : null}

      {ledgers.length > 0 ? (
        <>
          <h2>
            Distribution ledgers
            <span className="sub">
              growth in underlying shares per share held, split into what a declared dividend
              explains and what nothing does
            </span>
          </h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Steps</th>
                  <th>Growth</th>
                  <th>Dividends</th>
                  <th>Unexplained</th>
                  <th>Owed, not landed</th>
                  <th>Closes</th>
                </tr>
              </thead>
              <tbody>
                {ledgers.map((ledger) => (
                  <tr key={ledger.token.address}>
                    <td className="sym">{ledger.token.symbol}</td>
                    <td className="num">{ledger.totals?.distributionsObserved ?? '—'}</td>
                    <td className="num">{bps(ledger.totals?.underlyingSharesGrowthBps ?? null)}</td>
                    <td className="num">
                      {ledger.totals ? (
                        <>
                          {bps(ledger.totals.dividendGrowthBps)}
                          <span className="addr"> ({ledger.totals.dividendEvents})</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">
                      {ledger.totals ? (
                        <>
                          {bps(ledger.totals.unexplainedGrowthBps)}
                          <span className="addr"> ({ledger.totals.unexplainedEvents})</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{ledger.totals?.declaredNotLanded ?? '—'}</td>
                    <td>
                      {ledger.coverage.closes === true ? (
                        <span className="pill live">yes</span>
                      ) : (
                        <span className="pill none" title={ledger.coverage.closesBasis}>
                          no
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            A step counts as a dividend only where an issuer cash dividend is paired to it
            <em> and the two reconcile</em> — a split produces the same arithmetic with no economic
            gain, and a paired dividend whose numbers do not add up is an anomaly, so neither is
            called yield. &ldquo;Unexplained&rdquo; is therefore those two plus the
            issuer&rsquo;s own history: its corporate-action feed goes back about a month, so
            earlier steps have no declared row to match at all. Totals
            appear only when the ledger closes against the multiplier read at the head. Nothing here
            is annualised: <code>/v1/:chain/tokens/:addr/yield</code> lists every rate it refuses to
            compute, with a reason code.
          </p>
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
                <td className="num">
                  {token.multiplier.scheduled ? (
                    <span className="pill stale">scheduled {utc(token.multiplier.scheduled.effectiveAt)}</span>
                  ) : (
                    utc(token.multiplier.lastChangeEffectiveAt)
                  )}
                </td>
                <td className="num">
                  {token.events.count}
                  {token.events.last && token.events.last.announcementCount! > 1 ? (
                    <span className="addr"> ({token.events.last.announcementCount} announcements)</span>
                  ) : null}
                  {token.events.last && !token.events.last.applied ? (
                    <span className="addr"> (last not yet in effect)</span>
                  ) : null}
                  {token.events.last?.source === 'onchain:scan' || token.events.last?.source === 'onchain:sweep' ? (
                    <span className="addr"> {token.events.last.source.replace('onchain:', '')}</span>
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
                <td className="num">
                  {token.feed?.beyondHeartbeat === null || token.feed?.beyondHeartbeat === undefined
                    ? '—'
                    : token.feed.beyondHeartbeat
                      ? 'yes'
                      : 'no'}
                </td>
                <td className="num">{token.feed?.oraclePaused === null ? '—' : token.feed?.oraclePaused ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer>
        <p>
          Event rows marked <em>scan</em> were found by a full-chain sweep committed to the
          repository rather than seen live by the indexer; <em>sweep</em> rows were found by the
          indexer&rsquo;s own start-up catch-up. All are real logs with real transaction hashes. Token
          names and the feed pairing come from the issuer&rsquo;s registry as snapshotted on{' '}
          {tokens[0]?.registry.generatedAt.slice(0, 10) ?? '—'}, not read live.
        </p>
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
