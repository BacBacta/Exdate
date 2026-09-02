import { describe, expect, it } from 'vitest'
import {
  aggregatorRoundOf,
  encodeRoundId,
  findRoundAt,
  phaseOf,
  type AggregatorRound,
  type RoundLookup,
} from '../src/rounds.js'

/**
 * An off-by-one here picks the wrong price for a reconciliation, and the result
 * still looks plausible - a haircut computed against the previous day's close
 * reads exactly like a real measurement. So the search is pinned against a
 * synthetic series where the correct answer is known for every instant.
 */

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))

/** Build a lookup over an explicit round series, counting reads. */
function lookupOver(
  phase: bigint,
  series: { updatedAt: bigint; answer: bigint }[],
  options: { missing?: number[] } = {},
): RoundLookup & { reads: () => number } {
  let reads = 0
  const missing = new Set(options.missing ?? [])
  const build = (index: number): AggregatorRound => ({
    roundId: encodeRoundId(phase, BigInt(index + 1)),
    answer: series[index]!.answer,
    startedAt: series[index]!.updatedAt,
    updatedAt: series[index]!.updatedAt,
  })
  return {
    reads: () => reads,
    latest: async () => {
      reads++
      return build(series.length - 1)
    },
    round: async (roundId) => {
      reads++
      const index = Number(aggregatorRoundOf(roundId)) - 1
      if (index < 0 || index >= series.length) return null
      if (missing.has(index + 1)) return null
      return build(index)
    },
  }
}

// Modelled on the real SGOV feed: one round a day just after midnight UTC.
const daily = [
  { updatedAt: at('2026-08-03T00:01:00Z'), answer: 100_400_000_00n },
  { updatedAt: at('2026-08-04T00:01:00Z'), answer: 100_450_000_00n },
  { updatedAt: at('2026-08-05T00:01:00Z'), answer: 100_500_000_00n },
  { updatedAt: at('2026-08-06T00:01:32Z'), answer: 100_541_200_00n },
  { updatedAt: at('2026-08-07T00:01:33Z'), answer: 100_571_200_00n },
  { updatedAt: at('2026-08-10T00:00:21Z'), answer: 100_804_700_00n },
]

describe('round id encoding', () => {
  it('round-trips a phase and an aggregator round', () => {
    const id = encodeRoundId(1n, 49n)
    expect(phaseOf(id)).toBe(1n)
    expect(aggregatorRoundOf(id)).toBe(49n)
    // This is the shape the real SGOV proxy returns.
    expect(id).toBe(18_446_744_073_709_551_665n)
  })

  it('survives a phase above 1', () => {
    const id = encodeRoundId(3n, 7n)
    expect(phaseOf(id)).toBe(3n)
    expect(aggregatorRoundOf(id)).toBe(7n)
  })
})

describe('findRoundAt', () => {
  it('picks the last round at or before the target, not the nearest', () => {
    // The real SGOV reconciliation: effectiveAt 2026-08-07T15:10:24Z. The nearest
    // round in time is 08-10, three days later and 23 cents higher. Taking it
    // would move the measured haircut without any error being visible.
    return findRoundAt(lookupOver(1n, daily), at('2026-08-07T15:10:24Z')).then((result) => {
      expect(result.round?.answer).toBe(100_571_200_00n)
      expect(result.next?.answer).toBe(100_804_700_00n)
      expect(result.stalenessSeconds).toBe(54_531)
      expect(result.atPhaseFloor).toBe(false)
    })
  })

  it('is inclusive at the exact publication instant', async () => {
    const result = await findRoundAt(lookupOver(1n, daily), at('2026-08-06T00:01:32Z'))
    expect(result.round?.answer).toBe(100_541_200_00n)
    expect(result.stalenessSeconds).toBe(0)
  })

  it('picks the previous round one second before a publication', async () => {
    const result = await findRoundAt(lookupOver(1n, daily), at('2026-08-06T00:01:31Z'))
    expect(result.round?.answer).toBe(100_500_000_00n)
  })

  it('returns null when the target predates every round', async () => {
    const result = await findRoundAt(lookupOver(1n, daily), at('2026-07-01T00:00:00Z'))
    expect(result.round).toBeNull()
    expect(result.next).toBeNull()
    expect(result.stalenessSeconds).toBeUndefined()
  })

  it('returns the head without searching when the target is in the future', async () => {
    const lookup = lookupOver(1n, daily)
    const result = await findRoundAt(lookup, at('2026-09-02T12:00:00Z'))
    expect(result.round?.answer).toBe(100_804_700_00n)
    expect(result.next).toBeNull()
    // One read: latestRoundData. No binary search at all.
    expect(lookup.reads()).toBe(1)
  })

  it('flags the phase floor so a caller cannot mistake it for the real answer', async () => {
    // A target between the aggregator rollover and the phase's first round: the
    // true price is in the previous phase and unreachable from here.
    const result = await findRoundAt(lookupOver(2n, daily), at('2026-08-03T06:00:00Z'))
    expect(result.round?.answer).toBe(100_400_000_00n)
    expect(result.phase).toBe(2n)
    expect(result.atPhaseFloor).toBe(true)
  })

  it('does not flag the floor when an earlier round in the phase exists', async () => {
    const result = await findRoundAt(lookupOver(1n, daily), at('2026-08-05T06:00:00Z'))
    expect(result.atPhaseFloor).toBe(false)
  })

  it('treats an unreadable round as not-yet-reached and still lands correctly', async () => {
    // A proxy reverts for rounds the phase has not published. The search must
    // move up on a null, exactly as it would on a too-early timestamp.
    const result = await findRoundAt(
      lookupOver(1n, daily, { missing: [2, 4] }),
      at('2026-08-07T15:10:24Z'),
    )
    expect(result.round?.answer).toBe(100_571_200_00n)
  })

  it('handles a feed with a single round', async () => {
    const one = [{ updatedAt: at('2026-08-01T00:00:00Z'), answer: 1_000_000_00n }]
    const before = await findRoundAt(lookupOver(1n, one), at('2026-07-31T23:59:59Z'))
    expect(before.round).toBeNull()
    const after = await findRoundAt(lookupOver(1n, one), at('2026-08-01T00:00:01Z'))
    expect(after.round?.answer).toBe(1_000_000_00n)
    expect(after.atPhaseFloor).toBe(true)
  })

  it('handles a feed with no rounds at all', async () => {
    const empty: RoundLookup = {
      latest: async () => ({ roundId: encodeRoundId(1n, 0n), answer: 0n, startedAt: 0n, updatedAt: 0n }),
      round: async () => null,
    }
    const result = await findRoundAt(empty, at('2026-08-07T00:00:00Z'))
    expect(result.round).toBeNull()
    expect(result.roundsInPhase).toBe(0n)
  })

  it('costs a logarithmic number of reads, not a linear scan', async () => {
    const many = Array.from({ length: 1_000 }, (_, i) => ({
      updatedAt: at('2026-07-01T00:00:00Z') + BigInt(i) * 3_600n,
      answer: BigInt(i),
    }))
    const lookup = lookupOver(1n, many)
    const result = await findRoundAt(lookup, at('2026-07-01T00:00:00Z') + 500n * 3_600n)
    expect(result.round?.answer).toBe(500n)
    // latest + ~10 probes + one lookahead. A linear scan would be 1000.
    expect(lookup.reads()).toBeLessThan(15)
  })
})
