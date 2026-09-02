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
  await writeFile(SNAPSHOT_PATH, JSON.stringify(payload, null, 2) + '\n')
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
