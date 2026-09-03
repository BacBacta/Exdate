import { WAD, isPending, stepBps } from './multiplier.js'
import { expectedStepWad, parseDecimal, rescale, underlyingPriceWad } from './reconcile.js'
import { feedHealth } from './staleness.js'

/**
 * What is owed and has not arrived: GET /v1/:chain/tokens/:addr/pending.
 *
 * Three states get conflated everywhere else and are kept apart here, because
 * they carry completely different certainty:
 *
 *  - `scheduled` - a UIMultiplierUpdated log is already on chain with an
 *    effectiveAt in the future. This is certain and about nine minutes away.
 *  - `declared` with state `awaiting` - the issuer lists the dividend, the chain
 *    has not moved yet, and it is still inside the observed next-business-day
 *    window.
 *  - `declared` with state `overdue` or `declared_complete_not_on_chain` - the
 *    window has passed. The second is the sharper claim: the issuer's own feed
 *    says COMPLETED while the multiplier still reads what it read before. Seven
 *    tokens were in that state on 2026-09-02, BND for four weeks.
 *
 * Everything here is either on chain or the issuer's own statement. The one
 * derived figure that uses a market price - what step the declared dividend
 * would produce - is a projection at the LATEST round, is marked as such, and
 * is never used to fill a haircut. Predicting when the step will land, or how
 * much of it will survive, is refused under `notComputed`.
 */

const bpsOf = (wad: bigint) => Number(wad) / 1e14
const DAY_MS = 86_400_000

const iso = (seconds: bigint | null | undefined) =>
  seconds === null || seconds === undefined || seconds === 0n
    ? null
    : new Date(Number(seconds) * 1000).toISOString()

