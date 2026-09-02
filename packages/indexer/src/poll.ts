import { ponder } from 'ponder:registry'
import {
  corporateActions,
  feedRounds,
  feedStates,
  multiplierEvents,
  pauseEvents,
  syncMarkers,
  tokenStates,
  tokens,
} from 'ponder:schema'
import {
  ROBINHOOD_API_BASE,
  ROBINHOOD_CHAIN,
  SCANNED_MULTIPLIER_EVENTS,
  SCAN_THROUGH_BLOCK,
  aggregatorV3Abi,
  feedProxies,
  findToken,
  stockTokenAbi,
  throttledHttp,
  tokenAddresses,
  tokensForChain,
} from '@exdate/core'
import { runReconcilePass } from './reconcile-pass.js'
import { createPublicClient, parseAbiItem, type Address } from 'viem'

/**
 * The poller.
 *
 * ERC-8056 views and Chainlink rounds are present state, not events, so nothing
 * about them can be indexed from logs. This handler runs at the head of the
 * chain on a block interval and writes what it reads.
 *
 * Cost per poll, with Multicall3 (verified deployed at the canonical address on
 * Robinhood Chain): ~30 requests for 194 tokens x 5 views plus 35 feeds. Without it, 1 005.
 */

/** The issuer caches /corporate-actions for an hour; polling faster is waste. */
const CORPORATE_ACTIONS_INTERVAL_MS = 60 * 60 * 1000
/** After a failed fetch, try again sooner than the full hour. */
const CORPORATE_ACTIONS_RETRY_MS = 5 * 60 * 1000
/**
 * Module state, so it is NOT rolled back when Ponder retries a block. That is
 * acceptable here only because the worst case is a delayed fetch; it must never
 * gate a database write, which is why the seed below has no such flag.
 */
let corporateActionsNextAt = 0

/**
 * Sweep the gap only when it is wide enough to be a start-up or a downtime gap.
 * Ponder's live sync covers the tail; re-sweeping 600 blocks every poll would
 * double the eth_getLogs load for nothing.
 */
const SWEEP_MIN_GAP_BLOCKS = 10_000n
const SWEEP_CHUNK_BLOCKS = 2_000_000n

const rpcUrl = process.env.RHC_RPC_URL_ARCHIVE || process.env.RHC_RPC_URL || ROBINHOOD_CHAIN.defaultRpcUrl
const sweepClient = createPublicClient({
  transport: throttledHttp(rpcUrl, {
    minGapMs: Number(process.env.RHC_RPC_MIN_GAP_MS ?? 80),
    timeout: 45_000,
    onFetchRequest: async (request) => {
      if (process.env.EXDATE_DEBUG_RPC) {
        const body = await request.clone().text()
        console.log(`[exdate:rpc] ${body.slice(0, 120)} ... ${body.slice(-160)}`)
      }
    },
  }),
})
const UI_MULTIPLIER_UPDATED = parseAbiItem(
  'event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)',
)

interface MulticallFailure {
  status: 'failure'
  error: unknown
  result?: undefined
}
interface MulticallSuccess<T> {
  status: 'success'
  result: T
  error?: undefined
}
type MulticallResult<T> = MulticallSuccess<T> | MulticallFailure

const ok = <T>(entry: MulticallResult<T> | undefined): T | undefined =>
  entry?.status === 'success' ? entry.result : undefined

