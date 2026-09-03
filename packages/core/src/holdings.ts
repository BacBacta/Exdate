/**
 * What one address holds across every Stock Token, and what each declared
 * dividend would owe it.
 *
 * Reading a balance needs no signature: it is public state. So the whole read
 * is one `eth_call` to Multicall3 carrying `balanceOf`, `balanceOfUI` and
 * `uiMultiplier` for every token, plus the block number and timestamp so the
 * answer carries its own date. Measured on the public RPC: 194 tokens, 584
 * sub-calls, one request, about 250 ms.
 *
 * This file is pure and imports nothing: the caller does the transport (a
 * browser `fetch`, or the indexer's client) and a web page can bundle it
 * without dragging in an RPC library. The ABI encoding is written out by hand
 * for the same reason, and the tests check it byte for byte against viem.
 * (Really nothing: a bundler resolving this package as TypeScript source does
 * not follow the `.js` specifiers the rest of core uses, so the unit constant
 * is restated here rather than imported.)
 */

export type Hex = `0x${string}`

const WAD = 10n ** 18n

/** Signatures the read dials, and their selectors, computed (the tests check each against viem). */
export const HOLDINGS_SIGNATURE = {
  balanceOf: 'balanceOf(address)',
  balanceOfUI: 'balanceOfUI(address)',
  uiMultiplier: 'uiMultiplier()',
  aggregate3: 'aggregate3((address,bool,bytes)[])',
  getBlockNumber: 'getBlockNumber()',
  getCurrentBlockTimestamp: 'getCurrentBlockTimestamp()',
} as const

export const HOLDINGS_SELECTOR: Record<keyof typeof HOLDINGS_SIGNATURE, Hex> = {
  balanceOf: '0x70a08231',
  balanceOfUI: '0x437a9958',
  uiMultiplier: '0xa60bf13d',
  aggregate3: '0x82ad56cb',
  getBlockNumber: '0x42cbb15c',
  getCurrentBlockTimestamp: '0x0f28c97d',
}

export const isAddress = (value: string): value is Hex => /^0x[0-9a-fA-F]{40}$/.test(value)

const word = (value: bigint): string => value.toString(16).padStart(64, '0')
const addressWord = (address: string): string => address.slice(2).toLowerCase().padStart(64, '0')

interface Call {
  target: string
  callData: string
}

/** `(address target, bool allowFailure, bytes callData)`: a dynamic tuple, so its head carries the offset of `bytes`. */
function encodeTuple(call: Call): string {
  const bytes = call.callData.slice(2)
  const length = bytes.length / 2
  const padded = bytes.padEnd(Math.ceil(length / 32) * 64, '0')
  return addressWord(call.target) + word(1n) + word(0x60n) + word(BigInt(length)) + padded
}

/** Where the read gets its block number: Multicall3's own `block.number` unless the chain says otherwise. */
export interface BlockNumberSource {
  target: string
  selector: Hex
}

/**
 * Calldata for one `aggregate3` that reads the block, the timestamp, and for
 * every token the holder's raw balance, the shares it represents and the
 * multiplier in force. Every sub-call is allowed to fail so one reverting
 * token cannot take the whole answer down.
 *
 * The block number comes from `blockNumberSource` when given: on an
 * Arbitrum-family chain `block.number` is the parent chain's, and only
 * ArbSys knows the L2 height (see `ChainDefinition.blockNumberSource`).
 */
export function encodeHoldingsCall(
  multicall3: string,
  tokens: readonly string[],
  holder: string,
  blockNumberSource: BlockNumberSource = { target: multicall3, selector: HOLDINGS_SELECTOR.getBlockNumber },
): Hex {
  if (!isAddress(holder)) throw new Error(`holdings: not an address: ${holder}`)
  const holderWord = addressWord(holder)
  const calls: Call[] = [
    { target: blockNumberSource.target, callData: blockNumberSource.selector },
    { target: multicall3, callData: HOLDINGS_SELECTOR.getCurrentBlockTimestamp },
  ]
  for (const token of tokens) {
    calls.push(
      { target: token, callData: HOLDINGS_SELECTOR.balanceOf + holderWord },
      { target: token, callData: HOLDINGS_SELECTOR.balanceOfUI + holderWord },
      { target: token, callData: HOLDINGS_SELECTOR.uiMultiplier },
    )
  }
  const tuples = calls.map(encodeTuple)
  const offsets: string[] = []
  let offset = BigInt(calls.length * 32)
  for (const tuple of tuples) {
    offsets.push(word(offset))
    offset += BigInt(tuple.length / 2)
  }
  return `0x${HOLDINGS_SELECTOR.aggregate3.slice(2)}${word(0x20n)}${word(BigInt(calls.length))}${offsets.join('')}${tuples.join('')}`
}

