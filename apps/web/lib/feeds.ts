import { dateLong } from './format'
import { calendar, changes, observed, tokenPage } from './observed'

/**
 * Two files a visitor can subscribe to instead of remembering to come back:
 * a calendar of every declared dividend and every change observed on chain,
 * and a feed of the same record newest first. Both are generated at build from
 * the committed data like every page, so neither can carry a date or a figure
 * that is not in git. Timestamps that a client reads as "when was this
 * published" are the data's own, so an unchanged rebuild is byte-identical.
 */
const { site } = observed.links
const stamp = observed.lastObservedAt

// --- iCalendar (RFC 5545) ----------------------------------------------------

/** TEXT values escape backslash, semicolon, comma and newlines, in that order. */
const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** "2026-08-14T15:12:46Z" -> "20260814T151246Z"; "2026-08-05" -> "20260805". */
const icsDate = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/**
 * Lines longer than 75 octets are folded with CRLF and one space. Octets, not
 * characters: a name with an accent counts for two, and a client that gets a
 * line of 76 may drop the event rather than the byte.
 */
function fold(line: string): string {
  const encoder = new TextEncoder()
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    const limit = out.length === 0 ? 75 : 74
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  out.push(current)
  return out.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n')
}

export interface IcsEvent {
  uid: string
  /** A day ("2026-08-05") makes an all-day event; an instant makes a timed one. */
  start: string
  summary: string
  description: string
  url: string
  categories: string
}

