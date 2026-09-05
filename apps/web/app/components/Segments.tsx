'use client'

import { useEffect, useState } from 'react'

/**
 * Two lists, one shown at a time once JavaScript is here; both shown, one
 * under the other, without it. The choice lives in the URL hash so a link
 * can point at either list.
 */
export function Segments({ items }: { items: { id: string; label: string }[] }) {
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const pick = () => {
      const hash = window.location.hash.replace('#', '')
      setCurrent(items.some((item) => item.id === hash) ? hash : items[0]!.id)
    }
    pick()
    window.addEventListener('hashchange', pick)
    return () => window.removeEventListener('hashchange', pick)
  }, [items])

  useEffect(() => {
    if (!current) return
    for (const item of items) {
      const section = document.getElementById(item.id)
      if (section) section.hidden = item.id !== current
    }
  }, [current, items])

  return (
    <nav className="segments" aria-label="Lists">
      {items.map((item) => (
        <a key={item.id} href={`#${item.id}`} aria-current={current === item.id ? 'true' : undefined} onClick={() => setCurrent(item.id)}>
          {item.label}
        </a>
      ))}
    </nav>
  )
}
