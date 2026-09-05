// Robinhood publishes the canonical Stock Token list at api.robinhood.com/rhj/assets.
// docs.robinhood.com/chain/contracts renders its own table from that same endpoint,
// which makes it the authoritative address source - not a third-party list.

import { readFile, writeFile } from 'node:fs/promises'

export const REGISTRY_URL = 'https://api.robinhood.com/rhj/assets'
export const SNAPSHOT_PATH = new URL('../../data/robinhood-assets.snapshot.json', import.meta.url)

export async function fetchRegistry() {
  const res = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`registry: HTTP ${res.status}`)
  return res.json()
}

export async function loadSnapshot() {
  return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'))
}

export async function writeSnapshot(payload) {
  // `fetchedAt` first, so the file says when it was read from the issuer. The
  // generated registry copies it rather than stamping its own run: regenerating
  // from unchanged data must produce an unchanged file, or CI cannot tell drift
  // from a rebuild.
  //
  // Unchanged content is left alone entirely, timestamp included, which is what
  // lets this run on a schedule at all: the registry moves only when the issuer
  // moves something, and re-stamping a date daily would rewrite the file - and
  // through REGISTRY_GENERATED_AT the generated module too - to say nothing. The
  // 2026-09-05 audit found the opposite failure, a snapshot three days behind two
  // real multiplier changes because nothing refreshed it (F12); this makes a daily
  // refresh free, so there is no reason not to schedule one.
  let previous = null
  try {
    previous = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'))
  } catch {
    // No snapshot yet is not a reason to refuse to write the first one.
  }
  if (previous) {
    const { fetchedAt, ...content } = previous
    if (JSON.stringify(content) === JSON.stringify(payload)) return { written: false, fetchedAt }
  }
  const fetchedAt = new Date().toISOString()
  await writeFile(SNAPSHOT_PATH, JSON.stringify({ fetchedAt, ...payload }, null, 2) + '\n')
  return { written: true, fetchedAt }
}

/** Flatten the registry into one row per (asset, deployment). */
export function toRows(payload) {
  const rows = []
  for (const asset of payload.assets ?? []) {
    for (const deployment of asset.deployments ?? []) {
      rows.push({
        address: deployment.contractAddress,
        chainId: deployment.chainId,
        networkName: deployment.networkName,
        symbol: asset.tokenSymbol,
        name: asset.tokenName,
        decimals: asset.tokenDecimals,
        isin: asset.isin,
        status: asset.status,
        currentMultiplier: asset.currentMultiplier,
        pendingMultiplier: asset.pendingMultiplier,
      })
    }
  }
  return rows
}
