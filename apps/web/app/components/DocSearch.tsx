'use client'

import { useEffect, useRef, useState } from 'react'

interface Entry {
  page: string
  doc: string
  id: string
  title: string
  text: string
}

/**
 * Search over every section of every document. The index is one static file
 * built with the site, fetched the first time the box is used, so a reader
 * who never searches pays nothing for it. Matching is every word of the query
 * present in the section's title or text; title matches rank first.
 */
export function DocSearch() {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<Entry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const loading = useRef(false)

  const load = () => {
    if (index || loading.current) return
    loading.current = true
    fetch('/docs/search-index.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((rows: Entry[]) => setIndex(rows))
      .catch(() => setFailed(true))
  }
  useEffect(() => {
    if (query) load()
  })

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results =
    words.length === 0 || !index
      ? []
      : index
          .map((entry) => {
            const title = entry.title.toLowerCase()
            const text = entry.text.toLowerCase()
            const inTitle = words.every((word) => title.includes(word))
            const anywhere = words.every((word) => title.includes(word) || text.includes(word))
            return { entry, score: inTitle ? 2 : anywhere ? 1 : 0 }
          })
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map(({ entry }) => {
            const at = entry.text.toLowerCase().indexOf(words[0]!)
            const from = Math.max(0, at - 50)
            const snippet = at < 0 ? entry.text.slice(0, 110) : `${from > 0 ? '…' : ''}${entry.text.slice(from, from + 120)}…`
            return { ...entry, snippet }
          })

  return (
    <div className="doc-search">
      <label>
        <span className="sr-only">Search the documentation</span>
        <input
          type="search"
          placeholder="Search the docs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={load}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {query ? (
        <div className="doc-results" role="status">
          {failed ? (
            <p className="doc-results-note">The search index could not be loaded.</p>
          ) : !index ? (
            <p className="doc-results-note">Loading…</p>
          ) : results.length === 0 ? (
            <p className="doc-results-note">Nothing matches.</p>
          ) : (
            <ol>
              {results.map((result) => (
                <li key={`${result.page}#${result.id}`}>
                  <a href={`${result.page}#${result.id}`} onClick={() => setQuery('')}>
                    <span className="doc-results-where">{result.doc}</span>
                    <span className="doc-results-title">{result.title}</span>
                    <span className="doc-results-snippet">{result.snippet}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  )
}
