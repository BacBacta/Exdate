import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildYieldLedger, type YieldEventRow, type YieldReconciliationRow, type YieldTokenState } from '../src/yield.js'

/**
 * The ledger is built from SGOV's real history, the one token with three chained
 * steps: July (before the issuer's feed begins, unmatched), August (paired with
 * the issuer's 0.306812 dividend and priced, matched at a 33.78 % haircut) and
 * September (unmatched again, the issuer's feed no longer lists it). Plus the
 * issuer's declared October payment, not yet on chain.
 *
 * What is pinned here is not arithmetic - reconcile.test.ts owns that - but the
 * claims the ledger is allowed to make: which rows get to be called yield, when
 * the totals may exist at all, and that no per-annum number can appear anywhere.
 */

const WAD = 10n ** 18n
const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const SGOV_ADDRESS = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
const SERIES = '0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67'

const M0 = WAD
const M1 = 1_000_957_519_890_990_718n
const M2 = 1_002_981_519_346_766_532n
const M3 = 1_005_101_770_003_214_918n
const stepWad = (from: bigint, to: bigint) => ((to - from) * WAD) / from

/** Real logs, with their transaction hashes, from data/multiplier-events.observed.json. */
const observed = JSON.parse(
  readFileSync(new URL('../../../data/multiplier-events.observed.json', import.meta.url), 'utf8'),
) as {
  scannedFromBlock: number
  scannedThroughBlock: number
  scannedAt: string
  events: { token: string; block: number; announcedAt: string; effectiveAt: string; tx?: string; transactionHash?: string }[]
}
const sgovEvents: YieldEventRow[] = observed.events
  .filter((event) => event.token.toLowerCase() === SGOV_ADDRESS.toLowerCase())
  .map((event) => ({
    effectiveAt: at(event.effectiveAt),
    announcedAt: at(event.announcedAt),
    announcedBlock: BigInt(event.block),
    announcedTx: event.tx ?? event.transactionHash ?? '0x',
    announcementCount: 1,
    source: 'onchain:scan',
  }))
const scan = { fromBlock: observed.scannedFromBlock, throughBlock: observed.scannedThroughBlock, scannedAt: observed.scannedAt }

const polledAt = at('2026-09-02T18:34:20Z')
const now = at('2026-09-02T18:45:00Z')

const token: YieldTokenState = {
  chainId: 4663,
  address: SGOV_ADDRESS,
  symbol: 'SGOV',
  decimals: 18,
  issuer: 'Robinhood Assets (Jersey) Limited',
  uiMultiplier: M3,
  sampledAt: polledAt,
  feedProxy: '0xa0DF4ee0fFf975306345875E3548Fcc519577A11',
  feedVerified: false,
}

const blank = {
  confidence: 'low',
  actionId: null,
  actionType: null,
  actionStatus: null,
  processDate: null,
  rate: null,
  lagDays: null,
  priceWad: null,
  priceRoundId: null,
  priceUpdatedAt: null,
  priceStalenessSeconds: null,
  priceAtPhaseFloor: null,
  expectedStepWad: null,
  receivedPerShareWad: null,
  impliedHaircutBps: null,
  impliedReinvestPriceWad: null,
}

const unmatched = (id: string, effectiveAt: string, from: bigint, to: bigint): YieldReconciliationRow => ({
  ...blank,
  id,
  status: 'unmatched',
  note: 'on-chain step with no issuer row',
  effectiveAt: at(effectiveAt),
  oldMultiplier: from,
  newMultiplier: to,
  observedStepWad: stepWad(from, to),
  feed: token.feedProxy,
})

