// When a declared dividend will land on chain, predicted from the ones that already have.
//
// The capture that prices a haircut is armed today by the announcement log, which fires about nine
// to ten minutes before the change takes effect. That works and it is fragile in one specific way:
// it is the ONLY trigger. A watcher that was restarting, rate-limited or between ticks during those
// nine minutes has no second chance, and the issuer's quote cannot be read back - /rhj/prices
// serves the present only. Measured: 0 of 4 steps have a quote at the instant, and UPS's first
// sample landed 350 seconds late because GitHub's cron did not fire inside the lead.
//
// The declared side gives a second, independent trigger that needs no log at all. Measured over
// every reconciled step, 7 of 7:
//
//   * the step lands on the NEXT BUSINESS DAY after the issuer's processDate - including both
//     Friday declarations, which landed on the Monday;
//   * between 15:10:24 and 15:12:46 UTC, a spread of 142 seconds.
//
// So a window can be armed from a date the issuer publishes days ahead, and the announcement
// becomes the confirmation rather than the only chance.
//
// Everything here is derived from the record rather than written down: the profile is computed
// from the reconciled steps at call time, and it REFUSES below three observations. A window
// predicted from one landing would be a claim about that landing.
//
// Plain ESM with no dependencies, like scripts/lib/market-session.mjs, so the watcher runs it on a
// bare node with no install step. Tested in packages/core/test/landing-window.test.mjs.

/** Minimum landings before a window may be predicted at all. */
export const MIN_OBSERVATIONS = 3

/**
 * Padding either side of the observed spread.
 *
 * Not a guess about the issuer: it absorbs the sampling interval. The watcher ticks every 30 s and
 * the one-shot runs on GitHub's cron, so a window narrower than the tick would be missed by a
 * process that is working correctly. Ten minutes each side costs a handful of quotes.
 */
export const PAD_SECONDS = 600

const DAY = 86_400_000

/** Seconds since midnight UTC of an ISO instant. */
const secondOfDay = (iso) => {
  const d = new Date(iso)
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
}

/**
 * The next business day after a date, in UTC.
 *
 * Weekends only. Market holidays are deliberately NOT modelled, and the consequence is stated
 * rather than hidden: a holiday shifts the real landing a day later than this predicts, so the
 * window is armed a day early and captures nothing. That costs a few wasted quotes and never a
 * wrong figure - the opposite trade would be to guess a holiday calendar and be wrong silently.
 * The same choice scripts/lib/market-session.mjs makes for the session classifier.
 */
export function nextBusinessDay(date) {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  do {
    d.setTime(d.getTime() + DAY)
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

/**
 * What the landings that already happened say about when the next one will.
 *
 * `rows` are reconciliation rows: anything with a `processDate` and a `change.effectiveAt`. The
 * profile refuses itself below MIN_OBSERVATIONS rather than returning a narrow window from thin
 * evidence, and it reports how many of the landings actually fell on the next business day - if
 * that ever stops being all of them, the rule below is wrong and the number says so.
 */
export function landingProfile(rows) {
  const landings = (rows ?? [])
    .filter((row) => row?.processDate && row?.change?.effectiveAt)
    .map((row) => ({
      processDate: row.processDate,
      effectiveAt: row.change.effectiveAt,
      onNextBusinessDay: nextBusinessDay(row.processDate) === row.change.effectiveAt.slice(0, 10),
      secondOfDay: secondOfDay(row.change.effectiveAt),
    }))

  if (landings.length < MIN_OBSERVATIONS) {
    return {
      sufficient: false,
      notComputed: `needs ${MIN_OBSERVATIONS} landings, has ${landings.length}`,
      observations: landings.length,
      onNextBusinessDay: landings.filter((l) => l.onNextBusinessDay).length,
      earliestSecondOfDay: null,
      latestSecondOfDay: null,
    }
  }

  const seconds = landings.map((l) => l.secondOfDay).sort((a, b) => a - b)
  return {
    sufficient: true,
    notComputed: null,
    observations: landings.length,
    onNextBusinessDay: landings.filter((l) => l.onNextBusinessDay).length,
    earliestSecondOfDay: seconds[0],
    latestSecondOfDay: seconds[seconds.length - 1],
    medianSecondOfDay: seconds[(seconds.length - 1) >> 1],
    spreadSeconds: seconds[seconds.length - 1] - seconds[0],
  }
}

const iso = (day, second) => new Date(Date.parse(`${day}T00:00:00Z`) + second * 1000).toISOString()

/**
 * The window in which a dividend declared for `processDate` is expected to land, or null.
 *
 * Null - never a guessed window - when the profile is insufficient, when the date is unparseable,
 * or when the landings are not consistently on the next business day. The caller samples across
 * the window; nothing here writes an `effectiveAt`, because a predicted instant is not an observed
 * one and the two must never end up in the same field.
 */
export function predictLandingWindow(processDate, profile, { padSeconds = PAD_SECONDS } = {}) {
  if (!profile?.sufficient) return null
  // If a landing ever misses the next business day, the rule this rests on is not the rule.
  if (profile.onNextBusinessDay !== profile.observations) return null
  const day = nextBusinessDay(processDate)
  if (!day) return null
  return {
    day,
    from: iso(day, profile.earliestSecondOfDay - padSeconds),
    to: iso(day, profile.latestSecondOfDay + padSeconds),
    /** What the window rests on, carried with it so a caller cannot quote it as an observation. */
    basis: {
      observations: profile.observations,
      observedFrom: iso(day, profile.earliestSecondOfDay),
      observedTo: iso(day, profile.latestSecondOfDay),
      padSeconds,
      rule: 'the next business day after the issuer’s processDate, at the time of day every observed step took effect',
      predicted: true,
    },
  }
}

/** Is `nowMs` inside the window? */
export function insideWindow(window, nowMs) {
  if (!window) return false
  return nowMs >= Date.parse(window.from) && nowMs <= Date.parse(window.to)
}
