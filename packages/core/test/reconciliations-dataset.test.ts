import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDecimal, reconcile, rescale } from '../src/reconcile.js'

/**
 * The offline builder (scripts/build-reconciliations.mjs) and the library the API
 * will serve from (packages/core/src/reconcile.ts) implement the same arithmetic
 * twice, in two languages of their own. This test drives the committed dataset
 * back through the library and demands they agree.
 *
 * Its purpose is drift: the moment someone changes a band, a rounding rule or the
 * haircut formula in one place and not the other, a row's status flips here.
 */

const dataset = JSON.parse(
  readFileSync(new URL('../../../data/reconciliations.observed.json', import.meta.url), 'utf8'),
) as {
  matchWindowDays: number
  plausibleHaircutBps: [number, number]
  summary: Record<string, number>
  rows: {
    symbol: string
    status: string
    rate: string | null
    impliedHaircutBps?: number
    impliedReinvestPrice?: string | null
    observedStepWad?: string
    price?: {
      source?: string
      /** Chainlink only: the token price as published. */
      value?: string
      /** Both sources: the equity price the reconciliation actually used. */
      underlying?: string
    }
    issuerSpotToday?: { mid: string; impliedOverSpot: number }
    change: { oldMultiplier: string; newMultiplier: string } | null
  }[]
}

const priceable = dataset.rows.filter((row) => row.rate && row.change && row.price)

describe('the committed reconciliation dataset', () => {
  it('is not empty and its summary matches its rows', () => {
    expect(dataset.rows.length).toBeGreaterThan(0)
    for (const [key, expected] of Object.entries({
      matched: 'matched',
      anomaly: 'anomaly',
      pending: 'pending',
      unmatched: 'unmatched',
    })) {
      expect(dataset.summary[key]).toBe(dataset.rows.filter((row) => row.status === expected).length)
    }
    expect(dataset.summary.total).toBe(dataset.rows.length)
  })

  it('agrees with the library on every priceable row', () => {
    expect(priceable.length).toBeGreaterThan(0)
    for (const row of priceable) {
      // Two price sources reach the same function by different doors: a Chainlink
      // round is the token price and has its multiplier unwound inside, while the
      // issuer's quote is already the underlying and is used as it is. A row says
      // which it used, and the library must agree either way.
      const fromIssuer = row.price!.source === 'robinhood:/rhj/prices'
      const result = reconcile({
        rateWad: parseDecimal(row.rate as string, 18),
        // The builder stores the price already scaled to the feed's own decimals
        // as a plain decimal string; parse it back the same way the API will.
        priceWad: fromIssuer ? undefined : parseDecimal(row.price!.value as string, 18),
        underlyingPriceWad: fromIssuer ? parseDecimal(row.price!.underlying as string, 18) : undefined,
        oldMultiplier: BigInt(row.change!.oldMultiplier),
        newMultiplier: BigInt(row.change!.newMultiplier),
        observedEventCount: 1,
      })
      expect(result.priceSource, `${row.symbol} price source`).toBe(fromIssuer ? 'issuer:quote' : 'chainlink:round')
      expect(result.status, `${row.symbol} status`).toBe(row.status)
      expect(result.impliedHaircutBps, `${row.symbol} haircut`).toBe(row.impliedHaircutBps)
      expect(result.observedStepWad!.toString(), `${row.symbol} step`).toBe(row.observedStepWad)
    }
  })

  it('uses the same plausibility band as the library default', () => {
    // Both sides hardcode [-100, 5000] bps. If either moves, one of these fails.
    expect(dataset.plausibleHaircutBps).toEqual([-100, 5_000])
    const justInside = reconcile({
      rateWad: parseDecimal('1', 18),
      priceWad: parseDecimal('100', 18),
      oldMultiplier: 10n ** 18n,
      // $1 a share reinvested at $100 would raise the multiplier by 1e16 (100 bps).
      // Half of that, 5e15, delivers $0.50 - exactly 5000 bps of haircut, the
      // upper edge of the plausible band.
      newMultiplier: 10n ** 18n + 5n * 10n ** 15n,
      observedEventCount: 1,
    })
    expect(justInside.impliedHaircutBps).toBe(5_000)
    expect(justInside.status).toBe('matched')
  })

  it('uses the same match window as the library', () => {
    expect(dataset.matchWindowDays).toBe(4)
  })
})

