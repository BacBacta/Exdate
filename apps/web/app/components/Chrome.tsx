import { calendar, observed } from '../../lib/observed'

const { counts, links, lastObservedAt } = observed

/** A ring open on the share that never arrives: the product's own measurement, as the mark. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeDasharray="44.2 24.9"
        transform="rotate(40 16 16)"
      />
    </svg>
  )
}

export type NavCurrent = 'tokens' | 'wallet' | 'calendar' | 'oracle' | 'developers'

/**
 * Five destinations, one per reader: a holder finds a token or reads a
 * wallet, anyone watches the calendar, a curator comes for the oracle gap,
 * a developer for the docs. The oracle page was reachable only from the
 * footer, and the header repeated sections of the home page instead
 * (audit 2026-09-05, F06). On a narrow screen the row scrolls sideways
 * inside its own box rather than widening the page.
 */
export function Nav({ current }: { current?: NavCurrent }) {
  const item = (key: NavCurrent, href: string, label: string) => (
    <a href={href} aria-current={current === key ? 'page' : undefined}>
      {label}
    </a>
  )
  return (
    <header className="nav">
      <div className="wrap">
        <a className="brand" href="/" aria-label="exdate, home">
          <Mark />
          <span className="wordmark">exdate</span>
        </a>
        <nav aria-label="Primary">
          {item('tokens', '/#find', 'Tokens')}
          {item('wallet', '/wallet/', 'Wallet')}
          {item('calendar', '/calendar/', 'Calendar')}
          {item('oracle', '/gap/', 'Oracle')}
          {item('developers', '/docs/', 'Docs')}
        </nav>
      </div>
    </header>
  )
}

/** The visual header of a ledger; each row keeps its own labels for screen readers. */
export function LedgerHead({ cols }: { cols: readonly [string, string, string, string] }) {
  return (
    <div className="ledger-head" aria-hidden="true">
      {cols.map((col, index) => (
        <span key={index}>{col}</span>
      ))}
    </div>
  )
}

/**
 * Three columns named by what a reader does there, instead of one "About"
 * column of eleven links that mixed product pages, anchors and developer
 * links (audit 2026-09-05, F18).
 */
export function Footer() {
  const observedDay = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(lastObservedAt))
  return (
    <footer>
      <div className="wrap foot">
        <div>
          <span className="brand">
            <Mark />
            <span className="wordmark">exdate</span>
          </span>
          <p>The corporate-action layer for Stock Tokens.</p>
          {/* Who stands behind the numbers, and how to reach them (audit 2026-09-05, F26). */}
          <p className="made">
            <a href="/about/">About</a>
            {links.github ? (
              <>
                {' · '}
                <a href={`${links.github}/issues`}>Contact</a>
              </>
            ) : null}
            {' · '}
            <a href="/docs/changelog/">Changelog</a>
          </p>
        </div>
        <div>
          <h2>Look up</h2>
          <nav aria-label="Look up">
            <a href="/#find">Find your token</a>
            <a href="/wallet/">Your wallet</a>
            <a href="/calendar/">Calendar ({calendar.total} declared)</a>
            <a href="/calendar.ics">Subscribe (.ics)</a>
            <a href="/feed.xml">RSS</a>
          </nav>
        </div>
        <div>
          <h2>What we measured</h2>
          <nav aria-label="What we measured">
            <a href="/dividends/">Every dividend</a>
            <a href="/#off-hours">Off-hours share</a>
            <a href="/flows/">Net creation</a>
            <a href="/gap/">Oracle gap</a>
            <a href="/record/">Delivery record</a>
            <a href="/how/">How it works</a>
            <a href="/how/#coverage">Coverage</a>
          </nav>
        </div>
        <div>
          <h2>Build on it</h2>
          <nav aria-label="Build on it">
            <a href="/docs/">Developers</a>
            <a href={links.apiDocs}>API reference</a>
            {links.api ? <a href={`${links.api}/v1/health`}>Live API</a> : null}
            <a href={links.sdkDocs}>SDK</a>
            <a href="/tokenlist.json">Token list</a>
            <a href={links.data}>Data (CC BY 4.0)</a>
            {links.status ? <a href={links.status}>Live status</a> : null}
            {links.github ? <a href={links.github}>Source</a> : null}
          </nav>
        </div>
        <p className="fine">
          Data read from Robinhood Chain: {counts.tokens} tokens, last observed {observedDay}. Stock
          Tokens are debt securities issued by Robinhood Assets (Jersey) Limited, not equity. Nothing
          here is investment advice. exdate is an independent measurement and is not affiliated
          with, endorsed by, or officially connected with Robinhood Markets, Inc.
        </p>
      </div>
    </footer>
  )
}
