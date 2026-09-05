// The capture of the issuer's quote at the instant of a step is the price the
// haircut is computed from for the 159 tokens with no Chainlink feed, and the
// same module drives both the one-shot on GitHub's schedule and the persistent
// watcher on a machine. It lives in scripts/lib as plain ESM, because the GitHub
// job runs it on a bare `node`, and it is tested here so the two runners cannot
// drift apart in what they record.

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GIVE_UP_AFTER_SECONDS, SAMPLE_OFFSETS, TOLERANCE_SECONDS, closeOut, closestDistance, decodeAnnouncement, getLogsPaged, keyOf, pendingCaptures, record, sampleCaptures, scanAnnouncements, summarize, writeState } from '../../../scripts/lib/effective-prices.mjs'

const WAD = 10n ** 18n
const word = (n) => BigInt(n).toString(16).padStart(64, '0')
const EFFECTIVE = Date.UTC(2026, 8, 2, 15, 10, 26) // F's real step: 2026-09-02T15:10:26Z
const step = (overrides = {}) => ({
  token: '0xtoken',
  symbol: 'F',
  effectiveAt: new Date(EFFECTIVE).toISOString(),
  announcedAt: new Date(EFFECTIVE - 585_000).toISOString(),
  oldMultiplier: WAD.toString(),
  newMultiplier: (WAD + 146_000_000_000_000n).toString(),
  quotes: [],
  ...overrides,
})
const quoteAt = (ms, mid = '11.50') => ({ bid: '11.49', ask: '11.51', mid, generatedAt: new Date(ms).toISOString(), capturedAt: new Date(ms).toISOString(), isTradingHalt: false })

describe('decoding an announcement', () => {
  it('reads the three unindexed words and dates the step from the third', () => {
    const log = {
      address: '0xAF3D76f1834A1d425780943C99Ea8A608f8a93f9',
      data: '0x' + word(WAD) + word(WAD + 146_000_000_000_000n) + word(EFFECTIVE / 1000),
    }
    const a = decodeAnnouncement(log)
    expect(a.token).toBe('0xaf3d76f1834a1d425780943c99ea8a608f8a93f9')
    expect(a.oldMultiplier).toBe(WAD.toString())
    expect(a.newMultiplier).toBe('1000146000000000000')
    expect(a.effectiveAt).toBe('2026-09-02T15:10:26.000Z')
    expect(keyOf(a.token, a.effectiveAt)).toBe('0xaf3d76f1834a1d425780943c99ea8a608f8a93f9:2026-09-02T15:10:26.000Z')
  })
})

describe('recording quotes', () => {
  it('keeps them nearest-first and never records the same issuer timestamp twice', () => {
    const c = step()
    expect(record(c, quoteAt(EFFECTIVE + 31_000))).toBe(true)
    expect(record(c, quoteAt(EFFECTIVE - 4_000))).toBe(true)
    expect(record(c, quoteAt(EFFECTIVE - 4_000, '99'))).toBe(false) // same generatedAt: the 15 s cache served it again
    expect(c.quotes.map((q) => q.distanceSeconds)).toEqual([-4, 31])
    expect(closestDistance(c)).toBe(4)
  })

  it('refuses nothing quietly: a failed quote is not recorded', () => {
    const c = step()
    expect(record(c, null)).toBe(false)
    expect(closestDistance(c)).toBe(Infinity)
  })
})

describe('which steps are still worth sampling', () => {
  const now = EFFECTIVE - 300_000 // five minutes before F's step

  it('excludes what has no symbol, was given up, is already sampled at the instant, or is out of reach', () => {
    const sampled = step({ quotes: [{ ...quoteAt(EFFECTIVE + 20_000), distanceSeconds: 20 }] })
    const unknown = step({ symbol: null })
    const abandoned = step({ givenUp: true })
    const gone = step({ effectiveAt: new Date(now - (GIVE_UP_AFTER_SECONDS + 1) * 1000).toISOString() })
    const later = step({ effectiveAt: new Date(EFFECTIVE + 60_000).toISOString() })
    const pending = pendingCaptures([later, sampled, unknown, abandoned, gone, step()], now)
    expect(pending.map((c) => c.effectiveAt)).toEqual([step().effectiveAt, later.effectiveAt])
  })

  it('keeps a step whose only quote is the "before" one', () => {
    const before = step({ quotes: [{ ...quoteAt(now), distanceSeconds: -300 }] })
    expect(pendingCaptures([before], now)).toHaveLength(1)
  })
})

