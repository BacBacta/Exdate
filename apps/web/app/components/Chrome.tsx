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

/** Shared by every page; anchors are absolute so they work from a token page too. */
export function Nav() {
  return (
    <header className="nav">
      <div className="wrap">
        <a className="brand" href="/" aria-label="exdate, home">
          <Mark />
          <span className="wordmark">exdate</span>
        </a>
        <nav aria-label="Primary">
          <a href="/#how">How it works</a>
          <a href="/#proof">Proof</a>
          <a href="/#coverage">Coverage</a>
          <a href="/#developers">Developers</a>
          {links.status ? <a href={links.status}>Live status</a> : null}
          <a className="btn small" href="/#find">
            Find your token
          </a>
        </nav>
      </div>
    </header>
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
        <nav aria-label="Footer">
          <a href="/#find">Find your token</a>
          {links.status ? <a href={links.status}>Live status</a> : <a href={links.data}>Data</a>}
          <a href={links.apiDocs}>API</a>
          <a href={links.github}>GitHub</a>
        </nav>
        <p className="fine">
          Data read from Robinhood Chain: {counts.tokens} tokens, last observed {observedDay}. Stock
          Tokens are debt securities issued by Robinhood Assets (Jersey) Limited, not equity. Nothing
          here is investment advice.
        </p>
      </div>
    </footer>
  )
}
