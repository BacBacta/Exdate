import { dateLong } from './format'
import { observed, tokenPage } from './observed'

/**
 * A badge to paste into a README, a forum post or a dashboard: the token's
 * state in one line, as an SVG a browser renders with no font of ours. The
 * value is the same lead the token page opens on, so a badge can never say
 * something the page does not. Same flat shape as the badges everyone
 * already reads, so nobody has to learn what it is.
 */
const HEIGHT = 20
const PAD = 6
/** Verdana at 11px averages about 6.6px a character; textLength pins the text to this width regardless. */
const CHAR = 6.6

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const width = (text: string) => Math.round([...text].length * CHAR) + PAD * 2

export type BadgeTone = 'ink' | 'mid' | 'muted'
const TONE: Record<BadgeTone, string> = { ink: '#161615', mid: '#3a3935', muted: '#6b6a63' }

export function buildBadge(label: string, value: string, tone: BadgeTone, title: string): string {
  const lw = width(label)
  const vw = width(value)
  const w = lw + vw
  const text = (t: string, x: number, tw: number) =>
    `<text aria-hidden="true" x="${x * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${tw * 10}">${xml(t)}</text>` +
    `<text x="${x * 10}" y="140" transform="scale(.1)" textLength="${tw * 10}">${xml(t)}</text>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" role="img" aria-label="${xml(title)}">` +
    `<title>${xml(title)}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="${HEIGHT}" fill="#555"/><rect x="${lw}" width="${vw}" height="${HEIGHT}" fill="${TONE[tone]}"/><rect width="${w}" height="${HEIGHT}" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">` +
    text(label, lw / 2, lw - PAD * 2) +
    text(value, lw + vw / 2, vw - PAD * 2) +
    `</g></svg>\n`
  )
}

/** "14 September 2026" -> "14 Sep": a badge has no room for the year. */
const short = (iso: string) => dateLong(iso).replace(/ (\w{3})\w* \d{4}$/, ' $1')

/** What a token's badge says, from the same lead as its page head. */
export function tokenBadgeText(address: string): { value: string; tone: BadgeTone; title: string } | null {
  const token = tokenPage(address)
  if (!token) return null
  const { lead, lastMeasured } = token
  let value: string
  let tone: BadgeTone
  switch (lead.kind) {
    case 'owed':
      value = lead.count === 1 ? `$${lead.owedPerToken} owed per token` : `${lead.count} dividends owed, not on chain`
      tone = 'mid'
      break
    case 'next':
      value = `dividend declared for ${short(lead.processDate)}`
      tone = 'muted'
      break
    case 'measured':
      if (lastMeasured!.state === 'matched') {
        value = `${Math.round(lastMeasured!.haircutBps! / 100)}% never arrived`
        tone = 'ink'
      } else {
        value = 'dividend on chain, not measurable'
        tone = 'muted'
      }
      break
    case 'moved':
      value = 'moved on chain, nothing declared'
      tone = 'muted'
      break
    default:
      value = 'no dividend declared'
      tone = 'muted'
  }
  return { value: `${token.symbol} · ${value}`, tone, title: `${token.name} (${token.symbol}) on exdate: ${value}` }
}

export function tokenBadge(address: string): string | null {
  const text = tokenBadgeText(address)
  return text ? buildBadge('exdate', text.value, text.tone, text.title) : null
}

/** The site's own badge: the headline figure. */
export function siteBadge(): string {
  const { hero } = observed
  const pct = Math.round(hero.haircutBps! / 100)
  const value = `${pct}% of ${hero.name}’s last dividend never arrived`
  return buildBadge('exdate', value, 'ink', `exdate: ${value} on chain`)
}