describe('sampling at the instant', () => {
  const fakes = (start) => {
    let clock = start
    const waits = []
    const asked = []
    return {
      now: () => clock,
      sleepImpl: async (ms) => {
        waits.push(ms)
        clock += ms
      },
      quoteImpl: async (symbol) => {
        asked.push(symbol)
        return quoteAt(clock)
      },
      waits,
      asked,
    }
  }

  it('waits for each offset inside the deadline and leaves the rest to the next run', async () => {
    const f = fakes(EFFECTIVE - 120_000)
    const c = step()
    const changed = await sampleCaptures({ pending: [c], deadline: EFFECTIVE + 10_000, ...f })
    expect(changed).toBe(true)
    expect(f.waits).toEqual([90_000, 30_000]) // to -30 s, then to 0
    expect(c.quotes.map((q) => q.distanceSeconds).sort((a, b) => a - b)).toEqual([-30, 0])
    expect(f.asked).toEqual(['F', 'F'])
  })

  it('takes past offsets at once, and skips one already covered by a quote within ten seconds', async () => {
    const f = fakes(EFFECTIVE + 5_000)
    const c = step({ quotes: [{ ...quoteAt(EFFECTIVE - 28_000), distanceSeconds: -28 }] })
    await sampleCaptures({ pending: [c], deadline: EFFECTIVE + 60_000, ...f })
    // -30 s is covered by the -28 s quote; 0 is sampled now (+5 s); +30 s is waited for.
    expect(f.waits).toEqual([25_000])
    expect(c.quotes.map((q) => q.distanceSeconds).sort((a, b) => a - b)).toEqual([-28, 5, 30])
  })

  it('samples nothing when every offset is past the deadline', async () => {
    const f = fakes(EFFECTIVE - 600_000)
    const c = step()
    expect(await sampleCaptures({ pending: [c], deadline: EFFECTIVE - 400_000, ...f })).toBe(false)
    expect(f.asked).toEqual([])
  })
})

describe('closing out', () => {
  it('gives up a step more than an hour past with nothing near the instant, and says why', () => {
    const late = step()
    const priced = step({ quotes: [{ ...quoteAt(EFFECTIVE + 40_000), distanceSeconds: 40 }] })
    const nameless = step({ symbol: null })
    const now = EFFECTIVE + (GIVE_UP_AFTER_SECONDS + 1) * 1000
    expect(closeOut([late, priced, nameless], now)).toBe(true)
    expect(late.givenUp).toBe(true)
    expect(late.givenUpReason).toMatch(/unrecoverable/)
    expect(priced.givenUp).toBeUndefined()
    expect(nameless.givenUpReason).toMatch(/no symbol/)
  })

  it('leaves a step alone while the hour has not passed', () => {
    const c = step()
    expect(closeOut([c], EFFECTIVE + 1_000)).toBe(false)
    expect(c.givenUp).toBeUndefined()
  })

  it('counts a quote within tolerance as priced at effect', () => {
    const c = step({ quotes: [{ ...quoteAt(EFFECTIVE + TOLERANCE_SECONDS * 1000), distanceSeconds: TOLERANCE_SECONDS }] })
    expect(summarize([c, step({ givenUp: true })])).toEqual({ steps: 2, withQuoteAtEffect: 1, givenUp: 1 })
  })
})

