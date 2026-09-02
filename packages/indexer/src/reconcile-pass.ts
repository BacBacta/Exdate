import { corporateActions, multiplierEvents, reconciliations, tokens } from 'ponder:schema'
import { enqueueWebhook } from './webhooks.js'
import {
  aggregatorV3Abi,
  findRoundAt,
  lagDays,
  pairActionsWithChanges,
  parseDecimal,
  reconcile,
  rescale,
  type RoundLookup,
} from '@exdate/core'
import type { Context } from 'ponder:registry'
import type { Address } from 'viem'

/**
 * Compute the reconciliation table.
 *
 * Called from the poller rather than from an indexing function of its own,
 * because neither input is an event: the declared side comes from the issuer's
 * HTTP API and the price side from a Chainlink round lookup.
 *
 * Cost is bounded and mostly one-off. Pricing one row is a binary search over an
 * aggregator's round history - about twelve reads - and a row is only priced
 * once, because a past corporate action's price never changes. Rows already
 * holding a price are skipped on every later pass.
 */

/**
 * A row is priced once. A past corporate action's price never changes, so a pass
 * that finds a stored price leaves the row alone rather than spending another
 * dozen reads on it.
 */
const needsPricing = (existing: { priceWad: bigint | null } | null | undefined) =>
  existing === null || existing === undefined || existing.priceWad === null

