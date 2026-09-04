// Creations and redemptions, per token, signed.
//
// A Stock Token is minted when an authorised participant deposits the underlying and
// burned when they redeem it, so mint minus burn is net creation - the same signal an
// ETF publishes daily as net flow, and the one number that says whether the wrapper is
// growing or shrinking. Nobody publishes it for these tokens. The issuer's own
// /rhj/prices carries `mintBurnTokenVolume`, but that is gross turnover with no sign,
// and no history.
//
// On chain it is exact: mint is a Transfer from address(0), burn is a Transfer to it.
// Measured 2026-09-04 over one day across all 194 tokens: 1 865 mints, 862 burns,
// 162 tokens with flow, in about twenty requests.
//
// Each run reads from where the last one stopped to the current head, so the windows
// are contiguous and disjoint: no gap invents a zero, no overlap counts twice.
//
//   node scripts/measure-primary-flows.mjs
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { rpc, hex } from './phase0/rpc.mjs'

const root = new URL('../', import.meta.url)
const OUT = process.env.EXDATE_FLOWS_OUT ?? 'data/primary-flows.observed.json'
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO_TOPIC = '0x' + '0'.repeat(64)
const WAD = 10n ** 18n

/** ~0.1 s per block, so this is about 2.8 hours. Wider ranges time out on the public node. */
const CHUNK_BLOCKS = Number(process.env.EXDATE_FLOWS_CHUNK ?? 100_000)
/** A chunk the node still times out at this size is refused rather than silently dropped. */
const MIN_CHUNK_BLOCKS = 6_250
/** First run, and the cap on catching up after missed runs: three days. */
const DEFAULT_WINDOW_BLOCKS = Number(process.env.EXDATE_FLOWS_WINDOW ?? 860_000)
const MAX_CATCHUP_BLOCKS = DEFAULT_WINDOW_BLOCKS * 3

const registry = read('data/robinhood-assets.snapshot.json')
const assets = registry.assets ?? registry
const tokens = []
const symbolByToken = new Map()
for (const asset of assets) {
  for (const d of asset.deployments ?? []) {
    if (String(d.chainId) !== '4663') continue
    const address = d.contractAddress.toLowerCase()
    tokens.push(address)
    symbolByToken.set(address, asset.tokenSymbol)
  }
}

let state
try {
  state = read(OUT)
} catch {
  state = { windows: [] }
}
const windows = state.windows ?? []
const last = windows.at(-1)

const head = Number(await rpc('eth_blockNumber', []))
let fromBlock = last ? last.toBlock + 1 : head - DEFAULT_WINDOW_BLOCKS
let truncated = false
if (head - fromBlock > MAX_CATCHUP_BLOCKS) {
  // Missed runs leave a gap this run cannot honestly fill in one go. Read the most
  // recent three days and record that the window before it was never read, rather
  // than pretend the ledger is continuous.
  fromBlock = head - MAX_CATCHUP_BLOCKS
  truncated = true
}
if (fromBlock > head) {
  console.error('# no new blocks since the last window')
  process.exit(0)
}

/**
 * One direction over one range, halving on a timeout. A range that still times out at
 * the floor is reported, and the window is marked incomplete rather than published as
 * if the missing logs were zero.
 */
async function logsIn(topics, from, to, incomplete) {
  const out = []
  const stack = [[from, to]]
  while (stack.length) {
    const [lo, hi] = stack.pop()
    try {
      const logs = await rpc('eth_getLogs', [{ fromBlock: hex(lo), toBlock: hex(hi), address: tokens, topics }])
      out.push(...logs)
    } catch (error) {
      const span = hi - lo + 1
      if (!/timed out|exceeds limit|too many/i.test(error.message) || span <= MIN_CHUNK_BLOCKS) {
        incomplete.push({ fromBlock: lo, toBlock: hi, reason: error.message })
        continue
      }
      const mid = lo + Math.floor(span / 2)
      stack.push([mid, hi], [lo, mid - 1])
    }
  }
  return out
}

const incomplete = []
const mints = []
const burns = []
let requests = 0
const startedAt = Date.now()
for (let lo = fromBlock; lo <= head; lo += CHUNK_BLOCKS) {
  const hi = Math.min(lo + CHUNK_BLOCKS - 1, head)
  requests += 2
  mints.push(...(await logsIn([TRANSFER, ZERO_TOPIC], lo, hi, incomplete)))
  burns.push(...(await logsIn([TRANSFER, null, ZERO_TOPIC], lo, hi, incomplete)))
}

