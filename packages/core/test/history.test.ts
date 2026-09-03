import { keccak256, toHex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  RangeScanner,
  TRANSFER_TOPIC,
  addressTopic,
  balancesAt,
  checkpointKey,
  decodeTransferLog,
  dedupeTransfers,
  formatWad,
  transferFilter,
  walletHistory,
  type StepRecord,
  type Transfer,
} from '../src/holdings.js'

const SGOV = '0x92fd66527192e3e61d4ddd13322aa222de86f9b5'
const AAPL = '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'
const ME = '0x8601015e6310726547ae737d04b4f6c6e06f58b1'
const OTHER = '0x0aea9504aff416b29ccedd3c3f9b7d142629ad82'
const T = (n: bigint) => n * 10n ** 18n

const transfer = (token: string, from: string, to: string, value: bigint, blockNumber: number, logIndex = 0): Transfer => ({
  token,
  from,
  to,
  value,
  blockNumber,
  logIndex,
})

describe('transfer logs', () => {
  it('uses the computed Transfer topic', () => {
    expect(TRANSFER_TOPIC).toBe(keccak256(toHex('Transfer(address,address,uint256)')))
  })

  it('builds the filter for either side with the wallet as a padded topic', () => {
    const f = transferFilter([SGOV, AAPL], ME, 'to', 900_000, 5_899_999)
    expect(f).toEqual({
      fromBlock: '0xdbba0',
      toBlock: '0x5a06df',
      address: [SGOV, AAPL],
      topics: [TRANSFER_TOPIC, null, addressTopic(ME)],
    })
    expect(transferFilter([SGOV], ME, 'from', 1, 2).topics).toEqual([TRANSFER_TOPIC, addressTopic(ME)])
    expect(() => transferFilter([SGOV], '0xnope', 'from', 1, 2)).toThrow(/not an address/)
  })

  it('decodes an ERC-20 Transfer and drops the ERC-721 twin', () => {
    const log = {
      address: SGOV.toUpperCase().replace('0X', '0x'),
      topics: [TRANSFER_TOPIC, addressTopic(OTHER), addressTopic(ME)],
      data: `0x${T(10n).toString(16).padStart(64, '0')}`,
      blockNumber: '0x2dc6c0',
      logIndex: '0x7',
    }
    expect(decodeTransferLog(log)).toEqual({ token: SGOV, from: OTHER, to: ME, value: T(10n), blockNumber: 3_000_000, logIndex: 7 })
    // an NFT: four topics, empty data
    expect(decodeTransferLog({ ...log, topics: [...log.topics, '0x' + '1'.padStart(64, '0')], data: '0x' })).toBeNull()
    expect(decodeTransferLog({ ...log, topics: ['0x' + 'ab'.repeat(32), log.topics[1]!, log.topics[2]!] })).toBeNull()
  })

  it('keeps one copy of a log seen twice', () => {
    const a = transfer(SGOV, ME, ME, T(1n), 10, 3)
    expect(dedupeTransfers([a, { ...a }, transfer(SGOV, ME, ME, T(1n), 10, 4)])).toHaveLength(2)
  })
})

describe('balancesAt', () => {
  const transfers = [
    transfer(SGOV, OTHER, ME, T(10n), 1_000_000, 2), // +10 well before
    transfer(SGOV, ME, OTHER, T(3n), 2_000_000, 0), //  -3
    transfer(SGOV, OTHER, ME, T(5n), 2_500_000, 9), //  +5 in the effective block itself: already under the new multiplier
    transfer(SGOV, OTHER, ME, T(100n), 2_600_000, 0), // after
    transfer(AAPL, OTHER, ME, T(2n), 2_400_000, 1),
    transfer(AAPL, ME, ME, T(2n), 2_450_000, 0), // paying oneself changes nothing
  ]

  it('is the balance after every transfer strictly before the checkpoint block', () => {
    const b = balancesAt(transfers, ME, [
      { token: SGOV, block: 2_500_000 },
      { token: SGOV, block: 1_000_000 },
      { token: SGOV, block: 3_000_000 },
      { token: AAPL, block: 2_500_000 },
    ])
    expect(b.get(checkpointKey(SGOV, 2_500_000))).toBe(T(7n))
    expect(b.get(checkpointKey(SGOV, 1_000_000))).toBe(0n)
    expect(b.get(checkpointKey(SGOV, 3_000_000))).toBe(T(112n))
    expect(b.get(checkpointKey(AAPL, 2_500_000))).toBe(T(2n))
  })

  it('matches the wallet case-insensitively', () => {
    const b = balancesAt(transfers, ME.toUpperCase().replace('0X', '0x'), [{ token: SGOV.toUpperCase().replace('0X', '0x'), block: 2_500_000 }])
    expect(b.get(checkpointKey(SGOV, 2_500_000))).toBe(T(7n))
  })
})

