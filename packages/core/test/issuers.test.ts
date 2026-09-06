import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ISSUER_MECHANISMS, producesFor, stepBpsExact, stepShape } from '../src/issuers.js'

/** The committed step ledger, read as data rather than imported: it is a dataset, not a fixture. */
const xstocks = () =>
  JSON.parse(readFileSync(new URL('../../../data/xstocks-steps.observed.json', import.meta.url), 'utf8')) as {
    summary: { producesHaircuts: boolean; whyNot: string }
    tokens: { symbol: string; steps: { reason: string; activationDateTime: string; multiplier: number; previousMultiplier: number; stepBps: number }[] }[]
  }

const WAD = 10n ** 18n
const wad = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole ?? '0') * WAD + BigInt(fraction.padEnd(18, '0').slice(0, 18))
}

describe('the issuer mechanism table', () => {
  it('does not let two issuers share a role assignment by accident', () => {
    // The whole reason this module exists: Robinhood's constant view and Backed's adjusted one are
    // the SAME selector, `balanceOf(address)`. A contract that named the selector instead of the
    // role would have collapsed them.
    const robinhood = ISSUER_MECHANISMS.find((row) => row.id === 'robinhood')!
    const backed = ISSUER_MECHANISMS.find((row) => row.id === 'backed-xstocks')!
    expect(robinhood.constantView).toBe('balanceOf(address)')
    expect(backed.adjustedView).toBe('balanceOf(address)')
    expect(robinhood.constantView).toBe(backed.adjustedView)
    expect(robinhood.adjustedView).not.toBe(backed.adjustedView)
  })

  it('leaves the roles null where the mechanism is documented but not live', () => {
    const coinbase = ISSUER_MECHANISMS.find((row) => row.id === 'coinbase-b20')!
    expect(coinbase.constantView).toBeNull()
    expect(coinbase.adjustedView).toBeNull()
    // The one selector that does answer there is still named.
    expect(coinbase.multiplierView).toBe('multiplier()')
  })

  it('every row names the file its claims were read from', () => {
    for (const row of ISSUER_MECHANISMS) expect(row.evidence).toMatch(/\.json/)
  })

  it('derives what an issuer produces from what it publishes, never from ambition', () => {
    expect(producesFor({ publishesDeclaredRate: true, publishesStepHistory: false, everMoved: true })).toBe('haircuts')
    // A step history without a cash rate cannot price a haircut, however long the history is.
    expect(producesFor({ publishesDeclaredRate: false, publishesStepHistory: true, everMoved: true })).toBe('step-ledger')
    expect(producesFor({ publishesDeclaredRate: false, publishesStepHistory: false, everMoved: false })).toBe('nothing-yet')
    // And a rate is worth nothing until something moves.
    expect(producesFor({ publishesDeclaredRate: true, publishesStepHistory: true, everMoved: false })).toBe('nothing-yet')
  })

  it('the table agrees with its own derivation', () => {
    const moved: Record<string, boolean> = { robinhood: true, 'coinbase-b20': false, 'backed-xstocks': true }
    for (const row of ISSUER_MECHANISMS) {
      expect(producesFor({ ...row, everMoved: moved[row.id]! })).toBe(row.produces)
    }
  })
})

describe('stepBpsExact', () => {
  it('reproduces exdate’s own published steps', () => {
    // SGOV's real first step: 1.0 -> 1.000957, published as 9.57 bps.
    expect(stepBpsExact(WAD, wad('1.000957'))).toBeCloseTo(9.57, 2)
    // DELL, the smallest Robinhood step on record. A whole-bps round would print this as 1.
    expect(stepBpsExact(WAD, wad('1.000064'))).toBeCloseTo(0.64, 2)
    // CCL, the largest.
    expect(stepBpsExact(WAD, wad('1.0214862'))).toBeCloseTo(214.86, 2)
  })

  it('is exact where a float ratio would not be', () => {
    // A one-wei move on a WAD is 1e-16 bps: it must not round to something.
    expect(stepBpsExact(WAD, WAD + 1n)).toBe(0)
    // And a real step keeps its low digits.
    expect(stepBpsExact(wad('1.000957'), wad('1.002981'))).toBeCloseTo(20.22, 2)
  })

  it('refuses a zero or negative base rather than dividing by it', () => {
    expect(stepBpsExact(0n, WAD)).toBeNull()
    expect(stepBpsExact(-1n, WAD)).toBeNull()
  })

  it('signs a reverse step negative', () => {
    expect(stepBpsExact(wad('4.4'), wad('2.2'))).toBe(-5000)
  })
})

