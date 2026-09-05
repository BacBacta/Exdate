import type { CSSProperties } from 'react'

/** Stagger for the reveal animation, as a CSS custom property. */
export const delay = (ms: number) => ({ '--d': `${ms}ms` }) as unknown as CSSProperties

/** "2026-08-14T15:12:46Z" or "2026-08-14" -> "14 August 2026". */
export const dateLong = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
      )
    : ''

/** Whole percent for a reader; the exact basis points stay in the data. */
export const pctInt = (bps: number | null | undefined) => (bps == null ? null : Math.round(bps / 100))

/**
 * "2026-09-03T07:48:09Z", "2026-09-05T15:17:48Z" -> "3–5 September 2026"; across a
 * month or a year boundary the parts are spelled out: "31 August – 5 September 2026".
 */
export const dateRange = (fromIso: string, toIso: string) => {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  const day = (d: Date) => d.getUTCDate()
  const month = (d: Date) => new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(d)
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    return day(from) === day(to) ? dateLong(toIso) : `${day(from)}–${day(to)} ${month(to)} ${to.getUTCFullYear()}`
  }
  if (from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${day(from)} ${month(from)} – ${day(to)} ${month(to)} ${to.getUTCFullYear()}`
  }
  return `${dateLong(fromIso)} – ${dateLong(toIso)}`
}

/** A token count for a reader: whole tokens, grouped, signed when asked. */
export const tokenCount = (value: string | number, sign = false) => {
  const n = Math.round(Number(value))
  const text = Math.abs(n).toLocaleString('en-US')
  return n < 0 ? `−${text}` : sign && n > 0 ? `+${text}` : text
}