// Values as the reconciliation pass stores them: the round is the token price
// (100.57120681, multiplier included); 0.203167 received against 0.306812
// declared is the 3378 bps haircut of docs/phase-0-verification.md §12.
const august: YieldReconciliationRow = {
  ...blank,
  id: `${SERIES}:2026-08-06`,
  status: 'matched',
  note: null,
  actionId: SERIES,
  actionType: 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND',
  actionStatus: 'CORPORATE_ACTION_STATUS_COMPLETED',
  processDate: '2026-08-06',
  rate: '0.306812',
  effectiveAt: at('2026-08-07T15:10:24Z'),
  oldMultiplier: M1,
  newMultiplier: M2,
  observedStepWad: stepWad(M1, M2),
  lagDays: 1,
  feed: token.feedProxy,
  priceWad: 100_571_206_810_000_000_000n,
  priceRoundId: 18_446_744_073_709_551_646n,
  priceUpdatedAt: at('2026-08-07T00:01:33Z'),
  priceStalenessSeconds: 54_531,
  priceAtPhaseFloor: false,
  expectedStepWad: 3_053_615_327_227_618n,
  receivedPerShareWad: 203_167_000_000_000_000n,
  impliedHaircutBps: 3378,
  impliedReinvestPriceWad: 151_732_100_000_000_000_000n,
}

const july = unmatched(`${SGOV_ADDRESS.toLowerCase()}:${at('2026-07-08T20:14:32Z')}`, '2026-07-08T20:14:32Z', M0, M1)
const september = unmatched(`${SGOV_ADDRESS.toLowerCase()}:${at('2026-09-01T00:00:26Z')}`, '2026-09-01T00:00:26Z', M2, M3)

const declaredOctober: YieldReconciliationRow = {
  ...blank,
  id: `${SERIES}:2026-09-04`,
  status: 'pending',
  note: 'declared by the issuer, not yet processed',
  actionId: SERIES,
  actionType: 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND',
  actionStatus: 'CORPORATE_ACTION_STATUS_IN_PROGRESS',
  processDate: '2026-09-04',
  rate: '0.307098',
  effectiveAt: null,
  oldMultiplier: null,
  newMultiplier: null,
  observedStepWad: null,
  feed: token.feedProxy,
}

const build = (overrides: Partial<Parameters<typeof buildYieldLedger>[0]> = {}) =>
  buildYieldLedger({
    token,
    reconciliations: [september, declaredOctober, august, july],
    events: sgovEvents,
    scan,
    nowSeconds: now,
    matchWindowDays: 4,
    ...overrides,
  })

