import type { buildPendingView } from '@exdate/core/pending'
import type { buildYieldLedger } from '@exdate/core/yield'

/**
 * The shapes the API serves.
 *
 * Two of them are derived from the functions that produce them, so they cannot
 * drift. The rest are declared here by hand, on purpose: this package is the
 * published contract and must not make `@exdate/api` - and the HTTP framework
 * it carries - a dependency of every consumer. `test/contract.assert.ts` proves
 * the two agree at compile time, in this repo, where both are present.
 *
 * Conventions, the same ones the API follows: every bigint is a decimal string,
 * and anything exdate has not observed is `null`, never `0` and never absent.
 */

/** The distribution ledger, exactly as `buildYieldLedger` returns it. */
export type YieldLedger = ReturnType<typeof buildYieldLedger>
/** What is owed and has not arrived, exactly as `buildPendingView` returns it. */
export type PendingView = ReturnType<typeof buildPendingView>

export type FeedStatus = 'live' | 'stale' | 'paused' | 'unknown'
export type ReconciliationStatus =
  | 'pending'
  | 'matched'
  | 'anomaly'
  | 'unmatched'
  | 'unsupported_action_type'

export interface TokenView {
  chainId: number
  address: string
  symbol: string
  name: string
  /** Null for a token whose on-chain read failed and which the registry does not know. */
  decimals: number | null
  isin: string | null
  issuer: string
  status: string
  logoUrl: string | null
  explorerUrl: string
  /** Where the symbol, name, ISIN and feed pairing came from, and how old that snapshot is. */
  registry: { source: string; generatedAt: string }
  /** 'not_yet_polled' until the poller has read the ERC-8056 views at least once. */
  state: 'indexed' | 'not_yet_polled'
  multiplier: {
    current: string | null
    currentDecimal: string | null
    /**
     * Non-null only while a change is genuinely pending - `effectiveAt` in the
     * future AND `newUIMultiplier` different from `uiMultiplier`. Outside that
     * window the on-chain views are retrospective.
     */
    scheduled: {
      value: string
      valueDecimal: string | null
      effectiveAt: string | null
      secondsRemaining: number
    } | null
    /** Null while a change is pending: the timestamp then belongs to `scheduled`. */
    lastChangeEffectiveAt: string | null
    totalSupplyUI: string | null
    sampledAt: string | null
  }
  events: {
    count: number
    last: {
      effectiveAt: string | null
      /** Derived from the clock: no log is emitted when a change takes effect. */
      applied: boolean
      announcedAt: string | null
      announcementLeadSeconds: number | null
      announcedTx: string | null
      announcementCount: number | null
      oldMultiplier: string | null
      newMultiplier: string | null
      stepBps: number | null
      source: string | null
    } | null
  }
  feed: {
    proxy: string
    /** False everywhere today: the token to feed pairing is derived from the ticker. */
    verified: boolean
    decimals: number | null
    roundId: string | null
    answer: string | null
    price: string | null
    updatedAt: string | null
    ageSeconds: number | null
    beyondHeartbeat: boolean | null
    status: FeedStatus
    oraclePaused: boolean | null
    sampledAt: string | null
    /** Always true: never multiply this answer by the multiplier again. */
    includesMultiplier: boolean
  } | null
}

export interface MultiplierEventView {
  chainId: number
  token: string
  effectiveAt: string | null
  applied: boolean
  oldMultiplier: string
  newMultiplier: string
  stepBps: number
  announcedAt: string | null
  announcementLeadSeconds: number | null
  announcedBlock: string
  announcedTx: string
  announcementCount: number
  lastAnnouncedAt: string | null
  lastAnnouncedTx: string
  kind: string
  /** Which scanner found the log: onchain:indexer | onchain:scan | onchain:sweep. */
  source: string
}

