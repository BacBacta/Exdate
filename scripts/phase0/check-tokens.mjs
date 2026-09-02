// Phase 0 - step 2: for every Stock Token in the official registry, confirm the
// contract exists and read the ERC-20 + ERC-8056 views. Pass addresses as args
// to restrict the run, otherwise the whole registry is checked (slow: the public
// RPC is rate limited).
import { rpc, SELECTOR, decodeString } from './rpc.mjs'
import { fetchRegistry, toRows } from './registry.mjs'

const only = process.argv.slice(2).map((a) => a.toLowerCase())
const rows = toRows(await fetchRegistry()).filter(
  (r) => only.length === 0 || only.includes(r.address.toLowerCase()) || only.includes(r.symbol.toLowerCase()),
)

const read = async (address, selector) => {
  try {
    return { ok: true, value: await rpc('eth_call', [{ to: address, data: selector }, 'latest']) }
  } catch (error) {
    return { ok: false, value: String(error.message).slice(0, 60) }
  }
}

console.log(['symbol', 'address', 'codeBytes', 'symbol()', 'decimals()', 'uiMultiplier()', 'newUIMultiplier()', 'effectiveAt()', 'oraclePaused()', 'registryMultiplier'].join('\t'))
for (const row of rows) {
  const code = await rpc('eth_getCode', [row.address, 'latest'])
  if (!code || code === '0x') {
    console.log([row.symbol, row.address, 'NO-CODE'].join('\t'))
    continue
  }
  const symbol = await read(row.address, SELECTOR.symbol)
  const decimals = await read(row.address, SELECTOR.decimals)
  const ui = await read(row.address, SELECTOR.uiMultiplier)
  const next = await read(row.address, SELECTOR.newUIMultiplier)
  const effective = await read(row.address, SELECTOR.effectiveAt)
  const paused = await read(row.address, SELECTOR.oraclePaused)
  console.log([
    row.symbol,
    row.address,
    (code.length - 2) / 2,
    symbol.ok ? decodeString(symbol.value) : 'REVERT',
    decimals.ok ? Number(BigInt(decimals.value)) : 'REVERT',
    ui.ok ? BigInt(ui.value).toString() : 'REVERT',
    next.ok ? BigInt(next.value).toString() : 'REVERT',
    effective.ok ? BigInt(effective.value).toString() : 'REVERT',
    paused.ok ? BigInt(paused.value) === 1n : 'REVERT',
    row.currentMultiplier,
  ].join('\t'))
}
