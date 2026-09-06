import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  feedRounds,
  feedStates,
  multiplierEvents,
  pauseEvents,
  syncMarkers,
  tokenStates,
  tokens,
  webhookEvents,
} from 'ponder:schema'
import { ROBINHOOD_CHAIN, feedProxies, tokensForChain } from '@exdate/core'
import { ponderStore } from './fixtures/ponder-store.js'

/**
 * The poller, replayed.
 *
 * "The poller and the gap sweep have no tests of their own: they need a chain and a Ponder process,
 * so they are exercised by running the indexer" was a known gap, and it covered the branches where
 * this repository's hardest-won facts live: that a nonzero effectiveAt in the past means ALREADY
 * APPLIED and not pending; that nothing is emitted on chain when a change takes effect, so an
 * observed difference is the only evidence; and that a token already paused the first time exdate
 * looks is a baseline rather than a pause. Getting any of those wrong publishes a corporate action
 * that did not happen, and running the indexer by hand does not catch it - it looks like a poll
 * that worked.
 *
 * What is doubled: `ponder:registry` captures the handler instead of scheduling it, `context.db` is
 * a store over Maps, `context.client.multicall` answers with readings written here, and `fetch` is
 * the issuer. What is NOT doubled: everything the handler decides. Each case is a sequence of polls
 * against the same store, so the second poll sees what the first one wrote - which is the only way
 * a transition can be tested at all.
 *
 * What this does not reach: the gap sweep's eth_getLogs path, because `sweepClient` is built at
 * module scope from a real transport. The cases below keep the head inside SWEEP_MIN_GAP_BLOCKS of
 * the marker so the sweep returns before touching the network, and that limit is stated rather than
 * papered over.
 */

const CHAIN = ROBINHOOD_CHAIN.id
const WAD = 10n ** 18n
const NOW = 1_788_400_000n
const HEAD = 55_000_000n

/**
 * SGOV's real chained multipliers, from data/multiplier-events.observed.json. It is the reference
 * token for exactly this reason: three chained steps, so a "moved since the last poll" case can be
 * replayed against numbers the chain actually produced rather than a made-up delta.
 */
const SGOV_AUG = 1_002_981_519_346_766_532n
const SGOV_SEP = 1_005_101_770_003_214_918n

const registry = tokensForChain(CHAIN)
const proxies = feedProxies(CHAIN)
const SGOV = registry.find((t) => t.symbol === 'SGOV')!
const AAPL = registry.find((t) => t.symbol === 'AAPL')!

type View = { uiMultiplier?: bigint; newUIMultiplier?: bigint; effectiveAt?: bigint; oraclePaused?: boolean; totalSupplyUI?: bigint; reverts?: boolean }

const DEFAULT_VIEW: View = { uiMultiplier: WAD, newUIMultiplier: WAD, effectiveAt: 0n, oraclePaused: false, totalSupplyUI: WAD }

/** The five ERC-8056 view results for every token, in the order the handler builds its calls. */
function viewResults(overrides: Record<string, View>) {
  return registry.flatMap((token) => {
    const view = { ...DEFAULT_VIEW, ...(overrides[token.address.toLowerCase()] ?? {}) }
    if (view.reverts) return Array.from({ length: 5 }, () => ({ status: 'failure' as const, error: new Error('reverted') }))
    return [view.uiMultiplier, view.newUIMultiplier, view.effectiveAt, view.oraclePaused, view.totalSupplyUI].map(
      (result) => ({ status: 'success' as const, result }),
    )
  })
}

/** One Chainlink round per feed. `answer` and the round id do not matter here; `updatedAt` does. */
const roundResults = (updatedAt: bigint) =>
  proxies.map((_, i) => ({ status: 'success' as const, result: [BigInt(i + 1), 10_000_000_000n, updatedAt, updatedAt, BigInt(i + 1)] as const }))

