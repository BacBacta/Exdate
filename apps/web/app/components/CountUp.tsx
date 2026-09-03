'use client'

import { useEffect, useRef } from 'react'

/**
 * Counts from zero to `to`. The server renders the final value, so the number
 * is right without JavaScript and for anyone who prefers reduced motion; the
 * animation only ever replaces a correct number with a smaller one on its way
 * back to it.
 */
export function CountUp({
  to,
  decimals = 0,
  duration = 1700,
  delay = 350,
}: {
  to: number
  decimals?: number
  duration?: number
  delay?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    const start = performance.now() + delay
    const render = (value: number) => {
      element.textContent = value.toFixed(decimals)
    }
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration))
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      render(to * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    render(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, decimals, duration, delay])

  return <span ref={ref}>{to.toFixed(decimals)}</span>
}
