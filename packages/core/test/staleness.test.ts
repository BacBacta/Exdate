import { describe, expect, it } from 'vitest'
import { FEED_HEARTBEAT_SECONDS } from '../src/chains.js'
import { feedHealth, feedStatusTransition, isFresh, pauseTransition } from '../src/staleness.js'

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

describe('pause transitions', () => {
  // The poller reads oraclePaused() every cycle and has to decide what, if
  // anything, just happened. Getting this wrong is not a cosmetic bug: a
  // pause.changed webhook says a corporate action is in progress.
  it('says nothing when the flag has not moved', () => {
    expect(pauseTransition(false, false)).toBeNull()
    expect(pauseTransition(true, true)).toBeNull()
  })

  it('names the direction when it moves', () => {
    expect(pauseTransition(false, true)).toBe('paused')
    expect(pauseTransition(true, false)).toBe('resumed')
  })

  it('calls a first observation of a paused token a baseline, not a pause', () => {
    // Its pause began at some unknown moment before exdate existed. Announcing
    // it as a transition would fire on every restart.
    expect(pauseTransition(null, true)).toBe('baseline')
    expect(pauseTransition(undefined, true)).toBe('baseline')
  })

  it('says nothing at all about a first observation of a live token', () => {
    expect(pauseTransition(null, false)).toBeNull()
    expect(pauseTransition(undefined, false)).toBeNull()
  })

  it('treats a failed read as no observation, never as unchanged', () => {
    expect(pauseTransition(true, undefined)).toBeNull()
    expect(pauseTransition(false, undefined)).toBeNull()
    expect(pauseTransition(null, undefined)).toBeNull()
  })
})

describe('feed status transitions', () => {
  it('fires only on the two transitions that mean something', () => {
    expect(feedStatusTransition('live', 'stale')).toBe('stale')
    expect(feedStatusTransition('stale', 'live')).toBe('resumed')
    expect(feedStatusTransition('live', 'live')).toBeNull()
    expect(feedStatusTransition('stale', 'stale')).toBeNull()
  })

  it('does not report a first observation as a transition', () => {
    expect(feedStatusTransition(null, 'stale')).toBeNull()
    expect(feedStatusTransition(undefined, 'live')).toBeNull()
  })

  it('leaves unknown and paused to their own signals', () => {
    // A feed that became unreadable has not gone stale, and a paused oracle is
    // a corporate-action window that pause.changed already reports.
    expect(feedStatusTransition('live', 'unknown')).toBeNull()
    expect(feedStatusTransition('unknown', 'live')).toBeNull()
    expect(feedStatusTransition('live', 'paused')).toBeNull()
    expect(feedStatusTransition('paused', 'live')).toBeNull()
    expect(feedStatusTransition('paused', 'stale')).toBeNull()
  })

  it('composes with feedHealth on a real pause', () => {
    // SGOV's feed at a corporate action: fresh round, oracle paused. The health
    // is 'paused', and that is not a staleness transition.
    const before = feedHealth({ updatedAt: 1_788_307_271n, nowSeconds: 1_788_307_300n })
    const during = feedHealth({
      updatedAt: 1_788_307_271n,
      nowSeconds: 1_788_307_300n,
      oraclePaused: true,
    })
    expect(before.status).toBe('live')
    expect(during.status).toBe('paused')
    expect(feedStatusTransition(before.status, during.status)).toBeNull()
    expect(pauseTransition(false, true)).toBe('paused')
  })
})
