import { describe, expect, it } from 'vitest'
import { serializeMultiplierEvent, serializeReconciliation, serializeToken } from '../src/serialize.js'
import type { MultiplierEventRow, ReconciliationRow, TokenRow } from '../src/types.js'

/**
 * The retrospective/prospective trap, at the serialisation layer.
 *
 * `effectiveAt()` on a Stock Token is the timestamp of the last change that
 * took effect - except during the ~9-minute announcement window, when it is
 * the FUTURE instant the next change will take effect. The API must never
 * present that future instant as "when the multiplier last changed".
 */

const WAD = 10n ** 18n
const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))

// SGOV's real third event: announced 2026-08-31T23:50:51Z, effective
// 2026-09-01T00:00:26Z, 1.002981519346766532 -> 1.005101770003214918.
const SGOV: TokenRow = {
  chainId: 4663,
  address: '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5',
  symbol: 'SGOV',
  name: 'iShares 0-3 Month Treasury Bond ETF • Robinhood Token',
  decimals: 18,
  isin: 'US46436E7186',
  issuer: 'Robinhood Assets (Jersey) Limited',
  status: 'ASSET_STATUS_ACTIVE',
  logoUrl: null,
  feedProxy: '0xa0DF4ee0fFf975306345875E3548Fcc519577A11',
  feedDecimals: 8,
  feedVerified: false,
  uiMultiplier: 1_002_981_519_346_766_532n,
  newUIMultiplier: 1_005_101_770_003_214_918n,
  effectiveAt: at('2026-09-01T00:00:26Z'),
  oraclePaused: false,
  totalSupplyUI: null,
  sampledAt: at('2026-08-31T23:55:00Z'),
  feedRoundId: 18_446_744_073_709_551_665n,
  feedAnswer: 10_092_226_805n,
  feedUpdatedAt: at('2026-08-31T00:00:41Z'),
  feedSampledAt: at('2026-08-31T23:55:00Z'),
  eventCount: 3,
  lastEventEffectiveAt: at('2026-09-01T00:00:26Z'),
  lastEventOldMultiplier: 1_002_981_519_346_766_532n,
  lastEventNewMultiplier: 1_005_101_770_003_214_918n,
  lastEventAnnouncedAt: at('2026-08-31T23:50:51Z'),
  lastEventAnnouncedTx: '0xf33317c324c4d1d53278dd5c0fcb6ca3afeea41ccf39441ecada548148f5f4e7',
  lastEventAnnouncementCount: 1,
  lastEventSource: 'onchain:scan',
}

const options = { explorerUrl: 'https://robinhoodchain.blockscout.com' }

describe('serializeToken during the announcement window', () => {
  // 23:55Z: announced at 23:50:51, not in effect until 00:00:26.
  const now = at('2026-08-31T23:55:00Z')
  const out = serializeToken(SGOV, { ...options, nowSeconds: now })

  it('reports the change as scheduled, with the seconds remaining', () => {
    expect(out.multiplier.scheduled).not.toBeNull()
    expect(out.multiplier.scheduled!.effectiveAt).toBe('2026-09-01T00:00:26.000Z')
    expect(out.multiplier.scheduled!.secondsRemaining).toBe(326)
    expect(out.multiplier.scheduled!.valueDecimal).toBe('1.005101770003214918')
  })

  it('does not present the future effectiveAt as the last change', () => {
    // This was the bug: a future timestamp under "when the multiplier last changed".
    expect(out.multiplier.lastChangeEffectiveAt).toBeNull()
  })

  it('still reports the current multiplier, not the scheduled one', () => {
    expect(out.multiplier.currentDecimal).toBe('1.002981519346766532')
  })

  it('flags the last event as not yet applied', () => {
    expect(out.events.last).not.toBeNull()
    expect(out.events.last!.applied).toBe(false)
    expect(out.events.last!.announcementLeadSeconds).toBe(575)
  })
})

describe('serializeToken after the change took effect', () => {
  // The poller has since read the new views: multiplier moved, effectiveAt is
  // now in the past and newUIMultiplier mirrors uiMultiplier.
  const applied: TokenRow = {
    ...SGOV,
    uiMultiplier: 1_005_101_770_003_214_918n,
    newUIMultiplier: 1_005_101_770_003_214_918n,
    sampledAt: at('2026-09-02T15:00:00Z'),
  }
  const now = at('2026-09-02T15:00:00Z')
  const out = serializeToken(applied, { ...options, nowSeconds: now })

  it('reports nothing scheduled', () => {
    expect(out.multiplier.scheduled).toBeNull()
  })

  it('reports the effectiveAt as the last change, now that it is past', () => {
    expect(out.multiplier.lastChangeEffectiveAt).toBe('2026-09-01T00:00:26.000Z')
  })

  it('flags the last event as applied', () => {
    expect(out.events.last!.applied).toBe(true)
  })
})

