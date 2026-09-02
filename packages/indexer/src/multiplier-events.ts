import { ponder } from 'ponder:registry'
import { multiplierEvents, tokens } from 'ponder:schema'
import { findToken, stockTokenAbi } from '@exdate/core'

/**
 * `UIMultiplierUpdated` is the only Stock Token event exdate indexes.
 *
 * It fires once, at announcement, carrying a future `effectiveAt` - typically
 * nine to ten minutes ahead. Nothing is emitted when the change actually takes
 * effect, so this handler records an announcement and never an application.
 */
ponder.on('StockToken:UIMultiplierUpdated', async ({ event, context }) => {
  const chainId = context.chain.id
  const token = event.log.address
  const { oldMultiplier, newMultiplier, effectiveAtTimestamp } = event.args
  const announcedAt = event.block.timestamp

  const registryToken = findToken(chainId, token)

  // A token the committed registry does not know - listed after the snapshot
  // was taken. Read its decimals on chain rather than invent 18: the sibling
  // fields below are self-evident placeholders, a number would not be.
  let decimals: number | null = registryToken?.decimals ?? null
  if (decimals === null) {
    try {
      decimals = Number(
        await context.client.readContract({ address: token, abi: stockTokenAbi, functionName: 'decimals' }),
      )
    } catch {
      decimals = null
    }
  }

  // Keep the token row present even if the poller has not run yet, so an event
  // arriving during backfill is never orphaned.
  await context.db
    .insert(tokens)
    .values({
      chainId,
      address: token,
      symbol: registryToken?.symbol ?? 'UNKNOWN',
      name: registryToken?.name ?? 'Unknown token',
      decimals,
      isin: registryToken?.isin ?? null,
      issuer: 'Robinhood Assets (Jersey) Limited',
      status: registryToken?.status ?? 'ASSET_STATUS_UNSPECIFIED',
      logoUrl: registryToken?.logoUrl ?? null,
      feedProxy: registryToken?.feedProxy ?? null,
      feedDecimals: registryToken?.feedDecimals ?? null,
      feedVerified: registryToken?.feedVerified ?? false,
    })
    .onConflictDoNothing()

  // A schedule can be re-announced. CRWD emitted the same (newMultiplier,
  // effectiveAt) pair twice, 11 hours apart, and appending would have turned
  // one corporate action into two. The row is keyed on (chain, token,
  // effectiveAt); a repeat keeps the first announcement and updates the last.
  await context.db
    .insert(multiplierEvents)
    .values({
      chainId,
      token,
      effectiveAt: effectiveAtTimestamp,
      oldMultiplier,
      newMultiplier,
      announcedAt,
      announcedBlock: event.block.number,
      announcedTx: event.transaction.hash,
      lastAnnouncedAt: announcedAt,
      lastAnnouncedTx: event.transaction.hash,
      announcementCount: 1,
      kind: 'unknown',
      source: 'onchain:indexer',
    })
    .onConflictDoUpdate((row) => ({
      source: 'onchain:indexer',
      // The latest announcement is the one that will take effect, so its
      // multipliers win even though the first announcement's identity is kept.
      oldMultiplier,
      newMultiplier,
      lastAnnouncedAt: announcedAt,
      lastAnnouncedTx: event.transaction.hash,
      announcementCount: row.announcementCount + 1,
    }))
})
