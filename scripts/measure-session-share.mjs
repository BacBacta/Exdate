// How much Stock Token activity happens outside the US market session?
//
// The kickoff brief asserts "~46 % of transfers happen outside NYSE hours,
// weekends included". exdate has never measured it: the indexer stores no
// transfers, so the figure has stayed the brief's claim rather than an
// observation - the last number in the product that traces back to nobody.
// This measures it.
//
//   node scripts/measure-session-share.mjs [blocks] [--dry-run] [--out FILE]
//
// One run takes ONE sample: a short window of Transfer logs across all 194
// tokens, its rate in transfers per second, and the ET market session the
// window fell in. Run it on a schedule and the samples accumulate into a
// committed file; a GitHub Action does that hourly.
//
// The statistic is a rate weighted by clock hours, not a pooled count. A
// session that occupies 32.5 of the week's 168 hours contributes
// `mean rate x 32.5 x 3600` transfers, whatever share of the samples landed in
// it - so an uneven sampling schedule biases the answer less. The pooled,
// uncorrected share is published next to it so the two can be compared.
//
// Not measured, and said so in the file rather than smoothed over: market
// holidays and half-days count as ordinary sessions, and a 40-second window is
// a sample of an hour, not a census of it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { classifyMarketSession, easternHourOfWeek, MARKET_SESSIONS } from './lib/market-session.mjs'
import { rpc, hex, TOPIC } from './phase0/rpc.mjs'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'data/session-share.observed.json'
const BLOCKS = BigInt(args.find((arg) => /^\d+$/.test(arg)) ?? 400)

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase()
const CHAIN_ID = 4663

// --- one sample ---------------------------------------------------------------
const registry = JSON.parse(readFileSync('data/robinhood-assets.snapshot.json', 'utf8'))
const tokens = registry.assets.flatMap((asset) =>
  (asset.deployments ?? []).filter((d) => d.chainId === CHAIN_ID).map((d) => d.contractAddress),
)
if (tokens.length === 0) throw new Error('no tokens in the registry snapshot; refusing to sample')

/**
 * The endpoint caps a result set at 10 000 logs. A window that overflows it is
 * a window with more than 10 000 transfers in it - so halve and report the
 * window that actually fit, never the one that was asked for.
 */
async function transfersIn(address, startBlock, endBlock) {
  let start = startBlock
  for (;;) {
    try {
      const logs = await rpc('eth_getLogs', [
        { address, fromBlock: hex(start), toBlock: hex(endBlock), topics: [TOPIC.Transfer] },
      ])
      return { logs, blocks: endBlock - start + 1n }
    } catch (error) {
      if (!/exceeds limit/.test(error.message)) throw error
      const span = endBlock - start + 1n
      if (span <= 1n) throw error
      start = endBlock - span / 2n + 1n
    }
  }
}

const head = BigInt(await rpc('eth_blockNumber', []))
const { logs, blocks: window } = await transfersIn(tokens, head - BLOCKS + 1n, head)

// The window's own timestamps, read from the chain: block cadence is ~0.1 s but
// a rate divided by an assumed cadence is an assumption, not a measurement.
const firstBlockNumber = head - window + 1n
const [firstBlock, lastBlock] = await Promise.all([
  rpc('eth_getBlockByNumber', [hex(firstBlockNumber), false]),
  rpc('eth_getBlockByNumber', [hex(head), false]),
])
const startedAt = Number(BigInt(firstBlock.timestamp))
const endedAt = Number(BigInt(lastBlock.timestamp))
const seconds = endedAt - startedAt
if (seconds <= 0) throw new Error(`window covers ${seconds}s of chain time; refusing to divide by it`)

// ERC-721 declares the same signature, so topic0 collides by construction; a
// fourth topic is the tokenId. Those are not token transfers.
const erc20 = logs.filter((log) => log.topics.length === 3)

const { logs: usdgLogs } = await transfersIn(USDG, firstBlockNumber, head)
const usdgTx = new Set(usdgLogs.filter((log) => log.topics.length === 3).map((log) => log.transactionHash))
const stockTx = new Set(erc20.map((log) => log.transactionHash))
const provable = [...stockTx].filter((tx) => usdgTx.has(tx)).length

// The window's midpoint, not its edges: a 40-second window never straddles a
// session boundary by enough to matter, and one instant has to be chosen.
const midpoint = new Date(((startedAt + endedAt) / 2) * 1000)
const session = classifyMarketSession(midpoint)

const sample = {
  observedAt: new Date(endedAt * 1000).toISOString(),
  session,
  easternHourOfWeek: easternHourOfWeek(midpoint),
  fromBlock: Number(firstBlockNumber),
  headBlock: Number(head),
  windowBlocks: Number(window),
  windowSeconds: seconds,
  transfers: erc20.length,
  transfersPerSecond: Number((erc20.length / seconds).toFixed(3)),
  transactionsMovingAToken: stockTx.size,
  provableTrades: provable,
  provableTradesPerSecond: Number((provable / seconds).toFixed(3)),
}

console.error(
  `# ${sample.observedAt} ${session.padEnd(12)} ${erc20.length} transfers in ${seconds}s ` +
    `= ${sample.transfersPerSecond}/s (${provable} provable trades)`,
)

// --- merge and recompute ------------------------------------------------------
const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { samples: [] }
const previous = existing.samples ?? []

// Two runs close together read overlapping block ranges, and averaging a window
// with itself is not a second observation. A duplicate fire - a manual dispatch
// on top of the schedule, a retried job - is a no-op rather than a bias.
const last = previous.at(-1)
if (last && sample.fromBlock <= last.headBlock) {
  console.error(
    `# window ${sample.fromBlock}-${sample.headBlock} overlaps the last sample (ends ${last.headBlock}); nothing appended`,
  )
  process.exit(0)
}

