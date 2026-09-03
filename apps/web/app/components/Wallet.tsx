'use client'

import { useEffect, useRef, useState } from 'react'
import {
  decodeHoldings,
  encodeHoldingsCall,
  formatWad,
  isAddress,
  walletView,
  type BlockNumberSource,
  type DeclaredDividend,
  type HoldingsSnapshot,
} from '@exdate/core/holdings'
import { dateLong } from '../../lib/format'
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

interface Props {
  tokens: TokenSummary[]
  declaredByToken: Record<string, WalletDeclared[]>
  rpcUrl: string
  multicall3: string
  blockNumberSource?: BlockNumberSource
}

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

export function Wallet({ tokens, declaredByToken, rpcUrl, multicall3, blockNumberSource }: Props) {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
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

  async function read(raw: string) {
    const address = raw.trim()
    setNote(null)
    if (!isAddress(address)) {
      setNote('That is not an address: expected 0x followed by 40 hexadecimal characters.')
      return
    }
    const id = ++request.current
    setPhase({ kind: 'reading', address })
    try {
      const snapshot = await fetchHoldings(address)
      if (id === request.current) setPhase({ kind: 'done', address, snapshot })
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
      </div>
    )
  }
}
