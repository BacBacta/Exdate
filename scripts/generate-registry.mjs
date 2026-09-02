// Turn the committed first-party snapshots into a typed TypeScript module.
//
// The snapshots under data/ are the source of truth; this file only reshapes
// them so that the indexer, the API and the status page all read one registry
// without any of them parsing JSON at runtime. Regenerate after
// `node scripts/phase0/snapshot-registry.mjs` reports a diff.
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

const registrySnapshot = await read('data/robinhood-assets.snapshot.json')
const assets = registrySnapshot.assets ?? []
/**
 * When the registry was read from the issuer, not when this script ran.
 *
 * Reproducible on purpose: regenerating from unchanged data must produce a
 * byte-identical file, or CI cannot tell a stale artifact from a rebuild. A
 * file mtime would not do - git does not preserve it - so the snapshot has to
 * carry its own date, and a snapshot without one is an error rather than a
 * guess.
 */
if (!registrySnapshot.fetchedAt) {
  throw new Error('data/robinhood-assets.snapshot.json has no fetchedAt; re-run node scripts/phase0/snapshot-registry.mjs')
}
const feedMap = await read('data/token-feed-map.json')
const scan = await read('data/multiplier-events.observed.json')
const archive = await read('data/corporate-actions.archive.json').catch(() => ({ actions: [] }))

/**
 * The issuer's window is about a month deep and has no pagination, so a row that
 * falls out of it is gone from every first-party source. Flattened here the way
 * the poller stores it, so a fresh database starts with everything exdate has
 * ever seen rather than with today's window.
 */
const archivedActions = archive.actions.flatMap((action) => {
  const deployment = (action.deployments ?? []).find((entry) => entry.chainId)
  if (!deployment) return []
  const detail = action.details ? Object.values(action.details)[0] : undefined
  const processDate = action.processDate
    ? `${action.processDate.year}-${String(action.processDate.month).padStart(2, '0')}-${String(action.processDate.day).padStart(2, '0')}`
    : null
  return [
    {
      id: `${action.id}:${processDate ?? 'undated'}`,
      issuerId: action.id,
      chainId: deployment.chainId,
      token: deployment.contractAddress,
      symbol: action.tokenSymbol,
      underlyingSymbol: detail?.underlyingSymbol ?? null,
      type: action.type,
      status: action.status,
      processDate,
      rate: detail?.rate ?? null,
      oldRate: detail?.oldRate ?? null,
      newRate: detail?.newRate ?? null,
      firstSeenAt: action.firstSeenAt,
    },
  ]
})

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
        feedSvrProxy: feed?.feedSvrProxy ?? null,
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
  /**
   * The same feed's SVR proxy. Same aggregator, same answer, same updatedAt -
   * measured on all 35 - but a different phase, so a roundId from one proxy
   * must never be passed to getRoundData on the other.
   */
  feedSvrProxy: Address | null
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

export const REGISTRY_GENERATED_AT = ${JSON.stringify(registrySnapshot.fetchedAt)}

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

/**
 * Every corporate action exdate has ever seen the issuer publish, flattened.
 *
 * Seeded by the poller with source 'robinhood:/rhj/corporate-actions#archived';
 * a row still inside the issuer's window is then updated from the live feed and
 * carries the plain source. Refresh with node scripts/archive-corporate-actions.mjs.
 *
 * Only fields that change when the issuer changes something are carried here:
 * the archive re-dates every row on every run, and copying that through would
 * rewrite this file daily to say nothing.
 */
export interface ArchivedCorporateAction {
  id: string
  issuerId: string
  chainId: number
  token: Address
  symbol: string
  underlyingSymbol: string | null
  type: string
  status: string
  processDate: string | null
  rate: string | null
  oldRate: string | null
  newRate: string | null
  /** When exdate first saw the issuer publish this row. */
  firstSeenAt: string
}

export const ARCHIVED_CORPORATE_ACTIONS: readonly ArchivedCorporateAction[] = ${JSON.stringify(archivedActions, null, 2)} as const

export const SCAN_FROM_BLOCK = ${JSON.stringify(scan.scannedFromBlock)}
export const SCAN_THROUGH_BLOCK = ${JSON.stringify(scan.scannedThroughBlock)}
export const SCANNED_AT = ${JSON.stringify(scan.scannedAt)}
`

await mkdir(new URL('packages/core/src/generated/', root), { recursive: true })
await writeFile(new URL('packages/core/src/generated/registry.ts', root), out)

const withFeed = tokens.filter((token) => token.feedProxy !== null).length
console.log(
  `generated ${tokens.length} tokens (${withFeed} with a Chainlink feed), ${scan.events.length} scanned multiplier events and ${archivedActions.length} archived corporate actions -> packages/core/src/generated/registry.ts`,
)
