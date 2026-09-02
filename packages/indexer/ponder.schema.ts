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
    /**
     * Nullable, because a token missing from the committed registry has no
     * known decimals until they are read on chain, and a placeholder of 18
     * would be indistinguishable from a reading.
     */
    decimals: t.integer(),
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
    /**
     * Nullable. A failed read is null, never false: "the oracle is not paused"
     * is an observation, and a multicall entry that failed observed nothing.
     */
    oraclePaused: t.boolean(),
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

/**
 * Pause history.
 *
 * `transition` rows are written when `oraclePaused()` actually flips between
 * two polls. A `baseline` row is written when a token is first observed already
 * paused: the pause is real but its start is unknown, and a reader must be able
 * to tell that from a transition seen live. Nothing is written for a token first
 * observed unpaused - that is the ordinary state, not an event.
 */
export const pauseEvents = onchainTable(
  'pause_events',
  (t) => ({
    chainId: t.integer().notNull(),
    token: t.hex().notNull(),
    at: t.bigint().notNull(),
    paused: t.boolean().notNull(),
    block: t.bigint().notNull(),
    /** transition | baseline */
    kind: t.text().notNull().default('transition'),
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

/**
 * The differentiating asset: each declared corporate action against the multiplier
 * step it actually produced.
 *
 * Rows are computed by the poller, not indexed from an event, because the price
 * side needs a Chainlink round lookup and the traditional side comes from an HTTP
 * API. `priceRoundId` and `priceUpdatedAt` are stored so a reader can re-derive
 * the haircut from primary sources without trusting this table's arithmetic.
 *
 * Every row that carries a haircut also carries the price and the rate it came
 * from. A row with no reference price carries `impliedReinvestPriceWad` instead -
 * the price the step would have needed for the declared dividend to have arrived
 * in full - which is how CCL and COST were caught with no feed at all.
 */
export const reconciliations = onchainTable(
  'reconciliations',
  (t) => ({
    /** The issuer's action id, or `${token}:${effectiveAt}` for an unmatched step. */
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    token: t.hex(),
    symbol: t.text().notNull(),

    // --- traditional side, from GET /rhj/corporate-actions -------------------
    actionId: t.text(),
    actionType: t.text(),
    actionStatus: t.text(),
    /** The issuer's scheduling day. Not the ex-date and not the payable date. */
    processDate: t.text(),
    /** Declared gross amount per underlying share, as the issuer's decimal string. */
    rate: t.text(),

    // --- on-chain side, from UIMultiplierUpdated ------------------------------
    effectiveAt: t.bigint(),
    oldMultiplier: t.bigint(),
    newMultiplier: t.bigint(),
    observedStepWad: t.bigint(),
    /** Calendar days in UTC from processDate to effectiveAt. */
    lagDays: t.integer(),

    // --- reference price, from Chainlink getRoundData at effectiveAt ----------
    feed: t.hex(),
    priceWad: t.bigint(),
    priceRoundId: t.bigint(),
    priceUpdatedAt: t.bigint(),
    /** Seconds the round was already stale when the multiplier took effect. */
    priceStalenessSeconds: t.integer(),
    /**
     * True when the round found is the earliest of the aggregator's current
     * phase, so the real price at that instant may predate a rollover and be
     * unreachable. Such a row must not be read as a measurement.
     */
    priceAtPhaseFloor: t.boolean(),

    // --- result ---------------------------------------------------------------
    expectedStepWad: t.bigint(),
    receivedPerShareWad: t.bigint(),
    impliedHaircutBps: t.integer(),
    impliedReinvestPriceWad: t.bigint(),
    /** pending | matched | anomaly | unmatched */
    status: t.text().notNull(),
    /** low | medium | high. Low today for every row: see note on feedVerified. */
    confidence: t.text().notNull(),
    note: t.text(),
    computedAt: t.bigint().notNull(),
  }),
  (table) => ({
    tokenIdx: index().on(table.chainId, table.token),
    statusIdx: index().on(table.status),
  }),
)

/**
 * Where the gap sweep has reached.
 *
 * Ponder's event source starts at the head, and the committed scan stops at
 * SCAN_THROUGH_BLOCK. Anything announced between the two - and anything
 * announced while the process was down - is indexed by neither, so the poller
 * sweeps that window itself on start-up with the same wide eth_getLogs query the
 * backfill script uses, and records how far it got here. On the next start-up
 * the sweep resumes from this marker, which is what closes a downtime gap.
 */
export const syncMarkers = onchainTable(
  'sync_markers',
  (t) => ({
    chainId: t.integer().notNull(),
    key: t.text().notNull(),
    throughBlock: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.key] }) }),
)
