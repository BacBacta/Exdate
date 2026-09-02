import { describe, expect, it } from 'vitest'
import { MATCH_WINDOW_DAYS, lagDays, pairActionsWithChanges } from '../src/pairing.js'

/**
 * A wrong pair produces a haircut indistinguishable from a real one, so the join
 * is pinned against the actual observed dates rather than invented ones.
 */

const at = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000))

const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
const AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
const COST = '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2'

describe('pairing observed actions with observed changes', () => {
  it('matches AAPL across one day', () => {
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: AAPL, processDate: '2026-08-13' }],
      [{ token: AAPL, effectiveAt: at('2026-08-14T15:12:46Z') }],
    )
    expect(result.matched).toHaveLength(1)
    expect(result.unmatchedActions).toHaveLength(0)
    expect(result.unmatchedChanges).toHaveLength(0)
  })

  it('matches COST across a weekend', () => {
    // processDate Friday 2026-08-07, effective Monday 2026-08-10.
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: COST, processDate: '2026-08-07' }],
      [{ token: COST, effectiveAt: at('2026-08-10T15:10:24Z') }],
    )
    expect(result.matched).toHaveLength(1)
  })

  it('never matches a change that predates the action', () => {
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: AAPL, processDate: '2026-08-14' }],
      [{ token: AAPL, effectiveAt: at('2026-08-13T15:10:00Z') }],
    )
    expect(result.matched).toHaveLength(0)
    expect(result.unmatchedActions).toHaveLength(1)
    expect(result.unmatchedChanges).toHaveLength(1)
  })

  it('does not pair across tokens', () => {
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: AAPL, processDate: '2026-08-13' }],
      [{ token: SGOV, effectiveAt: at('2026-08-14T15:12:46Z') }],
    )
    expect(result.matched).toHaveLength(0)
  })

  it('is case-insensitive on the address', () => {
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: AAPL.toLowerCase(), processDate: '2026-08-13' }],
      [{ token: AAPL.toUpperCase().replace('0X', '0x'), effectiveAt: at('2026-08-14T15:12:46Z') }],
    )
    expect(result.matched).toHaveLength(1)
  })
})

describe('SGOV, the token with a monthly cadence', () => {
  // Three real actions and three real changes on one token. This is the case
  // where a first-candidate-wins join silently mispairs.
  const actions = [
    { id: 'jul', token: SGOV, processDate: '2026-07-07' },
    { id: 'aug', token: SGOV, processDate: '2026-08-06' },
    { id: 'sep', token: SGOV, processDate: '2026-08-31' },
  ]
  const changes = [
    { token: SGOV, effectiveAt: at('2026-07-08T20:14:32Z') },
    { token: SGOV, effectiveAt: at('2026-08-07T15:10:24Z') },
    { token: SGOV, effectiveAt: at('2026-09-01T00:00:26Z') },
  ]

  it('pairs each action with its own change, whatever the input order', () => {
    for (const [a, c] of [
      [actions, changes],
      [[...actions].reverse(), changes],
      [actions, [...changes].reverse()],
      [[...actions].reverse(), [...changes].reverse()],
    ] as const) {
      const result = pairActionsWithChanges(a, c)
      expect(result.matched).toHaveLength(3)
      const byId = Object.fromEntries(result.matched.map((m) => [m.action.id, m.change.effectiveAt]))
      expect(byId.jul).toBe(at('2026-07-08T20:14:32Z'))
      expect(byId.aug).toBe(at('2026-08-07T15:10:24Z'))
      expect(byId.sep).toBe(at('2026-09-01T00:00:26Z'))
    }
  })

  it('never uses one change for two actions', () => {
    // Two actions dated a day apart, one change. Only the nearer may claim it.
    const result = pairActionsWithChanges(
      [
        { id: 'near', token: SGOV, processDate: '2026-08-06' },
        { id: 'far', token: SGOV, processDate: '2026-08-04' },
      ],
      [{ token: SGOV, effectiveAt: at('2026-08-07T15:10:24Z') }],
    )
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]!.action.id).toBe('near')
    expect(result.unmatchedActions.map((a) => a.id)).toEqual(['far'])
  })

  it('never uses one action for two changes', () => {
    const result = pairActionsWithChanges(
      [{ id: 'only', token: SGOV, processDate: '2026-08-06' }],
      [
        { token: SGOV, effectiveAt: at('2026-08-07T15:10:24Z') },
        { token: SGOV, effectiveAt: at('2026-08-09T15:10:24Z') },
      ],
    )
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]!.change.effectiveAt).toBe(at('2026-08-07T15:10:24Z'))
    expect(result.unmatchedChanges).toHaveLength(1)
  })
})

