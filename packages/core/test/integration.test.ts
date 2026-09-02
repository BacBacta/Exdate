import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createPublicClient, http } from 'viem'
import { ROBINHOOD_CHAIN, aggregatorV3Abi, stockTokenAbi } from '../src/index.js'
import { REGISTRY_TOKENS } from '../src/registry.js'
import { findRoundAt, type RoundLookup } from '../src/rounds.js'
import { throttledHttp } from '../src/transport.js'

/**
 * Opt-in integration checks. `EXDATE_INTEGRATION=1 pnpm test`.
 *
 * These hit Robinhood Chain and the issuer's API for real, so they are skipped by
 * default: a unit suite that needs the network is a unit suite that fails for
 * reasons unrelated to the code.
 *
 * What they are for is drift. Every committed artifact in data/ is a claim about
 * the world on 2026-09-02. These re-assert the load-bearing ones against the live
 * chain, so a stale snapshot is caught by running a command rather than by
 * someone noticing a number looks wrong.
 */

const ENABLED = process.env.EXDATE_INTEGRATION === '1'

const reconciliations = JSON.parse(
  readFileSync(new URL('../../../data/reconciliations.observed.json', import.meta.url), 'utf8'),
) as {
  rows: {
    symbol: string
    token: string
    status: string
    change: { effectiveAt: string } | null
    price?: { value: string; roundId: string; updatedAt: string }
  }[]
}

const client = createPublicClient({
  transport: throttledHttp(ROBINHOOD_CHAIN.defaultRpcUrl, { minGapMs: 150, timeout: 45_000 }),
})

const lookupFor = (feed: `0x${string}`): RoundLookup => ({
  latest: async () => {
    const [roundId, answer, startedAt, updatedAt] = await client.readContract({
      address: feed,
      abi: aggregatorV3Abi,
      functionName: 'latestRoundData',
    })
    return { roundId, answer, startedAt, updatedAt }
  },
  round: async (roundId) => {
    try {
      const [id, answer, startedAt, updatedAt] = await client.readContract({
        address: feed,
        abi: aggregatorV3Abi,
        functionName: 'getRoundData',
        args: [roundId],
      })
      return { roundId: id, answer, startedAt, updatedAt }
    } catch {
      return null
    }
  },
})

describe.skipIf(!ENABLED)('live chain', () => {
  it('is still chain 4663', async () => {
    expect(await client.getChainId()).toBe(ROBINHOOD_CHAIN.id)
  }, 60_000)

  it('still has Multicall3 at the canonical address', async () => {
    const code = await client.getCode({ address: ROBINHOOD_CHAIN.multicall3Address })
    expect(code).toBeDefined()
    expect((code?.length ?? 0) > 2).toBe(true)
  }, 60_000)

  it('reports the multiplier the committed registry recorded, or a later one', async () => {
    // A multiplier can only rise for a dividend, so a mismatch means either a new
    // corporate action (rerun the backfill) or a wrong snapshot.
    const sgov = REGISTRY_TOKENS.find((token) => token.symbol === 'SGOV')!
    const onchain = await client.readContract({
      address: sgov.address,
      abi: stockTokenAbi,
      functionName: 'uiMultiplier',
    })
    expect(onchain).toBeGreaterThanOrEqual(1_005_101_770_003_214_918n)
  }, 60_000)
})

describe.skipIf(!ENABLED)('historical prices without an archive node', () => {
  const priced = reconciliations.rows.filter((row) => row.price && row.change)

  it('has priced rows to check', () => {
    expect(priced.length).toBeGreaterThan(0)
  })

  for (const row of priced) {
    it(
      `re-resolves the ${row.symbol} price at effectiveAt to the committed round`,
      async () => {
        const token = REGISTRY_TOKENS.find(
          (entry) => entry.address.toLowerCase() === row.token.toLowerCase(),
        )
        expect(token?.feedProxy).toBeTruthy()
        const result = await findRoundAt(
          lookupFor(token!.feedProxy!),
          BigInt(Math.floor(Date.parse(row.change!.effectiveAt) / 1000)),
        )
        expect(result.round, `${row.symbol} has no round at effectiveAt`).not.toBeNull()
        expect(result.round!.roundId.toString(), `${row.symbol} round id`).toBe(row.price!.roundId)
        expect(
          new Date(Number(result.round!.updatedAt) * 1000).toISOString(),
          `${row.symbol} round timestamp`,
        ).toBe(row.price!.updatedAt)
      },
      120_000,
    )
  }
})

describe.skipIf(!ENABLED)('issuer registry', () => {
  it('still lists exactly the tokens the committed snapshot recorded', async () => {
    const response = await fetch('https://api.robinhood.com/rhj/assets', {
      headers: { accept: 'application/json' },
    })
    expect(response.ok).toBe(true)
    const payload = (await response.json()) as {
      assets: { tokenSymbol: string; deployments: { contractAddress: string; chainId: number }[] }[]
    }
    const live = new Set(
      payload.assets.flatMap((asset) =>
        asset.deployments
          .filter((deployment) => deployment.chainId === ROBINHOOD_CHAIN.id)
          .map((deployment) => deployment.contractAddress.toLowerCase()),
      ),
    )
    const committed = new Set(REGISTRY_TOKENS.map((token) => token.address.toLowerCase()))
    const added = [...live].filter((address) => !committed.has(address))
    const removed = [...committed].filter((address) => !live.has(address))
    // Not a soft warning: a token added upstream is a token exdate is not
    // indexing, and the fix is to rerun the snapshot and the generator.
    expect({ added, removed }).toEqual({ added: [], removed: [] })
  }, 60_000)
})
