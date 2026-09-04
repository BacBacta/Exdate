import { ImageResponse } from 'next/og'
import { cents, observed } from '../lib/observed'

/**
 * The link preview: the mark, the one sentence, and the one number - rendered
 * at build time from the same committed data as the page.
 */
export const dynamic = 'force-static'
export const alt = 'exdate — see what your Stock Tokens actually paid you'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const RADIUS = 120
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function Image() {
  const { hero } = observed
  const pct = Math.round(hero.haircutBps! / 100)
  const gap = hero.gapFraction

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: '#f5f4f0',
        color: '#0f0f0e',
        padding: 72,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 32, fontWeight: 600 }}>
          <svg width="40" height="40" viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="11"
              fill="none"
              stroke="#0f0f0e"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeDasharray="44.2 24.9"
              transform="rotate(40 16 16)"
            />
          </svg>
          <span>exdate</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 62, fontWeight: 500, letterSpacing: -2.5, lineHeight: 1.05, maxWidth: 700 }}>
            See what your Stock Tokens actually paid you.
          </div>
          <div style={{ fontSize: 27, color: '#605f59', lineHeight: 1.3, maxWidth: 700 }}>
            {`${pct}% of ${hero.name}’s last dividend never arrived on chain. Declared $${cents(hero.declared)}, arrived $${cents(hero.received)}.`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 340, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 300,
            height: 300,
            fontSize: 76,
            fontWeight: 500,
            letterSpacing: -4,
          }}
        >
          {`${pct}%`}
        </div>
        <svg width="300" height="300" viewBox="0 0 300 300">
          <circle cx="150" cy="150" r={RADIUS} fill="none" stroke="#cbc9c0" strokeWidth="2" />
          <circle
            cx="150"
            cy="150"
            r={RADIUS}
            fill="none"
            stroke="#0f0f0e"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * gap} ${CIRCUMFERENCE}`}
            transform="rotate(-90 150 150)"
          />
        </svg>
      </div>
    </div>,
    { ...size },
  )
}
