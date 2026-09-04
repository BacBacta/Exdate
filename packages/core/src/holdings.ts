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

/**
 * The same balances, read from an archive node instead of rebuilt from logs.
 *
 * `balancesAt` replays the wallet's own `Transfer` logs because Robinhood's
 * endpoint keeps no archive: `eth_call` a few thousand blocks back answers
 * `metadata is not found`. That replay costs up to forty `eth_getLogs` requests
 * and is REFUSED past that, so a busy address gets no history at all - a
 * documented limitation of /wallet/.
 *
 * Other public endpoints for this chain do serve state at any height
 * (data/rpc-endpoints.observed.json, where two agree fifty million blocks deep),
 * and one of them also answers browsers. Against such a node the same answer is
 * one `eth_call` per distinct block: twelve requests for the whole history, the
 * same number for a wallet with three transfers and one with three thousand,
 * and exact rather than reconstructed.
 *
 * The cost is not technical and is stated on the page rather than hidden: the
 * replay only ever shows the address to Robinhood's own node, and this path
 * shows it to a third party. So the caller chooses, and `planBalanceReads`
 * exists to make the archive path cheap enough that the choice is real.
 */
export interface BalanceRead {
  block: number
  tokens: string[]
}

/**
 * One read per distinct block, carrying only the tokens that block needs. The
 * twelve steps span ten tokens, so this is twelve calls rather than one per
 * (token, block) pair.
 */
export function planBalanceReads(checkpoints: readonly Checkpoint[]): BalanceRead[] {
  const byBlock = new Map<number, Set<string>>()
  for (const cp of checkpoints) {
    const set = byBlock.get(cp.block) ?? new Set<string>()
    set.add(cp.token.toLowerCase())
    byBlock.set(cp.block, set)
  }
  return [...byBlock.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([block, tokens]) => ({ block, tokens: [...tokens].sort() }))
}

/**
 * Calldata for one `aggregate3` carrying `balanceOf(holder)` for each token.
 * Sent with a block tag rather than `latest`, which is the whole point: the
 * balance the step applied to is the balance one block BEFORE it took effect,
 * since a transfer in the effective block already ran under the new multiplier.
 */
export function encodeBalancesCall(multicall3: string, tokens: readonly string[], holder: string): Hex {
  if (!isAddress(holder)) throw new Error(`holdings: not an address: ${holder}`)
  const holderWord = addressWord(holder)
  const calls: Call[] = tokens.map((token) => ({ target: token, callData: HOLDINGS_SELECTOR.balanceOf + holderWord }))
  const tuples = calls.map(encodeTuple)
  const offsets: string[] = []
  let offset = BigInt(calls.length * 32)
  for (const tuple of tuples) {
    offsets.push(word(offset))
    offset += BigInt(tuple.length / 2)
  }
  return `0x${HOLDINGS_SELECTOR.aggregate3.slice(2)}${word(0x20n)}${word(BigInt(calls.length))}${offsets.join('')}${tuples.join('')}`
}

/**
 * Decodes one such read into checkpoint-keyed balances, so the result drops
 * straight into whatever `balancesAt` fed. A token whose sub-call reverted is
 * ABSENT rather than zero: at an early block a token may not have existed yet,
 * and zero would read as "held nothing" instead of "could not be read".
 */
