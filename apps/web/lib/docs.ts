import { readFileSync, readdirSync } from 'node:fs'
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

/** The documents the site renders, by page. One place, so the sidebar, the search index and the raw files agree. */
export const DOCS = [
  { page: '/docs/api/', file: 'docs/api.md', raw: '/docs/api.md', name: 'API reference' },
  { page: '/docs/sdk/', file: 'packages/sdk/README.md', raw: '/docs/sdk.md', name: 'SDK' },
  { page: '/docs/changelog/', file: 'docs/changelog.md', raw: '/docs/changelog.md', name: 'Changelog' },
  // Generated from the constants it describes (scripts/build-methodology.mjs), so the page cannot
  // state a parameter the code does not hold. Served raw as well: a researcher citing it wants the
  // source, and its version changes only when a parameter does.
  { page: '/docs/methodology/', file: 'docs/methodology.md', raw: '/docs/methodology.md', name: 'Méthode' },
  // Also generated (scripts/build-open-core.mjs), from the API's own source, the licence and the
  // record. Served so a reader can tell which side of the line a route or a field is on without
  // asking - and so the reasons nothing is reserved yet are a published measurement rather than a
  // position stated in a conversation.
  { page: '/docs/open-core/', file: 'docs/open-core.md', raw: '/docs/open-core.md', name: 'Open core' },
  // Also generated (scripts/build-issuer-mechanisms.mjs), from what was read on each chain. Served
  // because "which issuers does this cover, and what does each actually do" is the question every
  // integrator asks second, and the answer has three rows read and three marked unread.
  { page: '/docs/issuers/', file: 'docs/issuer-mechanisms.md', raw: '/docs/issuers.md', name: 'Issuers' },
] as const
export type DocPage = (typeof DOCS)[number]['page']

export interface DocHeading {
  level: 2 | 3
  id: string
  text: string
}
export interface DocSection {
  id: string
  title: string
  /** The section's own prose, tags stripped, for search. */
  text: string
}
export interface RenderedDoc {
  html: string
  title: string
  headings: DocHeading[]
  sections: DocSection[]
}

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A heading's anchor. A route heading (`GET /v1/:chain/tokens/:address/pending`)
 * gets the route's literal segments after /v1, so the anchor is the thing a
 * reader would type: #pending, #tokens, #webhooks-events. Anything else is the
 * text, slugified. Duplicates take a numeric suffix rather than colliding.
 */
function slugOf(text: string): string {
  const route = /^(?:GET|POST|DELETE)\s+\/v1\/([^\s·]+)/.exec(text)
  const base = route
    ? route[1]!
        .split('/')
        .filter((segment) => segment && !segment.startsWith(':'))
        .join('-')
    : text
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

export function renderDoc(relativePath: string): RenderedDoc {
  let markdown = readFileSync(join(ROOT, relativePath), 'utf8')
  for (const [from, to] of REWRITES) markdown = markdown.split(`(${from})`).join(`(${to})`)
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? relativePath
  // A code block that scrolls sideways is a scrollable region; without a
  // tabindex it cannot take focus and so cannot be scrolled from a keyboard.
  // axe reported 8 and 7 such blocks on the two reference pages (2026-09-05).
  // Each one is a landmark, and landmarks on a page must have distinct names.
  let sample = 0
  let html = (marked.parse(markdown, { async: false, gfm: true }) as string).replace(
    /<pre>/g,
    () => `<pre tabindex="0" role="region" aria-label="Code sample ${++sample}">`,
  )
  // Every h2 and h3 gets an id and a permanent link. The rendered headings
  // came out bare, so nothing on these pages could be linked to by section.
  const headings: DocHeading[] = []
  const seen = new Map<string, number>()
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match, level: string, inner: string) => {
    const text = plain(inner)
    let id = slugOf(text)
    const count = seen.get(id) ?? 0
    seen.set(id, count + 1)
    if (count > 0) id = `${id}-${count + 1}`
    headings.push({ level: Number(level) as 2 | 3, id, text })
    return `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Permanent link to ${text}">#</a></h${level}>`
  })
  // Sections for search: the prose between one heading and the next.
  const sections: DocSection[] = []
  const parts = html.split(/(?=<h[23] id=")/)
  for (const part of parts) {
    const head = /^<h[23] id="([^"]+)">([\s\S]*?)<a class="anchor"/.exec(part)
    if (!head) continue
    const body = part.slice(part.indexOf('</h') + 5)
    sections.push({ id: head[1]!, title: plain(head[2]!), text: plain(body).slice(0, 2000) })
  }
  return { html, title, headings, sections }
}

/** Every section of every document, for the search box: built once, served as one file. */
export function docsIndex() {
  return DOCS.flatMap((doc) => {
    const rendered = renderDoc(doc.file)
    return rendered.sections.map((section) => ({ page: doc.page, doc: doc.name, id: section.id, title: section.title, text: section.text }))
  })
}

