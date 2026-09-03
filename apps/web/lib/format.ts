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