describe('scanning for announcements', () => {
  const log = {
    address: '0xAF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    blockNumber: '0x100',
    transactionHash: '0xtx',
    data: '0x' + word(WAD) + word(WAD + 146_000_000_000_000n) + word(EFFECTIVE / 1000),
  }
  const rpc = async (method) => {
    if (method === 'eth_blockNumber') return '0x1000'
    if (method === 'eth_getLogs') return [log]
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x' + Math.floor((EFFECTIVE - 585_000) / 1000).toString(16) }
    throw new Error(method)
  }

  it('adds the step once, dates the announcement from its block, and takes the "before" quote', async () => {
    const captures = []
    const byKey = new Map()
    const symbolByToken = new Map([['0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', 'AAPL']])
    const asked = []
    const args = { rpc, lookbackBlocks: 100, captures, byKey, symbolByToken, now: () => EFFECTIVE - 500_000, quoteImpl: async (s) => (asked.push(s), quoteAt(EFFECTIVE - 500_000)) }
    const first = await scanAnnouncements(args)
    expect(first.changed).toBe(true)
    expect(first.found).toHaveLength(1)
    expect(captures[0]).toMatchObject({ symbol: 'AAPL', announcedTx: '0xtx', announcedAt: '2026-09-02T15:00:41.000Z' })
    expect(captures[0].quotes[0].distanceSeconds).toBe(-500)
    expect(asked).toEqual(['AAPL'])

    const second = await scanAnnouncements(args)
    expect(second.changed).toBe(false)
    expect(captures).toHaveLength(1)
  })

  it('does not quote a step it is already an hour late for', async () => {
    const asked = []
    const captures = []
    await scanAnnouncements({ rpc, lookbackBlocks: 100, captures, byKey: new Map(), symbolByToken: new Map([[log.address.toLowerCase(), 'AAPL']]), now: () => EFFECTIVE + (GIVE_UP_AFTER_SECONDS + 1) * 1000, quoteImpl: async (s) => (asked.push(s), quoteAt(EFFECTIVE)) })
    expect(captures).toHaveLength(1)
    expect(asked).toEqual([])
  })
})

describe('the state file', () => {
  it('carries the fields it does not own, keeps its shape, and falls back to the previous method', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exdate-capture-'))
    const root = pathToFileURL(dir + '/')
    const previous = {
      note: 'old',
      method: 'the one-shot method',
      lastRunAt: '2026-01-01T00:00:00.000Z',
      toleranceSeconds: 120,
      summary: { steps: 0 },
      watcher: { heartbeatAt: '2026-09-04T09:00:00.000Z' },
      steps: [],
    }
    await writeFile(join(dir, 'state.json'), JSON.stringify(previous))
    const later = step({ effectiveAt: new Date(EFFECTIVE + 60_000).toISOString() })
    await writeState(root, 'state.json', {
      previous,
      captures: [later, step()],
      method: undefined,
      patch: { watchdog: { stale: false } },
      now: () => EFFECTIVE,
    })
    const written = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
    // `source` and `exdateObserves` name whose content the quotes are, because
    // DATA-LICENSE.md carves the issuer's out of exdate's grant and a reader of this
    // file alone could not otherwise tell (audit 2026-09-05, F06).
    expect(Object.keys(written)).toEqual([
      'note',
      'source',
      'exdateObserves',
      'method',
      'lastRunAt',
      'toleranceSeconds',
      'summary',
      'watcher',
      'watchdog',
      'steps',
    ])
    expect(written.source).toBe('robinhood:/rhj/prices')
    expect(written.method).toBe('the one-shot method')
    expect(written.watcher.heartbeatAt).toBe('2026-09-04T09:00:00.000Z')
    expect(written.watchdog).toEqual({ stale: false })
    expect(written.steps.map((s) => s.effectiveAt)).toEqual([step().effectiveAt, later.effectiveAt]) // sorted
    expect(written.summary).toEqual({ steps: 2, withQuoteAtEffect: 0, givenUp: 0 })
    expect(SAMPLE_OFFSETS).toEqual([-30, 0, 30])
  })
})

