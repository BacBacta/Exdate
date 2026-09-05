'use client'

import { useState } from 'react'

/**
 * The contract address, shown short and copied whole. Copying the address is
 * the first thing anyone does on a token page - to a wallet, an explorer, a
 * search box - and on a phone a 40-character string wrapped over two lines
 * with no button is the worst way to offer it. The full, checksummed form is
 * what goes to the clipboard and what assistive technology reads; the eye
 * gets `0x92FD…9B5`.
 */
export function CopyAddress({ address, href }: { address: string; href?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <span className="addr">
      {href ? (
        <a href={href} rel="noopener" aria-label={`Contract ${address} on the explorer`} title={address}>
          {short}
        </a>
      ) : (
        <span aria-label={`Contract ${address}`} title={address}>
          {short}
        </span>
      )}
      <button className="copy-btn" type="button" onClick={() => void copy()} aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select to copy' : 'Copy'}
      </button>
    </span>
  )
}