export function buildIcs(name: string, description: string, events: IcsEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//exdate//Stock Token dividends//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    `X-WR-CALDESC:${icsText(description)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ]
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(event.uid)}`,
      `DTSTAMP:${icsDate(stamp)}`,
      event.start.length === 10 ? `DTSTART;VALUE=DATE:${icsDate(event.start)}` : `DTSTART:${icsDate(event.start)}`,
      `SUMMARY:${icsText(event.summary)}`,
      `DESCRIPTION:${icsText(event.description)}`,
      `URL:${icsText(event.url)}`,
      `CATEGORIES:${icsText(event.categories)}`,
      'STATUS:CONFIRMED',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

// --- what goes in --------------------------------------------------------------

type Change = (typeof changes)[number]
type Declared = (typeof calendar.upcoming)[number]

const tokenUrl = (token: string) => `${site}/t/${token.toLowerCase()}/`
const pct = (bps: number) => `${Math.round(bps / 100)}%`
const stepWords = (change: Change) =>
  change.stepBps >= 10_000 ? `×${(1 + change.stepBps / 10_000).toFixed(0)} split` : `+${(change.stepBps / 100).toFixed(3)}% shares per token`

/** What a change means in one sentence: the same states the token page shows, never a number the row lacks. */
function changeSummary(change: Change): string {
  switch (change.state) {
    case 'matched':
      return `${change.symbol}: dividend landed on chain, ${pct(change.haircutBps!)} never arrived`
    case 'anomaly':
      return change.hasFeed
        ? `${change.symbol}: dividend landed on chain, and it doesn’t add up`
        : `${change.symbol}: dividend landed on chain, no price feed to measure it`
    default:
      return `${change.symbol}: multiplier moved on chain, nothing declared`
  }
}

function changeDescription(change: Change): string {
  const parts = [`${change.name} (${change.symbol}). Multiplier ${change.from} → ${change.to}, ${stepWords(change)}.`]
  if (change.declared) parts.push(`Declared by the issuer: $${change.declared} per share${change.processDate ? ` for ${dateLong(change.processDate)}` : ''}.`)
  if (change.state === 'matched') parts.push(`Arrived: $${change.arrived} per share, priced at the instant of the step. ${pct(change.haircutBps!)} never arrived.`)
  else if (change.state === 'anomaly')
    parts.push(
      change.hasFeed
        ? 'The observed step is too far from what a full payment implies to call this a measurement; no gap is claimed.'
        : 'This token has no price feed, so what arrived cannot be priced; no gap is claimed.',
    )
  else parts.push('The issuer’s feed keeps about a month of history and this declaration is no longer in it, so its amount cannot be recovered.')
  parts.push(`Transaction: ${change.txUrl}`)
  return parts.join('\n')
}

function declaredSummary(row: Declared): string {
  const amount = row.declared ? `$${row.declared} per share` : 'amount not stated'
  const state =
    row.group === 'paid_not_on_chain'
      ? 'issuer says paid, not on chain'
      : row.group === 'overdue'
        ? 'past the window, not on chain'
        : row.group === 'awaiting'
          ? 'due now'
          : 'declared'
  return `${row.symbol}: dividend ${amount}, ${state}`
}

function declaredDescription(row: Declared): string {
  const parts = [`${row.name} (${row.symbol}). Declared by the issuer for ${dateLong(row.processDate)}.`]
  if (row.declared) parts.push(`Declared: $${row.declared} per share.`)
  if (row.owedPerToken) parts.push(`Owed per token: $${row.owedPerToken}, the rate times what one token represents today. No price is involved.`)
  parts.push(
    row.group === 'paid_not_on_chain'
      ? 'The issuer’s own feed marks this dividend completed, and the multiplier has not moved.'
      : row.group === 'overdue'
        ? 'More than a few days after the issuer’s date, still in progress on their side, nothing on chain.'
        : row.group === 'awaiting'
          ? 'The issuer’s date has passed. Every step observed so far landed one business day later.'
          : 'Nothing is owed yet. exdate does not predict when the change will land.',
  )
  return parts.join('\n')
}

const declaredRows = () => [...calendar.paidNotOnChain, ...calendar.overdue, ...calendar.awaiting, ...calendar.upcoming]

const declaredEvent = (row: Declared): IcsEvent => ({
  uid: `${row.actionId ?? row.token.toLowerCase()}:${row.processDate}@exdate.me`,
  start: row.processDate,
  summary: declaredSummary(row),
  description: declaredDescription(row),
  url: tokenUrl(row.token),
  categories: 'Dividend declared',
})

const changeEvent = (change: Change): IcsEvent => ({
  uid: `${change.token}:${change.effectiveAt}@exdate.me`,
  start: change.effectiveAt,
  summary: changeSummary(change),
  description: changeDescription(change),
  url: tokenUrl(change.token),
  categories: change.state === 'unmatched' ? 'Multiplier change' : 'Dividend on chain',
})

/** Every declared dividend not yet on chain, and every change observed on chain, across all tokens. */
export function calendarIcs(): string {
  return buildIcs(
    'exdate: Stock Token dividends',
    `Every dividend declared by the issuer that has not reached Robinhood Chain, and every multiplier change observed on it, as of ${dateLong(stamp)}. Measured by exdate, ${site}`,
    [...declaredRows().map(declaredEvent), ...changes.map(changeEvent)],
  )
}

/** The same, for one token. Null when the token has nothing to put in a calendar. */
export function tokenCalendarIcs(address: string): string | null {
  const token = tokenPage(address)
  if (!token) return null
  const key = token.address.toLowerCase()
  const declared = declaredRows().filter((row) => row.token.toLowerCase() === key)
  const moved = changes.filter((change) => change.token === key)
  if (declared.length === 0 && moved.length === 0) return null
  return buildIcs(
    `exdate: ${token.name} (${token.symbol})`,
    `Dividends declared for the ${token.symbol} Stock Token and every multiplier change observed on chain, as of ${dateLong(stamp)}. Measured by exdate, ${tokenUrl(key)}`,
    [...declared.map(declaredEvent), ...moved.map(changeEvent)],
  )
}

/** Tokens that have something to put in a calendar: the pages that link one, and the files that exist. */
export const tokensWithCalendar = (() => {
  const set = new Set<string>()
  for (const row of declaredRows()) set.add(row.token.toLowerCase())
  for (const change of changes) set.add(change.token)
  return [...set].sort()
})()

// --- RSS 2.0 -----------------------------------------------------------------

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rfc822 = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toUTCString()

interface Item {
  guid: string
  title: string
  description: string
  link: string
  /** The instant the thing happened: the step's effect, or when the declaration was first seen. */
  at: string
  category: string
}

/**
 * The record as a feed, newest first: a change is dated by the instant it
 * took effect, a declaration by the day exdate's archive first saw it. A
 * declaration the archive did not see arrive (it predates the archive) is
 * dated by its process date, and its description says so.
 */
export function rssFeed(): string {
  const items: Item[] = [
    ...changes.map((change) => ({
      guid: `${change.token}:${change.effectiveAt}`,
      title: changeSummary(change),
      description: changeDescription(change),
      link: tokenUrl(change.token),
      at: change.effectiveAt,
      category: change.state === 'unmatched' ? 'Multiplier change' : 'Dividend on chain',
    })),
    ...declaredRows().map((row) => ({
      guid: `${row.actionId ?? row.token.toLowerCase()}:${row.processDate}`,
      title: declaredSummary(row),
      description: `${declaredDescription(row)}${row.firstSeenAt ? '' : '\nSeen by exdate before its archive kept dates; dated here by the issuer’s process date.'}`,
      link: tokenUrl(row.token),
      at: row.firstSeenAt ?? row.processDate,
      category: 'Dividend declared',
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  const body = items
    .map(
      (item) => `    <item>
      <title>${xml(item.title)}</title>
      <link>${xml(item.link)}</link>
      <guid isPermaLink="false">${xml(item.guid)}</guid>
      <pubDate>${rfc822(item.at)}</pubDate>
      <category>${xml(item.category)}</category>
      <description>${xml(item.description).replace(/\n/g, ' ')}</description>
    </item>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>exdate: Stock Token dividends, measured</title>
    <link>${xml(site)}/</link>
    <atom:link href="${xml(site)}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Every dividend declared for a Robinhood Stock Token, and what each multiplier change on chain actually delivered. Read from the chain and the issuer’s own feed; nothing estimated.</description>
    <language>en</language>
    <lastBuildDate>${rfc822(stamp)}</lastBuildDate>
    <ttl>360</ttl>
${body}
  </channel>
</rss>
`
}