export async function runReconcilePass(
  context: Context<'Poll:block'>,
  chainId: number,
  now: bigint,
): Promise<number> {
  const [actionRows, eventRows, tokenRows] = await Promise.all([
    context.db.sql.select().from(corporateActions),
    context.db.sql.select().from(multiplierEvents),
    context.db.sql.select().from(tokens),
  ])

  // Reshape into exactly what the pairing needs. Explicit rather than spread: the
  // pairing decides which declared dividend a haircut belongs to, and a field
  // silently arriving as the wrong type there is not something to discover in
  // production.
  const actions = actionRows
    .filter((row) => row.chainId === chainId)
    .map((row) => ({
      id: row.id,
      issuerId: row.issuerId,
      token: row.token as Address | null,
      processDate: row.processDate,
      symbol: row.symbol,
      type: row.type,
      status: row.status,
      rate: row.rate,
    }))

  const changes = eventRows
    .filter((row) => row.chainId === chainId)
    .map((row) => ({
      token: row.token as Address,
      effectiveAt: row.effectiveAt,
      oldMultiplier: row.oldMultiplier,
      newMultiplier: row.newMultiplier,
    }))

  if (actions.length === 0 && changes.length === 0) return 0

  const tokenByAddress = new Map(
    tokenRows.filter((row) => row.chainId === chainId).map((row) => [row.address.toLowerCase(), row]),
  )

  const pairing = pairActionsWithChanges(actions, changes)

  const lookupFor = (feed: Address): RoundLookup => ({
    latest: async () => {
      const [roundId, answer, startedAt, updatedAt] = (await context.client.readContract({
        address: feed,
        abi: aggregatorV3Abi,
        functionName: 'latestRoundData',
      })) as [bigint, bigint, bigint, bigint, bigint]
      return { roundId, answer, startedAt, updatedAt }
    },
    round: async (roundId) => {
      try {
        const [id, answer, startedAt, updatedAt] = (await context.client.readContract({
          address: feed,
          abi: aggregatorV3Abi,
          functionName: 'getRoundData',
          args: [roundId],
        })) as [bigint, bigint, bigint, bigint, bigint]
        return { roundId: id, answer, startedAt, updatedAt }
      } catch {
        // A proxy reverts for a round the current phase has not reached.
        return null
      }
    },
  })

  /** How many multiplier changes this token has produced, for the confidence tier. */
  const eventCountFor = (address: string) =>
    changes.filter((change) => change.token.toLowerCase() === address.toLowerCase()).length

  let written = 0

  // values() also accepts an array; narrow to the single-row form so that
  // onConflictDoUpdate can take the same object.
  type ReconciliationRow = Exclude<
    Parameters<ReturnType<typeof context.db.insert<typeof reconciliations>>['values']>[0],
    readonly unknown[]
  >

  const write = async (row: ReconciliationRow) => {
    await context.db
      .insert(reconciliations)
      .values(row)
      .onConflictDoUpdate(() => row)
    written++
  }

  // --- declared with no on-chain step: pending ------------------------------
  for (const action of pairing.unmatchedActions) {
    const existing = await context.db.find(reconciliations, { id: action.id })
    if (existing) continue
    await enqueueWebhook(context, {
      chainId,
      type: 'dividend.pending',
      subject: action.id,
      token: action.token ? { address: action.token, symbol: action.symbol } : null,
      now,
      data: {
        actionId: action.issuerId,
        type: action.type,
        issuerStatus: action.status,
        processDate: action.processDate,
        processDateIsNotExDate: true,
        grossPerUnderlyingShare: action.rate,
        currency: 'USD',
        source: 'robinhood:/rhj/corporate-actions',
      },
    })
    await write({
      id: action.id,
      chainId,
      computedAt: now,
      token: action.token ?? null,
      symbol: action.symbol,
      actionId: action.issuerId,
      actionType: action.type,
      actionStatus: action.status,
      processDate: action.processDate ?? null,
      rate: action.rate ?? null,
      status: 'pending',
      confidence: 'low',
      note:
        action.status === 'CORPORATE_ACTION_STATUS_COMPLETED'
          ? 'the issuer marks this action completed, but no multiplier step has been observed on chain'
          : 'declared by the issuer, not yet processed',
    })
  }

  // --- on-chain step with no issuer row: unmatched --------------------------
  //
  // Rewritten every pass, and every `${token}:${effectiveAt}` row whose step
  // has since found its issuer action is deleted. Otherwise a step first seen
  // before the issuer's feed caught up would stay published as "unmatched"
  // alongside its later "matched" row - two contradictory rows for one dividend.
  const unmatchedIdOf = (change: { token: string; effectiveAt: bigint }) =>
    `${change.token.toLowerCase()}:${change.effectiveAt}`
  for (const { change } of pairing.matched) {
    const stale = await context.db.find(reconciliations, { id: unmatchedIdOf(change) })
    if (stale) {
      await context.db.delete(reconciliations, { id: unmatchedIdOf(change) })
      written++
    }
  }
  for (const change of pairing.unmatchedChanges) {
    const id = unmatchedIdOf(change)
    const existing = await context.db.find(reconciliations, { id })
    if (existing) continue
    const token = tokenByAddress.get(String(change.token).toLowerCase())
    await write({
      id,
      chainId,
      computedAt: now,
      token: change.token,
      symbol: token?.symbol ?? 'UNKNOWN',
      effectiveAt: change.effectiveAt,
      oldMultiplier: change.oldMultiplier,
      newMultiplier: change.newMultiplier,
      // The step is a fact about the chain, not about the pairing: an unmatched
      // row still has one, and the yield ledger compounds it as unexplained growth.
      observedStepWad:
        change.oldMultiplier === 0n
          ? null
          : ((change.newMultiplier - change.oldMultiplier) * 10n ** 18n) / change.oldMultiplier,
      status: 'unmatched',
      confidence: 'low',
      note: "no issuer corporate action explains this step - the issuer's feed only keeps about a month of history",
    })
  }

  // --- both sides present: price it and reconcile ---------------------------
  for (const { action, change } of pairing.matched) {
    const existing = (await context.db.find(reconciliations, { id: action.id })) as any
    if (!needsPricing(existing)) continue

    const token = tokenByAddress.get(String(change.token).toLowerCase())
    const observedStep =
      change.oldMultiplier === 0n
        ? null
        : ((change.newMultiplier - change.oldMultiplier) * 10n ** 18n) / change.oldMultiplier

    const base = {
      id: action.id,
      chainId,
      computedAt: now,
      token: change.token,
      symbol: action.symbol,
      actionId: action.issuerId,
      actionType: action.type,
      actionStatus: action.status,
      processDate: action.processDate ?? null,
      rate: action.rate ?? null,
      effectiveAt: change.effectiveAt,
      oldMultiplier: change.oldMultiplier,
      newMultiplier: change.newMultiplier,
      observedStepWad: observedStep,
      lagDays: action.processDate ? lagDays(action.processDate, change.effectiveAt) : null,
      confidence: 'low' as const,
    }

    // Only a cash dividend has a per-share rate to reconcile against. A split
    // changes the ratio itself and needs a different model, so it is recorded
    // rather than forced through this one.
    if (!action.rate) {
      await write({
        ...base,
        status: 'unsupported_action_type',
        note: `matched to a step, but ${action.type} carries no per-share rate to reconcile against`,
      })
      continue
    }

    const rateWad = parseDecimal(action.rate, 18)

    let priceWad: bigint | undefined
    let priceFields: Record<string, unknown> = {}
    if (token?.feedProxy) {
      const target = change.effectiveAt
      const result = await findRoundAt(lookupFor(token.feedProxy as Address), target)
      if (result.round) {
        const decimals = token.feedDecimals ?? 8
        priceWad = rescale(result.round.answer, decimals, 18)
        priceFields = {
          feed: token.feedProxy,
          priceWad,
          priceRoundId: result.round.roundId,
          priceUpdatedAt: result.round.updatedAt,
          priceStalenessSeconds: result.stalenessSeconds ?? null,
          priceAtPhaseFloor: result.atPhaseFloor,
        }
      }
    }

    const outcome = reconcile({
      rateWad,
      priceWad,
      priceAtPhaseFloor: (priceFields.priceAtPhaseFloor as boolean | undefined) ?? false,
      oldMultiplier: change.oldMultiplier,
      newMultiplier: change.newMultiplier,
      observedEventCount: eventCountFor(String(change.token)),
      feedVerified: token?.feedVerified ?? false,
    })

    await write({
      ...base,
      ...priceFields,
      expectedStepWad: outcome.expectedStepWad ?? null,
      receivedPerShareWad: outcome.receivedPerShareWad ?? null,
      impliedHaircutBps: outcome.impliedHaircutBps ?? null,
      impliedReinvestPriceWad: outcome.impliedReinvestPriceWad ?? null,
      status: outcome.status,
      confidence: outcome.confidence,
      note: outcome.note ?? null,
    })

    // The measured haircut, which is the number nobody else publishes. Sent
    // once per action: `needsPricing` above means a row that already carries a
    // price is not rewritten, so this cannot fire twice for one dividend.
    await enqueueWebhook(context, {
      chainId,
      type: 'dividend.reconciled',
      subject: action.id,
      token: { address: change.token as Address, symbol: action.symbol },
      now,
      data: {
        actionId: action.issuerId,
        processDate: action.processDate,
        grossPerUnderlyingShare: action.rate,
        effectiveAt: new Date(Number(change.effectiveAt) * 1000).toISOString(),
        lagDays: base.lagDays,
        observedStepBps: observedStep === null ? null : Number(observedStep) / 1e14,
        expectedStepBps: outcome.expectedStepWad === undefined ? null : Number(outcome.expectedStepWad) / 1e14,
        impliedHaircutBps: outcome.impliedHaircutBps ?? null,
        status: outcome.status,
        confidence: outcome.confidence,
        note: outcome.note ?? null,
        priceSource: priceFields.priceWad === undefined ? null : 'chainlink:getRoundData',
      },
    })
  }

  return written
}
