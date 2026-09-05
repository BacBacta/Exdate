import { db } from 'ponder:api'
import schema from 'ponder:schema'
import { createApi, limitsFromEnv } from '@exdate/api'
import type {
  CorporateActionRow,
  MultiplierEventRow,
  ReconciliationRow,
  Repository,
  TokenRow,
  WebhookDeliveryRow,
  WebhookEventRow,
} from '@exdate/api'
import { subscriptionStore } from '../subscriptions.js'
import { currentEndpoints } from '../webhooks.js'
import type { Address, Hex } from 'viem'

/**
 * The whole dataset is a few hundred rows - 194 tokens, 35 feeds, a dozen
 * multiplier events - so the repository reads each table once and joins in
 * memory. That is not a shortcut that stops working at scale here: the tables
 * that could grow (feed_rounds, and transfers if they are ever indexed) are
 * deliberately not part of this join.
 */

const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`

async function loadTokens(chainId: number): Promise<TokenRow[]> {
  const [tokenRows, stateRows, feedRows, eventRows] = await Promise.all([
    db.select().from(schema.tokens),
    db.select().from(schema.tokenStates),
    db.select().from(schema.feedStates),
    db.select().from(schema.multiplierEvents),
  ])

  const states = new Map(stateRows.map((row) => [key(row.chainId, row.address), row]))
  const feeds = new Map(feedRows.map((row) => [key(row.chainId, row.feed), row]))

  const eventsByToken = new Map<string, typeof eventRows>()
  for (const event of eventRows) {
    const id = key(event.chainId, event.token)
    const bucket = eventsByToken.get(id)
    if (bucket) bucket.push(event)
    else eventsByToken.set(id, [event])
  }

  return tokenRows
    .filter((token) => token.chainId === chainId)
    .map((token) => {
      const id = key(token.chainId, token.address)
      const state = states.get(id)
      const feed = token.feedProxy ? feeds.get(key(token.chainId, token.feedProxy)) : undefined
      const events = (eventsByToken.get(id) ?? []).sort((a, b) =>
        a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : 0,
      )
      const last = events.at(-1)

      return {
        chainId: token.chainId,
        address: token.address as Address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        isin: token.isin,
        issuer: token.issuer,
        status: token.status,
        logoUrl: token.logoUrl,
        feedProxy: (token.feedProxy ?? null) as Address | null,
        feedDecimals: token.feedDecimals,
        feedVerified: token.feedVerified,

        uiMultiplier: state?.uiMultiplier ?? null,
        newUIMultiplier: state?.newUIMultiplier ?? null,
        effectiveAt: state?.effectiveAt ?? null,
        oraclePaused: state?.oraclePaused ?? null,
        totalSupplyUI: state?.totalSupplyUI ?? null,
        sampledAt: state?.sampledAt ?? null,

        feedRoundId: feed?.roundId ?? null,
        feedAnswer: feed?.answer ?? null,
        feedUpdatedAt: feed?.updatedAt ?? null,
        feedSampledAt: feed?.sampledAt ?? null,

        eventCount: events.length,
        lastEventEffectiveAt: last?.effectiveAt ?? null,
        lastEventOldMultiplier: last?.oldMultiplier ?? null,
        lastEventNewMultiplier: last?.newMultiplier ?? null,
        lastEventAnnouncedAt: last?.announcedAt ?? null,
        lastEventAnnouncedTx: (last?.announcedTx ?? null) as Hex | null,
        lastEventAnnouncementCount: last?.announcementCount ?? null,
        lastEventSource: last?.source ?? null,
      } satisfies TokenRow
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
}

const repository: Repository = {
  tokens: loadTokens,

  async token(chainId, address) {
    const rows = await loadTokens(chainId)
    return rows.find((row) => row.address.toLowerCase() === address.toLowerCase()) ?? null
  },

  async multiplierEvents(chainId, address) {
    const rows = await db.select().from(schema.multiplierEvents)
    return rows
      .filter(
        (row) =>
          row.chainId === chainId &&
          (address === undefined || row.token.toLowerCase() === address.toLowerCase()),
      )
      .sort((a, b) => (a.effectiveAt < b.effectiveAt ? 1 : a.effectiveAt > b.effectiveAt ? -1 : 0))
      .map((row) => ({ ...row, token: row.token as Address }) satisfies MultiplierEventRow)
  },

  async reconciliations(chainId, address) {
    const rows = await db.select().from(schema.reconciliations)
    return rows
      .filter(
        (row) =>
          row.chainId === chainId &&
          (address === undefined || row.token?.toLowerCase() === address.toLowerCase()),
      )
      // Newest first by the on-chain effect, falling back to the issuer's date so
      // a pending row (no step yet) still lands in a sensible place.
      .sort((a, b) => {
        const key = (row: (typeof rows)[number]) =>
          row.effectiveAt !== null
            ? Number(row.effectiveAt)
            : row.processDate
              ? Date.parse(`${row.processDate}T00:00:00Z`) / 1000
              : 0
        return key(b) - key(a)
      })
      .map(
        (row) =>
          ({ ...row, token: (row.token ?? null) as Address | null, feed: (row.feed ?? null) as Address | null }) satisfies ReconciliationRow,
      )
  },

  async webhookEvents(chainId) {
    const rows = await db.select().from(schema.webhookEvents)
    return rows
      .filter((row) => row.chainId === chainId)
      .sort((a, b) => Number(b.createdAt - a.createdAt))
      .map((row) => ({ ...row, token: (row.token ?? null) as Address | null }) satisfies WebhookEventRow)
  },

  async webhookDeliveries(chainId) {
    const rows = await db.select().from(schema.webhookDeliveries)
    return rows.filter((row) => row.chainId === chainId) satisfies WebhookDeliveryRow[]
  },

  async corporateActions(chainId) {
    const rows = await db.select().from(schema.corporateActions)
    return rows
      .filter((row) => row.chainId === chainId)
      .map((row) => ({ ...row, token: (row.token ?? null) as Address | null }) satisfies CorporateActionRow)
  },
}

// Keys and quotas come from the environment and are validated at boot: a
// malformed entry stops the process rather than admitting nobody.
export default createApi({
  repository,
  webhookEndpointsConfigured: () => currentEndpoints().length,
  // Self-service subscriptions: a file the process owns, never a served table.
  subscriptions: subscriptionStore ?? undefined,
  subscriptionPolicy: { allowPrivate: process.env.EXDATE_WEBHOOK_ALLOW_PRIVATE === 'true' },
  limits: limitsFromEnv(process.env),
})