ponder.on('Poll:block', async ({ event, context }) => {
  const chainId = context.chain.id
  const now = event.block.timestamp
  const blockNumber = event.block.number
  const registry = tokensForChain(chainId)
  if (registry.length === 0) return

  const multicallAddress = ROBINHOOD_CHAIN.multicall3Address

  // Reconcile FIRST, on state this handler has not touched yet.
  //
  // Ponder buffers writes made inside an indexing function, so a `db.sql` read
  // issued later in the same handler does not see rows written earlier in it.
  // Running the pass at the top of the cycle means it reads what previous cycles
  // committed, which is exactly right: it reconciles past corporate actions, and
  // one poll interval of latency on a dividend that settled days ago is nothing.
  const reconciled = await runReconcilePass(context, chainId, now)
  if (reconciled > 0) console.log(`[exdate] reconciliation: ${reconciled} row(s) written`)

  // Every poll, not once per process. Twelve onConflictDoNothing inserts cost
  // nothing, and a module-level "done" flag would survive a transaction that
  // Ponder rolled back and retried - leaving the history dropped for the life
  // of the process.
  await seedScannedHistory(context, chainId)
  await sweepGap(context, chainId, blockNumber, now)

  // --- ERC-8056 views -------------------------------------------------------
  const viewNames = ['uiMultiplier', 'newUIMultiplier', 'effectiveAt', 'oraclePaused', 'totalSupplyUI'] as const
  const viewResults = (await context.client.multicall({
    contracts: registry.flatMap((token) =>
      viewNames.map((functionName) => ({ abi: stockTokenAbi, address: token.address, functionName })),
    ),
    allowFailure: true,
    multicallAddress,
  })) as MulticallResult<unknown>[]

  for (const [i, token] of registry.entries()) {
    const base = i * viewNames.length
    const uiMultiplier = ok<bigint>(viewResults[base] as MulticallResult<bigint>)
    const newUIMultiplier = ok<bigint>(viewResults[base + 1] as MulticallResult<bigint>)
    const effectiveAt = ok<bigint>(viewResults[base + 2] as MulticallResult<bigint>)
    const oraclePaused = ok<boolean>(viewResults[base + 3] as MulticallResult<boolean>)
    const totalSupplyUI = ok<bigint>(viewResults[base + 4] as MulticallResult<bigint>)

    // A token whose ERC-8056 views revert is not a Stock Token. Skip it rather
    // than writing a default: a fabricated 1.0 multiplier is worse than a gap.
    if (uiMultiplier === undefined || newUIMultiplier === undefined || effectiveAt === undefined) continue

    await context.db
      .insert(tokens)
      .values({
        chainId,
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        isin: token.isin,
        issuer: ROBINHOOD_CHAIN.issuer,
        status: token.status,
        logoUrl: token.logoUrl,
        feedProxy: token.feedProxy,
        feedDecimals: token.feedDecimals,
        feedVerified: token.feedVerified,
      })
      .onConflictDoUpdate(() => ({
        symbol: token.symbol,
        name: token.name,
        status: token.status,
        feedProxy: token.feedProxy,
        feedDecimals: token.feedDecimals,
        feedVerified: token.feedVerified,
      }))

    const previous = await context.db.find(tokenStates, { chainId, address: token.address })

    // A failed oraclePaused read is stored as null, exactly like totalSupplyUI.
    // Coercing it to false would publish "not paused" as an observation.
    await context.db
      .insert(tokenStates)
      .values({
        chainId,
        address: token.address,
        uiMultiplier,
        newUIMultiplier,
        effectiveAt,
        oraclePaused: oraclePaused ?? null,
        totalSupplyUI: totalSupplyUI ?? null,
        sampledAt: now,
        sampledBlock: blockNumber,
      })
      .onConflictDoUpdate(() => ({
        uiMultiplier,
        newUIMultiplier,
        effectiveAt,
        oraclePaused: oraclePaused ?? null,
        totalSupplyUI: totalSupplyUI ?? null,
        sampledAt: now,
        sampledBlock: blockNumber,
      }))

    if (oraclePaused !== undefined) {
      if (previous === null && oraclePaused) {
        // First ever observation and the oracle is already paused: record it as
        // a baseline whose start is unknown, not as a transition seen at `now`.
        await context.db
          .insert(pauseEvents)
          .values({ chainId, token: token.address, at: now, paused: true, block: blockNumber, kind: 'baseline' })
          .onConflictDoNothing()
      } else if (previous !== null && previous.oraclePaused !== null && previous.oraclePaused !== oraclePaused) {
        await context.db
          .insert(pauseEvents)
          .values({ chainId, token: token.address, at: now, paused: oraclePaused, block: blockNumber, kind: 'transition' })
          .onConflictDoNothing()
      }
    }
  }

  // --- Chainlink feeds ------------------------------------------------------
  const proxies: Address[] = feedProxies(chainId)
  if (proxies.length > 0) {
    const roundResults = (await context.client.multicall({
      contracts: proxies.map((address) => ({ abi: aggregatorV3Abi, address, functionName: 'latestRoundData' })),
      allowFailure: true,
      multicallAddress,
    })) as MulticallResult<readonly [bigint, bigint, bigint, bigint, bigint]>[]

    for (const [i, feed] of proxies.entries()) {
      const round = ok(roundResults[i])
      if (round === undefined) continue
      const [roundId, answer, startedAt, updatedAt] = round
      // Every Robinhood tokenized-equity feed reports 8 decimals; the value is
      // carried on the token row so the API never has to guess.
      const decimals = findToken(chainId, registryTokenForFeed(chainId, feed))?.feedDecimals ?? 8

      await context.db
        .insert(feedRounds)
        .values({ chainId, feed, roundId, answer, decimals, startedAt, updatedAt, observedAt: now })
        .onConflictDoNothing()

      await context.db
        .insert(feedStates)
        .values({ chainId, feed, roundId, answer, decimals, updatedAt, sampledAt: now })
        .onConflictDoUpdate(() => ({ roundId, answer, decimals, updatedAt, sampledAt: now }))
    }
  }

  // --- Issuer corporate actions ---------------------------------------------
  if (Date.now() >= corporateActionsNextAt) {
    // Set before the call so a failure cannot retry on every block, but a
    // failure schedules the next attempt in minutes, not the full hour.
    corporateActionsNextAt = Date.now() + CORPORATE_ACTIONS_RETRY_MS
    const ingested = await ingestCorporateActions(context, chainId, now)
    if (ingested) corporateActionsNextAt = Date.now() + CORPORATE_ACTIONS_INTERVAL_MS
  }
})

