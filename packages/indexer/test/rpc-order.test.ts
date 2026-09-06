import { describe, expect, it } from 'vitest'
import { RPC_URLS_IN_USE } from '../../../scripts/phase0/rpc.mjs'
import { DEFAULT_RPC_URLS } from '../ponder.config.js'

/**
 * The failover order is derived from data/rpc-endpoints.observed.json in two places: this package's
 * ponder.config.ts, and scripts/phase0/rpc.mjs, which imports nothing at all so the collectors and
 * the watcher can run it on a bare node with no install step. That is a deliberate duplication, and
 * a deliberate duplication needs something asserting the two agree - otherwise the indexer and the
 * watcher quietly read from different endpoints.
 *
 * Both values are the ones the two modules actually computed. Re-applying the rule here instead
 * would produce a test that agrees with itself for ever, which is how the pair went stale in the
 * first place: both named pocket.network first, for a 2 000 000-block eth_getLogs the daily probe
 * then measured at zero.
 */
describe('the derived failover order', () => {
  it('is the same list in the indexer and in the scripts', () => {
    expect([...RPC_URLS_IN_USE]).toEqual([...DEFAULT_RPC_URLS])
  })

  it('never leads with the operator’s own endpoint', () => {
    // The terms reason: Robinhood's RPC is a "Service" bound to testing and development
    // (docs/terms-review.md §2.4(a)), so a production read tries a third party first. It is last
    // and never absent, because it is the only endpoint that has always answered.
    expect(RPC_URLS_IN_USE.length).toBeGreaterThan(1)
    expect(RPC_URLS_IN_USE[0]).not.toContain('robinhood.com')
    expect(RPC_URLS_IN_USE.at(-1)).toContain('robinhood.com')
  })
})