function harness() {
  const store = ponderStore()
  // The sweep is skipped by leaving the marker one block behind the head: SWEEP_MIN_GAP_BLOCKS is
  // 10 000, so a gap of one is not a start-up gap and the handler returns before any eth_getLogs.
  store.put(syncMarkers, { chainId: CHAIN, key: 'multiplier-events', throughBlock: HEAD - 1n, updatedAt: NOW })
  const multicall = vi.fn()
  // The reconcile pass reads a Chainlink round per priced step through readContract. Answered with
  // one round whose updatedAt is the instant asked for, so the binary search in
  // packages/core/src/rounds.ts converges at once - that search has its own tests, and re-testing
  // it here would be testing core through the poller.
  const readContract = vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly bigint[] }) => {
    const roundId = functionName === 'getRoundData' ? (args?.[0] ?? 1n) : 1n
    return [roundId, 10_000_000_000n, NOW - 60n, NOW - 60n, roundId] as const
  })
  const context = {
    chain: { id: CHAIN },
    db: store.db,
    client: { multicall, readContract },
  }
  return { store, multicall, readContract, context }
}

async function poll(handler: (a: { event: unknown; context: unknown }) => Promise<void>, harnessed: ReturnType<typeof harness>, opts: { views: Record<string, View>; feedUpdatedAt?: bigint; now?: bigint; block?: bigint }) {
  const now = opts.now ?? NOW
  harnessed.multicall
    .mockResolvedValueOnce(viewResults(opts.views))
    .mockResolvedValueOnce(roundResults(opts.feedUpdatedAt ?? now - 60n))
  await handler({
    event: { block: { timestamp: now, number: opts.block ?? HEAD } },
    context: harnessed.context,
  })
}

/** `payload` is stored as the exact JSON body that will be signed, so it is text, not an object. */
const dataOf = (row: Record<string, unknown>) => JSON.parse(String(row.payload)).data as Record<string, unknown>

let handler: (a: { event: unknown; context: unknown }) => Promise<void>

beforeEach(async () => {
  vi.resetModules()
  // The issuer's corporate-action feed. Answered empty rather than refused: an empty window is a
  // real state (the endpoint is about a month deep), and a refusal would exercise the retry path
  // rather than the poll.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ corpActions: [] }), { status: 200 })))
  await import('../src/poll.js')
  // Imported from the SAME fresh module graph. `vi.resetModules()` gives the poller a new
  // registry double as well, so a statically imported `registeredHandler` would read an empty
  // map that nothing ever registered against - which is what the first run of this file did.
  const { registeredHandler } = await import('./fixtures/ponder-registry.js')
  handler = registeredHandler('Poll:block')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('what one poll writes', () => {
  it('records every token it could read, and none of the ones it could not', async () => {
    const h = harness()
    await poll(handler, h, { views: { [AAPL.address.toLowerCase()]: { reverts: true } } })
    const states = h.store.rows(tokenStates)
    expect(states).toHaveLength(registry.length - 1)
    // A fabricated 1.0 multiplier is worse than a gap: a token whose ERC-8056 views revert is not
    // a Stock Token, and writing a default would publish a reading nobody took.
    expect(states.some((s) => String(s.address).toLowerCase() === AAPL.address.toLowerCase())).toBe(false)
  })

  it('writes the static registry row once and the sampled state every time', async () => {
    const h = harness()
    await poll(handler, h, { views: {} })
    const firstToken = h.store.rows(tokens).find((t) => String(t.address).toLowerCase() === SGOV.address.toLowerCase())!
    await poll(handler, h, { views: {}, now: NOW + 600n })
    const state = h.store.rows(tokenStates).find((s) => String(s.address).toLowerCase() === SGOV.address.toLowerCase())!
    // `sampledAt` is an observation: skipping the write would make "checked, unchanged" read as
    // "not checked since", which is why tokenStates is written every poll on purpose.
    expect(state.sampledAt).toBe(NOW + 600n)
    expect(h.store.rows(tokens)).toHaveLength(registry.length)
    expect(firstToken.symbol).toBe('SGOV')
  })
})

describe('the retrospective trap', () => {
  const scheduled = { uiMultiplier: WAD, newUIMultiplier: WAD + 10n ** 15n, effectiveAt: NOW + 540n }
  const applied = { uiMultiplier: WAD + 10n ** 15n, newUIMultiplier: WAD + 10n ** 15n, effectiveAt: NOW - 86_400n }

  it('announces a change that is scheduled and not yet in effect', async () => {
    const h = harness()
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: scheduled } })
    const events = h.store.rows(webhookEvents).filter((e) => e.type === 'multiplier.scheduled')
    expect(events).toHaveLength(1)
    expect(dataOf(events[0]).secondsUntilEffective).toBe(540)
  })

  it('announces nothing for a nonzero effectiveAt in the past, which means already applied', async () => {
    // The trap this repository found by measurement and Base later documented: treating a nonzero
    // effectiveAt as "pending" reported nine phantom dividends. Every one of the 194 tokens here
    // carries a past effectiveAt in the `applied` case, so a regression is 194 phantom rows.
    const h = harness()
    await poll(handler, h, { views: Object.fromEntries(registry.map((t) => [t.address.toLowerCase(), applied])) })
    expect(h.store.rows(webhookEvents).filter((e) => e.type === 'multiplier.scheduled')).toHaveLength(0)
  })
})