export function decodeBalancesAt(read: BalanceRead, result: string): Map<string, bigint> {
  const results = decodeAggregate3(result)
  if (results.length !== read.tokens.length) throw new Error('holdings: balance read returned the wrong number of sub-calls')
  const out = new Map<string, bigint>()
  read.tokens.forEach((token, index) => {
    const entry = results[index]!
    if (!entry.success || entry.returnData === '0x') return
    out.set(checkpointKey(token, read.block), BigInt(entry.returnData))
  })
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


// ---------------------------------------------------------------------------
// A holder's own record of what past multiplier steps delivered to them.
//
// The wallet page works this out already and shows it on screen. On screen it cannot be
// handed to an accountant, reconciled against a broker statement, or kept. This turns
// the same figures into rows and a CSV, with no I/O and no rounding decisions hidden
// inside a template.
//
// It lives here rather than in its own file for the reason the top of this module gives:
// Turbopack does not follow the `.js` specifiers the rest of core uses, so anything the
// wallet page bundles has to import nothing.
//
// What it is not: a tax return. exdate values a distribution at the underlying price it
// measured at the instant the step took effect, which is a measurement and not any tax
// authority's prescribed method, and it says so on every export. A row exdate could not
// price carries no dollar figure at all rather than a zero.
// ---------------------------------------------------------------------------

export interface StatementRow {
  /** When the multiplier change took effect, ISO. */
  effectiveAt: string
  symbol: string
  name: string
  token: string
  /** Underlying shares the address held when the step took effect. */
  sharesHeld: string
  /** Shares the step added. Exact, on chain, no price involved. */
  sharesGained: string
  /** The issuer's declared amount per underlying share, or null where none survives. */
  declaredPerShare: string | null
  /** rate x shares held. */
  declaredTotal: string | null
  /** What the step actually delivered per share, at the price in force. */
  arrivedPerShare: string | null
  arrivedTotal: string | null
  /** The share of the declared amount that did not arrive, as a percentage. */
  shortfallPercent: string | null
  /** Why a figure is missing, in words, so a blank is never mistaken for a zero. */
  basis: string
}

export interface StatementMeta {
  /** Names and symbols by lowercase address; a step record carries only the address. */
  name(token: string): { symbol: string; name: string }
}

const SHARE_PLACES = 8
/** Micro-dollars. A dividend on a fraction of a share is genuinely worth thousandths of a cent. */
const MONEY_PLACES = 6

/**
 * Formats a WAD value so that a non-zero amount never prints as zero.
 *
 * A statement is read as a record of what happened. "0.00" against a holding that did
 * receive something says the opposite of the truth, and in an accounting context that
 * is the worst possible rounding. So a value that would round away falls back to full
 * precision: exact, ugly, and machine-readable, which is what a CSV is for.
 */
function exact(value: bigint, places: number): string {
  const rounded = formatWad(value, places)
  if (value !== 0n && /^0\.?0*$/.test(rounded)) return formatWad(value, 18)
  return rounded
}

/**
 * Why a row has the dollar figures it has, or has none. Carried on every row because a
 * statement is read months later, by someone who was not here when it was made.
 */
function basisFor(exposure: StepExposure): string {
  if (exposure.declared !== null && exposure.arrived !== null) {
    return 'declared by the issuer; arrived valued at the underlying price exdate measured when the step took effect'
  }
  if (exposure.declared !== null) {
    return exposure.step.hasFeed
      ? 'declared by the issuer; the observed step does not reconcile against the price, so no arrived value is claimed'
      : 'declared by the issuer; no price feed for this token, so no arrived value is claimed'
  }
  return "no declaration survives for this step: the issuer's feed keeps about a month, so the amount is unrecoverable"
}

/** Rows for one address, newest first, one per step it was exposed to. */
export function buildDividendStatement(exposures: readonly StepExposure[], meta: StatementMeta): StatementRow[] {
  return exposures.map((exposure) => {
    const { symbol, name } = meta.name(exposure.step.token.toLowerCase())
    const shortfall =
      exposure.declared !== null && exposure.arrived !== null && exposure.declared > 0n
        ? formatWad(((exposure.declared - exposure.arrived) * 100n * 10n ** 18n) / exposure.declared, 2, true)
        : null
    return {
      effectiveAt: exposure.step.effectiveAt,
      symbol,
      name,
      token: exposure.step.token,
      sharesHeld: exact(exposure.sharesBefore, SHARE_PLACES),
      sharesGained: exact(exposure.sharesGained, SHARE_PLACES),
      declaredPerShare: exposure.step.rate ?? null,
      declaredTotal: exposure.declared === null ? null : exact(exposure.declared, MONEY_PLACES),
      arrivedPerShare: exposure.step.receivedPerShare ?? null,
      arrivedTotal: exposure.arrived === null ? null : exact(exposure.arrived, MONEY_PLACES),
      shortfallPercent: shortfall,
      basis: basisFor(exposure),
    }
  })
}

/**
 * RFC 4180 escaping. A field is quoted only when it has to be - a comma, a quote, or a
 * line break - and an inner quote is doubled. Token names carry commas and periods, and
 * a naive join would silently shift every later column of that row.
 */
export function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export const STATEMENT_COLUMNS: { key: keyof StatementRow; header: string }[] = [
  { key: 'effectiveAt', header: 'effective_at' },
  { key: 'symbol', header: 'symbol' },
  { key: 'name', header: 'name' },
  { key: 'token', header: 'token_address' },
  { key: 'sharesHeld', header: 'shares_held' },
  { key: 'sharesGained', header: 'shares_gained' },
  { key: 'declaredPerShare', header: 'declared_per_share_usd' },
  { key: 'declaredTotal', header: 'declared_total_usd' },
  { key: 'arrivedPerShare', header: 'arrived_per_share_usd' },
  { key: 'arrivedTotal', header: 'arrived_total_usd' },
  { key: 'shortfallPercent', header: 'shortfall_percent' },
  { key: 'basis', header: 'basis' },
]

/** CRLF line endings, which is what RFC 4180 says and what a spreadsheet expects. */
export function statementToCsv(rows: readonly StatementRow[]): string {
  const header = STATEMENT_COLUMNS.map((column) => column.header).join(',')
  const body = rows.map((row) => STATEMENT_COLUMNS.map((column) => csvField(row[column.key])).join(','))
  return [header, ...body].join('\r\n') + '\r\n'
}

/** `exdate-dividends-0x8601…f58b1-2026-09-04.csv`: sortable, and it names the address it describes. */
export function statementFilename(address: string, observedAt: string): string {
  const short = `${address.slice(0, 6)}${address.slice(-5)}`.toLowerCase()
  return `exdate-dividends-${short}-${observedAt.slice(0, 10)}.csv`
}
