import { describe, expect, it } from 'vitest'
import { FEED_HEARTBEAT_SECONDS } from '../src/chains.js'
import { feedHealth, isFresh } from '../src/staleness.js'

// 2026-09-02T13:05:12Z, the moment the Phase 0 feed sweep ran.
const NOW = 1_788_354_312n

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))

describe('feed health', () => {
  it('calls a feed updated minutes ago live', () => {
    // COIN: updatedAt 2026-09-02T12:57:16Z, 8 minutes old.
    const health = feedHealth({ updatedAt: at('2026-09-02T12:57:16Z'), nowSeconds: NOW })
    expect(health.status).toBe('live')
    expect(health.ageSeconds).toBe(476)
    expect(health.beyondHeartbeat).toBe(false)
  })

  it('still calls SPY live at 18 hours because the heartbeat is 24 hours', () => {
    // The honest reading: SPY was 18 h stale during a live US session, yet it
    // is inside Chainlink's publication guarantee. The heartbeat is not a
    // freshness guarantee, which is why ageSeconds is always reported.
    const health = feedHealth({ updatedAt: at('2026-09-01T18:46:04Z'), nowSeconds: NOW })
    expect(health.status).toBe('live')
    expect(health.ageSeconds).toBeGreaterThan(18 * 3600)
    expect(health.beyondHeartbeat).toBe(false)
  })

  it('calls a feed stale once it passes the heartbeat', () => {
    const health = feedHealth({ updatedAt: NOW - BigInt(FEED_HEARTBEAT_SECONDS) - 1n, nowSeconds: NOW })
    expect(health.status).toBe('stale')
    expect(health.beyondHeartbeat).toBe(true)
  })

  it('does not flip at exactly one heartbeat', () => {
    const health = feedHealth({ updatedAt: NOW - BigInt(FEED_HEARTBEAT_SECONDS), nowSeconds: NOW })
    expect(health.status).toBe('live')
    expect(health.beyondHeartbeat).toBe(false)
  })

  it('reports paused over live, and still reports the age', () => {
    const health = feedHealth({
      updatedAt: at('2026-09-01T18:46:04Z'),
      nowSeconds: NOW,
      oraclePaused: true,
    })
    expect(health.status).toBe('paused')
    expect(health.ageSeconds).toBeGreaterThan(0)
    expect(health.beyondHeartbeat).toBe(false)
  })

  it('reports paused over stale, and still says the heartbeat is missed', () => {
    // The round is a day and a bit old AND the oracle is paused. Paused wins for
    // display because it is a deliberate window; beyondHeartbeat stays true so
    // a caller keeping its own staleness guard is not misled.
    const health = feedHealth({
      updatedAt: NOW - 90_000n,
      nowSeconds: NOW,
      oraclePaused: true,
    })
    expect(health.status).toBe('paused')
    expect(health.beyondHeartbeat).toBe(true)
  })

  it('is unknown, never zero, when no round exists', () => {
    const health = feedHealth({ updatedAt: 0n, nowSeconds: NOW })
    expect(health.status).toBe('unknown')
    expect(health.ageSeconds).toBeUndefined()
    // Not false: "within the heartbeat" is a claim about a round that does not
    // exist, and the status page used to render it as "no".
    expect(health.beyondHeartbeat).toBeUndefined()
    expect(feedHealth({ updatedAt: undefined, nowSeconds: NOW }).status).toBe('unknown')
  })

  it('accepts a caller-supplied heartbeat', () => {
    const health = feedHealth({ updatedAt: NOW - 3601n, nowSeconds: NOW, heartbeatSeconds: 3600 })
    expect(health.status).toBe('stale')
  })
})

describe('isFresh under a caller tolerance', () => {
  it('rejects the 18 hour SPY price for a 15 minute tolerance', () => {
    expect(
      isFresh({ updatedAt: at('2026-09-01T18:46:04Z'), nowSeconds: NOW, toleranceSeconds: 900 }),
    ).toBe(false)
  })

  it('accepts the 8 minute COIN price for the same tolerance', () => {
    expect(
      isFresh({ updatedAt: at('2026-09-02T12:57:16Z'), nowSeconds: NOW, toleranceSeconds: 900 }),
    ).toBe(true)
  })

  it('rejects a paused oracle however recent the round is', () => {
    expect(
      isFresh({ updatedAt: NOW - 1n, nowSeconds: NOW, oraclePaused: true, toleranceSeconds: 900 }),
    ).toBe(false)
  })

  it('rejects a missing round rather than treating it as fresh', () => {
    expect(isFresh({ updatedAt: undefined, nowSeconds: NOW, toleranceSeconds: 900 })).toBe(false)
  })
})
