import { ImageResponse } from 'next/og'
import { dateLong } from '../../../lib/format'
import { observed, tokenPage } from '../../../lib/observed'

/**
 * One link preview per token, from the same lead the page head opens on.
 * Every token page used to share the home page's card, so sharing SGOV showed
 * Apple's figure (audit 2026-09-05, F14). Rendered at build for all 194.
 */
export const dynamic = 'force-static'
export const alt = 'What this Stock Token paid, measured by exdate'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export function generateStaticParams() {
  return observed.tokens.map((token) => ({ address: token.address.toLowerCase() }))
}

const RADIUS = 120
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const token = tokenPage(address)!
  const { lead, lastMeasured } = token

  // The figure on the right and the sentence under the name, by state. A ring
  // is drawn only for a measured haircut: it is the share that never arrived,
  // and nothing else here is a share of anything.
  let figure: string
  let label: string
  let sentence: string
  let ring: number | null = null
  const measuredSentence =
    lastMeasured?.state === 'matched'
      ? `Last dividend on chain, ${dateLong(lastMeasured.processDate ?? lastMeasured.effectiveAt)}: $${lastMeasured.arrived} arrived of $${lastMeasured.declared} declared, ${Math.round(lastMeasured.haircutBps! / 100)}% never arrived.`
      : lastMeasured
        ? `Last dividend on chain, ${dateLong(lastMeasured.processDate ?? lastMeasured.effectiveAt)}: $${lastMeasured.declared} declared, ${lastMeasured.hasFeed ? 'and the step doesn’t add up' : 'no price feed to measure it'}.`
        : ''
  switch (lead.kind) {
    case 'owed':
      figure = `$${lead.owedPerToken}`
      label = lead.count === 1 ? 'owed per token, not yet on chain' : `owed per token, the first of ${lead.count}`
      sentence =
        lead.count === 1
          ? `One dividend is owed and not yet on chain: declared for ${dateLong(lead.processDate)}${lead.issuerCompleted ? ', and the issuer already calls it paid' : ''}.`
          : `${lead.count} dividends are owed and not yet on chain, the oldest declared for ${dateLong(lead.oldestProcessDate)}.`
      if (measuredSentence) sentence += ` ${measuredSentence}`
      break
    case 'next':
      figure = `$${lead.declared}`
      label = `per share, declared for ${dateLong(lead.processDate)}`
      sentence = `Next dividend declared for ${dateLong(lead.processDate)}. Nothing is owed yet.${measuredSentence ? ` ${measuredSentence}` : ''}`
      break
    case 'measured':
      if (lastMeasured!.state === 'matched') {
        figure = `${Math.round(lastMeasured!.haircutBps! / 100)}%`
        label = 'never arrived'
        ring = lastMeasured!.haircutBps! / 10_000
      } else {
        figure = token.multiplier
        label = 'shares per token today'
      }
      sentence = measuredSentence
      break
    case 'moved':
      figure = token.multiplier
      label = 'shares per token today'
      sentence = `The multiplier last moved on ${dateLong(token.lastMoved!.effectiveAt)} with no dividend declared in the issuer’s feed.`
      break
    default:
      figure = token.multiplier
      label = 'share per token, unchanged since launch'
      sentence = 'No dividend has been declared for this token, and its multiplier has never moved.'
  }

  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#f5f4f0', color: '#0f0f0e', padding: 72 }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, paddingRight: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 600 }}>
          <svg width="38" height="38" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="11" fill="none" stroke="#0f0f0e" strokeWidth="3.2" strokeLinecap="round" strokeDasharray="44.2 24.9" transform="rotate(40 16 16)" />
          </svg>
          <span>exdate</span>
          <span style={{ color: '#605f59', fontWeight: 400, fontSize: 24, marginLeft: 8 }}>{`Robinhood Stock Token · ${token.symbol}`}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: token.name.length > 28 ? 52 : 62, fontWeight: 500, letterSpacing: -2.5, lineHeight: 1.05, maxWidth: 720 }}>{token.name}</div>
          <div style={{ fontSize: 26, color: '#605f59', lineHeight: 1.3, maxWidth: 720 }}>{sentence}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 340, position: 'relative' }}>
        {ring !== null ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', width: 300, height: 300 }}>
            <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 300, height: 300, fontSize: 76, fontWeight: 500, letterSpacing: -4 }}>{figure}</div>
            <svg width="300" height="300" viewBox="0 0 300 300">
              <circle cx="150" cy="150" r={RADIUS} fill="none" stroke="#cbc9c0" strokeWidth="2" />
              <circle cx="150" cy="150" r={RADIUS} fill="none" stroke="#0f0f0e" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${CIRCUMFERENCE * ring} ${CIRCUMFERENCE}`} transform="rotate(-90 150 150)" />
            </svg>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: figure.length > 8 ? 56 : 72, fontWeight: 500, letterSpacing: -3, lineHeight: 1 }}>{figure}</div>
        )}
        <div style={{ display: 'flex', marginTop: 18, fontSize: 22, color: '#605f59', textAlign: 'center', maxWidth: 320 }}>{label}</div>
      </div>
    </div>,
    { ...size },
  )
}
