import { describe, expect, it } from 'vitest'
import {
  buildPendingView,
  type PendingEventRow,
  type PendingReconciliationRow,
  type PendingTokenState,
} from '../src/pending.js'

/**
 * Built from the state Robinhood Chain was actually in on 2026-09-02: SGOV with
 * September's dividend declared and nothing on chain yet, BND four weeks past a
 * dividend its own issuer marks COMPLETED, and F inside the nine-minute window
 * between its announcement and its effect.
 *
 * The trap this endpoint exists to avoid is in the last two tests: `effectiveAt()`
 * is retrospective, so a token that moved three weeks ago still returns a
 * non-zero timestamp and a `newUIMultiplier` equal to its current one. Reading
 * that as pending reported nine dividends that were not coming.
 */

const WAD = 10n ** 18n
const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const now = at('2026-09-02T18:45:00Z')

const SGOV_ADDRESS = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
const BND_ADDRESS = '0x2F62fC9fAbb470C690f141c28340eD832bB27020'
const F_ADDRESS = '0x25C288E6D899b9BC30160965aD9644c67e73bE0C'
const SGOV_M3 = 1_005_101_770_003_214_918n

const baseToken: PendingTokenState = {
  chainId: 4663,
  address: SGOV_ADDRESS,
  symbol: 'SGOV',
  decimals: 18,
  issuer: 'Robinhood Assets (Jersey) Limited',
  uiMultiplier: SGOV_M3,
  newUIMultiplier: SGOV_M3,
  effectiveAt: at('2026-09-01T00:00:26Z'),
  oraclePaused: false,
  sampledAt: at('2026-09-02T18:34:20Z'),
  feedProxy: '0xa0DF4ee0fFf975306345875E3548Fcc519577A11',
  feedVerified: false,
  feedDecimals: 8,
  // The round the poller read on 2026-09-02: 100.92226805, a TOKEN price.
  feedAnswer: 10_092_226_805n,
  feedUpdatedAt: at('2026-09-02T00:01:11Z'),
}

const blank = {
  actionId: null,
  actionType: null,
  actionStatus: null,
  processDate: null,
  rate: null,
  effectiveAt: null,
  impliedHaircutBps: null,
}

/** SGOV's September dividend: declared, in progress, nothing on chain. */
const sgovDeclared: PendingReconciliationRow = {
  ...blank,
  id: '0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67:2026-09-04',
  status: 'pending',
  actionId: '0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67',
  actionType: 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND',
  actionStatus: 'CORPORATE_ACTION_STATUS_IN_PROGRESS',
  processDate: '2026-09-04',
  rate: '0.307098',
}

/** August's, already reconciled at a 33.78 % haircut. History, not a forecast. */
const sgovMatched: PendingReconciliationRow = {
  ...blank,
  id: '0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67:2026-08-06',
  status: 'matched',
  actionId: '0x000000000000000000000000000000005f7e82ad6e4c4b60ba76497863fe4a67',
  actionType: 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND',
  actionStatus: 'CORPORATE_ACTION_STATUS_COMPLETED',
  processDate: '2026-08-06',
  rate: '0.306812',
  effectiveAt: at('2026-08-07T15:10:24Z'),
  impliedHaircutBps: 3378,
}

const build = (overrides: Partial<Parameters<typeof buildPendingView>[0]> = {}) =>
  buildPendingView({
    token: baseToken,
    reconciliations: [sgovDeclared, sgovMatched],
    events: [],
    nowSeconds: now,
    matchWindowDays: 4,
    ...overrides,
  })

