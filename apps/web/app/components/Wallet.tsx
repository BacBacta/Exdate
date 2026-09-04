'use client'

import { useEffect, useRef, useState } from 'react'
import {
  RangeScanner,
  balancesAt,
  checkpointKey,
  decodeHoldings,
  decodeTransferLog,
  encodeHoldingsCall,
  formatWad,
  isAddress,
  transferFilter,
  walletHistory,
  walletView,
  type BlockNumberSource,
  type DeclaredDividend,
  type HoldingsSnapshot,
  type ScanJob,
  type StepRecord,
  type Transfer,
  type WalletHistory,
  buildDividendStatement,
  statementFilename,
  statementToCsv,
} from '@exdate/core/holdings'
import { dateLong, pctInt } from '../../lib/format'
import { LedgerHead } from './Chrome'
import type { CalendarGroup, TokenSummary } from '../../lib/observed'

/**
 * A visitor pastes an address (or lets their wallet share it: a connection
 * prompt, never a signature) and their own browser asks Robinhood Chain what
 * that address holds: one eth_call to Multicall3 covering all 194 tokens.
 * There is no server in between, so nothing about the address reaches exdate.
 *
 * What is shown is what the chain answers at one block, dated by that block,
 * joined with the committed record of declared dividends. The "owed" figures
 * are rate x shares: the issuer's number times the chain's, no price.
 */

export interface WalletDeclared extends DeclaredDividend {
  group: CalendarGroup
}

export interface WalletStep extends StepRecord {
  symbol: string
  name: string
  processDate: string | null
}

interface Props {
  tokens: TokenSummary[]
  declaredByToken: Record<string, WalletDeclared[]>
  rpcUrl: string
  multicall3: string
  blockNumberSource?: BlockNumberSource
  steps: WalletStep[]
  scan: { fromBlock: number; toBlock: number; tokens: string[] }
}

/**
 * Step 2, the history: what past multiplier steps delivered to this address.
 * The balance at each step is rebuilt from the address's own transfers in
 * the tokens that ever moved, read in ranges through the core's planner.
 * The twelve rebuilt balances are kept in this browser so a second visit
 * costs nothing; they cannot go stale, since a past block never changes.
 */
type HistoryPhase =
  | { kind: 'idle' }
  | { kind: 'reading'; requests: number; remaining: number }
  | { kind: 'done'; history: WalletHistory; requests: number; cached: boolean }
  | { kind: 'refused'; requests: number }
  | { kind: 'error'; message: string }

