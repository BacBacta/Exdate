import { ROBINHOOD_CHAIN, failoverHttp, stockTokenAbi, tokenAddresses } from '@exdate/core'
import { createConfig } from 'ponder'

/**
 * Endpoints in order, tried left to right. RHC_RPC_URL_ARCHIVE alone wins when
 * set - that is the operator choosing to have Ponder own the whole history from
 * one archive provider. Otherwise RHC_RPC_URLS, then RHC_RPC_URL, then the
 * built-in order, which is the same one scripts/phase0/rpc.mjs carries (that
 * file imports nothing, so the list is written twice on purpose): a measured
 * third-party endpoint first, Robinhood's own only as the fallback. The reason
 * is in docs/terms-review.md and on failoverHttp.
 */
const DEFAULT_RPC_URLS = ['https://robinhood.api.pocket.network', ROBINHOOD_CHAIN.defaultRpcUrl]
const rpcUrls = (process.env.RHC_RPC_URL_ARCHIVE || process.env.RHC_RPC_URLS || process.env.RHC_RPC_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)
const rpcUrlsInUse = rpcUrls.length ? rpcUrls : DEFAULT_RPC_URLS

/**
 * Minimum gap between two RPC calls, ms. The public endpoint rejects roughly
 * half of all eth_getLogs calls whatever the pacing, so the transport retries
 * rather than relying on this; raise it only if a provider asks for it.
 */
const minGapMs = Number(process.env.RHC_RPC_MIN_GAP_MS ?? 80)

/**
 * Blocks between polls of the ERC-8056 views and the Chainlink feeds.
 * ~0.1 s per block, so 600 blocks is about a minute.
 */
const pollIntervalBlocks = Number(process.env.EXDATE_POLL_INTERVAL_BLOCKS ?? 600)

/**
 * Where the event sync starts. Defaults to the head, and that default is a
 * consequence of the endpoint, not a shortcut.
 *
 * Ponder splits the 194 addresses into four eth_getLogs calls per sync round
 * and sizes each round from the previous round's duration, starting at 25
 * blocks and growing by at most half. On this RPC a round takes 9-16 s, so the
 * range never leaves its floor: measured at 25 blocks per 12 s, walking the
 * 51.7 M blocks since the public mainnet date would take about 300 days.
 *
 * The full history is instead scanned by scripts/backfill-multiplier-events.mjs
 * - one wide query per 2 000 000 blocks, 26 requests, about two minutes - and
 * seeded by the poller. Ponder then does what it is good at: catching every new
 * event live.
 *
 * Point RHC_RPC_URL_ARCHIVE at a dedicated provider and set RHC_START_BLOCK to
 * 900000 to have Ponder own the whole history instead.
 */
const startBlock = process.env.RHC_START_BLOCK ? Number(process.env.RHC_START_BLOCK) : ('latest' as const)

export default createConfig({
  chains: {
    robinhood: {
      id: ROBINHOOD_CHAIN.id,
      // Absorbs HTTP 429 internally. A surfaced 429 makes Ponder deactivate the
      // provider and collapse its sync range to the 25-block floor, from which
      // the backfill never recovers on this endpoint.
      rpc: failoverHttp(rpcUrlsInUse, {
        minGapMs,
        timeout: 45_000,
        onThrottle: ({ method, attempt, delayMs }) => {
          if (attempt % 4 === 0) {
            console.warn(`[exdate] ${method} throttled, attempt ${attempt}, backing off ${Math.round(delayMs)}ms`)
          }
        },
      }),
      // Verified in Phase 0: a 5 000 000-block eth_getLogs filtered on all 194
      // token addresses answers in under a second when it is not rejected.
      ethGetLogsBlockRange: Number(process.env.RHC_GET_LOGS_BLOCK_RANGE ?? 2_000_000),
      /**
       * How often Ponder asks for a new head.
       *
       * Measured through a counting proxy on 2026-09-04, because the indexer is
       * by far the largest RPC consumer here and eth_getBlockByNumber is ~90 % of
       * its calls. The obvious saving is not there: raising this from 2 000 ms to
       * 30 000 ms made the rate go UP, from 1.92 to 4.03 calls/s, because the
       * chain produces ~10 blocks a second and a longer interval leaves more to
       * reconcile on each poll. Left at 2 s, and the number kept here so the next
       * person does not re-derive the wrong answer from first principles.
       * Overridable if a provider's own accounting says otherwise.
       */
      pollingInterval: Number(process.env.RHC_POLLING_INTERVAL_MS ?? 2_000),
    },
  },
  contracts: {
    /**
     * Multiplier events only. Transfers are ~375 000 logs per day for AAPL
     * alone and nothing in M1-M3 reads them; indexing them needs a paid archive
     * RPC and buys nothing today. See docs/phase-0-verification.md section 7.
     */
    StockToken: {
      abi: stockTokenAbi,
      chain: 'robinhood',
      address: tokenAddresses(ROBINHOOD_CHAIN.id),
      startBlock,
      filter: { event: 'UIMultiplierUpdated', args: {} },
    },
  },
  blocks: {
    /**
     * The poller starts at the head, never in history.
     *
     * Two reasons. Present state is what these views are for - historical
     * multiplier state is reconstructible from the events themselves. And the
     * public RPC keeps only a few thousand blocks of state: `eth_call` at
     * latest-10 000 already answers "metadata is not found", so a historical
     * poll could not run even if it were useful.
     */
    Poll: {
      chain: 'robinhood',
      startBlock: 'latest',
      interval: pollIntervalBlocks,
    },
  },
})
