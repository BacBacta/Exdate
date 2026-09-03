import { observed } from '../../lib/observed'

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

export type NavCurrent = 'tokens' | 'wallet' | 'calendar'

/**
 * Three destinations, which are the three things a visitor does here. The
 * explanatory sections of the home page are reachable from the footer and by
 * scrolling; they are not destinations.
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
          <p>The corporate-action layer for tokenized stocks.</p>
        </div>
        <div>
          <h4>Use</h4>
          <nav aria-label="Tools">
            <a href="/#find">Find your token</a>
            <a href="/wallet/">Your wallet</a>
            <a href="/calendar/">Calendar</a>
            {links.status ? <a href={links.status}>Live status</a> : null}
          </nav>
        </div>
        <div>
          <h4>About</h4>
          <nav aria-label="About">
            <a href="/#how">How it works</a>
            <a href="/#proof">Proof</a>
            <a href="/#coverage">Coverage</a>
            <a href="/#developers">Developers</a>
            <a href={links.apiDocs}>API</a>
            <a href={links.data}>Data</a>
            <a href={links.github}>GitHub</a>
          </nav>
        </div>
        <p className="fine">
          Data read from Robinhood Chain: {counts.tokens} tokens, last observed {observedDay}. Stock
          Tokens are debt securities issued by Robinhood Assets (Jersey) Limited, not equity. Nothing
          here is investment advice.
        </p>
      </div>
    </footer>
  )
}
