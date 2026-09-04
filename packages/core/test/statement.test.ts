import { describe, expect, it } from 'vitest'
import {
  STATEMENT_COLUMNS,
  buildDividendStatement,
  csvField,
  statementFilename,
  statementToCsv,
  type StepExposure,
  type StepRecord,
} from '../src/holdings.js'

const SGOV = '0x92fd66527192e3e61d4ddd13322aa222de86f9b5'
const AAPL = '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'
const WAD = 10n ** 18n

const names: Record<string, { symbol: string; name: string }> = {
  [SGOV]: { symbol: 'SGOV', name: 'iShares 0-3 Month Treasury Bond' },
  [AAPL]: { symbol: 'AAPL', name: 'Apple' },
}
const meta = { name: (token: string) => names[token] ?? { symbol: token, name: token } }

const step = (over: Partial<StepRecord> = {}): StepRecord => ({
  token: SGOV,
  effectiveAt: '2026-08-07T15:10:24.000Z',
  effectiveBlock: 30_308_049,
  oldMultiplier: '1000957519890990718',
  newMultiplier: '1002981519346766532',
  rate: '0.306812',
  receivedPerShare: '0.203167',
  haircutBps: 3378,
  status: 'matched',
  hasFeed: true,
  ...over,
})

/** SGOV's real August step against a holding of 6.0143 shares, the wallet measured live. */
const matched: StepExposure = {
  step: step(),
  rawAtEffect: 6_008_600_000_000_000_000n,
  sharesBefore: 6_014_353_000_000_000_000n,
  sharesGained: 12_161_000_000_000_000n,
  declared: 1_845_075_000_000_000_000n,
  arrived: 1_221_930_000_000_000_000n,
}

describe('buildDividendStatement', () => {
  it('names the token, the shares and both dollar figures on a reconciled step', () => {
    const [row] = buildDividendStatement([matched], meta)!
    expect(row).toMatchObject({
      symbol: 'SGOV',
      name: 'iShares 0-3 Month Treasury Bond',
      effectiveAt: '2026-08-07T15:10:24.000Z',
      declaredPerShare: '0.306812',
      declaredTotal: '1.845075',
      arrivedPerShare: '0.203167',
      // Unpadded: the exact value, with no trailing zero invented to fill a column.
      arrivedTotal: '1.22193',
    })
    expect(row!.sharesGained).toBe('0.012161')
    expect(row!.shortfallPercent).toBe('33.77')
    expect(row!.basis).toMatch(/price exdate measured when the step took effect/)
  })

  it('leaves a dollar figure blank rather than zero, and says why', () => {
    const noFeed: StepExposure = {
      ...matched,
      step: step({ token: AAPL, hasFeed: false, status: 'anomaly', receivedPerShare: null }),
      arrived: null,
    }
    const [row] = buildDividendStatement([noFeed], meta)!
    expect(row!.arrivedTotal).toBeNull()
    expect(row!.arrivedPerShare).toBeNull()
    expect(row!.declaredTotal).toBe('1.845075')
    expect(row!.shortfallPercent).toBeNull()
    expect(row!.basis).toMatch(/no price feed/)
  })

  it('never prints a non-zero amount as zero, which in a record reads as nothing happened', () => {
    // AAPL against 0.0142 shares: the dividend is worth thousandths of a cent.
    const dust: StepExposure = {
      ...matched,
      step: step({ token: AAPL, rate: '0.27', receivedPerShare: '0.172751' }),
      sharesBefore: 14_190_450_000_000_000n,
      sharesGained: 8_030_000_000n,
      declared: 3_831_421_500_000_000n,
      arrived: 2_451_432_000_000_000n,
    }
    const [row] = buildDividendStatement([dust], meta)!
    expect(row!.declaredTotal).toBe('0.003831')
    expect(row!.arrivedTotal).toBe('0.002451')
    // and a value too small even for six places keeps every digit rather than rounding away
    const tiny = buildDividendStatement([{ ...dust, declared: 1n, arrived: null }], meta)[0]!
    expect(tiny.declaredTotal).toBe('0.000000000000000001')
    expect(Number(tiny.declaredTotal)).toBeGreaterThan(0)
  })

  it('says when the declaration itself is gone, which is unrecoverable rather than missing', () => {
    const unmatched: StepExposure = { ...matched, step: step({ rate: null, status: 'unmatched', receivedPerShare: null }), declared: null, arrived: null }
    const [row] = buildDividendStatement([unmatched], meta)!
    expect(row!.declaredTotal).toBeNull()
    expect(row!.basis).toMatch(/unrecoverable/)
  })

  it('distinguishes a token that has a feed but does not reconcile', () => {
    const anomaly: StepExposure = { ...matched, step: step({ status: 'anomaly', hasFeed: true, receivedPerShare: null }), arrived: null }
    expect(buildDividendStatement([anomaly], meta)[0]!.basis).toMatch(/does not reconcile against the price/)
  })
})

describe('csvField', () => {
  it('quotes only what has to be quoted, and doubles an inner quote', () => {
    expect(csvField('Apple')).toBe('Apple')
    expect(csvField('Alphabet, Class A')).toBe('"Alphabet, Class A"')
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""')
    expect(csvField('line\nbreak')).toBe('"line\nbreak"')
  })

  it('writes an empty field for a value exdate does not have', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
    // and never the string "null", which a spreadsheet would show as text
    expect(csvField(null)).not.toBe('null')
  })
})

describe('statementToCsv', () => {
  it('has a header, CRLF endings and one row per exposure', () => {
    const csv = statementToCsv(buildDividendStatement([matched], meta))
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(STATEMENT_COLUMNS.map((c) => c.header).join(','))
    expect(lines[1]).toContain('SGOV')
    expect(lines[1]!.split(',').length).toBeGreaterThanOrEqual(STATEMENT_COLUMNS.length)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(lines.filter(Boolean)).toHaveLength(2)
  })

  it('keeps a comma inside a name from shifting every later column', () => {
    const withComma: StepExposure = { ...matched, step: step({ token: AAPL }) }
    const csv = statementToCsv(
      buildDividendStatement([withComma], { name: () => ({ symbol: 'GOOGL', name: 'Alphabet, Class A' }) }),
    )
    const row = csv.split('\r\n')[1]!
    expect(row).toContain('"Alphabet, Class A"')
    // The basis is the last column and must still be intact.
    expect(row.endsWith('effect')).toBe(true)
  })

  it('is just a header when the address was exposed to nothing', () => {
    expect(statementToCsv([]).trim().split('\r\n')).toHaveLength(1)
  })
})

describe('statementFilename', () => {
  it('names the address and the day, and sorts', () => {
    expect(statementFilename('0x8601015e6310726547AE737D04b4f6C6E06F58b1', '2026-09-04T07:00:00.000Z')).toBe(
      'exdate-dividends-0x8601f58b1-2026-09-04.csv',
    )
  })
})
