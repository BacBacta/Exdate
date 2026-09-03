// The off-hours measurement rests entirely on this classifier, so it is tested
// here rather than trusted. It lives in scripts/lib rather than in this package
// because the hourly GitHub Action that samples the chain runs it on a bare
// `node` with no install step - that is what lets the sampling keep running
// whatever happens to the workspace - and plain ESM is the price of that.

import { describe, expect, it } from 'vitest'
import {
  MARKET_SESSIONS,
  classifyMarketSession,
  easternHourOfWeek,
} from '../../../scripts/lib/market-session.mjs'

/** Reads as the Eastern wall clock it is meant to be, not as a UTC offset. */
const et = (isoWithOffset) => new Date(isoWithOffset)

describe('the session table', () => {
  it('accounts for every hour of the week exactly once', () => {
    const total = Object.values(MARKET_SESSIONS).reduce((sum, session) => sum + session.hoursPerWeek, 0)
    expect(total).toBe(168)
  })

  it('calls everything except the regular session off-hours', () => {
    const offHours = Object.values(MARKET_SESSIONS)
      .filter((session) => session.offHours)
      .reduce((sum, session) => sum + session.hoursPerWeek, 0)
    expect(offHours).toBe(135.5)
    expect(MARKET_SESSIONS.regular.offHours).toBe(false)
  })
})

describe('weekday boundaries', () => {
  // Thursday 2026-09-03, EDT (UTC-4).
  it.each([
    ['03:59', '2026-09-03T03:59:00-04:00', 'overnight'],
    ['04:00 pre-market opens', '2026-09-03T04:00:00-04:00', 'pre_market'],
    ['09:29', '2026-09-03T09:29:59-04:00', 'pre_market'],
    ['09:30 opening bell', '2026-09-03T09:30:00-04:00', 'regular'],
    ['15:59', '2026-09-03T15:59:59-04:00', 'regular'],
    ['16:00 closing bell', '2026-09-03T16:00:00-04:00', 'after_hours'],
    ['19:59', '2026-09-03T19:59:59-04:00', 'after_hours'],
    ['20:00 after-hours closes', '2026-09-03T20:00:00-04:00', 'overnight'],
    ['23:30', '2026-09-03T23:30:00-04:00', 'overnight'],
    ['00:30', '2026-09-03T00:30:00-04:00', 'overnight'],
  ])('%s is %s', (_label, iso, expected) => {
    expect(classifyMarketSession(et(iso))).toBe(expected)
  })
})

describe('the weekend', () => {
  it('is the weekend at an hour that would be a regular session on a weekday', () => {
    expect(classifyMarketSession(et('2026-09-05T10:00:00-04:00'))).toBe('weekend') // Saturday
    expect(classifyMarketSession(et('2026-09-06T10:00:00-04:00'))).toBe('weekend') // Sunday
  })

  it('does not start on Friday night', () => {
    // A weeknight that happens to precede a weekend is still overnight: folding
    // it in would make the two buckets disagree with their own hour counts.
    expect(classifyMarketSession(et('2026-09-04T21:00:00-04:00'))).toBe('overnight')
    expect(classifyMarketSession(et('2026-09-07T02:00:00-04:00'))).toBe('overnight') // Monday
  })
})

describe('daylight saving', () => {
  // The same UTC instant is a different session in January and in July. A fixed
  // offset would get one of these wrong, and the error would be an hour - larger
  // than the effect the sampling is trying to measure.
  it('reads 13:35 UTC as pre-market in winter and as the regular session in summer', () => {
    expect(classifyMarketSession(new Date('2026-01-15T13:35:00Z'))).toBe('pre_market') // 08:35 EST
    expect(classifyMarketSession(new Date('2026-07-15T13:35:00Z'))).toBe('regular') // 09:35 EDT
  })

  it('puts the opening bell at 14:30 UTC in winter and 13:30 UTC in summer', () => {
    expect(classifyMarketSession(new Date('2026-01-15T14:29:00Z'))).toBe('pre_market')
    expect(classifyMarketSession(new Date('2026-01-15T14:30:00Z'))).toBe('regular')
    expect(classifyMarketSession(new Date('2026-07-15T13:29:00Z'))).toBe('pre_market')
    expect(classifyMarketSession(new Date('2026-07-15T13:30:00Z'))).toBe('regular')
  })
})

describe('hour-of-week coverage', () => {
  it('numbers the week from Sunday 00:00 ET', () => {
    expect(easternHourOfWeek(et('2026-09-06T00:30:00-04:00'))).toBe(0) // Sunday
    expect(easternHourOfWeek(et('2026-09-07T00:30:00-04:00'))).toBe(24) // Monday
    expect(easternHourOfWeek(et('2026-09-03T03:48:00-04:00'))).toBe(99) // Thursday 03:00
    expect(easternHourOfWeek(et('2026-09-05T23:00:00-04:00'))).toBe(167) // Saturday 23:00
  })

  it('spans exactly the 168 slots the session table accounts for', () => {
    const slots = new Set()
    // One week of hourly instants, walked in UTC across a DST-free stretch.
    for (let hour = 0; hour < 168; hour++) {
      slots.add(easternHourOfWeek(new Date(Date.UTC(2026, 8, 6, 4 + hour))))
    }
    expect(slots.size).toBe(168)
  })
})