/** The document as its author wrote it, for a reader who wants the Markdown or is a machine. */
export function rawDoc(relativePath: string): string {
  let markdown = readFileSync(join(ROOT, relativePath), 'utf8')
  for (const [from, to] of REWRITES) markdown = markdown.split(`(${from})`).join(`(${to})`)
  return markdown
}

export interface Dataset {
  file: string
  what: string
  /** The page that renders this file's figures, when one does; a reader arriving from a tile wants the page, not the JSON. */
  page: string | null
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

/**
 * Descriptions that win over a file's own `note`, and cover the files that have none.
 *
 * The listing itself is derived from the directory - see datasets() - so a collector added
 * anywhere in scripts/ appears here without anyone remembering to add a line. This map exists
 * for two cases only: a file whose format forbids a `note` (the token list's schema rejects
 * unknown top-level fields) or whose note reads as a pointer into the repository rather than as a
 * sentence for a reader. A file with neither a note nor a line here fails the build, which is the
 * state this page exists to prevent: a dataset served that nobody can describe.
 *
 * Measured before this existed: the page listed 16 of 27 served files, and the two headline
 * figures on the home page - net creation and the DEX-to-feed gap - had no source on the page
 * that calls itself "the data behind every figure".
 */
const DESCRIBED: Record<string, { what: string; page?: string }> = {
  'effective-blocks.json': { what: 'The block at which each multiplier change took effect, resolved by bisection' },
  'exdate.tokenlist.json': { what: 'The token list a wallet imports: all 194 tokens with what each represents in shares, what it is owed, its identifiers and its price feed', page: '/subscribe/#tokenlist' },
  'robinhood-assets.snapshot.json': { what: "The issuer's token registry: 194 assets, addresses, ISINs, multipliers" },
  'token-feed-map.json': { what: 'Token → feed pairing by ticker, with what corroborates each row' },
  'feed-map-verification.json': { what: 'How each feed pairing was checked against the chain' },
  'reconciliations.observed.json': { what: 'Every dividend reconciled against its multiplier step: declared, arrived, the gap, the price at effect', page: '/dividends/' },
  'primary-flows.observed.json': { what: 'Creations and redemptions per token, from the chain, signed: the net flow nobody publishes', page: '/market/#creation' },
  'dex-feed-gap.observed.json': { what: 'The distance between the price a token trades at on chain and the Chainlink answer a lending market would liquidate against', page: '/market/' },
  'session-share.observed.json': { what: 'Hourly samples of transfer rate by market session, for the off-hours share', page: '/#off-hours' },
  'xstocks-steps.observed.json': { what: "xStocks' multiplier steps on Ethereum and BNB Chain, cross-checked against the issuer's own history", page: '/docs/issuers/' },
  'xstocks-verification.json': { what: 'xStocks (Backed) read back on chain from its own registry: the mechanism, and where it inverts ERC-8056', page: '/docs/issuers/' },
  'webhook-latency.observed.json': { what: 'How long a signed webhook took to reach a subscriber, over real deliveries only - refused until there is one' },
  'figi.observed.json': { what: "Every token's share-class and composite FIGI, joined on the ISIN through OpenFIGI" },
  'registry-changes.observed.json': { what: "What the issuer changed about an asset - ticker, status, tradability, listing - recorded before any handler is written" },
}

/** The first sentence of a file's own `note`, which is how most datasets describe themselves. */
const firstSentence = (note: unknown): string | null => {
  if (typeof note !== 'string' || !note.trim()) return null
  return note.trim().split(/(?<=[.!?])\s+/)[0] ?? null
}

const dateOf = (json: Record<string, unknown>): string | null => {
  for (const key of ['observedAt', 'generatedAt', 'scannedAt', 'fetchedAt', 'resolvedAt', 'lastArchivedAt', 'lastSampleAt', 'verifiedAt', 'measuredAt', 'checkedAt', 'lastRunAt', 'builtAt', 'timestamp']) {
    const value = json[key]
    if (typeof value === 'string') return value
  }
  return null
}

/**
 * Every JSON file under data/, described, dated and sized - read from the directory, the same
 * rule scripts/sync-public.mjs applies when it copies them, so the page and the files it serves
 * cannot disagree about what exists. exdate's own files first, alphabetically; the issuer's last.
 */
export function datasets(): Dataset[] {
  const rows = readdirSync(join(ROOT, 'data'))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(ROOT, 'data', file), 'utf8')
      const json = JSON.parse(raw) as Record<string, unknown>
      const described = DESCRIBED[file]
      const what = described?.what ?? firstSentence(json.note)
      if (!what) {
        throw new Error(
          `data/${file} has no top-level "note" and no entry in DESCRIBED (apps/web/lib/docs.ts); a served dataset must be describable`,
        )
      }
      return { file, what, page: described?.page ?? null, observedAt: dateOf(json), bytes: Buffer.byteLength(raw), issuer: ISSUER_FILES.has(file) }
    })
  return [...rows.filter((row) => !row.issuer), ...rows.filter((row) => row.issuer)]
}
