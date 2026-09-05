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
  ['../../docs/changelog.md', '/docs/changelog/'],
]

export function renderDoc(relativePath: string): { html: string; title: string } {
  let markdown = readFileSync(join(ROOT, relativePath), 'utf8')
  for (const [from, to] of REWRITES) markdown = markdown.split(`(${from})`).join(`(${to})`)
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? relativePath
  // A code block that scrolls sideways is a scrollable region; without a
  // tabindex it cannot take focus and so cannot be scrolled from a keyboard.
  // axe reported 8 and 7 such blocks on the two reference pages (2026-09-05).
  // Each one is a landmark, and landmarks on a page must have distinct names.
  let sample = 0
  const html = (marked.parse(markdown, { async: false, gfm: true }) as string).replace(
    /<pre>/g,
    () => `<pre tabindex="0" role="region" aria-label="Code sample ${++sample}">`,
  )
  return { html, title }
}

export interface Dataset {
  file: string
  what: string
  observedAt: string | null
  bytes: number
  /**
   * True for the issuer's own files, copied from Robinhood's Stock Token API.
   * They stay in the repository as the input the reconciliations are checked
   * against and are not served from the site: exdate's licence to that content
   * is personal and non-sublicensable (DATA-LICENSE.md). Rendered without a
   * download link, and outside the CC BY 4.0 grant.
   */
  issuer: boolean
}

/** Kept in step with ISSUER_FILES in scripts/sync-public.mjs, which is what actually withholds them. */
const ISSUER_FILES = new Set(['robinhood-assets.snapshot.json', 'robinhood-corporate-actions.snapshot.json', 'corporate-actions.archive.json'])

const DATASETS: [string, string][] = [
  ['reconciliations.observed.json', 'Every dividend reconciled against its multiplier step: declared, arrived, the gap, the price at effect'],
  ['multiplier-events.observed.json', 'Every UIMultiplierUpdated log since public mainnet, from a whole-chain scan'],
  ['effective-blocks.json', 'The block at which each multiplier change took effect, resolved by bisection'],
  ['multiplier-state-verification.json', "Every step read back in the chain's own state at the blocks straddling it, since nothing is emitted when a change takes effect"],
  ['rpc-endpoints.observed.json', 'Every public RPC endpoint for this chain, probed for archive depth and log limits'],
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
    return { file, what, observedAt: dateOf(JSON.parse(raw) as Record<string, unknown>), bytes: Buffer.byteLength(raw), issuer: ISSUER_FILES.has(file) }
  })
}