describe('SGOV, one dividend declared and none scheduled on chain', () => {
  it('reports nothing scheduled, because the views merely echo the last change', () => {
    const result = build()
    expect(result.scheduled).toBeNull()
    expect(result.state).toBe('indexed')
    expect(result.summary.scheduledOnChain).toBe(0)
  })

  it('lists a dividend whose process date is still ahead as upcoming, not awaiting', () => {
    // `awaiting` carries a claim - the chain should move within the window - and
    // that claim is false for a date that has not arrived. Nothing is owed yet.
    const [row] = build().declared
    expect(build().declared).toHaveLength(1)
    expect(row!.state).toBe('upcoming')
    expect(row!.daysSinceProcessDate).toBe(-2) // processDate is two days out
    expect(row!.note).toContain('2 day(s) away')
    expect(row!.grossPerUnderlyingShare).toBe('0.307098')
    expect(row!.processDateIsNotExDate).toBe(true)
    expect(row!.issuerStatus).toBe('CORPORATE_ACTION_STATUS_IN_PROGRESS')
  })

  it('turns it into awaiting once the process date has passed, still inside the window', () => {
    const [row] = build({
      reconciliations: [{ ...sgovDeclared, processDate: '2026-09-01' }, sgovMatched],
    }).declared
    expect(row!.state).toBe('awaiting')
    expect(row!.daysSinceProcessDate).toBe(1)
    expect(row!.note).toContain('inside the observed next-business-day window')
  })

  it('counts the two apart in the summary', () => {
    expect(build().summary).toMatchObject({ declaredUpcoming: 1, declaredAwaiting: 0 })
    expect(
      build({ reconciliations: [{ ...sgovDeclared, processDate: '2026-09-01' }] }).summary,
    ).toMatchObject({ declaredUpcoming: 0, declaredAwaiting: 1 })
  })

  it('converts the per-share rate into cash per token with no price at all', () => {
    // 0.307098 per underlying share x 1.005101770003214918 shares per token.
    const [row] = build().declared
    expect(Number(row!.grossPerToken)).toBeCloseTo(0.3086647, 7)
  })

  it('projects the step a full payment would produce, from the latest round', () => {
    const projection = build().declared[0]!.projection!
    expect(projection.tokenPrice).toBe('100.92226805')
    // 100.92226805 / 1.005101770003214918 - the multiplier is divided out, never applied.
    expect(Number(projection.underlyingPrice)).toBeCloseTo(100.41, 2)
    expect(projection.underlyingPriceDerivation).toBe('tokenPrice / uiMultiplier')
    expect(projection.stepBpsIfPaidInFull).toBeCloseTo(30.58, 2)
    expect(projection.notAMeasurement).toBe(true)
    expect(projection.basis).toContain('not the price at effectiveAt')
    expect(projection.feedStatus).toBe('live')
  })

  it('carries the measured haircut as history and applies it to nothing', () => {
    const result = build()
    expect(result.history.reconciledDividends).toBe(1)
    expect(result.history.lastObservedHaircutBps).toBe(3378)
    expect(result.history.lastObservedAt).toBe('2026-08-07T15:10:24.000Z')
    // The projection is gross: it does not quietly apply the 33.78 % it just reported.
    expect(result.declared[0]!.projection!.stepBpsIfPaidInFull).toBeGreaterThan(30)
  })

  it('refuses to say when it will land or how much will survive', () => {
    const byField = Object.fromEntries(build().notComputed.map((entry) => [entry.field, entry.reasonCode]))
    expect(byField).toEqual({
      expectedEffectiveAt: 'announcement_lead_is_minutes',
      expectedStepBps: 'haircut_not_forecastable',
      netAmountOwed: 'withholding_undocumented',
    })
  })
})

describe('BND, declared complete by the issuer and absent from the chain', () => {
  const bnd: PendingTokenState = {
    ...baseToken,
    address: BND_ADDRESS,
    symbol: 'BND',
    uiMultiplier: WAD,
    newUIMultiplier: WAD,
    effectiveAt: 0n, // never moved
    feedProxy: null,
    feedDecimals: null,
    feedAnswer: null,
    feedUpdatedAt: null,
  }
  const declared: PendingReconciliationRow = {
    ...blank,
    id: '0x000000000000000000000000000000006604af6b5c4a4031a29417ec8c2f8c53:2026-08-05',
    status: 'pending',
    actionId: '0x000000000000000000000000000000006604af6b5c4a4031a29417ec8c2f8c53',
    actionType: 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND',
    actionStatus: 'CORPORATE_ACTION_STATUS_COMPLETED',
    processDate: '2026-08-05',
    rate: '0.25155',
  }
  const result = () => build({ token: bnd, reconciliations: [declared] })

  it('separates "the issuer says it is done" from "it is late"', () => {
    const row = result().declared[0]!
    expect(row.state).toBe('declared_complete_not_on_chain')
    expect(row.daysSinceProcessDate).toBe(28)
    expect(row.note).toContain('the multiplier has not moved')
  })

  it('counts it in the summary and reports how long it has been outstanding', () => {
    const { summary } = result()
    expect(summary).toMatchObject({
      scheduledOnChain: 0,
      declaredUpcoming: 0,
      declaredAwaiting: 0,
      declaredOverdue: 1,
      declaredCompleteNotOnChain: 1,
      longestOverdueDays: 28,
      nothingPending: false,
    })
  })

  it('offers no projection at all rather than inventing a price', () => {
    const row = result().declared[0]!
    expect(row.projection).toBeNull()
    // The cash owed per token needs no price, so it is still stated.
    expect(row.grossPerToken).toBe('0.25155')
    expect(result().oracle.feed).toBeNull()
    expect(result().oracle.warning).toContain('no Chainlink feed')
  })

  it('reports an in-progress action past the window as overdue, not as complete', () => {
    const inProgress = { ...declared, actionStatus: 'CORPORATE_ACTION_STATUS_IN_PROGRESS' }
    const row = build({ token: bnd, reconciliations: [inProgress] }).declared[0]!
    expect(row.state).toBe('overdue')
    expect(row.note).toContain('28 days after')
  })
})

