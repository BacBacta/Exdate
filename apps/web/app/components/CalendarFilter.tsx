'use client'

import { useEffect, useState } from 'react'

/**
 * `/calendar/?tokens=0x…,0x…` shows only those tokens: the wallet page links
 * here with the tokens an address holds, so a holder sees their own dates
 * and not 37 (audit 2026-09-05, F12). The page is static; the filter hides
 * rows in the browser and says what it hid. Without the parameter it does
 * nothing at all.
 */
export function CalendarFilter({ total }: { total: number }) {
  const [state, setState] = useState<{ shown: number; tokens: number } | null>(null)

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('tokens')
    if (!raw) return
    const wanted = new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => /^0x[0-9a-f]{40}$/.test(t)))
    if (wanted.size === 0) return
    let shown = 0
    for (const row of document.querySelectorAll<HTMLElement>('[data-token]')) {
      const keep = wanted.has((row.dataset.token ?? '').toLowerCase())
      row.hidden = !keep
      if (keep) shown++
    }
    for (const group of document.querySelectorAll<HTMLElement>('[data-group]')) {
      group.hidden = group.querySelectorAll('[data-token]:not([hidden])').length === 0
    }
    setState({ shown, tokens: wanted.size })
  }, [])

  if (!state) return null
  return (
    <p className="cal-filter" role="status">
      Showing {state.shown} of {total} declared dividends, for the {state.tokens} token{state.tokens === 1 ? '' : 's'} this
      wallet holds. <a href="/calendar/">Show all</a>
    </p>
  )
}
