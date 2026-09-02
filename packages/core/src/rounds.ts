/**
 * Finding the Chainlink round that was in force at a past instant.
 *
 * This is what makes reconciliation possible without an archive node. Robinhood
 * Chain's public RPC keeps only a few thousand blocks of state - `eth_call` at
 * `latest - 10 000` already answers "metadata is not found" - so a historical
 * price cannot be read by pinning a block. But an aggregator keeps its own round
 * history in current storage, and `getRoundData(roundId)` reads it from the head.
 *
 * Round ids on a proxy are phase-encoded: `(phaseId << 64) | aggregatorRoundId`.
 * A feed that rolls its aggregator starts a new phase at round 1, so a search
 * confined to the current phase cannot see anything from before the rollover.
 * That is why {@link findRoundAt} reports the phase it searched and whether it
 * hit the phase's own floor: a caller must be able to tell "this is the price at
 * your instant" from "this is the oldest price this phase has".
 */

export interface AggregatorRound {
  roundId: bigint
  answer: bigint
  startedAt: bigint
  updatedAt: bigint
}

export interface RoundLookup {
  /** The feed's `latestRoundData()`. */
  latest: () => Promise<AggregatorRound>
  /**
   * The feed's `getRoundData(roundId)`. Must resolve to `null` rather than throw
   * when the round does not exist - a proxy reverts for round 0 and for rounds
   * the current phase has not reached.
   */
  round: (roundId: bigint) => Promise<AggregatorRound | null>
}

export interface RoundAtResult {
  /** The last round published at or before the target, or null if none exists. */
  round: AggregatorRound | null
  /** The first round published after the target, when one was read. */
  next: AggregatorRound | null
  phase: bigint
  roundsInPhase: bigint
  /**
   * True when `round` is the earliest round of the current phase. The real answer
   * may then predate the aggregator rollover and be unreachable, so the caller
   * must not treat the value as "the price at the instant".
   */
  atPhaseFloor: boolean
  /** Seconds between `round.updatedAt` and the target. */
  stalenessSeconds: number | undefined
}

const AGGREGATOR_ROUND_MASK = (1n << 64n) - 1n

export const phaseOf = (roundId: bigint): bigint => roundId >> 64n
export const aggregatorRoundOf = (roundId: bigint): bigint => roundId & AGGREGATOR_ROUND_MASK
export const encodeRoundId = (phase: bigint, aggregatorRound: bigint): bigint =>
  (phase << 64n) | aggregatorRound

/**
 * Binary search the current phase for the round in force at `targetSeconds`.
 *
 * `updatedAt` increases monotonically within a phase, which is what makes the
 * search sound. A round that reads back as null is treated as "not reached yet",
 * so the search moves up - the same direction a proxy's revert implies.
 *
 * Cost is O(log n) reads: about 10 calls for a feed with 1 000 rounds.
 */
export async function findRoundAt(lookup: RoundLookup, targetSeconds: bigint): Promise<RoundAtResult> {
  const latest = await lookup.latest()
  const phase = phaseOf(latest.roundId)
  const roundsInPhase = aggregatorRoundOf(latest.roundId)

  if (roundsInPhase === 0n) {
    return { round: null, next: null, phase, roundsInPhase, atPhaseFloor: false, stalenessSeconds: undefined }
  }

  // Short-circuit the common case: the target is at or after the head.
  if (latest.updatedAt <= targetSeconds) {
    return {
      round: latest,
      next: null,
      phase,
      roundsInPhase,
      atPhaseFloor: roundsInPhase === 1n,
      stalenessSeconds: Number(targetSeconds - latest.updatedAt),
    }
  }

  let low = 1n
  let high = roundsInPhase
  let best: AggregatorRound | null = null
  let bestAggregatorRound = 0n

  while (low <= high) {
    const mid = (low + high) / 2n
    const round = await lookup.round(encodeRoundId(phase, mid))
    if (round === null || round.updatedAt === 0n) {
      low = mid + 1n
      continue
    }
    if (round.updatedAt <= targetSeconds) {
      best = round
      bestAggregatorRound = mid
      low = mid + 1n
    } else {
      high = mid - 1n
    }
  }

  const next =
    best !== null && bestAggregatorRound < roundsInPhase
      ? await lookup.round(encodeRoundId(phase, bestAggregatorRound + 1n))
      : null

  return {
    round: best,
    next,
    phase,
    roundsInPhase,
    atPhaseFloor: best !== null && bestAggregatorRound === 1n,
    stalenessSeconds: best === null ? undefined : Number(targetSeconds - best.updatedAt),
  }
}
