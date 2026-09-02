import { describe, expect, it } from 'vitest'
import { createApi } from '../src/index.js'
import type { MultiplierEventRow, ReconciliationRow, Repository, TokenRow } from '../src/types.js'

/**
 * F on 2026-09-02, mid-announcement: the log is on chain at 15:00:41 and the
 * change takes effect at 15:10:26. The route is asked at 15:05, so `scheduled`
 * must be populated - and the same fixture with the clock moved past the effect
 * must report nothing pending, since no event is ever emitted at that instant.
 */

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const WAD = 10n ** 18n
const F = '0x25C288E6D899b9BC30160965aD9644c67e73bE0C'
const NEW_MULTIPLIER = 1_000_145_502_866_134_027n
const EFFECTIVE_AT = at('2026-09-02T15:10:26Z')

const token: TokenRow = {
  chainId: 4663,
  address: F,
  symbol: 'F',
  name: 'Ford Motor • Robinhood Token',
  decimals: 18,
  isin: 'US3453708600',
  issuer: 'Robinhood Assets (Jersey) Limited',
  status: 'ASSET_STATUS_ACTIVE',
  logoUrl: null,
  feedProxy: null,
  feedDecimals: null,
  feedVerified: false,
  uiMultiplier: WAD,
  newUIMultiplier: NEW_MULTIPLIER,
  effectiveAt: EFFECTIVE_AT,
  oraclePaused: false,
  totalSupplyUI: 8_199_934_569_975_794_798_092n,
  sampledAt: at('2026-09-02T15:04:00Z'),
  feedRoundId: null,
  feedAnswer: null,
  feedUpdatedAt: null,
  feedSampledAt: null,
  eventCount: 1,
  lastEventEffectiveAt: EFFECTIVE_AT,
  lastEventOldMultiplier: WAD,
  lastEventNewMultiplier: NEW_MULTIPLIER,
  lastEventAnnouncedAt: at('2026-09-02T15:00:41Z'),
  lastEventAnnouncedTx: '0x17717969d77a298b876c0c3c735b6367ee1f75e1906f67953a6a30dc35cc442e',
  lastEventAnnouncementCount: 1,
  lastEventSource: 'onchain:indexer',
}

const event: MultiplierEventRow = {
  chainId: 4663,
  token: F,
  effectiveAt: EFFECTIVE_AT,
  oldMultiplier: WAD,
  newMultiplier: NEW_MULTIPLIER,
  announcedAt: at('2026-09-02T15:00:41Z'),
  announcedBlock: 52_665_452n,
  announcedTx: '0x17717969d77a298b876c0c3c735b6367ee1f75e1906f67953a6a30dc35cc442e',
  lastAnnouncedAt: at('2026-09-02T15:00:41Z'),
  lastAnnouncedTx: '0x17717969d77a298b876c0c3c735b6367ee1f75e1906f67953a6a30dc35cc442e',
  announcementCount: 1,
  kind: 'unknown',
  source: 'onchain:indexer',
}

/** The issuer's row behind it: declared 2026-09-01, $0.15, still in progress. */
const declared: ReconciliationRow = {
  id: '0x00000000000000000000000000000000952cedaaab6e4593b884e68a4efbf481:2026-09-01',
  chainId: 4663,
  token: F,
  symbol: 'F',
  actionId: '0x00000000000000000000000000000000952cedaaab6e4593b884e68a4efbf481',
  actionType: 'CORPORATE_ACTION_TYPE_CASH_DIVIDEND',
  actionStatus: 'CORPORATE_ACTION_STATUS_IN_PROGRESS',
  processDate: '2026-09-01',
  rate: '0.15',
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
  confidence: 'low',
  note: 'declared by the issuer, not yet processed',
  computedAt: at('2026-09-02T15:04:00Z'),
}

const matches = (address: string | undefined) => address?.toLowerCase() === F.toLowerCase()

const repository: Repository = {
  tokens: async () => [token],
  token: async (_chainId, address) => (matches(address) ? token : null),
  multiplierEvents: async (_chainId, address) => (address === undefined || matches(address) ? [event] : []),
  corporateActions: async () => [],
  webhookEvents: async () => [],
  webhookDeliveries: async () => [],
  reconciliations: async (_chainId, address) => (address === undefined || matches(address) ? [declared] : []),
}

const appAt = (iso: string) => createApi({ repository, now: () => at(iso) })

describe('GET /v1/:chain/tokens/:address/pending', () => {
  it('reports the announced change while the clock has not reached it', async () => {
    const response = await appAt('2026-09-02T15:05:00Z').request(`/v1/robinhood/tokens/${F}/pending`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.scheduled).toMatchObject({
      newMultiplier: NEW_MULTIPLIER.toString(),
      effectiveAt: '2026-09-02T15:10:26.000Z',
      secondsRemaining: 326,
      announcementLeadSeconds: 585,
      announcedTx: event.announcedTx,
      source: 'onchain:indexer',
    })
    expect(body.summary.scheduledOnChain).toBe(1)
    expect(body.declared).toHaveLength(1)
    expect(body.declared[0]).toMatchObject({ state: 'awaiting', grossPerUnderlyingShare: '0.15' })
    // No feed for F, so nothing is projected and the response says why.
    expect(body.declared[0].projection).toBeNull()
    expect(body.oracle.feed).toBeNull()
  })

  it('reports nothing scheduled once the change has taken effect', async () => {
    const applied: TokenRow = { ...token, uiMultiplier: NEW_MULTIPLIER }
    const app = createApi({
      repository: { ...repository, token: async () => applied, tokens: async () => [applied] },
      now: () => at('2026-09-02T18:45:00Z'),
    })
    const body = await (await app.request(`/v1/robinhood/tokens/${F}/pending`)).json()
    expect(body.scheduled).toBeNull()
    expect(body.multiplier.current).toBe(NEW_MULTIPLIER.toString())
  })

  it('is a 404 for an unknown token and for an unknown chain', async () => {
    const app = appAt('2026-09-02T15:05:00Z')
    const unknownToken = await app.request('/v1/robinhood/tokens/0x0000000000000000000000000000000000000001/pending')
    expect(unknownToken.status).toBe(404)
    const unknownChain = await app.request(`/v1/base/tokens/${F}/pending`)
    expect(unknownChain.status).toBe(404)
  })

  it('resolves the address case-insensitively', async () => {
    const response = await appAt('2026-09-02T15:05:00Z').request(
      `/v1/4663/tokens/${F.toLowerCase()}/pending`,
    )
    expect(response.status).toBe(200)
  })
})
