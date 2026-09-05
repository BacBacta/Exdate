'use client'

import { useEffect } from 'react'

/**
 * Marks the section the reader is in, in the sidebar. Nothing else: the
 * links, the ids and the order were rendered on the server.
 */
export function DocNav() {
  useEffect(() => {
    const headings = [...document.querySelectorAll<HTMLElement>('.prose h2[id], .prose h3[id]')]
    const links = new Map([...document.querySelectorAll<HTMLAnchorElement>('.toc-desktop a[href^="#"]')].map((a) => [a.getAttribute('href')!.slice(1), a]))
    if (headings.length === 0 || links.size === 0) return
    let current: string | null = null
    const mark = (id: string) => {
      if (id === current) return
      current = id
      for (const [key, link] of links) {
        if (key === id) link.setAttribute('aria-current', 'true')
        else link.removeAttribute('aria-current')
      }
    }
    // The heading nearest above the top of the viewport is the current one.
    const update = () => {
      const line = window.scrollY + 120
      let best = headings[0]!
      for (const heading of headings) {
        if (heading.offsetTop <= line) best = heading
        else break
      }
      mark(best.id)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  return null
}
