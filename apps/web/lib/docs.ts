import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'

/**
 * The reference documents, rendered at build time from the repository's own
 * markdown so the site serves them whether or not the repository is public.
 * Links that pointed at sibling files in the repository point at the pages
 * that render them.
 */
const ROOT = join(process.cwd(), '..', '..')

const REWRITES: [string, string][] = [
  ['../packages/sdk/README.md', '/docs/sdk/'],
  ['../../README.md', '/'],
  ['../../docs/api.md', '/docs/api/'],
]

export function renderDoc(relativePath: string): { html: string; title: string } {
  let markdown = readFileSync(join(ROOT, relativePath), 'utf8')
  for (const [from, to] of REWRITES) markdown = markdown.split(`(${from})`).join(`(${to})`)
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? relativePath
  const html = marked.parse(markdown, { async: false, gfm: true }) as string
  return { html, title }
}

export interface Dataset {
  file: string
  what: string
  observedAt: string | null
  bytes: number
}

const DATASETS: [string, string][] = [
  ['reconciliations.observed.json', 'Every dividend reconciled against its multiplier step: declared, arrived, the gap, the price at effect'],
  ['multiplier-events.observed.json', 'Every UIMultiplierUpdated log since public mainnet, from a whole-chain scan'],
  ['effective-blocks.json', 'The block at which each multiplier change took effect, resolved by bisection'],
  ['corporate-actions.archive.json', "The issuer's corporate-action feed, archived daily since it keeps only a month"],
  ['robinhood-assets.snapshot.json', "The issuer's token registry: 194 assets, addresses, ISINs, multipliers"],
  ['chainlink-feeds.snapshot.json', "Chainlink's feed directory for Robinhood Chain"],
  ['token-feed-map.json', 'Token → feed pairing by ticker, with what corroborates each row'],
  ['feed-map-verification.json', 'How each feed pairing was checked against the chain'],
  ['svr-proxy-check.json', 'Primary and SVR proxies compared on all 35 feeds'],
  ['effective-prices.observed.json', "The issuer's own quote at the instant each multiplier change took effect, and whether something was watching"],
  ['capture-cadence.observed.json', "How often GitHub actually ran the capture job, from its own run log, against the five minutes it was asked for"],
  ['session-share.observed.json', 'Hourly samples of transfer rate by market session'],
  ['transfer-volume.observed.json', 'Transfer volume measured across all 194 tokens'],
  ['base-b20-verification.json', "Coinbase's tokens, oracle registry and feeds on Base, read back on chain"],
]

const dateOf = (json: Record<string, unknown>): string | null => {
  for (const key of ['observedAt', 'generatedAt', 'scannedAt', 'fetchedAt', 'resolvedAt', 'lastArchivedAt', 'lastSampleAt', 'verifiedAt', 'measuredAt', 'checkedAt']) {
    const value = json[key]
    if (typeof value === 'string') return value
  }
  return null
}

export function datasets(): Dataset[] {
  return DATASETS.map(([file, what]) => {
    const raw = readFileSync(join(ROOT, 'data', file), 'utf8')
    return { file, what, observedAt: dateOf(JSON.parse(raw) as Record<string, unknown>), bytes: Buffer.byteLength(raw) }
  })
}