describe('getLogsPaged', () => {
  const RANGE_ERROR = 'block range exceeds maximum allowed (max=10000, requested=900001)'

  /** A fake endpoint that refuses any span wider than `cap` blocks, as a real one does. */
  const cappedRpc = (cap, logsAt = new Map()) => {
    const calls = []
    return {
      calls,
      rpc: async (method, [filter]) => {
        const from = Number(filter.fromBlock)
        const to = Number(filter.toBlock)
        calls.push([from, to])
        if (to - from + 1 > cap) throw new Error(RANGE_ERROR)
        return [...logsAt.entries()].filter(([b]) => b >= from && b <= to).map(([, log]) => log)
      },
    }
  }

  it('asks once when the endpoint accepts the whole range', async () => {
    const { rpc, calls } = cappedRpc(1_000_000)
    await getLogsPaged({ rpc, from: 1, to: 900_000 })
    expect(calls).toEqual([[1, 900_000]])
  })

  it('splits until the endpoint accepts, and loses no log in the seams', async () => {
    const logs = new Map([
      [1, { blockNumber: '0x1', tag: 'first' }],
      [4_999, { blockNumber: '0x137f', tag: 'middle' }],
      [5_000, { blockNumber: '0x1388', tag: 'just after the first split point' }],
      [10_000, { blockNumber: '0x2710', tag: 'last' }],
    ])
    const { rpc, calls } = cappedRpc(2_500, logs)
    const found = await getLogsPaged({ rpc, from: 1, to: 10_000 })
    expect(found).toHaveLength(4)
    expect(found.map((l) => l.tag)).toEqual(['first', 'middle', 'just after the first split point', 'last'])
    // Contiguous and non-overlapping: a boundary counted twice would double-count
    // a step, and a gap would drop one.
    const accepted = calls.filter(([from, to]) => to - from + 1 <= 2_500).sort((a, b) => a[0] - b[0])
    expect(accepted[0][0]).toBe(1)
    expect(accepted[accepted.length - 1][1]).toBe(10_000)
    for (let i = 1; i < accepted.length; i++) {
      expect(accepted[i][0]).toBe(accepted[i - 1][1] + 1)
    }
  })

  it('raises an error that is not about the range, rather than splitting forever', async () => {
    let calls = 0
    const rpc = async () => {
      calls++
      throw new Error('execution reverted')
    }
    await expect(getLogsPaged({ rpc, from: 1, to: 900_000 })).rejects.toThrow(/execution reverted/)
    expect(calls).toBe(1)
  })
})

describe('scanAnnouncements, incremental', () => {
  const base = { captures: [], byKey: new Map(), symbolByToken: new Map() }

  it('scans the whole lookback on a cold start', async () => {
    const seen = []
    const rpc = async (method, params) => {
      if (method === 'eth_blockNumber') return '0x' + (1_000_000).toString(16)
      seen.push([Number(params[0].fromBlock), Number(params[0].toBlock)])
      return []
    }
    await scanAnnouncements({ rpc, lookbackBlocks: 900_000, ...base, captures: [], byKey: new Map() })
    expect(seen).toEqual([[100_000, 1_000_000]])
  })

  it('scans only the new blocks once it knows where it got to', async () => {
    const seen = []
    const rpc = async (method, params) => {
      if (method === 'eth_blockNumber') return '0x' + (1_000_300).toString(16)
      seen.push([Number(params[0].fromBlock), Number(params[0].toBlock)])
      return []
    }
    await scanAnnouncements({ rpc, lookbackBlocks: 900_000, fromBlock: 1_000_001, ...base, captures: [], byKey: new Map() })
    expect(seen).toEqual([[1_000_001, 1_000_300]])
  })

  it('asks for nothing when no block has been produced since the last tick', async () => {
    const seen = []
    const rpc = async (method, params) => {
      if (method === 'eth_blockNumber') return '0x' + (1_000_000).toString(16)
      seen.push(params)
      return []
    }
    const result = await scanAnnouncements({ rpc, lookbackBlocks: 900_000, fromBlock: 1_000_001, ...base, captures: [], byKey: new Map() })
    expect(seen).toHaveLength(0)
    expect(result.changed).toBe(false)
    expect(result.head).toBe(1_000_000)
  })
})
