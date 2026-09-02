import { index, onchainTable, primaryKey } from 'ponder'

/**
 * Every table carries `chainId`, and nothing keys on a symbol. Base / Coinbase
 * B20 is a planned second issuer, so a single-chain shortcut here would have to
 * be undone later.
 */

export const tokens = onchainTable(
  'tokens',
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    symbol: t.text().notNull(),
    name: t.text().notNull(),
    decimals: t.integer().notNull(),
    isin: t.text(),
    issuer: t.text().notNull(),
    status: t.text().notNull(),
    logoUrl: t.text(),
    /** Chainlink aggregator proxy, null for the 159 tokens with no feed. */
    feedProxy: t.hex(),
    feedDecimals: t.integer(),
    /** False while the token -> feed pairing is only a ticker heuristic. */
    feedVerified: t.boolean().notNull().default(false),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.address] }),
    symbolIdx: index().on(table.symbol),
  }),
)

/**
 * One row per scheduled multiplier change.
 *
 * Keyed on (chainId, token, effectiveAt) because a schedule can be re-announced:
 * CRWD emitted the same (newMultiplier, effectiveAt) pair twice, 11 hours apart.
 * Appending blindly would turn one corporate action into two.
 *
 * There is deliberately no `appliedTx` or `appliedAt`. Nothing is emitted when a
 * change takes effect - verified over 200 000 blocks past activation for SGOV
 * and CCL - so those columns could never be filled. Application is derived from
 * `effectiveAt` against the clock.
 */
export const multiplierEvents = onchainTable(
  'multiplier_events',
  (t) => ({
    chainId: t.integer().notNull(),
    token: t.hex().notNull(),
    /** Timestamp at which the new multiplier takes effect, seconds. */
    effectiveAt: t.bigint().notNull(),
    oldMultiplier: t.bigint().notNull(),
    newMultiplier: t.bigint().notNull(),
    /** First announcement of this (token, effectiveAt). */
    announcedAt: t.bigint().notNull(),
    announcedBlock: t.bigint().notNull(),
    announcedTx: t.hex().notNull(),
    /** Most recent re-announcement, equal to the first when there was only one. */
    lastAnnouncedAt: t.bigint().notNull(),
    lastAnnouncedTx: t.hex().notNull(),
    announcementCount: t.integer().notNull().default(1),
    /** dividend | split | reverse_split | unknown - set only from a matched action. */
    kind: t.text().notNull().default('unknown'),
    /**
     * Which scanner found this log.
     *
     * 'onchain:indexer' - Ponder saw the log itself while syncing.
     * 'onchain:scan'    - seeded from scripts/backfill-multiplier-events.mjs.
     *
     * Both are real logs with real transaction hashes; they differ only in how
     * they were discovered, and a reader is entitled to know which. The indexer
     * wins on conflict.
     */
    source: t.text().notNull().default('onchain:indexer'),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.token, table.effectiveAt] }),
    effectiveAtIdx: index().on(table.effectiveAt),
  }),
)

/** Latest poll of the ERC-8056 views. Present state, not history. */
export const tokenStates = onchainTable(
  'token_states',
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    uiMultiplier: t.bigint().notNull(),
    newUIMultiplier: t.bigint().notNull(),
    effectiveAt: t.bigint().notNull(),
    oraclePaused: t.boolean().notNull(),
    totalSupplyUI: t.bigint(),
    sampledAt: t.bigint().notNull(),
    sampledBlock: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.address] }) }),
)

/**
 * Distinct Chainlink rounds, keyed on the round id so a poll that sees no new
 * round writes nothing. This is a deduplicated price history, not a sample log.
 */
export const feedRounds = onchainTable(
  'feed_rounds',
  (t) => ({
    chainId: t.integer().notNull(),
    feed: t.hex().notNull(),
    roundId: t.bigint().notNull(),
    answer: t.bigint().notNull(),
    decimals: t.integer().notNull(),
    startedAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    /** When exdate first saw this round. */
    observedAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.feed, table.roundId] }),
    updatedAtIdx: index().on(table.updatedAt),
  }),
)

/** Latest known round per feed, plus when we last looked. */
export const feedStates = onchainTable(
  'feed_states',
  (t) => ({
    chainId: t.integer().notNull(),
    feed: t.hex().notNull(),
    roundId: t.bigint().notNull(),
    answer: t.bigint().notNull(),
    decimals: t.integer().notNull(),
    updatedAt: t.bigint().notNull(),
    sampledAt: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.feed] }) }),
)

/** A row is written only when `oraclePaused()` actually flips. */
export const pauseEvents = onchainTable(
  'pause_events',
  (t) => ({
    chainId: t.integer().notNull(),
    token: t.hex().notNull(),
    at: t.bigint().notNull(),
    paused: t.boolean().notNull(),
    block: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.token, table.at] }) }),
)

/**
 * The traditional side, straight from the issuer's own feed.
 *
 * `source` is recorded per row because the issuer's history is only about a
 * month deep - anything older has to come from a manual seed, and a reader must
 * be able to tell the two apart.
 */
export const corporateActions = onchainTable(
  'corporate_actions',
  (t) => ({
    /** The issuer's own uid, stable across chains. */
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    token: t.hex(),
    symbol: t.text().notNull(),
    underlyingSymbol: t.text(),
    type: t.text().notNull(),
    status: t.text().notNull(),
    /** ISO date, the issuer's scheduling day. Not the ex-date or payable date. */
    processDate: t.text(),
    /** Cash dividend: USD per underlying share, as a decimal string. */
    rate: t.text(),
    /** Splits: the old and new share ratio, as decimal strings. */
    oldRate: t.text(),
    newRate: t.text(),
    source: t.text().notNull(),
    firstSeenAt: t.bigint().notNull(),
    lastSeenAt: t.bigint().notNull(),
  }),
  (table) => ({
    tokenIdx: index().on(table.chainId, table.token),
    processDateIdx: index().on(table.processDate),
  }),
)
