import { kindFromCorporateActionType } from './multiplier.js'
import { underlyingPriceWad } from './reconcile.js'

/**
 * The yield ledger: what GET /v1/:chain/tokens/:addr/yield returns.
 *
 * This is a ledger of individual distributions, not a rate. One row per
 * observed multiplier step and one per issuer action that has not produced a
 * step, each carrying its own gross, received and haircut with the source of
 * every number. The only token-level aggregate is growth in underlying shares
 * per share held, an arithmetic identity between two multiplier values that are
 * both printed next to it - and it is split into the part explained by paired
 * dividends and the part that is not, so a split can never read as yield.
 *
 * Nothing here is per annum, trailing or forward. Those are not nullable fields
 * that a consumer's `?? 0` would quietly fill in; they are absent from the
 * shape and appear only under `notComputed`, each with a machine-readable
 * reason and a token-specific detail. A documented refusal cannot be mistaken
 * for a value that has not arrived yet.
 *
 * This module is pure: it is fed rows the repository already serves and it
 * reads nothing. That is what makes it testable against SGOV's real history.
 */

const WAD = 10n ** 18n
const bpsOf = (stepWad: bigint) => Number(stepWad) / 1e14

export interface YieldTokenState {
  chainId: number
  address: string
  symbol: string
  decimals: number | null
  issuer: string
  /** uiMultiplier() as last polled, or null if never polled. */
  uiMultiplier: bigint | null
  sampledAt: bigint | null
  feedProxy: string | null
  feedVerified: boolean
}

/** A row of the reconciliations table, as the repository returns it. */
export interface YieldReconciliationRow {
  id: string
  status: string
  confidence: string
  note: string | null
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
  feed: string | null
  priceWad: bigint | null
  priceRoundId: bigint | null
  priceUpdatedAt: bigint | null
  priceStalenessSeconds: number | null
  priceAtPhaseFloor: boolean | null
  expectedStepWad: bigint | null
  receivedPerShareWad: bigint | null
  impliedHaircutBps: number | null
  impliedReinvestPriceWad: bigint | null
}

/** An announcement row, for the fields the reconciliation does not carry. */
export interface YieldEventRow {
  effectiveAt: bigint
  announcedAt: bigint
  announcedBlock: bigint
  announcedTx: string
  announcementCount: number
  source: string
}

export interface YieldInput {
  token: YieldTokenState
  reconciliations: readonly YieldReconciliationRow[]
  events: readonly YieldEventRow[]
  scan: { fromBlock: number; throughBlock: number; scannedAt: string }
  nowSeconds: bigint
  matchWindowDays: number
}

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