/**
 * Close the window between the committed scan and Ponder's live sync.
 *
 * Runs the same wide query as scripts/backfill-multiplier-events.mjs - every
 * token address, one topic, 2 000 000 blocks per request - from the last block
 * the sweep guaranteed to the current head, and seeds anything it finds. Uses a
 * plain viem client on the throttled transport rather than Ponder's cached
 * client: this is a one-off catch-up read, not indexing state.
 */
async function sweepGap(context: PollContext, chainId: number, head: bigint, now: bigint) {
  const marker = await context.db.find(syncMarkers, { chainId, key: 'multiplier-events' })
  const from = (marker?.throughBlock ?? BigInt(SCAN_THROUGH_BLOCK)) + 1n
  if (head - from < SWEEP_MIN_GAP_BLOCKS) return

  const addresses = tokenAddresses(chainId)
  let found = 0
  for (let start = from; start <= head; start += SWEEP_CHUNK_BLOCKS) {
    const end = start + SWEEP_CHUNK_BLOCKS - 1n > head ? head : start + SWEEP_CHUNK_BLOCKS - 1n
    let logs
    try {
      logs = await sweepClient.getLogs({ address: addresses, event: UI_MULTIPLIER_UPDATED, fromBlock: start, toBlock: end })
    } catch (error) {
      // Leave the marker where it was: the next poll retries the same window.
      // Observed: the pool answered -32602 "Missing or invalid parameters" twice
      // to a body it accepted unchanged a minute later. Set EXDATE_DEBUG_RPC=1
      // to log the body and see for yourself.
      console.warn(`[exdate] gap sweep ${start}-${end} failed: ${(error as Error).message.slice(0, 120)}`)
      return
    }
    for (const log of logs) {
      const { oldMultiplier, newMultiplier, effectiveAtTimestamp } = log.args
      if (oldMultiplier === undefined || newMultiplier === undefined || effectiveAtTimestamp === undefined) continue
      const block = await sweepClient.getBlock({ blockNumber: log.blockNumber })
      const inserted = await context.db
        .insert(multiplierEvents)
        .values({
          chainId,
          token: log.address,
          effectiveAt: effectiveAtTimestamp,
          oldMultiplier,
          newMultiplier,
          announcedAt: block.timestamp,
          announcedBlock: log.blockNumber,
          announcedTx: log.transactionHash,
          lastAnnouncedAt: block.timestamp,
          lastAnnouncedTx: log.transactionHash,
          announcementCount: 1,
          kind: 'unknown',
          source: 'onchain:sweep',
        })
        .onConflictDoNothing()
      if (inserted) found++
    }
  }

  await context.db
    .insert(syncMarkers)
    .values({ chainId, key: 'multiplier-events', throughBlock: head, updatedAt: now })
    .onConflictDoUpdate(() => ({ throughBlock: head, updatedAt: now }))
  console.log(`[exdate] gap sweep ${from}-${head}: ${found} new event(s)`)
}

/**
 * Seed the multiplier events found by the full-chain scan.
 *
 * `onConflictDoNothing` means anything Ponder has already indexed itself is
 * left alone, so the seed can only ever fill gaps - it never overwrites a row
 * the indexer produced. See packages/core/src/generated/registry.ts for why the
 * scan exists at all.
 */