describe('walletHistory', () => {
  // SGOV's real second step (2026-08-07): 1.000957519890990718 -> 1.002981519346766532, rate 0.306812, received 0.203167, haircut 33.78 %.
  const sgovStep: StepRecord = {
    token: SGOV,
    effectiveAt: '2026-08-07T15:10:24Z',
    effectiveBlock: 2_500_000,
    oldMultiplier: '1000957519890990718',
    newMultiplier: '1002981519346766532',
    rate: '0.306812',
    receivedPerShare: '0.203167',
    haircutBps: 3378,
    status: 'matched',
    hasFeed: true,
  }
  const unmatched: StepRecord = {
    token: AAPL,
    effectiveAt: '2026-07-20T15:10:24Z',
    effectiveBlock: 2_000_000,
    oldMultiplier: '1000000000000000000',
    newMultiplier: '1000500000000000000',
    rate: null,
    receivedPerShare: null,
    haircutBps: null,
    status: 'unmatched',
    hasFeed: false,
  }

  it('computes shares gained exactly and dollars from the committed per-share figures', () => {
    const balances = new Map([
      [checkpointKey(SGOV, 2_500_000), T(100n)],
      [checkpointKey(AAPL, 2_000_000), T(10n)],
    ])
    const h = walletHistory(balances, [unmatched, sgovStep])
    expect(h.exposures.map((e) => e.step.token)).toEqual([SGOV, AAPL]) // newest first
    const sgov = h.exposures[0]!
    expect(formatWad(sgov.sharesBefore, 6)).toBe('100.095752')
    expect(formatWad(sgov.sharesGained, 6)).toBe('0.2024')
    expect(formatWad(sgov.declared!, 4)).toBe('30.7106')
    expect(formatWad(sgov.arrived!, 4)).toBe('20.3362')
    const aapl = h.exposures[1]!
    expect(aapl.sharesGained).toBe(T(10n) / 2000n)
    expect(aapl.declared).toBeNull()
    expect(aapl.arrived).toBeNull()
    expect(h.measured).toEqual({ count: 1, declared: sgov.declared, arrived: sgov.arrived })
    expect(h.totalSharesGained).toBe(sgov.sharesGained + aapl.sharesGained)
  })

  it('leaves out steps the wallet held nothing at', () => {
    const h = walletHistory(new Map([[checkpointKey(SGOV, 2_500_000), 0n]]), [sgovStep, unmatched])
    expect(h.exposures).toEqual([])
    expect(h.totalSharesGained).toBe(0n)
    expect(h.measured.count).toBe(0)
  })
})

describe('RangeScanner', () => {
  it('hands out both sides of every range and finishes', () => {
    const s = new RangeScanner({ fromBlock: 0, toBlock: 9_999_999, rangeSize: 5_000_000 })
    expect(s.total).toBe(4)
    const jobs = []
    for (let job = s.next(); job; job = s.next()) {
      jobs.push(job)
      s.done(job)
    }
    expect(jobs).toHaveLength(4)
    expect(jobs.map((j) => `${j.side}:${j.fromBlock}-${j.toBlock}`).sort()).toEqual([
      'from:0-4999999',
      'from:5000000-9999999',
      'to:0-4999999',
      'to:5000000-9999999',
    ])
    expect(s.finished).toBe(true)
    expect(s.exhausted).toBe(false)
    expect(s.requests).toBe(4)
  })

  it('halves a range that times out, down to the floor, then gives up', () => {
    const s = new RangeScanner({ fromBlock: 0, toBlock: 999_999, rangeSize: 1_000_000, minRange: 250_000, maxRequests: 100 })
    let job = s.next()!
    s.timedOut(job) // 1M -> two of 500k
    expect(s.remaining).toBe(3)
    job = s.next()!
    expect(job.toBlock - job.fromBlock + 1).toBe(500_000)
    s.timedOut(job) // 500k -> two of 250k
    job = s.next()!
    expect(job.toBlock - job.fromBlock + 1).toBe(250_000)
    s.timedOut(job) // at the floor: refuse
    expect(s.exhausted).toBe(true)
    expect(s.next()).toBeNull()
    expect(s.finished).toBe(false)
  })

  it('retries a rejected job and stops at the request budget', () => {
    const s = new RangeScanner({ fromBlock: 0, toBlock: 99, rangeSize: 100, maxRequests: 3 })
    const job = s.next()!
    s.rejected(job)
    expect(s.next()).toEqual(job)
    s.rejected(job)
    expect(s.next()).toEqual(job)
    s.rejected(job)
    expect(s.next()).toBeNull()
    expect(s.exhausted).toBe(true)
    expect(s.requests).toBe(3)
  })
})
