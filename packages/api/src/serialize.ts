import { REGISTRY_GENERATED_AT, feedHealth, findToken, isPending, WAD } from '@exdate/core'
import { formatUnits } from 'viem'
import type {
  CorporateActionRow,
  MultiplierEventRow,
  ReconciliationRow,
  TokenRow,
  WebhookDeliveryRow,
  WebhookEventRow,
} from './types.js'

/**
 * Serialisation rules, and they are the honesty policy in code:
 *
 *  - every bigint leaves as a decimal string, never a JS number
 *  - a field exdate has not observed is `null`, never 0 and never a default
 *  - `state` says explicitly when a token has not been polled yet
 *  - `scheduled` is populated only when a change is genuinely pending, which
 *    means `effectiveAt > now` AND `newUIMultiplier != uiMultiplier`
 */

const iso = (seconds: bigint | null | undefined): string | null =>
  seconds === null || seconds === undefined || seconds === 0n
    ? null
    : new Date(Number(seconds) * 1000).toISOString()

const decimal = (value: bigint | null | undefined, decimals: number): string | null =>
  value === null || value === undefined ? null : formatUnits(value, decimals)

export interface SerializeOptions {
  /** Observation time in seconds. Injected so responses are testable. */
  nowSeconds: bigint
  explorerUrl: string
}

export function serializeToken(row: TokenRow, options: SerializeOptions) {
  const { nowSeconds, explorerUrl } = options
  const polled = row.uiMultiplier !== null && row.newUIMultiplier !== null && row.effectiveAt !== null

  const pending =
    polled &&
    isPending(
      {
        uiMultiplier: row.uiMultiplier as bigint,
        newUIMultiplier: row.newUIMultiplier as bigint,
        effectiveAt: row.effectiveAt as bigint,
      },
      nowSeconds,
    )

  const health = row.feedProxy
    ? feedHealth({
        updatedAt: row.feedUpdatedAt ?? undefined,
        nowSeconds,
        oraclePaused: row.oraclePaused ?? undefined,
        heartbeatSeconds: undefined,
      })
    : null

  return {
    chainId: row.chainId,
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    isin: row.isin,
    issuer: row.issuer,
    status: row.status,
    logoUrl: row.logoUrl,
    explorerUrl: `${explorerUrl}/token/${row.address}`,
    /**
     * symbol, name, isin, status and the feed pairing come from the issuer's
     * registry as snapshotted at build time - not read live, and not on chain.
     * The date says how old that snapshot is.
     */
    registry: { source: 'robinhood:/rhj/assets', generatedAt: REGISTRY_GENERATED_AT },

    /** 'indexed' once the poller has read the ERC-8056 views for this token. */
    state: polled ? ('indexed' as const) : ('not_yet_polled' as const),

    multiplier: {
      current: row.uiMultiplier?.toString() ?? null,
      currentDecimal: decimal(row.uiMultiplier, 18),
      /**
       * Only ever non-null while a change is genuinely pending. `effectiveAt`
       * on its own is retrospective: it holds the timestamp of the last change
       * that already took effect, which is why it is reported separately below.
       */
      scheduled: pending
        ? {
            value: (row.newUIMultiplier as bigint).toString(),
            valueDecimal: decimal(row.newUIMultiplier, 18),
            effectiveAt: iso(row.effectiveAt),
            secondsRemaining: Number((row.effectiveAt as bigint) - nowSeconds),
          }
        : null,
      /**
       * When the multiplier last changed. Null for a token that never moved, and
       * null while a change is pending: in that window `effectiveAt()` holds the
       * FUTURE instant, which is reported under `scheduled` and must not be read
       * as a change that already happened.
       */
      lastChangeEffectiveAt: pending ? null : iso(row.effectiveAt),
      totalSupplyUI: row.totalSupplyUI?.toString() ?? null,
      sampledAt: iso(row.sampledAt),
    },

    events: {
      count: row.eventCount,
      /**
       * The most recently announced event. An announcement lands ~9 minutes
       * before it takes effect, so `applied` says whether the clock has passed
       * its effectiveAt - there is no application event to observe.
       */
      last:
        row.lastEventEffectiveAt === null
          ? null
          : {
              effectiveAt: iso(row.lastEventEffectiveAt),
              applied: row.lastEventEffectiveAt <= nowSeconds,
              announcedAt: iso(row.lastEventAnnouncedAt),
              announcementLeadSeconds:
                row.lastEventAnnouncedAt === null
                  ? null
                  : Number(row.lastEventEffectiveAt - row.lastEventAnnouncedAt),
              announcedTx: row.lastEventAnnouncedTx,
              announcementCount: row.lastEventAnnouncementCount,
              source: row.lastEventSource,
              oldMultiplier: row.lastEventOldMultiplier?.toString() ?? null,
              newMultiplier: row.lastEventNewMultiplier?.toString() ?? null,
              stepBps:
                row.lastEventOldMultiplier && row.lastEventNewMultiplier
                  ? (Number(row.lastEventNewMultiplier - row.lastEventOldMultiplier) /
                      Number(row.lastEventOldMultiplier)) *
                    10_000
                  : null,
            },
    },

    feed:
      row.feedProxy === null
        ? null
        : {
            proxy: row.feedProxy,
            /**
             * False everywhere today: no first-party, address-level statement
             * links a token to a feed. The token contract exposes no
             * address-shaped view at all, Chainlink's directory carries no token
             * address, and the issuer publishes no feed.
             */
            verified: row.feedVerified,
            /**
             * Behavioural evidence instead: this token's own multiplier step was
             * seen moving this feed by the step's own size, above the feed's
             * round-to-round noise, with no other mapped feed closer. True for
             * SGOV only - see data/feed-map-verification.json.
             */
            corroborated: findToken(row.chainId, row.address)?.feedCorroborated ?? false,
            /** How the pairing was made in the first place. */
            pairedBy: 'ticker-heuristic',
            /**
             * The same feed's SVR proxy, which a lending market may well be the
             * one reading. Measured on all 35 pairs: same aggregator, same
             * answer, same updatedAt. The round id is NOT portable - each proxy
             * has its own phase, so `roundId` above belongs to `proxy` alone.
             */
            svrProxy: findToken(row.chainId, row.address)?.feedSvrProxy ?? null,
            roundIdIsProxySpecific: true,
            decimals: row.feedDecimals,
            roundId: row.feedRoundId?.toString() ?? null,
            answer: row.feedAnswer?.toString() ?? null,
            price: decimal(row.feedAnswer, row.feedDecimals ?? 8),
            updatedAt: iso(row.feedUpdatedAt),
            ageSeconds: health?.ageSeconds ?? null,
            beyondHeartbeat: health?.beyondHeartbeat ?? null,
            status: health?.status ?? 'unknown',
            oraclePaused: row.oraclePaused,
            sampledAt: iso(row.feedSampledAt),
            /**
             * The feed answer is total return: it already includes the
             * multiplier. Multiplying it by uiMultiplier double-counts every
             * dividend ever paid.
             */
            includesMultiplier: true,
          },
  }
}