describe('the SGOV ledger', () => {
  it('reads the three real logs from the committed scan', () => {
    expect(sgovEvents).toHaveLength(3)
  })

  it('lists every distribution in time order, the declared one last', () => {
    const ledger = build().ledger
    expect(ledger.map((row) => row.status)).toEqual(['unmatched', 'matched', 'unmatched', 'pending'])
    expect(ledger.map((row) => row.observed?.effectiveAt ?? row.declared?.processDate)).toEqual([
      '2026-07-08T20:14:32.000Z',
      '2026-08-07T15:10:24.000Z',
      '2026-09-01T00:00:26.000Z',
      '2026-09-04',
    ])
  })

  it('carries the announcement from the log onto the observed side', () => {
    const row = build().ledger[1]!
    expect(row.observed?.announcedAt).toBe('2026-08-07T15:00:36.000Z')
    expect(row.observed?.announcementLeadSeconds).toBe(588)
    expect(row.observed?.applied).toBe(true)
    expect(row.observed?.source).toBe('onchain:scan')
  })

  it('states the underlying price it reconciled against, and how it got it', () => {
    const price = build().ledger[1]!.price!
    expect(price.tokenPrice).toBe('100.57120681')
    expect(price.multiplierBefore).toBe(M1.toString())
    // 100.57120681 / 1.000957519890990718 - the dataset prints it as 100.4750.
    expect(Number(price.underlyingPrice)).toBeCloseTo(100.475, 3)
    expect(price.underlyingPriceDerivation).toBe('tokenPrice / multiplierBefore')
    expect(price.answerIncludesMultiplier).toBe(true)
    expect(price.feedVerified).toBe(false)
  })

  it('calls the paired dividend yield and nothing else', () => {
    const [july, august, september] = build().ledger
    expect(august!.kind).toBe('dividend')
    expect(august!.observed?.netYieldBps).toBeCloseTo(20.22, 2)
    expect(august!.result.netYieldBps).toBeCloseTo(20.22, 2)
    expect(august!.result.grossYieldBps).toBeCloseTo(30.54, 2)
    expect(august!.result.haircutBps).toBe(3378)
    expect(august!.result.receivedPerShare).toBe('0.203167')

    for (const row of [july!, september!]) {
      expect(row.kind).toBe('unknown')
      expect(row.observed?.stepBps).toBeGreaterThan(0)
      expect(row.observed?.netYieldBps).toBeNull()
      expect(row.result.netYieldBps).toBeNull()
      expect(row.result.haircutBps).toBeNull()
      expect(row.result.grossYieldBps).toBeNull()
    }
  })

  it('keeps the declared payment separate from anything observed', () => {
    const declared = build().ledger[3]!
    expect(declared.observed).toBeNull()
    expect(declared.price).toBeNull()
    expect(declared.declared?.grossPerUnderlyingShare).toBe('0.307098')
    expect(declared.declared?.processDateIsNotExDate).toBe(true)
    expect(declared.overdue).toBe(false) // processDate is still two days out
    expect(declared.key).toContain(SERIES)
  })

  it('closes: the last step reaches the multiplier read at the head', () => {
    const { coverage, totals } = build()
    expect(coverage.multiplierAtWindowStart).toBe(WAD.toString())
    expect(coverage.multiplierNow).toBe(M3.toString())
    expect(coverage.closes).toBe(true)
    expect(coverage.startIsInception).toBe(true)
    expect(coverage.liveFromBlock).toBe(scan.throughBlock + 1)
    expect(totals).not.toBeNull()
    expect(totals!.distributionsObserved).toBe(3)
    expect(totals!.underlyingSharesGrowthBps).toBeCloseTo(51.02, 2)
  })

  it('splits growth into the part dividends explain and the part nothing does', () => {
    const totals = build().totals!
    expect(totals.dividendEvents).toBe(1)
    expect(totals.dividendGrowthBps).toBeCloseTo(20.22, 2)
    expect(totals.unexplainedEvents).toBe(2)
    // (1 + 9.58 bps)(1 + 21.14 bps) - 1, compounded, not summed.
    expect(totals.unexplainedGrowthBps).toBeCloseTo(30.74, 1)
    // And the two compound back to the whole.
    const recompounded = (1 + totals.dividendGrowthBps / 1e4) * (1 + totals.unexplainedGrowthBps / 1e4) - 1
    expect(recompounded * 1e4).toBeCloseTo(totals.underlyingSharesGrowthBps!, 3)
    expect(totals.declaredNotLanded).toBe(1)
    // July's 562 s (20:05:10 -> 20:14:32) is the shortest of the three leads.
    expect(totals.minAnnouncementLeadSeconds).toBe(562)
  })

  it('refuses every rate, with a reason a machine can read', () => {
    const { notComputed } = build()
    const byField = Object.fromEntries(notComputed.map((entry) => [entry.field, entry.reasonCode]))
    expect(byField).toEqual({
      annualizedYield: 'no_observed_schedule',
      trailingTwelveMonthYield: 'window_shorter_than_period',
      forwardYield: 'delivery_not_demonstrated',
      expectedHaircut: 'insufficient_reconciliations',
    })
    expect(notComputed.find((entry) => entry.field === 'annualizedYield')?.detail).toContain('3 distribution(s)')
  })

  it('has no per-annum, trailing or forward field anywhere outside notComputed', () => {
    const { notComputed: _, ...rest } = build()
    const keys: string[] = []
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object')
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key)
          walk(inner)
        }
    }
    walk(rest)
    expect(keys.filter((key) => /annual|apy|apr|trailing|forward|ttm/i.test(key))).toEqual([])
    expect(rest.basis).toBe('per_distribution_not_annualized')
  })
})

