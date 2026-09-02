import { describe, expect, it } from 'vitest'
import { createClient } from '../src/index.js'

/**
 * Opt-in checks against a running deployment.
 *
 *     EXDATE_INTEGRATION=1 EXDATE_API_URL=http://localhost:42069 pnpm --filter @exdate/sdk test
 *
 * Skipped by default: a unit suite that needs a server is a unit suite that
 * fails for reasons unrelated to the code. What these are for is the seam the
 * stubbed tests cannot cover - that the shapes this package declares are the
 * shapes the API actually serves, on real data.
 *
 * They assert invariants, not values: the numbers move with the chain, and a
 * test that pins today's multiplier would fail on the next dividend.
 */

const ENABLED = process.env.EXDATE_INTEGRATION === '1'
const baseUrl = process.env.EXDATE_API_URL ?? 'http://localhost:42069'
const client = createClient({ baseUrl })

describe.skipIf(!ENABLED)('against a live API', () => {
  it('serves the registry and the poller state together', async () => {
    const { count, polled, tokens } = await client.tokens()
    expect(count).toBeGreaterThan(0)
    expect(polled).toBeLessThanOrEqual(count)
    for (const token of tokens) {
      // The rules this SDK documents, checked on every row the deployment has.
      expect(token.state === 'indexed' || token.multiplier.current === null).toBe(true)
      if (token.multiplier.scheduled !== null) {
        expect(token.multiplier.lastChangeEffectiveAt).toBeNull()
        expect(token.multiplier.scheduled.secondsRemaining).toBeGreaterThan(0)
      }
      if (token.feed) expect(token.feed.includesMultiplier).toBe(true)
    }
  })

  it('serves a ledger that either closes or says why not', async () => {
    const { tokens } = await client.tokens()
    const moved = tokens.find((token) => token.events.count > 0)
    if (!moved) return
    const ledger = await client.yield(moved.address)
    expect(ledger.basis).toBe('per_distribution_not_annualized')
    expect(ledger.totals === null || ledger.coverage.closes === true).toBe(true)
    if (ledger.totals === null) {
      expect(ledger.notComputed.some((entry) => entry.field === 'totals')).toBe(true)
    }
    // A step is only ever called yield when an issuer dividend is paired to it.
    for (const row of ledger.ledger) {
      if (row.observed?.netYieldBps != null) expect(row.status).toBe('matched')
    }
  })

  it('serves what is owed, with nothing projected out of thin air', async () => {
    const { tokens } = await client.tokens()
    const token = tokens[0]!
    const owed = await client.pending(token.address)
    expect(owed.token.address.toLowerCase()).toBe(token.address.toLowerCase())
    for (const declared of owed.declared) {
      expect(['awaiting', 'overdue', 'declared_complete_not_on_chain']).toContain(declared.state)
      if (declared.projection) expect(declared.projection.notAMeasurement).toBe(true)
      else expect(owed.oracle.feed === null || declared.grossPerUnderlyingShare === null).toBe(true)
    }
  })

  it('reports a 404 as a 404', async () => {
    expect(await client.tokenOrNull('0x0000000000000000000000000000000000000001')).toBeNull()
  })

  it('publishes a webhook catalogue whose counts match the outbox', async () => {
    const [catalogue, outbox] = await Promise.all([client.webhooks.catalogue(), client.webhooks.events()])
    expect(catalogue.events.length).toBe(7)
    expect(outbox.endpointsConfigured).toBe(catalogue.endpointsConfigured)
    expect(outbox.counts.deliveries).toBe(
      outbox.counts.queued + outbox.counts.delivered + outbox.counts.failed,
    )
    for (const event of outbox.events) {
      // The served body must be the bytes that were signed, not a re-encoding.
      expect(JSON.parse(event.signedBody)).toEqual(event.payload)
    }
  })
})