describe('a change taking effect, which emits no log', () => {
  it('says nothing on the first sight of a token, because that is a baseline', async () => {
    const h = harness()
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: { uiMultiplier: WAD + 10n ** 15n } } })
    expect(h.store.rows(webhookEvents).filter((e) => e.type === 'multiplier.applied')).toHaveLength(0)
  })

  it('reports the move on the poll that sees it, from the difference alone', async () => {
    const h = harness()
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: { uiMultiplier: SGOV_AUG } } })
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: { uiMultiplier: SGOV_SEP } }, now: NOW + 600n })
    const events = h.store.rows(webhookEvents).filter((e) => e.type === 'multiplier.applied')
    expect(events).toHaveLength(1)
    const data = dataOf(events[0])
    // 21.14 bps: the step the record publishes for SGOV on 2026-09-01, recomputed here from the
    // two multipliers alone - which is what the poller has to do, since nothing is emitted on chain.
    expect(Number(data.stepBps)).toBeCloseTo(21.14, 2)
    expect(String(data.basis)).toContain('no log is emitted')
  })

  it('reports it once, not again on every later poll', async () => {
    const h = harness()
    const moved = { [SGOV.address.toLowerCase()]: { uiMultiplier: SGOV_SEP } }
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: { uiMultiplier: SGOV_AUG } } })
    await poll(handler, h, { views: moved, now: NOW + 600n })
    await poll(handler, h, { views: moved, now: NOW + 1200n })
    expect(h.store.rows(webhookEvents).filter((e) => e.type === 'multiplier.applied')).toHaveLength(1)
  })
})

describe('a paused oracle', () => {
  it('records a baseline, and sends nothing, when a token is already paused the first time exdate looks', async () => {
    const h = harness()
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: { oraclePaused: true } } })
    const paused = h.store.rows(pauseEvents)
    expect(paused).toHaveLength(1)
    expect(paused[0].kind).toBe('baseline')
    expect(h.store.rows(webhookEvents).filter((e) => e.type === 'pause.changed')).toHaveLength(0)
  })

  it('sends the transition when a token that was live pauses', async () => {
    const h = harness()
    await poll(handler, h, { views: {} })
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: { oraclePaused: true } }, now: NOW + 600n })
    const events = h.store.rows(webhookEvents).filter((e) => e.type === 'pause.changed')
    expect(events).toHaveLength(1)
    expect(dataOf(events[0]).paused).toBe(true)
    expect(h.store.rows(pauseEvents).filter((p) => p.kind === 'transition')).toHaveLength(1)
  })

  it('stores a failed read as null rather than as "not paused"', async () => {
    const h = harness()
    await poll(handler, h, { views: { [SGOV.address.toLowerCase()]: { oraclePaused: undefined } } })
    const state = h.store.rows(tokenStates).find((s) => String(s.address).toLowerCase() === SGOV.address.toLowerCase())!
    expect(state.oraclePaused).toBeNull()
    // A failed read must not be recorded as a pause transition either.
    expect(h.store.rows(pauseEvents)).toHaveLength(0)
  })
})

