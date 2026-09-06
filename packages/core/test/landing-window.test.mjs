import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MIN_OBSERVATIONS,
  insideWindow,
  landingProfile,
  nextBusinessDay,
  predictLandingWindow,
} from '../../../scripts/lib/landing-window.mjs'

/**
 * The committed record, read as data: this library's whole claim is about what actually happened,
 * so a fixture would be testing a story instead of the observations.
 */
const rows = JSON.parse(
  readFileSync(new URL('../../../data/reconciliations.observed.json', import.meta.url), 'utf8'),
).rows

describe('nextBusinessDay', () => {
  it('steps over a weekend', () => {
    expect(nextBusinessDay('2026-08-07')).toBe('2026-08-10') // Friday -> Monday
    expect(nextBusinessDay('2026-08-08')).toBe('2026-08-10') // Saturday -> Monday
    expect(nextBusinessDay('2026-08-09')).toBe('2026-08-10') // Sunday -> Monday
  })

  it('is the following day inside the week', () => {
    expect(nextBusinessDay('2026-08-05')).toBe('2026-08-06')
    expect(nextBusinessDay('2026-09-03')).toBe('2026-09-04')
  })

  it('refuses an unparseable date rather than returning today', () => {
    expect(nextBusinessDay('not-a-date')).toBeNull()
    expect(nextBusinessDay('')).toBeNull()
  })
})

describe('landingProfile, over the real record', () => {
  it('finds every landing on the next business day', () => {
    // The rule the prediction rests on. If this ever stops being all of them, the rule is wrong
    // and predictLandingWindow refuses rather than guessing - see the test below.
    const profile = landingProfile(rows)
    expect(profile.sufficient).toBe(true)
    expect(profile.onNextBusinessDay).toBe(profile.observations)
    expect(profile.observations).toBeGreaterThanOrEqual(MIN_OBSERVATIONS)
  })

  it('reports a time-of-day window narrow enough to be worth arming', () => {
    const profile = landingProfile(rows)
    // Measured 2026-09-06: 15:10:24 to 15:12:46, a spread of 142 s. Asserting the shape rather
    // than the exact seconds, which move as the record grows.
    expect(profile.earliestSecondOfDay).toBeGreaterThan(14 * 3600)
    expect(profile.latestSecondOfDay).toBeLessThan(17 * 3600)
    expect(profile.spreadSeconds).toBeLessThan(3600)
  })

  it('refuses below three landings, and says how many it has', () => {
    const profile = landingProfile(rows.slice(0, 1))
    expect(profile.sufficient).toBe(false)
    expect(profile.notComputed).toMatch(/has 0|has 1/)
    expect(profile.earliestSecondOfDay).toBeNull()
  })

  it('ignores a row with no landing rather than counting it as one', () => {
    const pending = rows.filter((row) => !row.change)
    expect(pending.length).toBeGreaterThan(0)
    expect(landingProfile(pending).observations).toBe(0)
    expect(landingProfile([]).sufficient).toBe(false)
    expect(landingProfile(undefined).sufficient).toBe(false)
  })
})

describe('predictLandingWindow', () => {
  const profile = landingProfile(rows)

  it('contains the landing it could not have known about', () => {
    // UPS was declared for 2026-09-03 and took effect at 2026-09-04T15:10:26Z. The window is
    // built from the profile without looking at UPS's own row being in it - the point is that a
    // window armed from the declared date alone would have been sampling at the instant.
    const window = predictLandingWindow('2026-09-03', profile)
    expect(window.day).toBe('2026-09-04')
    expect(insideWindow(window, Date.parse('2026-09-04T15:10:26Z'))).toBe(true)
  })

  it('contains every landing on record, from its own declared date', () => {
    const missed = rows
      .filter((row) => row.processDate && row.change?.effectiveAt)
      .filter((row) => !insideWindow(predictLandingWindow(row.processDate, profile), Date.parse(row.change.effectiveAt)))
      .map((row) => row.symbol)
    expect(missed).toEqual([])
  })

  it('is a window, not an instant, and carries what it rests on', () => {
    const window = predictLandingWindow('2026-09-03', profile)
    expect(Date.parse(window.to)).toBeGreaterThan(Date.parse(window.from))
    // The basis travels with the window so a caller cannot store it as an observation.
    expect(window.basis.predicted).toBe(true)
    expect(window.basis.observations).toBe(profile.observations)
  })

  it('refuses when the profile is insufficient', () => {
    expect(predictLandingWindow('2026-09-03', landingProfile([]))).toBeNull()
    expect(predictLandingWindow('2026-09-03', null)).toBeNull()
  })

  it('refuses when a landing ever misses the next business day', () => {
    // The rule is not "about a day later", it is "the next business day". One counter-example and
    // the prediction stops rather than widening itself to fit.
    const broken = { ...profile, onNextBusinessDay: profile.observations - 1 }
    expect(predictLandingWindow('2026-09-03', broken)).toBeNull()
  })

  it('refuses an unparseable declared date', () => {
    expect(predictLandingWindow('nope', profile)).toBeNull()
  })
})

describe('insideWindow', () => {
  const window = predictLandingWindow('2026-09-03', landingProfile(rows))
  it('is inclusive at both ends and false outside', () => {
    expect(insideWindow(window, Date.parse(window.from))).toBe(true)
    expect(insideWindow(window, Date.parse(window.to))).toBe(true)
    expect(insideWindow(window, Date.parse(window.from) - 1000)).toBe(false)
    expect(insideWindow(window, Date.parse(window.to) + 1000)).toBe(false)
    expect(insideWindow(null, Date.now())).toBe(false)
  })
})
