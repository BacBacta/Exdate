// Turn the committed first-party snapshots into a typed TypeScript module.
//
// The snapshots under data/ are the source of truth; this file only reshapes
// them so that the indexer, the API and the status page all read one registry
// without any of them parsing JSON at runtime. Regenerate after
// `node scripts/phase0/snapshot-registry.mjs` reports a diff.
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

const assets = (await read('data/robinhood-assets.snapshot.json')).assets ?? []
const feedMap = await read('data/token-feed-map.json')
const scan = await read('data/multiplier-events.observed.json')

const feedByToken = new Map(feedMap.pairs.map((pair) => [pair.token.toLowerCase(), pair]))

const tokens = assets
  .flatMap((asset) =>
    (asset.deployments ?? []).map((deployment) => {
      const feed = feedByToken.get(deployment.contractAddress.toLowerCase())
      return {
        chainId: deployment.chainId,
        address: deployment.contractAddress,
        symbol: asset.tokenSymbol,
        name: asset.tokenName,
        decimals: asset.tokenDecimals,
        isin: asset.isin ?? null,
        status: asset.status,
        logoUrl: asset.logoUrl ?? null,
        feedProxy: feed?.feedProxy ?? null,
        feedDecimals: feed?.feedDecimals ?? null,
        feedHeartbeatSeconds: feed?.heartbeatSeconds ?? null,
        // Ticker-derived, never issuer-confirmed. See scripts/phase0/map-feeds.mjs.
        feedVerified: feed?.verified ?? false,
        feedCorroborated: feed?.corroborated ?? false,
      }
    }),
  )
  .sort((a, b) => a.symbol.localeCompare(b.symbol))

const banner = `// GENERATED FILE - do not edit.
// Source: data/robinhood-assets.snapshot.json + data/token-feed-map.json
// Regenerate: node scripts/generate-registry.mjs
`

const out = `${banner}
import type { Address } from 'viem'

export interface RegistryToken {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  isin: string | null
  status: string
  logoUrl: string | null
  /** Chainlink aggregator proxy, or null when the token has no feed at all. */
  feedProxy: Address | null
  feedDecimals: number | null
  feedHeartbeatSeconds: number | null
  /** False everywhere today: the pairing is derived from the ticker. */
  feedVerified: boolean
  /**
   * The token's own multiplier step was observed moving this feed by the step's
   * own size, and no other mapped feed moved closer to it. Behavioural
   * evidence, not a first-party statement - see data/feed-map-verification.json.
   */
  feedCorroborated: boolean
}

export const REGISTRY_TOKENS: readonly RegistryToken[] = ${JSON.stringify(tokens, null, 2)} as const

export const REGISTRY_GENERATED_AT = ${JSON.stringify(new Date().toISOString())}

/**
 * Every UIMultiplierUpdated log on chain, found by
 * scripts/backfill-multiplier-events.mjs.
 *
 * These are real logs with real transaction hashes, not a fixture. They are
 * carried in the repository because the indexer cannot rediscover them on the
 * public RPC: Ponder splits the address list into chunks and syncs 25 blocks at
 * a time, which does not finish on a 52-million-block chain, while one wide
 * query per 2 000 000 blocks does the whole scan in about two minutes.
 *
 * The poller seeds these rows on first run with source 'onchain:scan'. Anything
 * the indexer sees itself is written with source 'onchain:indexer' and wins.
 */
export interface ScannedMultiplierEvent {
  chainId: number
  symbol: string
  token: Address
  block: number
  announcedAt: string
  effectiveAt: string
  leadMinutes: number
  oldMultiplier: string
  newMultiplier: string
  stepBps: number
  tx: \`0x\${string}\`
}

export const SCANNED_MULTIPLIER_EVENTS: readonly ScannedMultiplierEvent[] = ${JSON.stringify(scan.events, null, 2)} as const

export const SCAN_FROM_BLOCK = ${JSON.stringify(scan.scannedFromBlock)}
export const SCAN_THROUGH_BLOCK = ${JSON.stringify(scan.scannedThroughBlock)}
export const SCANNED_AT = ${JSON.stringify(scan.scannedAt)}
`

await mkdir(new URL('packages/core/src/generated/', root), { recursive: true })
await writeFile(new URL('packages/core/src/generated/registry.ts', root), out)

const withFeed = tokens.filter((token) => token.feedProxy !== null).length
console.log(
  `generated ${tokens.length} tokens (${withFeed} with a Chainlink feed) and ${scan.events.length} scanned multiplier events -> packages/core/src/generated/registry.ts`,
)
