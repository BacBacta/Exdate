/** Formatting only. Nothing here invents or rounds away a value's meaning. */

export function age(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`
}

/**
 * Multipliers are shown to the digit that matters. A dividend can move the
 * multiplier by less than a basis point (DELL, +0.64 bps), so truncating to a
 * few decimals would render a real corporate action as "1.00".
 */
export function multiplier(decimalString: string | null): string {
  if (decimalString === null) return '—'
  const [whole, fraction = ''] = decimalString.split('.')
  if (fraction === '' || /^0*$/.test(fraction)) return `${whole}.0`
  const trimmed = fraction.replace(/0+$/, '')
  return `${whole}.${trimmed.slice(0, 12)}`
}

export function price(value: string | null): string {
  if (value === null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function bps(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)} bps`
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** "2026-08-14T15:12:46.000Z" -> "2026-08-14 15:12Z". Minutes matter: the
 *  announcement lead on every observed dividend is about nine of them. */
export function utc(iso: string | null): string {
  if (!iso) return '—'
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)
  return match ? `${match[1]} ${match[2]}Z` : iso
}

/** Whole days from a UTC date string to today. */
export function daysSince(isoDate: string | null): string {
  if (!isoDate) return '—'
  const then = Date.parse(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(then)) return '—'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  return days < 0 ? '—' : `${days}`
}