export interface Aggregate3Result {
  success: boolean
  returnData: Hex
}

/** Decodes `(bool success, bytes returnData)[]`, the return shape of `aggregate3`. */
export function decodeAggregate3(result: string): Aggregate3Result[] {
  const hex = result.startsWith('0x') ? result.slice(2) : result
  const wordAt = (byteOffset: number): number => {
    const slice = hex.slice(byteOffset * 2, byteOffset * 2 + 64)
    if (slice.length !== 64) throw new Error('holdings: truncated multicall result')
    return Number(BigInt(`0x${slice}`))
  }
  const arrayStart = wordAt(0)
  const length = wordAt(arrayStart)
  const base = arrayStart + 32
  const out: Aggregate3Result[] = []
  for (let i = 0; i < length; i++) {
    const tuple = base + wordAt(base + i * 32)
    const success = wordAt(tuple) === 1
    const bytes = tuple + wordAt(tuple + 32)
    const size = wordAt(bytes)
    const data = hex.slice((bytes + 32) * 2, (bytes + 32 + size) * 2)
    if (data.length !== size * 2) throw new Error('holdings: truncated multicall result')
    out.push({ success, returnData: `0x${data}` })
  }
  return out
}

export interface Holding {
  token: string
  /** ERC-20 balance, 18 decimals: the number of tokens. */
  raw: bigint
  /** `balanceOfUI`: the underlying shares those tokens represent right now, 18 decimals. */
  underlyingShares: bigint
  /** The multiplier in force at the read, WAD. `raw * uiMultiplier / 1e18 == underlyingShares`. */
  uiMultiplier: bigint
}

export interface HoldingsSnapshot {
  blockNumber: bigint
  /** Block timestamp, seconds. The read's own date, from the chain rather than the reader's clock. */
  timestamp: bigint
  /** Tokens with a non-zero balance only. */
  holdings: Holding[]
  /** Tokens whose views reverted this time; reported, never treated as zero. */
  unreadable: string[]
}

const uint256 = (result: Aggregate3Result): bigint | null =>
  result.success && result.returnData.length === 66 ? BigInt(result.returnData) : null

/** Pairs the answer of `encodeHoldingsCall` back with the token list it was built from. */
export function decodeHoldings(result: string, tokens: readonly string[]): HoldingsSnapshot {
  const rows = decodeAggregate3(result)
  const expected = 2 + tokens.length * 3
  if (rows.length !== expected) throw new Error(`holdings: expected ${expected} results, got ${rows.length}`)
  const blockNumber = uint256(rows[0]!)
  const timestamp = uint256(rows[1]!)
  if (blockNumber === null || timestamp === null) throw new Error('holdings: Multicall3 did not report its block')
  const holdings: Holding[] = []
  const unreadable: string[] = []
  tokens.forEach((token, i) => {
    const raw = uint256(rows[2 + i * 3]!)
    const underlyingShares = uint256(rows[3 + i * 3]!)
    const uiMultiplier = uint256(rows[4 + i * 3]!)
    if (raw === null || underlyingShares === null || uiMultiplier === null) {
      unreadable.push(token)
      return
    }
    if (raw === 0n) return
    holdings.push({ token, raw, underlyingShares, uiMultiplier })
  })
  return { blockNumber, timestamp, holdings, unreadable }
}

// --- what a declared dividend would owe, exact, no floats -------------------

/** "0.2516" → WAD. The issuer prints rates as plain decimals; anything else is refused rather than guessed. */
export function parseDecimalWad(value: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(value)) throw new Error(`holdings: not a decimal: ${value}`)
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * WAD + BigInt(fraction.padEnd(18, '0'))
}