type LogsOutcome = { kind: 'ok'; transfers: Transfer[] } | { kind: 'timeout' } | { kind: 'rejected' } | { kind: 'error'; message: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading'; address: string }
  | { kind: 'done'; address: string; snapshot: HoldingsSnapshot }
  | { kind: 'error'; address: string; message: string }

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

const RETRIES = 4
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** "12345.6789" with the whole part grouped, the way a person reads a balance. */
const grouped = (value: string) => {
  const [whole, fraction] = value.split('.')
  const head = BigInt(whole!).toLocaleString('en-US')
  return fraction ? `${head}.${fraction}` : head
}
/** Four places; dust that rounds to nothing is said to be dust, never "0". */
const amount = (wad: bigint) => {
  const text = formatWad(wad, 4)
  return text === '0' && wad > 0n ? '< 0.0001' : grouped(text)
}
const dollars = (wad: bigint) => `$${grouped(formatWad(wad, 2, true))}`
/** Below half a cent: a percentage of nothing is not a measurement. */
const underACent = (wad: bigint) => wad < 5n * 10n ** 15n
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
const blockTime = (seconds: bigint) =>
  `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Number(seconds) * 1000),
  )} UTC`

const groupWords: Record<CalendarGroup, string> = {
  paid_not_on_chain: 'issuer says paid, not on chain',
  overdue: 'past the usual window, not on chain',
  awaiting: 'due now',
  upcoming: 'not due yet',
}

export function Wallet({ tokens, declaredByToken, rpcUrl, multicall3, blockNumberSource, steps, scan }: Props) {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [history, setHistory] = useState<HistoryPhase>({ kind: 'idle' })
  const [hasWallet, setHasWallet] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const request = useRef(0)

  // Only after mount: the server does not know whether a wallet is installed.
  useEffect(() => {
    setHasWallet(typeof window !== 'undefined' && Boolean(window.ethereum))
  }, [])

  const addresses = tokens.map((token) => token.address)
  const byAddress = new Map(tokens.map((token) => [token.address.toLowerCase(), token]))

  async function fetchHoldings(address: string): Promise<HoldingsSnapshot> {
    const data = encodeHoldingsCall(multicall3, addresses, address, blockNumberSource)
    let lastError = 'no answer'
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (attempt > 0) await sleep(400 * 2 ** attempt)
      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: multicall3, data }, 'latest'] }),
        })
        if (response.status === 429) {
          lastError = 'the node is rate limiting'
          continue
        }
        const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
        if (body.error) {
          lastError = body.error.message ?? 'the node returned an error'
          if (/rate|too many|limit/i.test(lastError)) continue
          throw new Error(lastError)
        }
        if (typeof body.result !== 'string') throw new Error('the node returned no data')
        return decodeHoldings(body.result, addresses)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    throw new Error(lastError)
  }

  const checkpoints = steps.map((step) => ({ token: step.token, block: step.effectiveBlock }))
  const cacheKey = (address: string) => `exdate.history.v1.${address.toLowerCase()}.${scan.toBlock}.${steps.length}`

  async function getLogs(address: string, job: ScanJob): Promise<LogsOutcome> {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getLogs',
          params: [transferFilter(scan.tokens, address, job.side, job.fromBlock, job.toBlock)],
        }),
      })
      if (response.status === 429) return { kind: 'rejected' }
      const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
      if (body.error) {
        const message = body.error.message ?? 'the node returned an error'
        // the node's "too much" answers first: "exceeds limit of 10000" would otherwise read as a rate limit
        if (/timed out|exceeds limit|more than|too many results|response size/i.test(message)) return { kind: 'timeout' }
        if (/rate|too many|limit/i.test(message)) return { kind: 'rejected' }
        return { kind: 'error', message }
      }
      if (!Array.isArray(body.result)) return { kind: 'error', message: 'the node returned no logs' }
      const transfers: Transfer[] = []
      for (const log of body.result as Parameters<typeof decodeTransferLog>[0][]) {
        const transfer = decodeTransferLog(log)
        if (transfer) transfers.push(transfer)
      }
      return { kind: 'ok', transfers }
    } catch {
      return { kind: 'rejected' }
    }
  }

  async function readHistory(address: string, id: number) {
    const stale = () => id !== request.current
    try {
      const cached = localStorage.getItem(cacheKey(address))
      if (cached) {
        const parsed = JSON.parse(cached) as { balances: Record<string, string> }
        const balances = new Map(Object.entries(parsed.balances).map(([key, value]) => [key, BigInt(value)]))
        if (!stale()) setHistory({ kind: 'done', history: walletHistory(balances, steps), requests: 0, cached: true })
        return
      }
    } catch {
      // no storage, or an unreadable entry: read the chain
    }
    const scanner = new RangeScanner({ fromBlock: scan.fromBlock, toBlock: scan.toBlock })
    const transfers: Transfer[] = []
    for (let job = scanner.next(); job; job = scanner.next()) {
      if (stale()) return
      setHistory({ kind: 'reading', requests: scanner.requests, remaining: scanner.remaining })
      const outcome = await getLogs(address, job)
      if (outcome.kind === 'ok') {
        transfers.push(...outcome.transfers)
        scanner.done(job)
      } else if (outcome.kind === 'timeout') {
        scanner.timedOut(job)
      } else if (outcome.kind === 'rejected') {
        scanner.rejected(job)
        await sleep(600)
      } else {
        if (!stale()) setHistory({ kind: 'error', message: outcome.message })
        return
      }
    }
    if (stale()) return
    if (scanner.exhausted) {
      setHistory({ kind: 'refused', requests: scanner.requests })
      return
    }
    const balances = balancesAt(transfers, address, checkpoints)
    try {
      localStorage.setItem(
        cacheKey(address),
        JSON.stringify({ balances: Object.fromEntries([...balances].map(([key, value]) => [key, value.toString()])) }),
      )
    } catch {
      // storage refused: the read still shows
    }
    setHistory({ kind: 'done', history: walletHistory(balances, steps), requests: scanner.requests, cached: false })
  }

  async function read(raw: string) {
    const address = raw.trim()
    setNote(null)
    if (!isAddress(address)) {
      setNote('That is not an address: expected 0x followed by 40 hexadecimal characters.')
      return
    }
    const id = ++request.current
    setPhase({ kind: 'reading', address })
    setHistory({ kind: 'idle' })
    try {
      const snapshot = await fetchHoldings(address)
      if (id !== request.current) return
      setPhase({ kind: 'done', address, snapshot })
      void readHistory(address, id)
    } catch (error) {
      if (id === request.current) setPhase({ kind: 'error', address, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function useWallet() {
    setNote(null)
    try {
      const accounts = (await window.ethereum!.request({ method: 'eth_requestAccounts' })) as string[]
      const address = accounts[0]
      if (!address) {
        setNote('The wallet shared no address.')
        return
      }
      setInput(address)
      await read(address)
    } catch {
      setNote('The wallet did not share an address. You can paste one instead.')
    }
  }

  const reading = phase.kind === 'reading'

  return (
    <div className="wallet">
      <form
        className="finder wallet-form"
        onSubmit={(event) => {
          event.preventDefault()
          void read(input)
        }}
      >
        <label className="finder-label" htmlFor="wallet-input">
          Your wallet address
        </label>
        <div className="finder-row">
          <input
            id="wallet-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="0x…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-describedby="wallet-hint"
          />
          <button className="btn" type="submit" disabled={reading}>
            {reading ? 'Reading…' : 'Read'}
          </button>
          {hasWallet ? (
            <button className="btn ghost" type="button" onClick={() => void useWallet()} disabled={reading}>
              Use my wallet
            </button>
          ) : null}
        </div>
        <p className="finder-hint" id="wallet-hint">
          Read in your browser, straight from Robinhood Chain&rsquo;s public node. No signature. exdate has no
          server, so the address goes nowhere else.
        </p>
        {note ? (
          <p className="wallet-status err" role="status">
            {note}
          </p>
        ) : null}
      </form>

      <div aria-live="polite">
        {phase.kind === 'reading' ? (
          <p className="wallet-status">Reading {tokens.length} tokens for {short(phase.address)}…</p>
        ) : null}

        {phase.kind === 'error' ? (
          <p className="wallet-status err">
            Robinhood Chain did not answer ({phase.message}).{' '}
            <button className="linklike" type="button" onClick={() => void read(phase.address)}>
              Try again
            </button>
          </p>
        ) : null}

        {phase.kind === 'done' ? <Result address={phase.address} snapshot={phase.snapshot} /> : null}
      </div>
    </div>
  )

  function Result({ address, snapshot }: { address: string; snapshot: HoldingsSnapshot }) {
    const view = walletView(snapshot, declaredByToken)
    const count = view.lines.length
    return (
      <div className="wallet-result">
        <div className="wallet-head">
          <div>
            <p className="wallet-count">
              {count === 0 ? 'No Robinhood Stock Token at this address' : `${count} Stock Token${count === 1 ? '' : 's'} held`}
            </p>
            <p className="wallet-meta">
              {short(address)} · block {snapshot.blockNumber.toLocaleString('en-US')} · {blockTime(snapshot.timestamp)}
            </p>
          </div>
          {count > 0 ? (
            <div className="wallet-total">
              {view.totalDue > 0n ? (
                <>
                  <div className="v">{dollars(view.totalDue)}</div>
                  <div className="k">declared, due, and not yet on chain</div>
                </>
              ) : view.totalUpcoming > 0n ? (
                <>
                  <div className="v">{dollars(view.totalUpcoming)}</div>
                  <div className="k">declared for the coming weeks; nothing due yet</div>
                </>
              ) : (
                <div className="k">no dividend declared and unpaid on these tokens</div>
              )}
            </div>
          ) : null}
        </div>

        {count > 0 ? (
          <>
          <LedgerHead cols={['Token', 'Tokens', 'Shares represented', 'Declared']} />
          <ul className="ledger">
            {view.lines.map((line) => {
              const token = byAddress.get(line.holding.token.toLowerCase())
              const upcoming = line.dividends.filter((d) => !d.due)
              const state =
                line.owedDue > 0n
                  ? { text: `${dollars(line.owedDue)} owed`, on: true }
                  : upcoming.length > 0
                    ? { text: `${dollars(upcoming.reduce((s, d) => s + d.owed, 0n))} declared for ${dateLong(upcoming[0]!.processDate)}`, on: false }
                    : { text: 'nothing declared', on: false }
              return (
                <li key={line.holding.token}>
                  <div className="who">
                    <a className="name" href={`/t/${line.holding.token.toLowerCase()}/`}>
                      {token?.name ?? line.holding.token}
                    </a>
                    <span className="sym">{token?.symbol ?? short(line.holding.token)}</span>
                  </div>
                  <div className="amt">
                    <span className="k">Tokens</span>
                    <span className="v">{amount(line.holding.raw)}</span>
                  </div>
                  <div className="amt">
                    <span className="k">Shares represented</span>
                    <span className="v">{amount(line.holding.underlyingShares)}</span>
                  </div>
                  <div className="gap">
                    <span className={`state${state.on ? ' on' : ''}`}>{state.text}</span>
                  </div>
                  {line.dividends.length > 0 ? (
                    <details className="row-detail">
                      <summary>Details</summary>
                      <dl>
                        {line.dividends.map((dividend) => (
                          <div className="wide" key={dividend.processDate}>
                            <dt>
                              {dateLong(dividend.processDate)} · {groupWords[dividend.group]}
                            </dt>
                            <dd>
                              ${dividend.rate} per share × {amount(line.holding.underlyingShares)} shares ={' '}
                              {dollars(dividend.owed)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                </li>
              )
            })}
          </ul>
          </>
        ) : null}

        {snapshot.unreadable.length > 0 ? (
          <p className="wallet-status">
            {snapshot.unreadable.length} token{snapshot.unreadable.length === 1 ? '' : 's'} could not be read this
            time and {snapshot.unreadable.length === 1 ? 'is' : 'are'} not counted.
          </p>
        ) : null}

        <History address={address} />
      </div>
    )
  }

  /**
   * The same figures the section shows, as a file. On screen they cannot be handed to
   * an accountant or reconciled against a broker statement. Built in the browser from
   * what is already computed: nothing is sent anywhere, which is the same promise the
   * rest of the page makes.
   */
  function downloadStatement(address: string, computed: WalletHistory, observedAt: string) {
    const named = new Map(steps.map((step) => [step.token.toLowerCase(), { symbol: step.symbol, name: step.name }]))
    const rows = buildDividendStatement(computed.exposures, {
      name: (token) => named.get(token) ?? { symbol: token, name: token },
    })
    const blob = new Blob([statementToCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = statementFilename(address, observedAt)
    link.click()
    URL.revokeObjectURL(url)
  }

  function History({ address }: { address: string }) {
    const stepByKey = new Map(steps.map((step) => [checkpointKey(step.token, step.effectiveBlock), step]))
    return (
      <section className="wallet-history" aria-labelledby="history-title" aria-live="polite">
        <h2 className="small" id="history-title">
          What past dividends delivered
        </h2>
        {history.kind === 'reading' ? (
          <p className="wallet-status">
            Reading this address&rsquo;s transfers in the {scan.tokens.length} tokens that moved… {history.requests} request
            {history.requests === 1 ? '' : 's'}, {history.remaining} to go.
          </p>
        ) : null}
        {history.kind === 'refused' ? (
          <p className="wallet-status err">
            This address has too many transfers to rebuild its history in a browser: stopped after {history.requests}{' '}
            requests rather than show a partial total.
          </p>
        ) : null}
        {history.kind === 'error' ? (
          <p className="wallet-status err">
            Robinhood Chain did not answer while reading history ({history.message}).{' '}
            <button className="linklike" type="button" onClick={() => void readHistory(address, request.current)}>
              Try again
            </button>
          </p>
        ) : null}
        {history.kind === 'done' ? (
          history.history.exposures.length === 0 ? (
            <p className="wallet-status">
              This address held none of the {scan.tokens.length} tokens that moved, at the moment they moved. Tokens
              held inside a protocol at the time are not seen.
            </p>
          ) : (
            <>
              <p className="lead">
                <strong>{amount(history.history.totalSharesGained)} shares gained</strong> across{' '}
                {history.history.exposures.length} dividend{history.history.exposures.length === 1 ? '' : 's'}.
                {history.history.measured.count > 0
                  ? ` On the ${history.history.measured.count === 1 ? 'one' : history.history.measured.count} that reconciled: ${dollars(history.history.measured.declared)} declared for this holding, ${dollars(history.history.measured.arrived)} arrived.`
                  : ' None of them reconciled against a declared amount, so no dollar figure is claimed.'}
              </p>
              <LedgerHead cols={['Dividend', 'Shares held then', 'Shares gained', 'Arrived']} />
              <ul className="ledger">
                {history.history.exposures.map((exposure) => {
                  const step = stepByKey.get(checkpointKey(exposure.step.token, exposure.step.effectiveBlock))!
                  const state =
                    exposure.declared !== null && underACent(exposure.declared)
                      ? { text: 'under a cent declared', sub: null, on: false }
                      : exposure.arrived !== null && exposure.declared !== null
                        ? { text: `${dollars(exposure.arrived)} of ${dollars(exposure.declared)}`, sub: `${pctInt(step.haircutBps)}% never arrived`, on: true }
                        : step.status === 'anomaly'
                          ? { text: step.hasFeed ? 'doesn’t add up' : 'no price feed', sub: exposure.declared !== null ? `${dollars(exposure.declared)} declared` : null, on: false }
                          : { text: 'nothing declared', sub: null, on: false }
                  return (
                    <li key={checkpointKey(step.token, step.effectiveBlock)}>
                      <div className="who">
                        <a className="name" href={`/t/${step.token}/`}>
                          {step.name}
                        </a>
                        <span className="sym">
                          {step.symbol} · {dateLong(step.effectiveAt)}
                        </span>
                      </div>
                      <div className="amt">
                        <span className="k">Shares held then</span>
                        <span className="v">{amount(exposure.sharesBefore)}</span>
                      </div>
                      <div className="amt">
                        <span className="k">Shares gained</span>
                        <span className="v">{amount(exposure.sharesGained)}</span>
                      </div>
                      <div className="gap">
                        <span className={`state${state.on ? ' on' : ''}`}>
                          {state.text}
                          {state.sub ? <span className="sub">{state.sub}</span> : null}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="wallet-actions">
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => downloadStatement(address, history.history, new Date().toISOString())}
                >
                  Download as CSV
                </button>
                <span>
                  One row per dividend, with the shares held, what was declared and what arrived. A
                  figure exdate could not measure is left empty rather than written as zero, and each
                  row carries why. It values a distribution at the price measured when the step took
                  effect, which is a measurement and not any tax authority&rsquo;s method.
                </span>
              </p>
              <p className="wallet-status">
                Shares held then is this address&rsquo;s balance at the block each change took effect, rebuilt from its
                own transfers{history.cached ? ', remembered by this browser from an earlier read' : `, read in ${history.requests} requests`}.
                Tokens held inside a protocol at the time are not seen. Dollar figures use the price and the gap
                measured on each token&rsquo;s page.
              </p>
            </>
          )
        ) : null}
      </section>
    )
  }
}