const samples = [...previous, sample].sort((a, b) => a.observedAt.localeCompare(b.observedAt))

const mean = (numbers) => numbers.reduce((total, n) => total + n, 0) / numbers.length

const buckets = Object.entries(MARKET_SESSIONS).map(([key, meta]) => {
  const mine = samples.filter((s) => s.session === key)
  return {
    session: key,
    label: meta.label,
    offHours: meta.offHours,
    hoursPerWeek: meta.hoursPerWeek,
    samples: mine.length,
    transfersSampled: mine.reduce((total, s) => total + s.transfers, 0),
    secondsSampled: mine.reduce((total, s) => total + s.windowSeconds, 0),
    transfersPerSecondMean: mine.length ? Number(mean(mine.map((s) => s.transfersPerSecond)).toFixed(3)) : null,
    transfersPerSecondMin: mine.length ? Math.min(...mine.map((s) => s.transfersPerSecond)) : null,
    transfersPerSecondMax: mine.length ? Math.max(...mine.map((s) => s.transfersPerSecond)) : null,
    provableTradesPerSecondMean: mine.length
      ? Number(mean(mine.map((s) => s.provableTradesPerSecond)).toFixed(3))
      : null,
  }
})

const MIN_SAMPLES_PER_SESSION = 3
const thin = buckets.filter((bucket) => bucket.samples < MIN_SAMPLES_PER_SESSION)
const slotsCovered = new Set(samples.map((s) => s.easternHourOfWeek)).size

/**
 * Rate x hours, not a pooled count. Publishing a share before every session has
 * been seen would be a number about the sampling schedule, so it is refused by
 * name until then - rule 2.
 */
function shares(rateOf) {
  if (thin.length > 0) return null
  const weekly = buckets.map((bucket) => ({ bucket, weekly: rateOf(bucket) * bucket.hoursPerWeek * 3600 }))
  const total = weekly.reduce((sum, row) => sum + row.weekly, 0)
  if (total <= 0) return null
  return {
    total: Math.round(total),
    bySession: Object.fromEntries(
      weekly.map((row) => [row.bucket.session, Number((row.weekly / total).toFixed(4))]),
    ),
    offHours: Number(
      (weekly.filter((row) => row.bucket.offHours).reduce((sum, row) => sum + row.weekly, 0) / total).toFixed(4),
    ),
  }
}

const transferShares = shares((bucket) => bucket.transfersPerSecondMean ?? 0)
const tradeShares = shares((bucket) => bucket.provableTradesPerSecondMean ?? 0)

/** The same question answered without the hours weighting, for comparison. */
const pooledOffHours = (() => {
  const total = samples.reduce((sum, s) => sum + s.transfers, 0)
  if (total === 0) return null
  const off = samples.filter((s) => MARKET_SESSIONS[s.session].offHours).reduce((sum, s) => sum + s.transfers, 0)
  return Number((off / total).toFixed(4))
})()

const output = {
  note:
    'How much Stock Token activity happens outside the US market session, measured by exdate rather than assumed. Each run samples a short window of Transfer logs across all 194 tokens and records its rate and the ET session it fell in; a GitHub Action runs it hourly. The published share is a rate weighted by the clock hours each session occupies in a week, so an uneven sampling schedule biases it less than a pooled count would. Refresh with node scripts/measure-session-share.mjs.',
  chainId: CHAIN_ID,
  sessionsAreDefinedIn: 'America/New_York',
  method:
    'share = mean transfers/second in a session x that session hours per week, normalised across the five sessions',
  notMeasured: [
    'Market holidays and half-days are counted as ordinary weekday sessions: no holiday calendar is used.',
    'Each sample is a window of a few dozen seconds, so it is a sample of its hour and not a census of it.',
    'Only Transfer logs from the 194 Stock Tokens are counted. A transfer proves custody moved, not that a trade happened; provableTrades is the subset that also moves USDG in the same transaction.',
  ],
  firstSampleAt: samples[0].observedAt,
  lastSampleAt: samples.at(-1).observedAt,
  sampleCount: samples.length,
  easternHourOfWeekSlotsCovered: slotsCovered,
  easternHourOfWeekSlots: 168,
  minSamplesPerSession: MIN_SAMPLES_PER_SESSION,
  sufficient: thin.length === 0,
  notComputed:
    thin.length === 0
      ? []
      : [
          {
            field: 'transferShare / provableTradeShare',
            reason: 'insufficient_session_coverage',
            detail: `every session needs at least ${MIN_SAMPLES_PER_SESSION} samples; still short: ${thin
              .map((bucket) => `${bucket.session} (${bucket.samples})`)
              .join(', ')}`,
          },
        ],
  transferShare: transferShares,
  provableTradeShare: tradeShares,
  pooledOffHoursShareOfSampledTransfers: pooledOffHours,
  briefClaim: {
    value: 0.46,
    text: 'the kickoff brief asserts ~46 % of transfers happen outside NYSE hours, weekends included',
    source: 'kickoff brief, unverified by exdate until this file says sufficient: true',
  },
  sessions: buckets,
  samples,
}

if (transferShares) {
  console.error(`# off-hours share of transfers:       ${(transferShares.offHours * 100).toFixed(1)} %`)
  if (tradeShares) console.error(`# off-hours share of provable trades: ${(tradeShares.offHours * 100).toFixed(1)} %`)
} else {
  console.error(`# share not computed yet: ${output.notComputed[0].detail}`)
}
console.error(`# ${samples.length} sample(s), ${slotsCovered}/168 hour-of-week slots covered`)

if (DRY_RUN) {
  console.error('# --dry-run: nothing written')
} else {
  writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`)
  console.error(`# wrote ${OUT}`)
}
