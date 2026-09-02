import type { Address, Hex } from 'viem'

/**
 * The API is a pure HTTP + serialisation layer over a repository. Whoever owns
 * the database implements {@link Repository}; the routes never build SQL. That
 * keeps this package deployable on its own and keeps the Ponder-specific
 * drizzle types out of the Next.js bundle.
 */

export interface TokenRow {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  isin: string | null
  issuer: string
  status: string
  logoUrl: string | null
  feedProxy: Address | null
  feedDecimals: number | null
  feedVerified: boolean

  /** From token_states. Null until the poller has run at least once. */
  uiMultiplier: bigint | null
  newUIMultiplier: bigint | null
  effectiveAt: bigint | null
  oraclePaused: boolean | null
  totalSupplyUI: bigint | null
  sampledAt: bigint | null

  /** From feed_states, when the token has a feed and it has been polled. */
  feedRoundId: bigint | null
  feedAnswer: bigint | null
  feedUpdatedAt: bigint | null
  feedSampledAt: bigint | null

  /** From multiplier_events. */
  eventCount: number
  lastEventEffectiveAt: bigint | null
  lastEventOldMultiplier: bigint | null
  lastEventNewMultiplier: bigint | null
  lastEventAnnouncedAt: bigint | null
  lastEventAnnouncedTx: Hex | null
  lastEventAnnouncementCount: number | null
  lastEventSource: string | null
}

export interface MultiplierEventRow {
  chainId: number
  token: Address
  effectiveAt: bigint
  oldMultiplier: bigint
  newMultiplier: bigint
  announcedAt: bigint
  announcedBlock: bigint
  announcedTx: Hex
  lastAnnouncedAt: bigint
  lastAnnouncedTx: Hex
  announcementCount: number
  kind: string
  /** 'onchain:indexer' or 'onchain:scan'. Both are real logs. */
  source: string
}

export interface CorporateActionRow {
  id: string
  chainId: number
  token: Address | null
  symbol: string
  underlyingSymbol: string | null
  type: string
  status: string
  processDate: string | null
  rate: string | null
  oldRate: string | null
  newRate: string | null
  source: string
}

export interface ReconciliationRow {
  id: string
  chainId: number
  token: Address | null
  symbol: string
  actionId: string | null
  actionType: string | null
  actionStatus: string | null
  processDate: string | null
  rate: string | null
  effectiveAt: bigint | null
  oldMultiplier: bigint | null
  newMultiplier: bigint | null
  observedStepWad: bigint | null
  lagDays: number | null
  feed: Address | null
  priceWad: bigint | null
  priceRoundId: bigint | null
  priceUpdatedAt: bigint | null
  priceStalenessSeconds: number | null
  priceAtPhaseFloor: boolean | null
  expectedStepWad: bigint | null
  receivedPerShareWad: bigint | null
  impliedHaircutBps: number | null
  impliedReinvestPriceWad: bigint | null
  status: string
  confidence: string
  note: string | null
  computedAt: bigint
}

export interface Repository {
  /** Joined token + latest state + latest feed round + event summary. */
  tokens(chainId: number): Promise<TokenRow[]>
  token(chainId: number, address: string): Promise<TokenRow | null>
  multiplierEvents(chainId: number, address?: string): Promise<MultiplierEventRow[]>
  corporateActions(chainId: number): Promise<CorporateActionRow[]>
  reconciliations(chainId: number, address?: string): Promise<ReconciliationRow[]>
}
