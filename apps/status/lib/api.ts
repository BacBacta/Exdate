/**
 * The status page reads the exdate API and nothing else. It never talks to an
 * RPC and it never computes a number of its own - if the API has not observed
 * something, the page says so rather than filling the gap.
 */

export const API_URL = process.env.EXDATE_API_URL ?? 'http://localhost:42069'

export interface FeedView {
  proxy: string
  /** False everywhere: no first-party statement links a token to a feed. */
  verified: boolean
  /** The token's own multiplier step was seen moving this feed by its own size. */
  corroborated: boolean
  decimals: number | null
  roundId: string | null
  answer: string | null
  price: string | null
  updatedAt: string | null
  ageSeconds: number | null
  beyondHeartbeat: boolean | null
  status: 'live' | 'stale' | 'paused' | 'unknown'
  oraclePaused: boolean | null
  sampledAt: string | null
  includesMultiplier: boolean
}

export interface TokenView {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number | null
  isin: string | null
  issuer: string
  status: string
  logoUrl: string | null
  explorerUrl: string
  registry: { source: string; generatedAt: string }
  state: 'indexed' | 'not_yet_polled'
  multiplier: {
    current: string | null
    currentDecimal: string | null
    scheduled: {
      value: string
      valueDecimal: string | null
      effectiveAt: string | null
      secondsRemaining: number
    } | null
    lastChangeEffectiveAt: string | null
    totalSupplyUI: string | null
    sampledAt: string | null
  }
  events: {
    count: number
    last: {
      effectiveAt: string | null
      applied: boolean
      announcedAt: string | null
      announcementLeadSeconds: number | null
      announcedTx: string | null
      announcementCount: number | null
      source: string | null
      oldMultiplier: string | null
      newMultiplier: string | null
      stepBps: number | null
    } | null
  }
  feed: FeedView | null
}

export interface TokensResponse {
  chainId: number
  count: number
  polled: number
  tokens: TokenView[]
}

export interface CalendarResponse {
  observedAt: string
  chains: {
    chainId: number
    upcomingCorporateActions: {
      id: string
      symbol: string
      token: string | null
      type: string
      status: string
      processDate: string | null
      rate: string | null
      source: string
    }[]
    scheduledMultiplierUpdates: TokenView[]
  }[]
}

export interface ReconciliationView {
  id: string
  chainId: number
  token: string | null
  symbol: string
  status: 'pending' | 'matched' | 'anomaly' | 'unmatched' | 'unsupported_action_type'
  confidence: 'low' | 'medium' | 'high'
  note: string | null
  declared: {
    actionId: string
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
    impliedHaircutBps: number | null
    impliedReinvestPrice: string | null
  }
  computedAt: string | null
}

export interface ReconciliationsResponse {
  chainId: number
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

/**
 * What the page renders from `/v1/:chain/tokens/:addr/yield` - a subset of the
 * ledger, declared here so the page cannot quietly start showing a field the
 * API stopped sending. The full shape is typed in @exdate/sdk.
 */
export interface YieldLedgerView {
  token: { address: string; symbol: string }
  coverage: { closes: boolean | null; closesBasis: string }
  /** Null unless the ledger closes: see coverage.closesBasis for why. */
  totals: {
    distributionsObserved: number
    underlyingSharesGrowthBps: number | null
    dividendGrowthBps: number
    dividendEvents: number
    unexplainedGrowthBps: number
    unexplainedEvents: number
    declaredNotLanded: number
  } | null
  notComputed: { field: string; reasonCode: string; detail: string }[]
}

/**
 * What the page renders from `/v1/:chain/tokens/:addr/pending` - a subset,
 * declared here so the page cannot quietly start showing a field the API
 * stopped sending. The full shape is typed in @exdate/sdk.
 */
export interface PendingView {
  token: { address: string; symbol: string }
  state: 'indexed' | 'not_yet_polled'
  multiplier: { currentDecimal: string | null }
  declared: {
    key: string
    /**
     * upcoming before the process date, awaiting inside the observed window,
     * overdue past it, or completed by the issuer with no step on chain.
     */
    state: 'upcoming' | 'awaiting' | 'overdue' | 'declared_complete_not_on_chain'
    processDate: string | null
    daysSinceProcessDate: number | null
    windowDays: number
    grossPerUnderlyingShare: string | null
    /** rate x uiMultiplier: cash owed per raw token, and it needs no price. */
    grossPerToken: string | null
    /** What a payment in full would produce at today's price. Never a forecast. */
    projection: { stepBpsIfPaidInFull: number; notAMeasurement: boolean } | null
    note: string
  }[]
  summary: {
    scheduledOnChain: number
    declaredUpcoming: number
    declaredAwaiting: number
    declaredOverdue: number
    declaredCompleteNotOnChain: number
    longestOverdueDays: number | null
    nothingPending: boolean
  }
  history: {
    reconciledDividends: number
    lastObservedHaircutBps: number | null
  }
  notComputed: { field: string; reasonCode: string; detail: string }[]
}

export class ApiUnreachable extends Error {}

async function get<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, { cache: 'no-store' })
  } catch (error) {
    throw new ApiUnreachable(`${API_URL}${path}: ${(error as Error).message}`)
  }
  if (!response.ok) throw new ApiUnreachable(`${API_URL}${path}: HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export const getTokens = (chain = 'robinhood') => get<TokensResponse>(`/v1/${chain}/tokens`)
export const getCalendar = () => get<CalendarResponse>('/v1/calendar')
export const getReconciliations = (chain = 'robinhood') =>
  get<ReconciliationsResponse>(`/v1/${chain}/reconciliations`)
export const getYield = (address: string, chain = 'robinhood') =>
  get<YieldLedgerView>(`/v1/${chain}/tokens/${address}/yield`)
export const getPending = (address: string, chain = 'robinhood') =>
  get<PendingView>(`/v1/${chain}/tokens/${address}/pending`)
