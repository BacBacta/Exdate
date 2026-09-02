/**
 * The status page reads the exdate API and nothing else. It never talks to an
 * RPC and it never computes a number of its own - if the API has not observed
 * something, the page says so rather than filling the gap.
 */

export const API_URL = process.env.EXDATE_API_URL ?? 'http://localhost:42069'

export interface FeedView {
  proxy: string
  verified: boolean
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
  decimals: number
  isin: string | null
  issuer: string
  status: string
  logoUrl: string | null
  explorerUrl: string
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
      announcedAt: string | null
      announcementLeadSeconds: number | null
      announcedTx: string | null
      announcementCount: number | null
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