describe('the Chainlink feeds', () => {
  it('records one round per feed and does not record it twice', async () => {
    const h = harness()
    await poll(handler, h, { views: {} })
    expect(h.store.rows(feedRounds)).toHaveLength(proxies.length)
    await poll(handler, h, { views: {}, now: NOW + 600n })
    // Keyed on the round id: a poll that sees no new round writes nothing. This is a deduplicated
    // price history, not a sample log.
    expect(h.store.rows(feedRounds)).toHaveLength(proxies.length)
    expect(h.store.rows(feedStates)).toHaveLength(proxies.length)
  })

  it('says nothing on the first sight of a stale feed, and reports it when a live one goes stale', async () => {
    const h = harness()
    await poll(handler, h, { views: {}, feedUpdatedAt: NOW - 200_000n })
    expect(h.store.rows(webhookEvents).filter((e) => e.type === 'feed.stale')).toHaveLength(0)

    const fresh = harness()
    await poll(handler, fresh, { views: {}, feedUpdatedAt: NOW - 60n })
    await poll(handler, fresh, { views: {}, now: NOW + 600n, feedUpdatedAt: NOW - 200_000n })
    expect(fresh.store.rows(webhookEvents).filter((e) => e.type === 'feed.stale')).toHaveLength(proxies.length)
  })
})

describe('the seeded history', () => {
  it('seeds the scanned events without overwriting anything the indexer found', async () => {
    const h = harness()
    // A row the live indexer already wrote, on a step the scan also carries.
    const scanned = h.store
    await poll(handler, h, { views: {} })
    const seeded = scanned.rows(multiplierEvents)
    expect(seeded.length).toBeGreaterThan(0)
    expect(seeded.every((e) => e.source === 'onchain:scan')).toBe(true)

    const second = harness()
    second.store.put(multiplierEvents, {
      chainId: CHAIN,
      token: seeded[0].token,
      effectiveAt: seeded[0].effectiveAt,
      oldMultiplier: 1n,
      newMultiplier: 2n,
      announcedAt: 1n,
      announcedBlock: 1n,
      announcedTx: '0xindexer',
      lastAnnouncedAt: 1n,
      lastAnnouncedTx: '0xindexer',
      announcementCount: 1,
      kind: 'dividend',
      source: 'onchain:indexer',
    })
    await poll(handler, second, { views: {} })
    const kept = second.store.rows(multiplierEvents).find((e) => e.announcedTx === '0xindexer')
    // onConflictDoNothing: the seed can only ever fill gaps, never overwrite a row the indexer
    // produced. Getting this backwards would replace real transaction hashes with scanned ones.
    expect(kept?.source).toBe('onchain:indexer')
  })

  it('collapses a re-announced schedule into one row rather than dropping the second', async () => {
    // CRWD announced the same (newMultiplier, effectiveAt) twice, 11 hours apart. The table is
    // keyed on (chain, token, effectiveAt), so inserting both one at a time silently drops the
    // second and leaves announcementCount at 1 - hiding the trap the key exists to handle.
    const h = harness()
    await poll(handler, h, { views: {} })
    const rows = h.store.rows(multiplierEvents)
    const keys = rows.map((e) => `${e.token}:${e.effectiveAt}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(rows.some((e) => Number(e.announcementCount) > 1)).toBe(true)
  })
})
