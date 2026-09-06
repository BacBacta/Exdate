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
  /**
   * The joins an integrator already keys on, so exdate's rows match theirs without a mapping
   * table. `address` is the key: the only one of these that is first-party, unambiguous and
   * readable from the chain.
   *
   * `cusip` is the ISIN's own substring for a US ISIN, checked, and null for every other
   * jurisdiction - it is derived rather than stored, so it cannot disagree with the ISIN.
   * `figi` is OpenFIGI's country composite and is null where the asset lists in no venue in its
   * ISIN's country; `shareClassFigi` is the share class, which is what a Stock Token actually
   * represents, and resolves for all 194.
   */
  identifiers: {
    address: string
    ticker: string
    isin: string | null
    cusip: string | null
    figi: string | null
    shareClassFigi: string | null
  }
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
    /** False everywhere today: no first-party statement links a token to a feed. */
    verified: boolean
    /**
     * Behavioural evidence for the pairing. `corroboratedBy` says which kind,
     * and they are not interchangeable - see below.
     */
    corroborated: boolean
    /**
     * Which evidence carries the pairing:
     *
     *   'multiplier-step' - this token's own step was seen moving this feed by
     *      the step's own size, above the feed's round-to-round noise, with no
     *      other mapped feed closer. Causal.
     *   'traded-price' - the token's traded price repeatedly sits far closer to
     *      this feed than to any other mapped feed. Identification, and weaker:
     *      two unrelated assets can trade at one price.
     *
     * Empty when the pairing is still a bare ticker match. Presenting a
     * price-corroborated pairing as step-corroborated overstates what was
     * measured.
     */
    corroboratedBy: readonly ('multiplier-step' | 'traded-price')[]
    /** How the pairing was made in the first place. */
    pairedBy: string
    /**
     * The same feed's SVR proxy: same aggregator, same answer, same updatedAt.
     * Its round ids live in a different phase, so never pass `roundId` from one
     * proxy to `getRoundData` on the other.
     */
    svrProxy: string | null
    /** Always true, and the reason `svrProxy` cannot share `roundId`. */
    roundIdIsProxySpecific: boolean
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
  /**
   * Which behaviour carries `confidence`. Both kinds reach `medium` and they are
   * not the same claim, so read this rather than the word alone:
   * `multiplier-step` is causal - this token's own multiplier step was seen
   * moving this feed by the step's own size - while `traded-price` only
   * identifies the underlying, since two unrelated assets can trade at one
   * price. Empty means the token to feed pairing rests on a ticker match alone.
   */
  feedCorroboratedBy: readonly ('multiplier-step' | 'traded-price')[]
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

/** `/v1/me`: the caller's tier and quota. `label` is the operator's name for the key; the key is never echoed. */
export interface MeResponse {
  tier: 'anonymous' | 'key'
  label: string | null
  limitPerMinute: number
  remaining: number
  resetAt: string
  keysConfigured: number
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
  /** Null on an instance that keeps no subscription store. */
  selfService: {
    create: string
    body: { url: string; events: string; description: string }
    secretHeader: string
    manage: string
    test: string
    limits: { activePerHost: number; signupsPerHourPerClient: number; httpsOnly: boolean; publicHostsOnly: boolean }
  } | null
}

/** A self-service subscription as the API describes it to its owner. */
export interface WebhookSubscriptionView {
  id: string
  url: string
  host: string
  /** Null means every event type. */
  events: string[] | null
  description: string | null
  createdAt: string
  revokedAt: string | null
  status: 'active' | 'revoked'
}

/** The answer to a subscription: the secret, once. */
export interface WebhookSubscriptionCreated extends WebhookSubscriptionView {
  secret: string
  note: string
  secretHeader: string
  verify: string
}

/** What the outbox has done for a subscription, alongside its record. */
export interface WebhookSubscriptionStatus extends WebhookSubscriptionView {
  deliveries: { queued: number; delivered: number; failed: number; lastDeliveredAt: string | null }
}

/** A test delivery: the most recent recorded event, replayed now. */
export interface WebhookTestResult {
  ok: boolean
  eventId: string
  type: string
  delivery: string
  responseStatus: number | null
  error: string | null
  sentAt: string
}

/** One leg of the delivery path, with the count it was computed from beside every figure. */
export interface WebhookLatencyLeg {
  /** How many deliveries carried this leg. A leg with no sample is absent, never zero. */
  n: number
  medianSeconds: number | null
  minSeconds: number | null
  maxSeconds: number | null
}

/**
 * How long a webhook actually took, over real deliveries and nothing else.
 *
 * `sufficient` is false with a reason in `notComputed` until at least one delivery has been
 * accepted by a subscriber. Nothing here is derived from the poll interval: a delivery path with
 * nothing subscribed to it has a budget, not a latency, and publishing the budget as the latency
 * is the failure this shape exists to prevent.
 */
export interface WebhookLatencyResponse {
  chainId: number
  legs: { announceToObserve: string; observeToDeliver: string; announceToDeliver: string }
  basis: string
  endpointsConfigured: number
  delivered: number
  pending: number
  failed: number
  sufficient: boolean
  notComputed: string | null
  /** exdate's own lag: the chain carried the announcement, to exdate writing it to the outbox. */
  announceToObserve: WebhookLatencyLeg
  /** The outbox: the row written, to a subscriber accepting the signed POST. */
  observeToDeliver: WebhookLatencyLeg
  /** The total a subscriber experiences. The only leg worth quoting on its own. */
  announceToDeliver: WebhookLatencyLeg
  /** The same figures per event type, so one slow type cannot hide inside the median. */
  byType: ({ type: string } & Omit<WebhookLatencyResponse, 'chainId' | 'legs' | 'basis' | 'endpointsConfigured' | 'byType'>)[]
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