const decimal = (value: bigint | null | undefined, decimals = 18) => {
  if (value === null || value === undefined) return null
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / 10n ** BigInt(decimals)
  const fraction = (abs % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export interface PendingTokenState {
  chainId: number
  address: string
  symbol: string
  decimals: number | null
  issuer: string
  /** The three ERC-8056 views, as last polled. Null until the poller has run. */
  uiMultiplier: bigint | null
  newUIMultiplier: bigint | null
  effectiveAt: bigint | null
  oraclePaused: boolean | null
  sampledAt: bigint | null
  feedProxy: string | null
  feedVerified: boolean
  feedDecimals: number | null
  /** The latest Chainlink round, for the projection only. */
  feedAnswer: bigint | null
  feedUpdatedAt: bigint | null
}

/** The fields of a reconciliations row this view reads. */
export interface PendingReconciliationRow {
  id: string
  status: string
  actionId: string | null
  actionType: string | null
  actionStatus: string | null
  processDate: string | null
  rate: string | null
  effectiveAt: bigint | null
  impliedHaircutBps: number | null
}

/** The announcement log behind a scheduled change. */
export interface PendingEventRow {
  effectiveAt: bigint
  announcedAt: bigint
  announcedTx: string
  announcementCount: number
  source: string
}

export interface PendingInput {
  token: PendingTokenState
  reconciliations: readonly PendingReconciliationRow[]
  events: readonly PendingEventRow[]
  nowSeconds: bigint
  matchWindowDays: number
}

export type DeclaredState =
  | 'upcoming'
  | 'awaiting'
  | 'overdue'
  | 'declared_complete_not_on_chain'

export function buildPendingView(input: PendingInput) {
  const { token, reconciliations, events, nowSeconds, matchWindowDays } = input
  const polled = token.uiMultiplier !== null && token.newUIMultiplier !== null && token.effectiveAt !== null

  // --- announced on chain, not yet in effect ---------------------------------
  //
  // isPending is the whole trap in one call: effectiveAt() is retrospective
  // outside the announcement window, so a non-zero timestamp on its own means a
  // change that already happened. Treating it as pending reported nine phantom
  // dividends on 2026-09-02.
  const scheduledNow =
    polled &&
    isPending(
      {
        uiMultiplier: token.uiMultiplier as bigint,
        newUIMultiplier: token.newUIMultiplier as bigint,
        effectiveAt: token.effectiveAt as bigint,
      },
      nowSeconds,
    )
  const announcement = scheduledNow
    ? events.find((event) => event.effectiveAt === token.effectiveAt)
    : undefined

  const scheduled = scheduledNow
    ? {
        currentMultiplier: (token.uiMultiplier as bigint).toString(),
        newMultiplier: (token.newUIMultiplier as bigint).toString(),
        newMultiplierDecimal: decimal(token.newUIMultiplier),
        stepBps: stepBps(token.uiMultiplier as bigint, token.newUIMultiplier as bigint),
        effectiveAt: iso(token.effectiveAt),
        secondsRemaining: Number((token.effectiveAt as bigint) - nowSeconds),
        announcedAt: iso(announcement?.announcedAt),
        announcementLeadSeconds: announcement
          ? Number((token.effectiveAt as bigint) - announcement.announcedAt)
          : null,
        announcedTx: announcement?.announcedTx ?? null,
        /** CRWD announced the same (newMultiplier, effectiveAt) twice, 11 h apart. */
        announcementCount: announcement?.announcementCount ?? null,
        /**
         * Nothing is emitted when the change takes effect - there is no
         * application event on this chain. Application is the clock passing
         * effectiveAt, which is why this endpoint reports seconds remaining
         * rather than promising a log to watch for.
         */
        appliedBy: 'clock: no event is emitted when a multiplier change takes effect',
        source: announcement?.source ?? 'onchain:views',
      }
    : null

  // --- the latest round, for the projection only -----------------------------
  const health = token.feedProxy
    ? feedHealth({
        updatedAt: token.feedUpdatedAt ?? undefined,
        nowSeconds,
        oraclePaused: token.oraclePaused ?? undefined,
      })
    : null
  const latestTokenPriceWad =
    token.feedAnswer !== null && token.feedDecimals !== null
      ? rescale(token.feedAnswer, token.feedDecimals, 18)
      : null
  const latestUnderlyingPriceWad =
    latestTokenPriceWad !== null && token.uiMultiplier !== null && token.uiMultiplier > 0n
      ? underlyingPriceWad(latestTokenPriceWad, token.uiMultiplier)
      : null

  // --- declared by the issuer, nothing on chain ------------------------------
  const declared = reconciliations
    .filter((row) => row.status === 'pending')
    .map((row) => {
      const processedMs = row.processDate ? Date.parse(`${row.processDate}T00:00:00Z`) : Number.NaN
      const daysSinceProcessDate = Number.isNaN(processedMs)
        ? null
        : Math.floor((Number(nowSeconds) * 1000 - processedMs) / DAY_MS)
      const pastWindow = daysSinceProcessDate !== null && daysSinceProcessDate > matchWindowDays
      /**
       * A process date still in the future is not owed yet, and calling it
       * `awaiting` would carry a claim that is false: `awaiting` means the chain
       * should move within the window. The issuer's feed is a calendar as much
       * as a ledger, so a token's own view lists what is coming - under a state
       * that says so.
       */
      const notYetDue = daysSinceProcessDate !== null && daysSinceProcessDate < 0
      const state: DeclaredState = notYetDue
        ? 'upcoming'
        : !pastWindow
          ? 'awaiting'
          : row.actionStatus === 'CORPORATE_ACTION_STATUS_COMPLETED'
            ? 'declared_complete_not_on_chain'
            : 'overdue'

      const rateWad = row.rate ? parseDecimal(row.rate, 18) : null
      /**
       * Cash owed per raw token: the rate is per underlying share and one raw
       * token carries `uiMultiplier` of them. Two known numbers, no price.
       */
      const grossPerToken =
        rateWad !== null && token.uiMultiplier !== null ? (rateWad * token.uiMultiplier) / WAD : null

      const projection =
        rateWad !== null && rateWad > 0n && latestUnderlyingPriceWad !== null && latestUnderlyingPriceWad > 0n
          ? {
              stepBpsIfPaidInFull: bpsOf(expectedStepWad(rateWad, latestUnderlyingPriceWad)),
              tokenPrice: decimal(latestTokenPriceWad),
              multiplierInForce: token.uiMultiplier?.toString() ?? null,
              underlyingPrice: decimal(latestUnderlyingPriceWad),
              underlyingPriceDerivation: 'tokenPrice / uiMultiplier',
              feed: token.feedProxy,
              feedVerified: token.feedVerified,
              priceUpdatedAt: iso(token.feedUpdatedAt),
              priceAgeSeconds: health?.ageSeconds ?? null,
              feedStatus: health?.status ?? null,
              /**
               * The price today, not the price at any effectiveAt, and gross of
               * a haircut every measured distribution has taken. It says what a
               * full payment would look like; it is not a forecast of the step.
               */
              basis: 'chainlink:latestRoundData, today - not the price at effectiveAt',
              notAMeasurement: true,
            }
          : null

      return {
        key: row.id,
        issuerId: row.actionId,
        type: row.actionType,
        issuerStatus: row.actionStatus,
        state,
        /** The issuer's scheduling day. Explicitly not the ex-date and not the payable date. */
        processDate: row.processDate,
        processDateIsNotExDate: true,
        daysSinceProcessDate,
        windowDays: matchWindowDays,
        grossPerUnderlyingShare: row.rate,
        grossPerToken: decimal(grossPerToken),
        currency: 'USD',
        projection,
        note:
          state === 'declared_complete_not_on_chain'
            ? 'the issuer marks this action completed; the multiplier has not moved'
            : state === 'overdue'
              ? `no multiplier step ${daysSinceProcessDate} days after the issuer's process date; the observed lag is one business day`
              : state === 'upcoming'
                ? `the issuer's process date is ${-(daysSinceProcessDate as number)} day(s) away; nothing is owed yet`
                : 'declared by the issuer, still inside the observed next-business-day window',
        source: 'robinhood:/rhj/corporate-actions',
      }
    })
    .sort((a, b) => (a.processDate ?? '').localeCompare(b.processDate ?? ''))

  const inState = (state: DeclaredState) => declared.filter((row) => row.state === state)
  const overdueRows = [...inState('overdue'), ...inState('declared_complete_not_on_chain')]

  // --- what this token's own history says, as history and nothing more -------
  const reconciled = reconciliations.filter(
    (row) => row.status === 'matched' && row.impliedHaircutBps !== null,
  )
  const lastReconciled = [...reconciled].sort((a, b) => Number((b.effectiveAt ?? 0n) - (a.effectiveAt ?? 0n)))[0]

  return {
    chainId: token.chainId,
    observedAt: iso(nowSeconds),
    token: {
      address: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
      issuer: token.issuer,
    },
    state: polled ? ('indexed' as const) : ('not_yet_polled' as const),
    multiplier: {
      current: token.uiMultiplier?.toString() ?? null,
      currentDecimal: decimal(token.uiMultiplier),
      sampledAt: iso(token.sampledAt),
    },
    scheduled,
    declared,
    summary: {
      scheduledOnChain: scheduled === null ? 0 : 1,
      declaredUpcoming: inState('upcoming').length,
      declaredAwaiting: inState('awaiting').length,
      declaredOverdue: overdueRows.length,
      declaredCompleteNotOnChain: inState('declared_complete_not_on_chain').length,
      longestOverdueDays: overdueRows.length
        ? Math.max(...overdueRows.map((row) => row.daysSinceProcessDate ?? 0))
        : null,
      /** Nothing owed and nothing scheduled: the honest empty answer, not an error. */
      nothingPending: scheduled === null && declared.length === 0,
    },
    history: {
      reconciledDividends: reconciled.length,
      lastObservedHaircutBps: lastReconciled?.impliedHaircutBps ?? null,
      lastObservedAt: iso(lastReconciled?.effectiveAt ?? null),
      basis:
        'measured on past distributions of this token. Observed, not a forecast: it is applied to nothing above.',
    },
    notComputed: [
      {
        field: 'expectedEffectiveAt',
        reasonCode: 'announcement_lead_is_minutes',
        detail:
          'the issuer publishes no on-chain schedule and the announcement arrives about nine minutes ahead of the change. Every observed step landed the next business day near 15:10 UTC, but that is a pattern in a dozen events, not a date this endpoint will assert.',
      },
      {
        field: 'expectedStepBps',
        reasonCode: 'haircut_not_forecastable',
        detail:
          'the fraction withheld from an on-chain distribution is undocumented and has been measured on two tokens only. `projection.stepBpsIfPaidInFull` is what a full payment would produce, not what is expected to arrive.',
      },
      {
        field: 'netAmountOwed',
        reasonCode: 'withholding_undocumented',
        detail:
          'fees and withholding applied to on-chain distributions are not published by the issuer; only the declared gross is stated here.',
      },
    ],
    oracle: {
      feed: token.feedProxy,
      verified: token.feedProxy === null ? null : token.feedVerified,
      status: health?.status ?? null,
      oraclePaused: token.oraclePaused,
      answerIncludesMultiplier: token.feedProxy === null ? null : true,
      warning:
        token.feedProxy === null
          ? 'this token has no Chainlink feed, so no projection is possible; most Stock Tokens have none (GET /v1/status carries the count)'
          : 'Chainlink publishes Token Price = Underlying Equity Market Price x Multiplier. The projection above divides by uiMultiplier(); multiplying by it instead double-counts every step.',
    },
  }
}