describe('serializeToken for a token that has never moved', () => {
  const never: TokenRow = {
    ...SGOV,
    uiMultiplier: WAD,
    newUIMultiplier: WAD,
    effectiveAt: 0n,
    eventCount: 0,
    lastEventEffectiveAt: null,
    lastEventOldMultiplier: null,
    lastEventNewMultiplier: null,
    lastEventAnnouncedAt: null,
    lastEventAnnouncedTx: null,
    lastEventAnnouncementCount: null,
    lastEventSource: null,
  }
  const out = serializeToken(never, { ...options, nowSeconds: at('2026-09-02T15:00:00Z') })

  it('reports no last change and no scheduled change', () => {
    expect(out.multiplier.lastChangeEffectiveAt).toBeNull()
    expect(out.multiplier.scheduled).toBeNull()
    expect(out.events.last).toBeNull()
    expect(out.multiplier.currentDecimal).toBe('1')
  })
})

describe('serializeToken before the poller has run', () => {
  const unpolled: TokenRow = {
    ...SGOV,
    uiMultiplier: null,
    newUIMultiplier: null,
    effectiveAt: null,
    oraclePaused: null,
    totalSupplyUI: null,
    sampledAt: null,
    feedRoundId: null,
    feedAnswer: null,
    feedUpdatedAt: null,
    feedSampledAt: null,
  }
  const out = serializeToken(unpolled, { ...options, nowSeconds: at('2026-09-02T15:00:00Z') })

  it('says so instead of showing zeros', () => {
    expect(out.state).toBe('not_yet_polled')
    expect(out.multiplier.current).toBeNull()
    expect(out.multiplier.currentDecimal).toBeNull()
    expect(out.multiplier.lastChangeEffectiveAt).toBeNull()
  })

  it('reports the feed as unknown, with no age and no heartbeat verdict', () => {
    expect(out.feed).not.toBeNull()
    expect(out.feed!.status).toBe('unknown')
    expect(out.feed!.price).toBeNull()
    expect(out.feed!.ageSeconds).toBeNull()
    // Not false. "Within the heartbeat" is a claim about a round that does not exist.
    expect(out.feed!.beyondHeartbeat).toBeNull()
    expect(out.feed!.oraclePaused).toBeNull()
  })
})

describe('serializeToken feed health', () => {
  it('calls a 15-hour-old round live because the heartbeat is 24 hours, and says how old', () => {
    const out = serializeToken(SGOV, { ...options, nowSeconds: at('2026-08-31T15:00:00Z') })
    expect(out.feed!.status).toBe('live')
    expect(out.feed!.ageSeconds).toBe(53_959)
    expect(out.feed!.beyondHeartbeat).toBe(false)
    expect(out.feed!.price).toBe('100.92226805')
    expect(out.feed!.includesMultiplier).toBe(true)
    expect(out.feed!.verified).toBe(false)
  })

  it('reports paused when the oracle flag is set, and a failed flag read as null', () => {
    const paused = serializeToken({ ...SGOV, oraclePaused: true }, { ...options, nowSeconds: at('2026-08-31T15:00:00Z') })
    expect(paused.feed!.status).toBe('paused')
    const unread = serializeToken({ ...SGOV, oraclePaused: null }, { ...options, nowSeconds: at('2026-08-31T15:00:00Z') })
    expect(unread.feed!.status).toBe('live')
    expect(unread.feed!.oraclePaused).toBeNull()
  })

  it('reports null, not a feed, for a token with no feed', () => {
    const out = serializeToken({ ...SGOV, feedProxy: null }, { ...options, nowSeconds: at('2026-08-31T15:00:00Z') })
    expect(out.feed).toBeNull()
  })
})