describe('stepShape', () => {
  it('names only the two ends, and refuses the middle', () => {
    // CRWD's real x4 split.
    expect(stepShape(WAD, WAD * 4n)).toBe('split')
    // Backed's real 1-for-2 reverse split, from their own history.
    expect(stepShape(wad('4.4'), wad('2.2'))).toBe('reverse-split')
    // Every dividend ever observed, on any issuer, lands here.
    expect(stepShape(WAD, wad('1.0214862'))).toBe('undetermined')
    expect(stepShape(WAD, wad('1.000064'))).toBe('undetermined')
  })

  it('does not classify a dividend as a split however large', () => {
    // The brief's "0.05 %-2 %" band does not hold - CCL was 214.86 bps - so the only safe rule is
    // the doubling one. A 99 % step is still undetermined, and the issuer has to say.
    expect(stepShape(WAD, wad('1.99'))).toBe('undetermined')
    expect(stepShape(WAD, wad('2'))).toBe('split')
  })

  it('refuses a zero base', () => {
    expect(stepShape(0n, WAD)).toBeNull()
  })
})

describe('the extracted helpers against the second issuer’s real record', () => {
  // The whole justification for extracting anything: the helpers were written from Robinhood's
  // steps and must hold on 603 steps from an issuer whose contract inverts the balance semantics.
  // If they only worked on the issuer they were written from, they would not be an abstraction.
  const ledger = xstocks()

  it('reproduces every step the issuer declared, from its own multipliers', () => {
    const wrong: string[] = []
    for (const token of ledger.tokens) {
      for (const step of token.steps) {
        if (!step.previousMultiplier) continue
        // The declared side is a float, so the comparison is at the float's own precision - and
        // stepBpsExact takes WADs, so the floats are lifted rather than the WADs flattened.
        const toWad = (value: number) => BigInt(Math.round(value * 1e18))
        const computed = stepBpsExact(toWad(step.previousMultiplier), toWad(step.multiplier))
        if (computed === null || Math.abs(computed - step.stepBps) > 0.02) {
          wrong.push(`${token.symbol} ${step.activationDateTime}: ${computed} vs ${step.stepBps}`)
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([])
  })

  it('never calls a declared dividend a split, and never misses a declared one', () => {
    const misread: string[] = []
    for (const token of ledger.tokens) {
      for (const step of token.steps) {
        if (!step.previousMultiplier) continue
        const toWad = (value: number) => BigInt(Math.round(value * 1e18))
        const shape = stepShape(toWad(step.previousMultiplier), toWad(step.multiplier))
        // A dividend must never reach either end: that is the rule the brief's magnitude band broke.
        if (step.reason === 'Dividend' && shape !== 'undetermined') {
          misread.push(`${token.symbol} dividend read as ${shape}`)
        }
        // A declared split that at least doubled must be recognised. One that did not is left
        // undetermined on purpose - a 3-for-2 split is a real split and is not distinguishable
        // from a large dividend by size, which is why the issuer's label is the authority.
        if (step.reason === 'Split' && shape === 'reverse-split') misread.push(`${token.symbol} split read as reverse`)
        if (step.reason === 'ReverseSplit' && shape === 'split') misread.push(`${token.symbol} reverse split read as split`)
      }
    }
    expect(misread).toEqual([])
  })

  it('the ledger says it produces no haircut, and says why', () => {
    // The refusal has to survive the data growing: 603 steps is not a reason to start pricing them.
    expect(ledger.summary.producesHaircuts).toBe(false)
    expect(ledger.summary.whyNot).toMatch(/no declared cash rate/)
    const backed = ISSUER_MECHANISMS.find((row) => row.id === 'backed-xstocks')!
    expect(backed.produces).toBe('step-ledger')
  })
})
