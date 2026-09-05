/**
 * The parameters of the method, in one place, importable by anything.
 *
 * These are the numbers a published methodology note has to state: the band outside which a
 * reconciliation is reported as an anomaly rather than a measurement, and the rungs of the
 * confidence ladder. They lived as unnamed literals inside `reconcile.ts` until the note was
 * generated from the code (roadmap 8a), and a constant a document has to restate by hand is a
 * constant the document will eventually be wrong about.
 *
 * This module imports nothing on purpose. `reconcile.ts` cannot be loaded by a plain script - it
 * imports siblings through `.js` specifiers that only a bundler or a compiler resolves - so the
 * generator could not read its values. Anything here can be read by `node --experimental-strip-types`,
 * which is what `scripts/build-methodology.mjs` does.
 */

/**
 * Bounds outside which a reconciliation is an anomaly rather than a measurement, in basis points.
 *
 * It admits everything from "holders received 1 % more than declared" to "half the dividend
 * disappeared", which comfortably contains the 30 % US non-resident withholding rate and the
 * 34-36 % observed on AAPL and SGOV, and rejects ASML at 90 %. A presentation bound, never a claim
 * about what is correct.
 */
export const PLAUSIBLE_HAIRCUT_BPS = [-100, 5_000] as const

/**
 * How many multiplier events a token must have produced before its pairing can carry more than
 * `low` confidence. Below this the pairing has not been exercised enough to be believed on
 * behaviour, whatever the evidence says.
 */
export const CONFIDENCE_MIN_EVENTS_MEDIUM = 3

/**
 * And before `high` - which additionally requires a first-party address-level link between token
 * and feed. No such statement exists for any pair on any chain exdate reads, so nothing reaches
 * this rung today and the number is here to be published rather than to be used.
 */
export const CONFIDENCE_MIN_EVENTS_HIGH = 10
