'use client'

import { useEffect, useState } from 'react'

type Sort = 'gap' | 'age' | 'pool' | 'name'

/**
 * Search and sort over a ledger that was built static. Rows carry their sort
 * keys as data attributes; this reorders and hides them in place and says how
 * many are shown. Nothing is fetched and nothing is computed: every value the
 * page can sort by was on the row already.
 */
export function GapControls({ listId, total }: { listId: string; total: number }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('gap')
  const [shown, setShown] = useState(total)

  useEffect(() => {
    const found = document.getElementById(listId)
    if (!found) return
    // A table's rows live in its body; a list's in the list itself.
    const list = found instanceof HTMLTableElement ? (found.tBodies[0] ?? found) : found
    const rows = [...list.querySelectorAll<HTMLElement>('[data-token]')]
    const q = query.trim().toLowerCase()
    const key = (row: HTMLElement) => Number(row.dataset[sort === 'gap' ? 'gap' : sort === 'age' ? 'age' : 'pool'] ?? 0)
    const ordered = [...rows].sort((a, b) =>
      sort === 'name' ? (a.dataset.name ?? '').localeCompare(b.dataset.name ?? '') : key(b) - key(a),
    )
    let count = 0
    for (const row of ordered) {
      const keep = q === '' || (row.dataset.name ?? '').includes(q)
      row.hidden = !keep
      if (keep) count++
      list.appendChild(row)
    }
    setShown(count)
  }, [listId, query, sort])

  return (
    <div className="controls" role="group" aria-label="Search and sort">
      <label>
        <span className="sr-only">Search by company or ticker</span>
        <input
          type="search"
          placeholder="Company or ticker"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label>
        <span>Sort by</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="gap">widest gap</option>
          <option value="age">oldest oracle</option>
          <option value="pool">deepest pool</option>
          <option value="name">name</option>
        </select>
      </label>
      <span className="controls-count" role="status">
        {shown === total ? `${total} tokens` : `${shown} of ${total} tokens`}
      </span>
    </div>
  )
}