describe('when the ledger cannot vouch for itself', () => {
  it('withholds totals while the poll lags the last step', () => {
    // Polled at 23:55 on 08-31; the September step took effect five minutes later.
    const result = build({ token: { ...token, uiMultiplier: M2, sampledAt: at('2026-08-31T23:55:00Z') } })
    expect(result.coverage.closes).toBeNull()
    expect(result.coverage.closesBasis).toContain('poll_lags_last_step')
    expect(result.totals).toBeNull()
    expect(result.notComputed.find((entry) => entry.field === 'totals')?.reasonCode).toBe('poll_lags_last_step')
  })

  it('withholds totals when a step is missing from the ledger', () => {
    // Head reads M3 but the ledger stops at M2: something fell between scan and sweep.
    const result = build({ reconciliations: [july, august, declaredOctober] })
    expect(result.coverage.closes).toBe(false)
    expect(result.totals).toBeNull()
    expect(result.notComputed.find((entry) => entry.field === 'totals')?.reasonCode).toBe('ledger_does_not_close')
  })

  it('withholds totals for a token never polled', () => {
    const result = build({ token: { ...token, uiMultiplier: null, sampledAt: null } })
    expect(result.coverage.closes).toBeNull()
    expect(result.coverage.multiplierNow).toBeNull()
    expect(result.totals).toBeNull()
    expect(result.notComputed.find((entry) => entry.field === 'totals')?.reasonCode).toBe('not_yet_polled')
  })

  it('flags a declared dividend past the pairing window as overdue', () => {
    // BND: COMPLETED by the issuer on 08-05, multiplier still 1.0 four weeks later.
    const result = build({
      reconciliations: [{ ...declaredOctober, id: 'bnd', processDate: '2026-08-05', actionStatus: 'CORPORATE_ACTION_STATUS_COMPLETED' }],
    })
    expect(result.ledger[0]!.overdue).toBe(true)
    expect(result.ledger[0]!.declared?.daysSinceProcessDate).toBe(28)
  })

  it('never lets a split read as yield', () => {
    // CRWD's x4 on 2026-07-02 paired with a forward split.
    const split: YieldReconciliationRow = {
      ...august,
      id: 'crwd-split',
      status: 'matched',
      actionType: 'CORPORATE_ACTION_TYPE_FORWARD_SPLIT',
      rate: null,
      oldMultiplier: WAD,
      newMultiplier: 4n * WAD,
      observedStepWad: 3n * WAD,
      priceWad: null,
      expectedStepWad: null,
      receivedPerShareWad: null,
      impliedHaircutBps: null,
      impliedReinvestPriceWad: null,
    }
    const result = build({
      token: { ...token, uiMultiplier: 4n * WAD },
      reconciliations: [split],
      events: [],
    })
    const row = result.ledger[0]!
    expect(row.kind).toBe('split')
    expect(row.observed?.netYieldBps).toBeNull()
    expect(row.result.netYieldBps).toBeNull()
    expect(result.totals?.dividendGrowthBps).toBe(0)
    expect(result.totals?.unexplainedGrowthBps).toBe(30_000)
    expect(result.totals?.underlyingSharesGrowthBps).toBe(30_000)
  })

  it('recomputes a step the row stores as null from the two multipliers beside it', () => {
    // An unmatched row written without observedStepWad still names both
    // multipliers; the ledger must not compound it as zero.
    const result = build({
      reconciliations: [july, august, { ...september, observedStepWad: null }, declaredOctober],
    })
    expect(result.ledger[2]!.observed?.stepBps).toBeCloseTo(21.14, 2)
    expect(result.totals?.unexplainedGrowthBps).toBeCloseTo(30.74, 1)
  })

  it('says so when the token has no feed at all', () => {
    const result = build({ token: { ...token, feedProxy: null } })
    expect(result.oracle.feed).toBeNull()
    expect(result.oracle.verified).toBeNull()
    expect(result.oracle.warning).toContain('no Chainlink feed')
  })
})
