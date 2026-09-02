import { describe, expect, it } from 'vitest'
import { createApi } from '../src/index.js'
import type { MultiplierEventRow, ReconciliationRow, Repository, TokenRow } from '../src/types.js'

/**
 * The route is thin - the ledger itself is pinned in @exdate/core - so what is
 * tested here is the contract around it: the address resolves case-insensitively,
 * an unknown token or chain is a 404 and never an empty ledger, and the response
 * is the ledger shape with the repository's rows in it.
 */

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))
const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'

const token: TokenRow = {
  chainId: 4663,
  address: SGOV,
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
  uiMultiplier: 1_005_101_770_003_214_918n,
  newUIMultiplier: 1_005_101_770_003_214_918n,
  effectiveAt: at('2026-09-01T00:00:26Z'),
  oraclePaused: false,
  totalSupplyUI: null,
  sampledAt: at('2026-09-02T18:34:20Z'),
  feedRoundId: null,
  feedAnswer: null,
  feedUpdatedAt: null,
  feedSampledAt: null,
  eventCount: 1,
  lastEventEffectiveAt: at('2026-09-01T00:00:26Z'),
  lastEventOldMultiplier: 1_002_981_519_346_766_532n,
  lastEventNewMultiplier: 1_005_101_770_003_214_918n,
  lastEventAnnouncedAt: at('2026-08-31T23:50:51Z'),
  lastEventAnnouncedTx: '0xf33317c324c4d1d53278dd5c0fcb6ca3afeea41ccf39441ecada548148f5f4e7',
  lastEventAnnouncementCount: 1,
  lastEventSource: 'onchain:scan',
}

const event: MultiplierEventRow = {
  chainId: 4663,
  token: SGOV,
  effectiveAt: at('2026-09-01T00:00:26Z'),
  oldMultiplier: 1_002_981_519_346_766_532n,
  newMultiplier: 1_005_101_770_003_214_918n,
  announcedAt: at('2026-08-31T23:50:51Z'),
  announcedBlock: 52_000_000n,
  announcedTx: '0xf33317c324c4d1d53278dd5c0fcb6ca3afeea41ccf39441ecada548148f5f4e7',
  lastAnnouncedAt: at('2026-08-31T23:50:51Z'),
  lastAnnouncedTx: '0xf33317c324c4d1d53278dd5c0fcb6ca3afeea41ccf39441ecada548148f5f4e7',
  announcementCount: 1,
  kind: 'unknown',
  source: 'onchain:scan',
}

const reconciliation: ReconciliationRow = {
  id: `${SGOV.toLowerCase()}:${at('2026-09-01T00:00:26Z')}`,
  chainId: 4663,
  token: SGOV,
  symbol: 'SGOV',
  actionId: null,
  actionType: null,
  actionStatus: null,
  processDate: null,
  rate: null,
  effectiveAt: at('2026-09-01T00:00:26Z'),
  oldMultiplier: 1_002_981_519_346_766_532n,
  newMultiplier: 1_005_101_770_003_214_918n,
  observedStepWad: 2_113_947_879_946_270n,
  lagDays: null,
  feed: '0xa0DF4ee0fFf975306345875E3548Fcc519577A11',
  priceWad: null,
  priceRoundId: null,
  priceUpdatedAt: null,
  priceStalenessSeconds: null,
  priceAtPhaseFloor: null,
  expectedStepWad: null,
  receivedPerShareWad: null,
  impliedHaircutBps: null,
  impliedReinvestPriceWad: null,
  status: 'unmatched',
  confidence: 'low',
  note: 'on-chain step with no issuer row',
  computedAt: at('2026-09-02T18:34:20Z'),
}

const matches = (address: string | undefined) => address?.toLowerCase() === SGOV.toLowerCase()

const repository: Repository = {
  tokens: async () => [token],
  token: async (_chainId, address) => (matches(address) ? token : null),
  multiplierEvents: async (_chainId, address) => (address === undefined || matches(address) ? [event] : []),
  corporateActions: async () => [],
  webhookEvents: async () => [],
  webhookDeliveries: async () => [],
  reconciliations: async (_chainId, address) => (address === undefined || matches(address) ? [reconciliation] : []),
}

const app = createApi({ repository, now: () => at('2026-09-02T18:45:00Z') })
const get = (path: string) => app.request(path)

describe('GET /v1/:chain/tokens/:address/yield', () => {
  it('serves the ledger for a known token', async () => {
    const response = await get(`/v1/robinhood/tokens/${SGOV}/yield`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.basis).toBe('per_distribution_not_annualized')
    expect(body.token.address).toBe(SGOV)
    expect(body.ledger).toHaveLength(1)
    expect(body.ledger[0].observed.tx).toBe(event.announcedTx)
    expect(body.ledger[0].observed.netYieldBps).toBeNull()
    expect(body.coverage.closes).toBe(true)
    expect(body.coverage.scannedFromBlock).toBe(900_000)
    expect(body.observedAt).toBe('2026-09-02T18:45:00.000Z')
    expect(body.notComputed.map((entry: { field: string }) => entry.field)).toContain('annualizedYield')
  })

  it('resolves the address case-insensitively and the chain by id', async () => {
    const response = await get(`/v1/4663/tokens/${SGOV.toLowerCase()}/yield`)
    expect(response.status).toBe(200)
  })

  it('is a 404 for an unknown token, never an empty ledger', async () => {
    const response = await get('/v1/robinhood/tokens/0x0000000000000000000000000000000000000001/yield')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'unknown token' })
  })

  it('is a 404 for an unknown chain', async () => {
    const response = await get(`/v1/base/tokens/${SGOV}/yield`)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'unknown chain' })
  })
})