async function seedScannedHistory(context: PollContext, chainId: number) {
  const seconds = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))

  // Collapse re-announcements before writing. CRWD announced the same
  // (newMultiplier, effectiveAt) twice, 11 hours apart, and the table is keyed
  // on (chain, token, effectiveAt): inserting both rows one at a time would
  // silently drop the second and leave announcementCount at 1, hiding exactly
  // the trap this key exists to handle.
  const grouped = new Map<string, (typeof SCANNED_MULTIPLIER_EVENTS)[number][]>()
  for (const event of SCANNED_MULTIPLIER_EVENTS) {
    if (event.chainId !== chainId) continue
    const id = `${event.token.toLowerCase()}:${event.effectiveAt}`
    const bucket = grouped.get(id)
    if (bucket) bucket.push(event)
    else grouped.set(id, [event])
  }

  let seeded = 0
  for (const announcements of grouped.values()) {
    const ordered = [...announcements].sort((a, b) => a.block - b.block)
    const first = ordered[0]!
    const last = ordered.at(-1)!
    const inserted = await context.db
      .insert(multiplierEvents)
      .values({
        chainId,
        token: first.token,
        effectiveAt: seconds(first.effectiveAt),
        // The last announcement is the one that takes effect.
        oldMultiplier: BigInt(last.oldMultiplier),
        newMultiplier: BigInt(last.newMultiplier),
        announcedAt: seconds(first.announcedAt),
        announcedBlock: BigInt(first.block),
        announcedTx: first.tx,
        lastAnnouncedAt: seconds(last.announcedAt),
        lastAnnouncedTx: last.tx,
        announcementCount: ordered.length,
        kind: 'unknown',
        source: 'onchain:scan',
      })
      .onConflictDoNothing()
    if (inserted) seeded++
  }
  if (seeded > 0) {
    console.log(`[exdate] seeded ${seeded} scanned multiplier events from ${SCANNED_MULTIPLIER_EVENTS.length} logs`)
  }
}

/** First token on this chain that points at a given aggregator. */
function registryTokenForFeed(chainId: number, feed: Address): Address {
  const match = tokensForChain(chainId).find(
    (token) => token.feedProxy?.toLowerCase() === feed.toLowerCase(),
  )
  return match?.address ?? feed
}

type PollContext = Parameters<Parameters<typeof ponder.on<'Poll:block'>>[1]>[0]['context']

/**
 * Pull the issuer's own corporate-action feed.
 *
 * This is the traditional side of the reconciliation table, published by the
 * issuer itself, so no market-data vendor is involved. Its history is only
 * about a month deep - snapshotting it on every poll is how exdate accumulates
 * an archive the issuer does not keep.
 */
async function ingestCorporateActions(context: PollContext, chainId: number, now: bigint): Promise<boolean> {
  let payload: { corpActions?: unknown[] }
  try {
    const response = await fetch(`${ROBINHOOD_API_BASE}/corporate-actions`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    // The issuer answers rate limiting with a plain-text body and HTTP 200.
    if (!text.trimStart().startsWith('{')) throw new Error(`non-JSON body: ${text.slice(0, 40)}`)
    payload = JSON.parse(text)
  } catch (error) {
    console.warn(`[exdate] corporate-actions fetch failed: ${(error as Error).message}`)
    return false
  }

  for (const raw of payload.corpActions ?? []) {
    const action = raw as {
      id?: string
      type?: string
      status?: string
      tokenSymbol?: string
      processDate?: { year: number; month: number; day: number } | null
      deployments?: { contractAddress: string; chainId: number }[]
      details?: Record<string, { underlyingSymbol?: string; rate?: string; oldRate?: string; newRate?: string }>
    }
    if (!action.id || !action.type || !action.status || !action.tokenSymbol) continue

    const deployment = action.deployments?.find((d) => d.chainId === chainId)
    const detail = action.details ? Object.values(action.details)[0] : undefined
    const processDate = action.processDate
      ? `${action.processDate.year}-${String(action.processDate.month).padStart(2, '0')}-${String(action.processDate.day).padStart(2, '0')}`
      : null

    const values = {
      id: action.id,
      chainId,
      token: (deployment?.contractAddress ?? null) as Address | null,
      symbol: action.tokenSymbol,
      underlyingSymbol: detail?.underlyingSymbol ?? null,
      type: action.type,
      status: action.status,
      processDate,
      rate: detail?.rate ?? null,
      oldRate: detail?.oldRate ?? null,
      newRate: detail?.newRate ?? null,
      source: 'robinhood:/rhj/corporate-actions',
      firstSeenAt: now,
      lastSeenAt: now,
    }

    await context.db
      .insert(corporateActions)
      .values(values)
      .onConflictDoUpdate(() => ({
        status: values.status,
        processDate: values.processDate,
        rate: values.rate,
        oldRate: values.oldRate,
        newRate: values.newRate,
        token: values.token,
        lastSeenAt: now,
      }))
  }

  return true
}
