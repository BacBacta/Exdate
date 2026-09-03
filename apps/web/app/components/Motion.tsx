'use client'

import { useEffect } from 'react'

/**
 * Reveal-on-scroll, once, for every element marked `data-reveal`.
 *
 * The page is complete without this: the inline script in the layout adds
 * `data-js` to <html> before first paint, and only under that attribute does
 * the stylesheet hide anything. No JavaScript, no hiding. Reduced motion is
 * honoured in CSS, so this component never has to ask.
 */
export function Motion() {
  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>('[data-reveal]')
    if (!('IntersectionObserver' in window)) {
      for (const element of elements) element.classList.add('in')
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('in')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    for (const element of elements) observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return null
}