describe('what the dataset actually observed', () => {
  const bySymbol = (symbol: string, status?: string) =>
    dataset.rows.filter((row) => row.symbol === symbol && (status === undefined || row.status === status))

  it('reconciles AAPL and SGOV into the same haircut band', () => {
    // Two unrelated underlyings, two independent Chainlink feeds, one number.
    // If this ever splits, either the model or an input changed.
    const aapl = bySymbol('AAPL', 'matched')[0]
    const sgov = bySymbol('SGOV', 'matched')[0]
    expect(aapl?.impliedHaircutBps).toBeGreaterThan(3_500)
    expect(aapl?.impliedHaircutBps).toBeLessThan(3_700)
    expect(sgov?.impliedHaircutBps).toBeGreaterThan(3_300)
    expect(sgov?.impliedHaircutBps).toBeLessThan(3_500)
  })

  it('separates matched from anomalous rows by implied price over spot', () => {
    // The discriminator that works even for the 159 tokens with no Chainlink
    // feed: a reinvestment that really happened implies a price near spot.
    const withRatio = dataset.rows.filter((row) => row.issuerSpotToday)
    expect(withRatio.length).toBeGreaterThan(0)
    for (const row of withRatio) {
      const ratio = row.issuerSpotToday!.impliedOverSpot
      if (row.status === 'matched') {
        expect(ratio, `${row.symbol} matched but implies a price far from spot`).toBeGreaterThan(1)
        expect(ratio, `${row.symbol} matched but implies a price far from spot`).toBeLessThan(2)
      } else {
        expect(
          ratio < 1 || ratio > 2,
          `${row.symbol} is an anomaly yet implies a price close to spot (${ratio})`,
        ).toBe(true)
      }
    }
  })

  it('reports declared dividends that never reached the chain as pending, not as zero', () => {
    const pending = dataset.rows.filter((row) => row.status === 'pending')
    expect(pending.length).toBeGreaterThan(0)
    for (const row of pending) {
      expect(row.change, `${row.symbol} pending row must have no on-chain step`).toBeNull()
      expect(row.impliedHaircutBps, `${row.symbol} pending row must not carry a haircut`).toBeUndefined()
    }
  })

  it('reports on-chain steps the issuer feed cannot explain as unmatched, not as a haircut', () => {
    // The issuer's corporate-action history is only about a month deep, so July's
    // events have no counterpart. That absence is a finding, not a zero.
    const unmatched = dataset.rows.filter((row) => row.status === 'unmatched')
    expect(unmatched.length).toBeGreaterThan(0)
    for (const row of unmatched) {
      expect(row.rate, `${row.symbol} unmatched row must have no declared rate`).toBeNull()
      expect(row.impliedHaircutBps).toBeUndefined()
    }
  })

  it('never carries a haircut without a price to have derived it from', () => {
    for (const row of dataset.rows) {
      if (row.impliedHaircutBps !== undefined) {
        expect(row.price, `${row.symbol} has a haircut but no price`).toBeDefined()
        expect(row.rate, `${row.symbol} has a haircut but no declared rate`).toBeTruthy()
      }
    }
  })
})

describe('rescale', () => {
  it('converts a Chainlink 8-decimal answer to WAD without drift', () => {
    // 305.17110000 as the feed reports it.
    expect(rescale(30_517_110_000n, 8, 18)).toBe(parseDecimal('305.1711', 18))
  })
})
