'use client'

import { useMemo, useState } from 'react'
import type { TokenSummary } from '../../lib/observed'

/**
 * The one thing a holder comes here to do: find their token. The list is the
 * issuer's registry, baked into the page - 194 names, tickers and addresses -
 * so the search needs no server and answers on every keystroke. Every result
 * is a plain link to the token's page, so it works with a keyboard, a screen
 * reader, and without the button.
 */
export function Finder({ tokens }: { tokens: TokenSummary[] }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!needle) return []
    const starts = tokens.filter(
      (token) =>
        token.symbol.toLowerCase().startsWith(needle) ||
        token.name.toLowerCase().startsWith(needle) ||
        token.address.toLowerCase().startsWith(needle),
    )
    const contains = tokens.filter((token) => !starts.includes(token) && token.name.toLowerCase().includes(needle))
    return [...starts, ...contains].slice(0, 6)
  }, [needle, tokens])

  const hint = !needle
    ? `${tokens.length} Robinhood Stock Tokens`
    : matches.length
      ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
      : 'No Robinhood Stock Token by that name'

  return (
    <form
      className="finder"
      id="find"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (matches[0]) window.location.assign(`/t/${matches[0].address.toLowerCase()}/`)
      }}
    >
      <label className="finder-label" htmlFor="find-input">
        Find your token
      </label>
      <div className="finder-row">
        <input
          id="find-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Company, ticker or address"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby="find-hint"
        />
        <button className="btn" type="submit" disabled={matches.length === 0}>
          Look up
        </button>
      </div>
      <p className="finder-hint" id="find-hint" aria-live="polite">
        {hint}
      </p>
      {matches.length > 0 ? (
        <ul className="finder-list" aria-label="Matching tokens">
          {matches.map((token) => (
            <li key={token.address}>
              <a href={`/t/${token.address.toLowerCase()}/`}>
                <span className="name">{token.name}</span>
                <span className="sym">{token.symbol}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  )
}
