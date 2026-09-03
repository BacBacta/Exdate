// Which US market session is a given instant in?
//
// The off-hours measurement stands or falls on this: a boundary off by half an
// hour, or a DST transition handled by a fixed UTC offset, would move the answer
// by more than the effect being measured. So it is one module, with no
// dependencies - the hourly GitHub Action runs it on a bare `node`, with no
// install step, which is what lets the sampling survive the codebase - and it is
// unit-tested in packages/core/test/market-session.test.mjs.
//
// Boundaries are NYSE's own: 04:00 pre-market open, 09:30 opening bell, 16:00
// closing bell, 20:00 after-hours close, all in America/New_York, which is where
// DST is handled for us rather than by an offset we would have to maintain.
//
// Not modelled, deliberately and stated everywhere the number is published:
// market holidays and half-days. A holiday counts here as an ordinary weekday,
// so its quiet regular session drags the regular-session rate down slightly -
// nine or ten days a year out of about 250.

/** Every session, and how many of the week's 168 hours each one occupies. */
export const MARKET_SESSIONS = {
  pre_market: { label: 'pre-market 04:00-09:30 ET', hoursPerWeek: 27.5, offHours: true },
  regular: { label: 'regular session 09:30-16:00 ET', hoursPerWeek: 32.5, offHours: false },
  after_hours: { label: 'after-hours 16:00-20:00 ET', hoursPerWeek: 20, offHours: true },
  overnight: { label: 'overnight 20:00-04:00 ET', hoursPerWeek: 40, offHours: true },
  weekend: { label: 'Saturday and Sunday', hoursPerWeek: 48, offHours: true },
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const EASTERN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Wall-clock in New York, which is what a market session is defined in. */
export function easternParts(date) {
  const parts = Object.fromEntries(EASTERN.formatToParts(date).map((part) => [part.type, part.value]))
  return { weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) }
}

/**
 * Saturday and Sunday are the weekend at any hour, so Sunday 10:00 ET is not a
 * regular session. Friday 21:00 ET is overnight rather than weekend: it is a
 * weeknight that happens to precede one, and folding it into the weekend would
 * make the two buckets disagree with their own hour counts.
 */
export function classifyMarketSession(date) {
  const { weekday, hour, minute } = easternParts(date)
  if (weekday === 'Sat' || weekday === 'Sun') return 'weekend'
  const minuteOfDay = hour * 60 + minute
  if (minuteOfDay >= 4 * 60 && minuteOfDay < 9 * 60 + 30) return 'pre_market'
  if (minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60) return 'regular'
  if (minuteOfDay >= 16 * 60 && minuteOfDay < 20 * 60) return 'after_hours'
  return 'overnight'
}

/** 0-167, so coverage of the week can be counted rather than assumed. */
export function easternHourOfWeek(date) {
  const { weekday, hour } = easternParts(date)
  return WEEKDAYS.indexOf(weekday) * 24 + hour
}