export function buildYieldLedger(input: YieldInput) {
  const { token, reconciliations, events, scan, nowSeconds, matchWindowDays } = input
  const eventsByEffectiveAt = new Map(events.map((event) => [event.effectiveAt, event]))

  const rows = [...reconciliations].sort((a, b) => {
    const key = (row: YieldReconciliationRow) =>
      row.effectiveAt !== null
        ? Number(row.effectiveAt)
        : row.processDate
          ? Date.parse(`${row.processDate}T00:00:00Z`) / 1000
          : 0
    return key(a) - key(b)
  })

  const ledger = rows.map((row) => {
    const event = row.effectiveAt !== null ? eventsByEffectiveAt.get(row.effectiveAt) : undefined
    const kind = row.status === 'matched' || row.status === 'anomaly' ? kindFromCorporateActionType(row.actionType) : 'unknown'
    const pairedDividend = row.status === 'matched' && kind === 'dividend'
    const underlying =
      row.priceWad !== null && row.oldMultiplier !== null && row.oldMultiplier > 0n
        ? underlyingPriceWad(row.priceWad, row.oldMultiplier)
        : null
    const daysSinceProcess =
      row.processDate && row.effectiveAt === null
        ? Math.floor((Number(nowSeconds) * 1000 - Date.parse(`${row.processDate}T00:00:00Z`)) / 86_400_000)
        : null
    const overdue = row.status === 'pending' && daysSinceProcess !== null && daysSinceProcess > matchWindowDays

    return {
      key:
        row.effectiveAt !== null
          ? `${token.chainId}:${token.address.toLowerCase()}:${row.effectiveAt}`
          : `${token.chainId}:${token.address.toLowerCase()}:${row.actionType ?? 'ACTION'}:${row.processDate ?? 'undated'}`,
      status: row.status,
      overdue,
      /** Never inferred from magnitude: DELL's dividend is +0.64 bps, CCL's +214.86, CRWD's split +30 000. */
      kind,
      kindBasis:
        kind === 'unknown'
          ? 'no issuer action paired; magnitude never classifies kind'
          : `issuer action type ${row.actionType}`,

      observed:
        row.effectiveAt === null
          ? null
          : {
              effectiveAt: iso(row.effectiveAt),
              applied: row.effectiveAt <= nowSeconds,
              announcedAt: iso(event?.announcedAt),
              announcementLeadSeconds: event ? Number(row.effectiveAt - event.announcedAt) : null,
              announcementCount: event?.announcementCount ?? null,
              oldMultiplier: row.oldMultiplier?.toString() ?? null,
              newMultiplier: row.newMultiplier?.toString() ?? null,
              stepWad: row.observedStepWad?.toString() ?? null,
              stepBps: row.observedStepWad === null ? null : bpsOf(row.observedStepWad),
              /**
               * Equal to stepBps, and only stated when the step is a paired
               * dividend. A holder of R raw tokens holds R*m underlying shares at
               * price P; value goes from R*m0*P to R*m1*P, so the realised return
               * of the step is (m1-m0)/m0 and P cancels. It needs no price and no
               * feed - but a split produces the same identity with no economic
               * gain, which is why an unclassified step does not get the name.
               */
              netYieldBps: pairedDividend && row.observedStepWad !== null ? bpsOf(row.observedStepWad) : null,
              tx: event?.announcedTx ?? null,
              block: event?.announcedBlock?.toString() ?? null,
              source: event?.source ?? 'onchain:UIMultiplierUpdated',
            },

      declared:
        row.actionId === null
          ? null
          : {
              issuerId: row.actionId,
              type: row.actionType,
              status: row.actionStatus,
              /** The issuer's scheduling day. Explicitly not the ex-date and not the payable date. */
              processDate: row.processDate,
              processDateIsNotExDate: true,
              lagDays: row.lagDays,
              daysSinceProcessDate: daysSinceProcess,
              grossPerUnderlyingShare: row.rate,
              currency: 'USD',
              source: 'robinhood:/rhj/corporate-actions',
            },

      price:
        row.priceWad === null
          ? null
          : {
              /** The Chainlink answer as published: the token price, multiplier included. */
              tokenPrice: decimal(row.priceWad),
              multiplierBefore: row.oldMultiplier?.toString() ?? null,
              /** The equity price the token price implies; the reconciliation input. */
              underlyingPrice: decimal(underlying),
              underlyingPriceDerivation: 'tokenPrice / multiplierBefore',
              feed: row.feed,
              feedVerified: token.feedVerified,
              feedPairedBy: 'ticker-heuristic',
              roundId: row.priceRoundId?.toString() ?? null,
              updatedAt: iso(row.priceUpdatedAt),
              stalenessSecondsAtEffectiveAt: row.priceStalenessSeconds,
              atPhaseFloor: row.priceAtPhaseFloor,
              answerIncludesMultiplier: true,
              source: 'chainlink:getRoundData',
            },

      result: {
        grossYieldBps: row.expectedStepWad === null ? null : bpsOf(row.expectedStepWad),
        netYieldBps: pairedDividend && row.observedStepWad !== null ? bpsOf(row.observedStepWad) : null,
        haircutBps: row.priceWad !== null && row.rate !== null ? row.impliedHaircutBps : null,
        receivedPerShare: decimal(row.receivedPerShareWad),
        /** Present with no feed at all - that is the point of it. */
        impliedReinvestPrice: decimal(row.impliedReinvestPriceWad),
        confidence: row.confidence,
        reason: row.note,
      },
    }
  })

  // --- coverage -------------------------------------------------------------
  const observedRows = ledger.filter((row) => row.observed !== null)
  const appliedRows = observedRows.filter((row) => row.observed!.applied)
  const first = appliedRows[0]
  const last = appliedRows.at(-1)
  const multiplierAtWindowStart = first?.observed?.oldMultiplier ?? (token.uiMultiplier === null ? null : WAD.toString())
  const multiplierNow = token.uiMultiplier?.toString() ?? null
  const lastNew = last?.observed?.newMultiplier ?? null
  const closes =
    multiplierNow === null
      ? null
      : appliedRows.length === 0
        ? multiplierNow === WAD.toString()
        : lastNew === multiplierNow
  // The poller can lag a step by up to one interval, so a mismatch right after a
  // step is expected for minutes, not evidence of a missing row.
  const pollLagsLastStep =
    last?.observed?.effectiveAt !== undefined &&
    token.sampledAt !== null &&
    last.observed !== null &&
    BigInt(Math.floor(Date.parse(last.observed.effectiveAt as string) / 1000)) > token.sampledAt

  const coverage = {
    scannedFromBlock: scan.fromBlock,
    scannedThroughBlock: scan.throughBlock,
    scannedAt: scan.scannedAt,
    multiplierAtWindowStart,
    multiplierNow,
    multiplierNowSource: token.sampledAt === null ? null : `onchain:uiMultiplier(), polled ${iso(token.sampledAt)}`,
    /**
     * True when the last applied step's newMultiplier equals uiMultiplier() as
     * last polled - so no step is missing from this ledger. When false, every
     * field of `totals` is null. Null when the token has not been polled.
     */
    closes: pollLagsLastStep ? null : closes,
    closesBasis: pollLagsLastStep
      ? 'poll_lags_last_step: the last step took effect after the most recent poll, so the head multiplier has not been re-read yet'
      : appliedRows.length === 0
        ? 'no applied step in the scanned range; closes when uiMultiplier() still reads exactly 1e18'
        : 'the newMultiplier of the last applied step equals uiMultiplier() read at the head',
    startIsInception: first ? first.observed!.oldMultiplier === WAD.toString() : token.uiMultiplier === WAD,
  }

  // --- totals ---------------------------------------------------------------
  const compound = (rowsToCompound: typeof ledger) =>
    rowsToCompound.reduce((acc, row) => {
      const step = row.observed?.stepWad ? BigInt(row.observed.stepWad) : 0n
      return (acc * (WAD + step)) / WAD
    }, WAD) - WAD
  const dividendRows = appliedRows.filter((row) => row.kind === 'dividend' && row.status === 'matched')
  const unexplainedRows = appliedRows.filter((row) => !(row.kind === 'dividend' && row.status === 'matched'))
  const growthWad =
    multiplierAtWindowStart && multiplierNow
      ? ((BigInt(multiplierNow) - BigInt(multiplierAtWindowStart)) * WAD) / BigInt(multiplierAtWindowStart)
      : null

  const totals =
    coverage.closes === true
      ? {
          quantity: 'share_count_growth',
          windowStart: iso(first ? BigInt(Math.floor(Date.parse(first.observed!.announcedAt ?? first.observed!.effectiveAt!) / 1000)) : null),
          windowEnd: iso(token.sampledAt),
          distributionsObserved: appliedRows.length,
          underlyingSharesGrowthWad: growthWad?.toString() ?? null,
          underlyingSharesGrowthBps: growthWad === null ? null : bpsOf(growthWad),
          growthBasis:
            '(multiplierNow - multiplierAtWindowStart) / multiplierAtWindowStart, both printed under coverage. Growth in underlying shares per share held, not gain: a split produces it with no economic gain.',
          dividendGrowthBps: bpsOf(compound(dividendRows)),
          dividendEvents: dividendRows.length,
          unexplainedGrowthBps: bpsOf(compound(unexplainedRows)),
          unexplainedEvents: unexplainedRows.length,
          largestSingleStepBps: appliedRows.length ? Math.max(...appliedRows.map((row) => row.observed!.stepBps ?? 0)) : null,
          minAnnouncementLeadSeconds: appliedRows.length
            ? Math.min(...appliedRows.map((row) => row.observed!.announcementLeadSeconds ?? Number.POSITIVE_INFINITY))
            : null,
          reconciledDistributions: dividendRows.length,
          unreconciledDistributions: unexplainedRows.length,
          declaredNotLanded: ledger.filter((row) => row.status === 'pending').length,
          overdueDistributions: ledger.filter((row) => row.overdue).length,
        }
      : null

  // --- refusals -------------------------------------------------------------
  const notComputed = [
    {
      field: 'annualizedYield',
      reasonCode: appliedRows.length === 0 ? 'no_observed_distribution' : 'no_observed_schedule',
      detail:
        appliedRows.length === 0
          ? '0 distributions observed on chain for this token'
          : `${appliedRows.length} distribution(s) observed. Neither the chain nor the issuer publishes a distribution frequency, so any period would be inferred and any per-annum figure invented.`,
    },
    {
      field: 'trailingTwelveMonthYield',
      reasonCode: 'window_shorter_than_period',
      detail: `on-chain history starts at block ${scan.fromBlock} (2026-07-01); most of a twelve-month figure would be extrapolation`,
    },
    {
      field: 'forwardYield',
      reasonCode: 'delivery_not_demonstrated',
      detail: 'declared dividends have been observed not to reach the chain for weeks; a forward rate assumes a delivery rate this chain has not shown',
    },
    ...(dividendRows.length < 3
      ? [
          {
            field: 'expectedHaircut',
            reasonCode: 'insufficient_reconciliations',
            detail: `${dividendRows.length} reconciled dividend(s) for this token; fewer than three is not a distribution`,
          },
        ]
      : []),
    ...(coverage.closes !== true
      ? [
          {
            field: 'totals',
            reasonCode: coverage.closes === null ? (token.sampledAt === null ? 'not_yet_polled' : 'poll_lags_last_step') : 'ledger_does_not_close',
            detail:
              coverage.closes === null
                ? 'the head multiplier has not been read since the last step took effect'
                : 'the last applied step does not reach the multiplier read at the head, so a step is missing from this ledger',
          },
        ]
      : []),
  ]

  return {
    chainId: token.chainId,
    observedAt: iso(nowSeconds),
    token: { address: token.address, symbol: token.symbol, decimals: token.decimals, issuer: token.issuer },
    basis: 'per_distribution_not_annualized',
    coverage,
    ledger,
    totals,
    notComputed,
    oracle: {
      feed: token.feedProxy,
      verified: token.feedProxy === null ? null : token.feedVerified,
      answerIncludesMultiplier: token.feedProxy === null ? null : true,
      warning:
        token.feedProxy === null
          ? 'this token has no Chainlink feed; 159 of 194 do not'
          : 'Chainlink publishes Token Price = Underlying Equity Market Price x Multiplier. Multiplying this answer by uiMultiplier() double-counts every step in this ledger.',
    },
  }
}