export interface ReconciliationView {
  id: string
  chainId: number
  token: string | null
  symbol: string
  status: ReconciliationStatus | string
  confidence: string
  note: string | null
  declared: {
    actionId: string | null
    type: string | null
    status: string | null
    processDate: string | null
    grossPerShare: string | null
    source: string
  } | null
  observed: {
    effectiveAt: string | null
    oldMultiplier: string | null
    newMultiplier: string | null
    stepBps: number | null
    lagDays: number | null
    source: string
  } | null
  price: {
    value: string | null
    feed: string | null
    roundId: string | null
    updatedAt: string | null
    stalenessSeconds: number | null
    atPhaseFloor: boolean | null
    source: string
  } | null
  result: {
    expectedStepBps: number | null
    receivedPerShare: string | null
    /** Present only when both a declared rate and a reference price exist. */
    impliedHaircutBps: number | null
    /** Present even with no feed - the discriminator for the 159 tokens without one. */
    impliedReinvestPrice: string | null
  }
  computedAt: string | null
}

export interface CorporateActionView {
  id: string
  issuerId: string
  chainId: number
  token: string | null
  symbol: string
  underlyingSymbol: string | null
  type: string
  status: string
  /** The issuer's scheduling day. Not the ex-date and not the payable date. */
  processDate: string | null
  rate: string | null
  oldRate: string | null
  newRate: string | null
  source: string
}

export interface TokensResponse {
  chainId: number
  count: number
  polled: number
  tokens: TokenView[]
}

export interface TokenResponse {
  token: TokenView
  events: MultiplierEventView[]
}

export interface EventsResponse {
  chainId: number
  count: number
  events: MultiplierEventView[]
}

export interface ReconciliationsResponse {
  chainId: number
  /** Always the whole picture, even under a filter. */
  counts: {
    total: number
    matched: number
    anomaly: number
    pending: number
    unmatched: number
    unsupportedActionType: number
  }
  returned: number
  reconciliations: ReconciliationView[]
}

export interface StatusResponse {
  observedAt: string
  chains: {
    chainId: number
    name: string
    tokens: number
    tokensWithFeed: number
    /** Most Stock Tokens have no Chainlink feed at all. */
    tokensWithoutFeed: number
    live: number
    stale: number
    paused: number
    unknown: number
    feeds: {
      symbol: string
      token: string
      feed: string | null
      verified: boolean
      status: FeedStatus
      ageSeconds: number | null
      beyondHeartbeat: boolean | null
      updatedAt: string | null
    }[]
  }[]
}

export interface CalendarResponse {
  observedAt: string
  chains: {
    chainId: number
    upcomingCorporateActions: CorporateActionView[]
    /** Changes genuinely pending on chain - a horizon of minutes, not weeks. */
    scheduledMultiplierUpdates: TokenView[]
  }[]
}

export interface ChainsResponse {
  chains: { key: string; chainId: number; name: string; issuer: string; explorerUrl: string }[]
}

export interface HealthResponse {
  ok: boolean
  registryGeneratedAt: string
}

export interface WebhookCatalogue {
  events: { type: string; summary: string; trigger: string }[]
  signature: {
    algorithm: string
    header: string
    format: string
    signedMaterial: string
    toleranceSeconds: number
    verify: string
    note: string
  }
  headers: { event: string; eventId: string; delivery: string }
  idempotency: { key: string; note: string }
  retries: { scheduleSeconds: readonly number[]; maxAttempts: number }
  endpointsConfigured: number
}

export interface WebhookOutboxResponse {
  chainId: number
  counts: { events: number; deliveries: number; queued: number; delivered: number; failed: number }
  endpointsConfigured: number
  returned: number
  events: {
    id: string
    type: string
    token: string | null
    createdAt: string | null
    createdBlock: string | null
    payload: unknown
    /** The exact bytes the signature covers. */
    signedBody: string
    deliveries: {
      id: string
      endpointId: string
      /** Host only: the configured URL never leaves the process. */
      host: string
      status: 'queued' | 'delivered' | 'failed' | string
      attempts: number
      nextAttemptAt: string | null
      lastAttemptAt: string | null
      deliveredAt: string | null
      responseStatus: number | null
      error: string | null
    }[]
  }[]
}