describe('serializeToken provenance', () => {
  it('stamps the registry snapshot the metadata came from', () => {
    const out = serializeToken(SGOV, { ...options, nowSeconds: at('2026-09-02T15:00:00Z') })
    expect(out.registry.source).toBe('robinhood:/rhj/assets')
    expect(out.registry.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('passes the event source through', () => {
    const out = serializeToken(SGOV, { ...options, nowSeconds: at('2026-09-02T15:00:00Z') })
    expect(out.events.last!.source).toBe('onchain:scan')
  })
})

describe('serializeMultiplierEvent', () => {
  const row: MultiplierEventRow = {
    chainId: 4663,
    token: '0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931',
    effectiveAt: at('2026-07-02T13:30:00Z'),
    oldMultiplier: WAD,
    newMultiplier: 4n * WAD,
    announcedAt: at('2026-07-02T01:01:22Z'),
    announcedBlock: 978_630n,
    announcedTx: '0x07884f2f2440316a996ab3a9c0f8bce962ec872af6924745f5a04a9e9ac1d31f',
    lastAnnouncedAt: at('2026-07-02T12:15:44Z'),
    lastAnnouncedTx: '0x5dbbb9524fc402fea6786eb5a5dd40205ce8c6e848fb313eecedf7e9395f5bf0',
    announcementCount: 2,
    kind: 'unknown',
    source: 'onchain:scan',
  }

  it('derives applied from the clock and keeps both announcement hashes', () => {
    const before = serializeMultiplierEvent(row, at('2026-07-02T13:00:00Z'))
    expect(before.applied).toBe(false)
    const after = serializeMultiplierEvent(row, at('2026-07-02T13:30:00Z'))
    expect(after.applied).toBe(true)
    expect(after.announcementCount).toBe(2)
    expect(after.announcedTx).not.toBe(after.lastAnnouncedTx)
    expect(after.stepBps).toBe(30_000)
    expect(after.announcementLeadSeconds).toBe(44_918)
  })

  it('serialises every bigint as a decimal string', () => {
    const out = serializeMultiplierEvent(row, at('2026-07-02T13:30:00Z'))
    expect(out.oldMultiplier).toBe('1000000000000000000')
    expect(out.newMultiplier).toBe('4000000000000000000')
    expect(out.announcedBlock).toBe('978630')
    for (const value of Object.values(out)) expect(typeof value).not.toBe('bigint')
  })
})

describe('serializeReconciliation', () => {
  const base: ReconciliationRow = {
    id: 'a',
    chainId: 4663,
    token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    symbol: 'AAPL',
    actionId: 'a',
    actionType: 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND',
    actionStatus: 'CORPORATE_ACTION_STATUS_COMPLETED',
    processDate: '2026-08-13',
    rate: '0.27',
    effectiveAt: at('2026-08-14T15:12:46Z'),
    oldMultiplier: WAD,
    newMultiplier: 1_000_566_080_061_092_436n,
    observedStepWad: 566_080_061_092_436n,
    lagDays: 1,
    feed: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0',
    priceWad: 305_171_100_000_000_000_000n,
    priceRoundId: 18_446_744_073_709_552_078n,
    priceUpdatedAt: at('2026-08-14T14:21:47Z'),
    priceStalenessSeconds: 3_059,
    priceAtPhaseFloor: false,
    expectedStepWad: 884_750_000_000_000n,
    receivedPerShareWad: 172_747_000_000_000_000n,
    impliedHaircutBps: 3_601,
    impliedReinvestPriceWad: 476_964_300_000_000_000_000n,
    status: 'matched',
    confidence: 'low',
    note: null,
    computedAt: at('2026-09-02T16:00:00Z'),
  }

  it('carries a haircut only alongside the rate and the price it came from', () => {
    const out = serializeReconciliation(base)
    expect(out.result.impliedHaircutBps).toBe(3_601)
    expect(out.declared!.grossPerShare).toBe('0.27')
    expect(out.price!.value).toBe('305.1711')
    expect(out.price!.source).toBe('chainlink:getRoundData')
  })

  it('drops the haircut when there is no price, and keeps the implied price', () => {
    const out = serializeReconciliation({
      ...base,
      feed: null,
      priceWad: null,
      priceRoundId: null,
      priceUpdatedAt: null,
      priceStalenessSeconds: null,
      priceAtPhaseFloor: null,
      expectedStepWad: null,
      receivedPerShareWad: null,
      impliedHaircutBps: null,
      status: 'anomaly',
    })
    expect(out.price).toBeNull()
    expect(out.result.impliedHaircutBps).toBeNull()
    expect(out.result.impliedReinvestPrice).toBe('476.9643')
  })

  it('never lets a stored haircut leak through without its price', () => {
    // Defensive: even if a row somehow held a haircut with no price, the
    // serialiser withholds it rather than publish an unsourced number.
    const out = serializeReconciliation({ ...base, priceWad: null })
    expect(out.result.impliedHaircutBps).toBeNull()
  })

  it('reports a pending row with neither side of the arithmetic', () => {
    const out = serializeReconciliation({
      ...base,
      effectiveAt: null,
      oldMultiplier: null,
      newMultiplier: null,
      observedStepWad: null,
      lagDays: null,
      feed: null,
      priceWad: null,
      priceRoundId: null,
      priceUpdatedAt: null,
      priceStalenessSeconds: null,
      priceAtPhaseFloor: null,
      expectedStepWad: null,
      receivedPerShareWad: null,
      impliedHaircutBps: null,
      impliedReinvestPriceWad: null,
      status: 'pending',
    })
    expect(out.observed).toBeNull()
    expect(out.price).toBeNull()
    expect(out.result.impliedHaircutBps).toBeNull()
    expect(out.declared!.processDate).toBe('2026-08-13')
  })
})