describe('F, inside the announcement window', () => {
  // Announced 2026-09-02T15:00:41Z, effective 15:10:26Z: 9 min 45 s of warning.
  const effectiveAt = at('2026-09-02T15:10:26Z')
  const newMultiplier = 1_000_145_502_866_134_027n
  const announcement: PendingEventRow = {
    effectiveAt,
    announcedAt: at('2026-09-02T15:00:41Z'),
    announcedTx: '0x17717969d77a298b876c0c3c735b6367ee1f75e1906f67953a6a30dc35cc442e',
    announcementCount: 1,
    source: 'onchain:scan',
  }
  const duringWindow: PendingTokenState = {
    ...baseToken,
    address: F_ADDRESS,
    symbol: 'F',
    uiMultiplier: WAD,
    newUIMultiplier: newMultiplier,
    effectiveAt,
    feedProxy: null,
    feedDecimals: null,
    feedAnswer: null,
    feedUpdatedAt: null,
  }

  it('reports the scheduled change with the seconds left on the clock', () => {
    const result = build({
      token: duringWindow,
      reconciliations: [],
      events: [announcement],
      nowSeconds: at('2026-09-02T15:05:00Z'),
    })
    expect(result.scheduled).toMatchObject({
      currentMultiplier: WAD.toString(),
      newMultiplier: newMultiplier.toString(),
      effectiveAt: '2026-09-02T15:10:26.000Z',
      secondsRemaining: 326,
      announcementLeadSeconds: 585,
      announcedTx: announcement.announcedTx,
      announcementCount: 1,
    })
    expect(result.scheduled!.stepBps).toBeCloseTo(1.455, 3)
    expect(result.scheduled!.appliedBy).toContain('no event is emitted')
    expect(result.summary.scheduledOnChain).toBe(1)
  })

  it('stops reporting it the instant the clock reaches effectiveAt', () => {
    // The views do not change at effectiveAt - nothing is emitted - so at this
    // second the token still reads newUIMultiplier != uiMultiplier. Only the
    // clock separates "coming" from "already happened".
    const result = build({
      token: duringWindow,
      reconciliations: [],
      events: [announcement],
      nowSeconds: effectiveAt,
    })
    expect(result.scheduled).toBeNull()
  })

  it('does not read the retrospective views of a token that moved hours ago as pending', () => {
    // F after the change: the poller has re-read uiMultiplier, and effectiveAt
    // still holds 15:10:26 - a past timestamp on a token with nothing pending.
    const applied = { ...duringWindow, uiMultiplier: newMultiplier, newUIMultiplier: newMultiplier }
    const result = build({ token: applied, reconciliations: [], events: [announcement] })
    expect(result.scheduled).toBeNull()
    expect(result.summary.nothingPending).toBe(true)
  })
})

describe('the empty and unknown states', () => {
  it('says plainly that nothing is pending rather than returning an error', () => {
    const result = build({ reconciliations: [sgovMatched] })
    expect(result.declared).toEqual([])
    expect(result.scheduled).toBeNull()
    expect(result.summary.nothingPending).toBe(true)
    expect(result.summary.longestOverdueDays).toBeNull()
    // History survives: the token has been reconciled before.
    expect(result.history.reconciledDividends).toBe(1)
  })

  it('says a token has not been polled instead of reporting it as quiet', () => {
    const result = build({
      token: { ...baseToken, uiMultiplier: null, newUIMultiplier: null, effectiveAt: null, sampledAt: null },
      reconciliations: [sgovDeclared],
    })
    expect(result.state).toBe('not_yet_polled')
    expect(result.multiplier.current).toBeNull()
    expect(result.scheduled).toBeNull()
    // The issuer's side is independent of the poller, so it is still listed -
    // but with no multiplier there is neither cash per token nor a projection.
    expect(result.declared).toHaveLength(1)
    expect(result.declared[0]!.grossPerToken).toBeNull()
    expect(result.declared[0]!.projection).toBeNull()
  })

  it('orders several declared dividends by the issuer date', () => {
    const older = { ...sgovDeclared, id: 'older', processDate: '2026-07-04' }
    const result = build({ reconciliations: [sgovDeclared, older] })
    expect(result.declared.map((row) => row.processDate)).toEqual(['2026-07-04', '2026-09-04'])
    expect(result.summary.declaredOverdue).toBe(1)
    expect(result.summary.longestOverdueDays).toBe(60)
  })
})