/**
 * What a full payment of `rate` dollars per underlying share would deliver to
 * a holder of `underlyingShares` (WAD): WAD dollars. The rate is the issuer's,
 * the shares are the chain's, and no price enters. It is the gross; how much
 * of it survives is measured per token once the step lands.
 */
export function owedWad(rate: string, underlyingShares: bigint): bigint {
  return (parseDecimalWad(rate) * underlyingShares) / WAD
}

/** WAD → decimal string, half-up at `places`; `pad` keeps trailing zeros so "0.20" reads as a price. */
export function formatWad(value: bigint, places: number, pad = false): string {
  const unit = 10n ** BigInt(18 - places)
  const rounded = (value + unit / 2n) / unit
  const scale = 10n ** BigInt(places)
  const whole = (rounded / scale).toString()
  let fraction = (rounded % scale).toString().padStart(places, '0')
  if (!pad) fraction = fraction.replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export interface DeclaredDividend {
  processDate: string
  rate: string
  /** False while the issuer's date has not arrived: nothing is owed yet, the amount is stated anyway. */
  due: boolean
}

export type WalletDividend<D extends DeclaredDividend = DeclaredDividend> = D & { owed: bigint }

export interface WalletLine<D extends DeclaredDividend = DeclaredDividend> {
  holding: Holding
  dividends: WalletDividend<D>[]
  /** Sum of the dividends already due, WAD dollars. */
  owedDue: bigint
}

export interface WalletView<D extends DeclaredDividend = DeclaredDividend> {
  lines: WalletLine<D>[]
  totalDue: bigint
  totalUpcoming: bigint
}

/**
 * Joins a snapshot with the declared-not-landed dividends per token (keyed by
 * lowercase address). Lines are ordered by what is owed, then by size, so the
 * reader sees the money first. Whatever else a declared row carries (a state,
 * a label) rides along untouched.
 */
export function walletView<D extends DeclaredDividend>(
  snapshot: HoldingsSnapshot,
  declaredByToken: Record<string, D[]>,
): WalletView<D> {
  const lines: WalletLine<D>[] = snapshot.holdings.map((holding) => {
    const dividends = (declaredByToken[holding.token.toLowerCase()] ?? []).map((declared) => ({
      ...declared,
      owed: owedWad(declared.rate, holding.underlyingShares),
    }))
    const owedDue = dividends.filter((d) => d.due).reduce((sum, d) => sum + d.owed, 0n)
    return { holding, dividends, owedDue }
  })
  lines.sort((a, b) =>
    a.owedDue !== b.owedDue
      ? a.owedDue > b.owedDue
        ? -1
        : 1
      : a.holding.underlyingShares > b.holding.underlyingShares
        ? -1
        : a.holding.underlyingShares < b.holding.underlyingShares
          ? 1
          : 0,
  )
  const totalDue = lines.reduce((sum, line) => sum + line.owedDue, 0n)
  const totalUpcoming = lines.reduce(
    (sum, line) => sum + line.dividends.filter((d) => !d.due).reduce((s, d) => s + d.owed, 0n),
    0n,
  )
  return { lines, totalDue, totalUpcoming }
}

// ---------------------------------------------------------------------------
// History: what past multiplier steps delivered to one address.
//
// The balance an address held when a step took effect is not readable from
// state (the public node keeps no archive), so it is rebuilt from the
// address's own Transfer logs: entries minus exits, per token, up to the
// block the step took effect. The browser walks the chain in ranges through
// a planner that halves a range the node times out on and gives up, saying
// so, past a request budget: a person's wallet takes ~22 requests, a bot's
// never finishes, and a partial total must never be shown.
// ---------------------------------------------------------------------------

/** keccak256("Transfer(address,address,uint256)"); shared by ERC-20 and ERC-721, hence the topic-count check below. */
export const TRANSFER_TOPIC: Hex = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export interface RpcLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  logIndex: string
}

export interface Transfer {
  token: string
  from: string
  to: string
  value: bigint
  blockNumber: number
  logIndex: number
}

export const addressTopic = (address: string): Hex => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
const blockHex = (n: number): Hex => `0x${n.toString(16)}`