export function serializeMultiplierEvent(row: MultiplierEventRow, nowSeconds: bigint) {
  return {
    chainId: row.chainId,
    token: row.token,
    effectiveAt: iso(row.effectiveAt),
    /** Derived from the clock: no event is emitted when a change takes effect. */
    applied: row.effectiveAt <= nowSeconds,
    oldMultiplier: row.oldMultiplier.toString(),
    newMultiplier: row.newMultiplier.toString(),
    stepBps: (Number(row.newMultiplier - row.oldMultiplier) / Number(row.oldMultiplier)) * 10_000,
    announcedAt: iso(row.announcedAt),
    announcedBlock: row.announcedBlock.toString(),
    announcedTx: row.announcedTx,
    announcementLeadSeconds: Number(row.effectiveAt - row.announcedAt),
    /** Greater than 1 means the schedule was re-announced, as CRWD's was. */
    announcementCount: row.announcementCount,
    lastAnnouncedAt: iso(row.lastAnnouncedAt),
    lastAnnouncedTx: row.lastAnnouncedTx,
    kind: row.kind,
    /** Which scanner found the log. Never a source other than the chain. */
    source: row.source,
  }
}

export function serializeCorporateAction(row: CorporateActionRow) {
  return {
    id: row.id,
    /** The issuer's own id. Monthly payers (SGOV, SHY, BND) reuse it every month. */
    issuerId: row.issuerId,
    chainId: row.chainId,
    token: row.token,
    symbol: row.symbol,
    underlyingSymbol: row.underlyingSymbol,
    type: row.type,
    status: row.status,
    /**
     * The issuer's scheduling day. Explicitly not the ex-date and not the
     * payable date; the on-chain effect lands on a later business day.
     */
    processDate: row.processDate,
    rate: row.rate,
    oldRate: row.oldRate,
    newRate: row.newRate,
    source: row.source,
  }
}

