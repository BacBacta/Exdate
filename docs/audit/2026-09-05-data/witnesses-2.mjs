// P3, second pass: a third witness for state where ordofi has lost its archive, and the 194-view batch in chunks.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { keccak256, toHex } = require('/home/user/Exdate/packages/core/node_modules/viem')
const SEL = keccak256(toHex('uiMultiplier()')).slice(0, 10)
const EP = { RH: 'https://rpc.mainnet.chain.robinhood.com', BM: 'https://rpc-robinhood.blockmachine.io', OR: 'https://rpc.ordofi.network', BX: 'https://robinhood.rpc.blxrbdn.com' }
const out = { ranAt: new Date().toISOString(), stateBX: [], batch: {}, errors: [] }
let id = 0
async function rpc(ep, method, params) {
  try {
    const r = await fetch(EP[ep], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(25000) })
    const j = await r.json(); if (j.error) throw new Error(`${ep} ${method}: ${JSON.stringify(j.error).slice(0, 120)}`); return j.result
  } catch (e) { out.errors.push(String(e).slice(0, 160)); return null }
}
const blocks = JSON.parse(readFileSync('/home/user/Exdate/data/effective-blocks.json', 'utf8')).blocks
for (const b of blocks) {
  const before = await rpc('BX', 'eth_call', [{ to: b.token, data: SEL }, '0x' + (b.effectiveBlock - 1).toString(16)])
  const at = await rpc('BX', 'eth_call', [{ to: b.token, data: SEL }, '0x' + b.effectiveBlock.toString(16)])
  const bv = before ? BigInt(before).toString() : null, av = at ? BigInt(at).toString() : null
  out.stateBX.push({ symbol: b.symbol, effectiveBlock: b.effectiveBlock, before: bv, at: av, agrees: bv === b.oldMultiplier && av === b.newMultiplier, answered: bv !== null && av !== null })
}
const registry = JSON.parse(readFileSync('/home/user/Exdate/data/robinhood-assets.snapshot.json', 'utf8')).assets
const tokens = registry.map((a) => a.deployments.find((d) => d.chainId === 4663).contractAddress.toLowerCase())
const head = Number(await rpc('BM', 'eth_blockNumber', []))
const pinned = head - 30
async function batch(ep) {
  const result = {}
  for (let i = 0; i < tokens.length; i += 20) {
    const slice = tokens.slice(i, i + 20)
    const body = slice.map((t, k) => ({ jsonrpc: '2.0', id: k + 1, method: 'eth_call', params: [{ to: t, data: SEL }, '0x' + pinned.toString(16)] }))
    try {
      const r = await fetch(EP[ep], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) })
      const txt = await r.text(); let j; try { j = JSON.parse(txt) } catch { out.errors.push(`${ep} batch ${i}: non-JSON ${txt.slice(0, 80)}`); continue }
      if (!Array.isArray(j)) { out.errors.push(`${ep} batch ${i}: ${txt.slice(0, 100)}`); continue }
      for (const x of j) result[slice[x.id - 1]] = x.result ? BigInt(x.result).toString() : `error`
    } catch (e) { out.errors.push(`${ep} batch ${i}: ${String(e).slice(0, 100)}`) }
  }
  return result
}
const bm = await batch('BM'); const bx = await batch('BX')
const regMult = Object.fromEntries(registry.map((a) => [a.deployments.find((d) => d.chainId === 4663).contractAddress.toLowerCase(), a.currentMultiplier]))
const tl = JSON.parse(readFileSync('/home/user/Exdate/data/exdate.tokenlist.json', 'utf8')).tokens
const tlMult = Object.fromEntries(tl.map((t) => [t.address.toLowerCase(), t.extensions?.multiplier ?? t.extensions?.uiMultiplier ?? JSON.stringify(t.extensions).slice(0, 60)]))
const rows = tokens.map((t) => ({ token: t, BM: bm[t] ?? null, BX: bx[t] ?? null }))
out.batch = {
  block: pinned, answeredBM: rows.filter((r) => r.BM && r.BM !== 'error').length, answeredBX: rows.filter((r) => r.BX && r.BX !== 'error').length,
  disagreements: rows.filter((r) => r.BM && r.BX && r.BM !== 'error' && r.BX !== 'error' && r.BM !== r.BX),
  moved: rows.filter((r) => r.BM && r.BM !== '1000000000000000000' && r.BM !== 'error').map((r) => ({ token: r.token, chain: r.BM, registrySnapshot: regMult[r.token], tokenlist: tlMult[r.token] })),
  snapshotVsChain: rows.filter((r) => r.BM && r.BM !== 'error' && regMult[r.token] && !regMult[r.token].startsWith(r.BM.slice(0, 1))).length,
}
out.summary = { stateBX: { agrees: out.stateBX.filter((s) => s.agrees).length, answered: out.stateBX.filter((s) => s.answered).length, total: out.stateBX.length }, batch: { block: pinned, answeredBM: out.batch.answeredBM, answeredBX: out.batch.answeredBX, disagreements: out.batch.disagreements.length, moved: out.batch.moved.length }, errors: out.errors.length }
writeFileSync('/home/user/Exdate/docs/audit/2026-09-05-data/witnesses-2.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out.summary)); console.log(JSON.stringify(out.batch.moved)); console.log(out.errors.slice(0, 4))