// ERC-721 declares the same topic0 with a fourth topic and empty data.
const erc20 = (log) => log.topics.length === 3 && log.data.length === 66
const byToken = new Map()
const bucket = (address) => {
  const key = address.toLowerCase()
  if (!byToken.has(key)) byToken.set(key, { mintedWad: 0n, burnedWad: 0n, mints: 0, burns: 0 })
  return byToken.get(key)
}
for (const log of mints.filter(erc20)) {
  const b = bucket(log.address)
  b.mintedWad += BigInt(log.data)
  b.mints++
}
for (const log of burns.filter(erc20)) {
  const b = bucket(log.address)
  b.burnedWad += BigInt(log.data)
  b.burns++
}

const [fromHeader, toHeader] = await Promise.all([
  rpc('eth_getBlockByNumber', [hex(fromBlock), false]),
  rpc('eth_getBlockByNumber', [hex(head), false]),
])
const stamp = (header) => new Date(Number(BigInt(header.timestamp)) * 1000).toISOString()
const decimal = (wad) => {
  const whole = wad / WAD
  const fraction = (wad % WAD).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

const rows = [...byToken.entries()]
  .map(([token, b]) => ({
    token,
    symbol: symbolByToken.get(token) ?? null,
    /** Raw token amounts, 18 decimals. Underlying shares are these times the multiplier in force. */
    minted: decimal(b.mintedWad),
    burned: decimal(b.burnedWad),
    net: (b.mintedWad >= b.burnedWad ? '' : '-') + decimal(b.mintedWad >= b.burnedWad ? b.mintedWad - b.burnedWad : b.burnedWad - b.mintedWad),
    mints: b.mints,
    burns: b.burns,
  }))
  .sort((a, b) => Math.abs(Number(b.net)) - Math.abs(Number(a.net)))

const totalMinted = [...byToken.values()].reduce((s, b) => s + b.mintedWad, 0n)
const totalBurned = [...byToken.values()].reduce((s, b) => s + b.burnedWad, 0n)

const window = {
  fromBlock,
  toBlock: head,
  fromTime: stamp(fromHeader),
  toTime: stamp(toHeader),
  hours: Number(((Number(BigInt(toHeader.timestamp)) - Number(BigInt(fromHeader.timestamp))) / 3600).toFixed(2)),
  readAt: new Date().toISOString(),
  requests,
  readMs: Date.now() - startedAt,
  /** True when a range could not be read; the totals below are then a floor, not a count. */
  incomplete: incomplete.length > 0,
  unreadRanges: incomplete,
  /** True when missed runs left a gap this run did not read. */
  precededByGap: truncated,
  tokensWithFlow: rows.length,
  mints: rows.reduce((s, r) => s + r.mints, 0),
  burns: rows.reduce((s, r) => s + r.burns, 0),
  totalMinted: decimal(totalMinted),
  totalBurned: decimal(totalBurned),
  netCreated: (totalMinted >= totalBurned ? '' : '-') + decimal(totalMinted >= totalBurned ? totalMinted - totalBurned : totalBurned - totalMinted),
  tokens: rows,
}
windows.push(window)

await writeFile(
  new URL(OUT, root),
  JSON.stringify(
    {
      note:
        'Creations and redemptions per Stock Token, from the chain: mint is a Transfer from address(0), burn is a Transfer to it. Mint minus burn is net creation, the signal an ETF publishes as net flow and that nobody publishes for these tokens. Amounts are raw tokens, 18 decimals; underlying shares are these times the multiplier in force.',
      method:
        'Each run reads from the block after the last window to the current head, so windows are contiguous and disjoint. A range the node times out on is halved; one that still fails at the floor is listed in unreadRanges and the window is marked incomplete rather than published as if those logs were zero.',
      lastRunAt: new Date().toISOString(),
      windows,
    },
    null,
    2,
  ) + '\n',
)
console.error(
  `# ${window.fromTime} -> ${window.toTime} (${window.hours} h, ${requests} requests, ${window.readMs} ms)` +
    `${window.incomplete ? ` INCOMPLETE: ${incomplete.length} unread range(s)` : ''}`,
)
console.error(`# ${window.mints} mints, ${window.burns} burns across ${window.tokensWithFlow} tokens`)
console.error(`# minted ${window.totalMinted}, burned ${window.totalBurned}, net ${window.netCreated}`)
for (const row of rows.slice(0, 5)) console.error(`#   ${(row.symbol ?? row.token).padEnd(6)} net ${row.net}`)
console.error(`# wrote ${OUT}: ${windows.length} window(s)`)