/**
 * A reconciliation row.
 *
 * The invariant this shape enforces: `impliedHaircutBps` is present only when
 * `gross` and `price` are both present, because a haircut is a statement about
 * those two numbers and nothing else. Where there is no reference price - 159 of
 * the 194 tokens have no Chainlink feed at all - the row carries
 * `impliedReinvestPrice` instead: the price the observed step would have needed
 * for the declared dividend to have arrived in full. Comparing that to spot is
 * how an unexplainable event is told apart from a measured one.
 */
export function serializeReconciliation(row: ReconciliationRow) {
  const hasHaircut = row.impliedHaircutBps !== null && row.priceWad !== null && row.rate !== null
  return {
    id: row.id,
    chainId: row.chainId,
    token: row.token,
    symbol: row.symbol,
    /** pending | matched | anomaly | unmatched | unsupported_action_type */
    status: row.status,
    confidence: row.confidence,
    note: row.note,

    declared:
      row.actionId === null
        ? null
        : {
            /** The issuer's id, which names a series for monthly payers; with processDate it names the payment. */
            actionId: row.actionId,
            type: row.actionType,
            status: row.actionStatus,
            /** The issuer's scheduling day. Not the ex-date and not the payable date. */
            processDate: row.processDate,
            /** Gross amount per underlying share, as the issuer states it. */
            grossPerShare: row.rate,
            source: 'robinhood:/rhj/corporate-actions',
          },

    observed:
      row.effectiveAt === null
        ? null
        : {
            effectiveAt: iso(row.effectiveAt),
            oldMultiplier: row.oldMultiplier?.toString() ?? null,
            newMultiplier: row.newMultiplier?.toString() ?? null,
            stepBps: row.observedStepWad === null ? null : Number(row.observedStepWad) / 1e14,
            /** Calendar days in UTC from the issuer's processDate to the on-chain effect. */
            lagDays: row.lagDays,
            source: 'onchain:UIMultiplierUpdated',
          },

    price:
      row.priceWad === null
        ? null
        : {
            value: decimal(row.priceWad, 18),
            feed: row.feed,
            roundId: row.priceRoundId?.toString() ?? null,
            updatedAt: iso(row.priceUpdatedAt),
            /** How stale the round already was when the multiplier took effect. */
            stalenessSeconds: row.priceStalenessSeconds,
            /**
             * True when this is the earliest round of the aggregator's current
             * phase, so the real price at that instant may predate a rollover and
             * be unreachable. Such a row is not a measurement.
             */
            atPhaseFloor: row.priceAtPhaseFloor,
            source: 'chainlink:getRoundData',
          },

    result: {
      expectedStepBps: row.expectedStepWad === null ? null : Number(row.expectedStepWad) / 1e14,
      receivedPerShare: decimal(row.receivedPerShareWad, 18),
      impliedHaircutBps: hasHaircut ? row.impliedHaircutBps : null,
      /** Present even with no feed - that is the point of it. */
      impliedReinvestPrice: decimal(row.impliedReinvestPriceWad, 18),
    },

    computedAt: iso(row.computedAt),
  }
}

/**
 * An outbox event with its delivery attempts.
 *
 * `payload` is served parsed for readability but the raw string is served
 * alongside it, because the raw bytes are what the signature covers: a consumer
 * replaying a delivery must sign that string, not a re-encoding of the object.
 * Delivery rows carry the endpoint id and host only - the configured URL and
 * its secret never leave the process.
 */
export function serializeWebhookEvent(row: WebhookEventRow, deliveries: readonly WebhookDeliveryRow[]) {
  let payload: unknown = null
  try {
    payload = JSON.parse(row.payload)
  } catch {
    payload = null
  }
  return {
    id: row.id,
    type: row.type,
    token: row.token,
    createdAt: iso(row.createdAt),
    createdBlock: row.createdBlock?.toString() ?? null,
    payload,
    /** The exact bytes the signature was computed over. */
    signedBody: row.payload,
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      endpointId: delivery.endpointId,
      host: delivery.host,
      /** queued | delivered | failed */
      status: delivery.status,
      attempts: delivery.attempts,
      nextAttemptAt: iso(delivery.nextAttemptAt),
      lastAttemptAt: iso(delivery.lastAttemptAt),
      deliveredAt: iso(delivery.deliveredAt),
      responseStatus: delivery.responseStatus,
      error: delivery.error,
    })),
  }
}

export const WAD_DECIMALS = 18
export { WAD }