/** The `eth_getLogs` filter for one side of a wallet's transfers over a block range. */
export function transferFilter(
  tokens: readonly string[],
  wallet: string,
  side: 'from' | 'to',
  fromBlock: number,
  toBlock: number,
): { fromBlock: Hex; toBlock: Hex; address: string[]; topics: (Hex | null)[] } {
  if (!isAddress(wallet)) throw new Error(`history: not an address: ${wallet}`)
  return {
    fromBlock: blockHex(fromBlock),
    toBlock: blockHex(toBlock),
    address: tokens.map((token) => token.toLowerCase()),
    topics: side === 'from' ? [TRANSFER_TOPIC, addressTopic(wallet)] : [TRANSFER_TOPIC, null, addressTopic(wallet)],
  }
}

/** An ERC-20 Transfer, or null for anything else: ERC-721 emits the same topic0 with four topics and no data. */
export function decodeTransferLog(log: RpcLog): Transfer | null {
  if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return null
  if (log.data.length !== 66) return null
  return {
    token: log.address.toLowerCase(),
    from: `0x${log.topics[1]!.slice(26).toLowerCase()}`,
    to: `0x${log.topics[2]!.slice(26).toLowerCase()}`,
    value: BigInt(log.data),
    blockNumber: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
  }
}

/** A wallet paying itself is in both the `from` and the `to` answer; a retried range can repeat a log. One log, once. */
export function dedupeTransfers(transfers: readonly Transfer[]): Transfer[] {
  const seen = new Set<string>()
  const out: Transfer[] = []
  for (const t of transfers) {
    const key = `${t.blockNumber}:${t.logIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

export interface Checkpoint {
  token: string
  block: number
}

export const checkpointKey = (token: string, block: number) => `${token.toLowerCase()}:${block}`

/**
 * The wallet's raw balance in each token after every transfer in blocks
 * strictly before the checkpoint block: the balance the step applied to.
 * Transfers in the effective block itself already ran under the new
 * multiplier, so they are excluded.
 */
export function balancesAt(transfers: readonly Transfer[], wallet: string, checkpoints: readonly Checkpoint[]): Map<string, bigint> {
  const me = wallet.toLowerCase()
  const byToken = new Map<string, Transfer[]>()
  for (const t of dedupeTransfers(transfers)) {
    const list = byToken.get(t.token) ?? []
    list.push(t)
    byToken.set(t.token, list)
  }
  const out = new Map<string, bigint>()
  for (const cp of checkpoints) {
    const token = cp.token.toLowerCase()
    let balance = 0n
    for (const t of byToken.get(token) ?? []) {
      if (t.blockNumber >= cp.block) continue
      if (t.to === me) balance += t.value
      if (t.from === me) balance -= t.value
    }
    out.set(checkpointKey(token, cp.block), balance)
  }
  return out
}

export interface StepRecord {
  token: string
  effectiveAt: string
  effectiveBlock: number
  /** WAD, as decimal strings so the record survives JSON. */
  oldMultiplier: string
  newMultiplier: string
  /** The issuer's declared rate per share, when the step has a declaration. */
  rate: string | null
  /** Dollars per share the step delivered, priced at effect: only on a matched reconciliation. */
  receivedPerShare: string | null
  /** The share of the declared amount that never arrived, only on a matched reconciliation. */
  haircutBps: number | null
  status: 'matched' | 'anomaly' | 'unmatched' | 'pending'
  hasFeed: boolean
}

export interface StepExposure {
  step: StepRecord
  /** Raw balance when the step took effect. */
  rawAtEffect: bigint
  /** Underlying shares those tokens represented just before the step, WAD. */
  sharesBefore: bigint
  /** Shares the step added: exact, on chain, price-free. */
  sharesGained: bigint
  /** rate × sharesBefore, WAD dollars; null without a declaration. */
  declared: bigint | null
  /** receivedPerShare × sharesBefore, WAD dollars; null unless the step reconciled. */
  arrived: bigint | null
}

export interface WalletHistory {
  exposures: StepExposure[]
  totalSharesGained: bigint
  /** Over the exposures that reconciled: what was declared for this holding and what arrived. */
  measured: { count: number; declared: bigint; arrived: bigint }
}

/** Joins the balances at each step with the step records; steps the wallet held nothing at are left out. */
export function walletHistory(balances: ReadonlyMap<string, bigint>, steps: readonly StepRecord[]): WalletHistory {
  const exposures: StepExposure[] = []
  for (const step of steps) {
    const raw = balances.get(checkpointKey(step.token, step.effectiveBlock)) ?? 0n
    if (raw <= 0n) continue
    const oldM = BigInt(step.oldMultiplier)
    const newM = BigInt(step.newMultiplier)
    const sharesBefore = (raw * oldM) / WAD
    const sharesGained = (raw * (newM - oldM)) / WAD
    const declared = step.rate ? (parseDecimalWad(step.rate) * sharesBefore) / WAD : null
    const arrived =
      step.status === 'matched' && step.receivedPerShare ? (parseDecimalWad(step.receivedPerShare) * sharesBefore) / WAD : null
    exposures.push({ step, rawAtEffect: raw, sharesBefore, sharesGained, declared, arrived })
  }
  exposures.sort((a, b) => b.step.effectiveAt.localeCompare(a.step.effectiveAt))
  const measured = exposures.filter((e) => e.declared !== null && e.arrived !== null)
  return {
    exposures,
    totalSharesGained: exposures.reduce((sum, e) => sum + e.sharesGained, 0n),
    measured: {
      count: measured.length,
      declared: measured.reduce((sum, e) => sum + e.declared!, 0n),
      arrived: measured.reduce((sum, e) => sum + e.arrived!, 0n),
    },
  }
}

// --- the range planner ------------------------------------------------------

export interface ScanJob {
  side: 'from' | 'to'
  fromBlock: number
  toBlock: number
}

export interface ScanOptions {
  fromBlock: number
  toBlock: number
  /** Blocks per request to start with; 5 M answers in under a second for a person's wallet. */
  rangeSize?: number
  /** A range the node still times out on at this size means the wallet is too active to rebuild here. */
  minRange?: number
  /** Total requests, retries included, before giving up. */
  maxRequests?: number
}

/**
 * Hands out one `eth_getLogs` job at a time and takes the outcome back:
 * done, timed out (the range is halved), or rejected (the same range comes
 * back). Pure bookkeeping, so the budget and the halving are testable
 * without a network.
 */
export class RangeScanner {
  readonly #pending: ScanJob[] = []
  readonly #minRange: number
  readonly #maxRequests: number
  #requests = 0
  #exhausted = false
  #total: number

  constructor(options: ScanOptions) {
    const size = options.rangeSize ?? 5_000_000
    this.#minRange = options.minRange ?? 250_000
    this.#maxRequests = options.maxRequests ?? 40
    if (options.toBlock < options.fromBlock) throw new Error('history: empty scan')
    for (let from = options.fromBlock; from <= options.toBlock; from += size) {
      const to = Math.min(from + size - 1, options.toBlock)
      this.#pending.push({ side: 'from', fromBlock: from, toBlock: to }, { side: 'to', fromBlock: from, toBlock: to })
    }
    this.#total = this.#pending.length
  }

  /** The next job, or null when every range is done or the budget is spent. */
  next(): ScanJob | null {
    if (this.#exhausted || this.#pending.length === 0) return null
    if (this.#requests >= this.#maxRequests) {
      this.#exhausted = true
      return null
    }
    this.#requests++
    return this.#pending.pop()!
  }

  done(_job: ScanJob): void {}

  /** The node timed out: try each half, unless the range is already the floor, which means giving up. */
  timedOut(job: ScanJob): void {
    const span = job.toBlock - job.fromBlock + 1
    if (span <= this.#minRange) {
      this.#exhausted = true
      return
    }
    const mid = job.fromBlock + Math.floor(span / 2)
    this.#pending.push({ ...job, fromBlock: mid, toBlock: job.toBlock }, { ...job, fromBlock: job.fromBlock, toBlock: mid - 1 })
    this.#total++
  }

  /** Rate limited: the same job again, later. */
  rejected(job: ScanJob): void {
    this.#pending.push(job)
  }

  get requests(): number {
    return this.#requests
  }
  get remaining(): number {
    return this.#pending.length
  }
  get total(): number {
    return this.#total
  }
  get exhausted(): boolean {
    return this.#exhausted
  }
  get finished(): boolean {
    return !this.#exhausted && this.#pending.length === 0
  }
}