describe('rows that cannot be paired', () => {
  it('reports July changes as unmatched, because the issuer feed does not go back that far', () => {
    const result = pairActionsWithChanges(
      [{ id: 'aug', token: SGOV, processDate: '2026-08-06' }],
      [
        { token: SGOV, effectiveAt: at('2026-07-08T20:14:32Z') },
        { token: SGOV, effectiveAt: at('2026-08-07T15:10:24Z') },
      ],
    )
    expect(result.matched).toHaveLength(1)
    expect(result.unmatchedChanges).toHaveLength(1)
    expect(result.unmatchedChanges[0]!.effectiveAt).toBe(at('2026-07-08T20:14:32Z'))
  })

  it('reports a declared dividend with no on-chain step as an unmatched action', () => {
    // BND: COMPLETED by the issuer on 2026-08-05, multiplier still 1.0 weeks on.
    const result = pairActionsWithChanges(
      [{ id: 'bnd', token: '0x2F62fC9fAbb470C690f141c28340eD832bB27020', processDate: '2026-08-05' }],
      [],
    )
    expect(result.matched).toHaveLength(0)
    expect(result.unmatchedActions).toHaveLength(1)
  })

  it('skips an action with no deployment or no date instead of crashing', () => {
    const result = pairActionsWithChanges(
      [
        { id: 'no-token', token: null, processDate: '2026-08-13' },
        { id: 'no-date', token: AAPL, processDate: null },
        { id: 'bad-date', token: AAPL, processDate: 'not-a-date' },
      ],
      [{ token: AAPL, effectiveAt: at('2026-08-14T15:12:46Z') }],
    )
    expect(result.matched).toHaveLength(0)
    expect(result.unmatchedActions).toHaveLength(3)
    expect(result.unmatchedChanges).toHaveLength(1)
  })

  it('pairs a step exactly four calendar days out, at the hour every step lands', () => {
    // A Thursday processDate over a holiday weekend: Fri closed, effect Monday
    // at 15:10 UTC. That is four calendar days but 4 days 15 h of elapsed time,
    // which a seconds-based window would reject.
    expect(MATCH_WINDOW_DAYS).toBe(4)
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: AAPL, processDate: '2026-12-31' }],
      [{ token: AAPL, effectiveAt: at('2027-01-04T15:10:24Z') }],
    )
    expect(result.matched).toHaveLength(1)
  })

  it('does not pair a step five calendar days out', () => {
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: AAPL, processDate: '2026-12-31' }],
      [{ token: AAPL, effectiveAt: at('2027-01-05T15:10:24Z') }],
    )
    expect(result.matched).toHaveLength(0)
  })

  it('pairs a step on the same calendar day', () => {
    const result = pairActionsWithChanges(
      [{ id: 'a1', token: AAPL, processDate: '2026-08-14' }],
      [{ token: AAPL, effectiveAt: at('2026-08-14T15:12:46Z') }],
    )
    expect(result.matched).toHaveLength(1)
  })

  it('honours a caller-supplied window', () => {
    const wide = pairActionsWithChanges(
      [{ id: 'a1', token: COST, processDate: '2026-08-07' }],
      [{ token: COST, effectiveAt: at('2026-08-10T15:10:24Z') }],
      1,
    )
    expect(wide.matched).toHaveLength(0)
  })
})

describe('lagDays', () => {
  it('measures the observed one-business-day lag', () => {
    expect(lagDays('2026-08-13', at('2026-08-14T15:12:46Z'))).toBe(1)
  })

  it('measures a weekend', () => {
    expect(lagDays('2026-08-07', at('2026-08-10T15:10:24Z'))).toBe(3)
  })

  it('refuses an unparseable date', () => {
    expect(lagDays('not-a-date', at('2026-08-14T15:12:46Z'))).toBeNull()
  })
})
