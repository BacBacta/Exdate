// P3 - independent witnesses. Raw JSON-RPC, no library but keccak for selectors.
// Every on-chain fact behind a published figure is re-read from two endpoints
// (three where one serves the height) and compared to the committed file.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { keccak256, toHex } = require('/home/user/Exdate/packages/core/node_modules/viem')
const sel = (sig) => keccak256(toHex(sig)).slice(0, 10)
const SEL = { uiMultiplier: sel('uiMultiplier()'), getRoundData: sel('getRoundData(uint80)'), latestRoundData: sel('latestRoundData()') }
const TOPIC = keccak256(toHex('UIMultiplierUpdated(uint256,uint256,uint256)'))
const EP = {
  RH: 'https://rpc.mainnet.chain.robinhood.com',
  BM: 'https://rpc-robinhood.blockmachine.io',
  OR: 'https://rpc.ordofi.network',
  BX: 'https://robinhood.rpc.blxrbdn.com',
}
const out = { ranAt: new Date().toISOString(), selectors: SEL, topic0: TOPIC, endpoints: EP, receipts: [], state: [], rounds: [], head: {}, batch: null, errors: [] }
let id = 0
async function rpc(ep, method, params, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(EP[ep], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(25000) })
      const j = await r.json()
      if (j.error) throw new Error(`${ep} ${method}: ${JSON.stringify(j.error).slice(0, 160)}`)
      return j.result
    } catch (e) { if (i === tries - 1) { out.errors.push(String(e).slice(0, 200)); return null } await new Promise((r) => setTimeout(r, 400 * (i + 1))) }
  }
}
const hexWord = (data, i) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64))
const events = JSON.parse(readFileSync('/home/user/Exdate/data/multiplier-events.observed.json', 'utf8')).events
const blocks = JSON.parse(readFileSync('/home/user/Exdate/data/effective-blocks.json', 'utf8')).blocks
const recon = JSON.parse(readFileSync('/home/user/Exdate/data/reconciliations.observed.json', 'utf8')).rows
const registry = JSON.parse(readFileSync('/home/user/Exdate/data/robinhood-assets.snapshot.json', 'utf8')).assets

// 1. every announcement log, from the receipt, on two endpoints
for (const ev of events) {
  const row = { symbol: ev.symbol, tx: ev.tx, block: ev.block, file: { old: ev.oldMultiplier, new: ev.newMultiplier, effectiveAt: ev.effectiveAt }, witnesses: {} }
  for (const ep of ['RH', 'BM']) {
    const rc = await rpc(ep, 'eth_getTransactionReceipt', [ev.tx])
    if (!rc) { row.witnesses[ep] = 'no answer'; continue }
    const log = (rc.logs || []).find((l) => l.topics?.[0] === TOPIC && l.address.toLowerCase() === ev.token.toLowerCase())
    if (!log) { row.witnesses[ep] = 'receipt found, no UIMultiplierUpdated log for this token'; continue }
    const old = hexWord(log.data, 0).toString(), nw = hexWord(log.data, 1).toString(), eff = new Date(Number(hexWord(log.data, 2)) * 1000).toISOString().replace('.000Z', 'Z')
    row.witnesses[ep] = { block: Number(rc.blockNumber), old, new: nw, effectiveAt: eff, agrees: old === ev.oldMultiplier && nw === ev.newMultiplier && eff === ev.effectiveAt && Number(rc.blockNumber) === ev.block }
  }
  out.receipts.push(row)
}
// 2. uiMultiplier() at effectiveBlock-1 and effectiveBlock, on two archive endpoints
for (const b of blocks) {
  const row = { symbol: b.symbol, token: b.token, effectiveBlock: b.effectiveBlock, file: { old: b.oldMultiplier, new: b.newMultiplier }, witnesses: {} }
  for (const ep of ['BM', 'OR']) {
    const before = await rpc(ep, 'eth_call', [{ to: b.token, data: SEL.uiMultiplier }, '0x' + (b.effectiveBlock - 1).toString(16)])
    const at = await rpc(ep, 'eth_call', [{ to: b.token, data: SEL.uiMultiplier }, '0x' + b.effectiveBlock.toString(16)])
    const bv = before ? BigInt(before).toString() : null, av = at ? BigInt(at).toString() : null
    row.witnesses[ep] = { before: bv, at: av, agrees: bv === b.oldMultiplier && av === b.newMultiplier }
  }
  out.state.push(row)
}
// 3. the Chainlink round each reconciliation used, on two endpoints
for (const r of recon.filter((r) => r.price?.source === 'chainlink:getRoundData')) {
  const row = { symbol: r.symbol, proxy: r.feed.proxy, roundId: r.price.roundId, file: { value: r.price.value, updatedAt: r.price.updatedAt }, witnesses: {} }
  const data = SEL.getRoundData + BigInt(r.price.roundId).toString(16).padStart(64, '0')
  for (const ep of ['RH', 'BM']) {
    const res = await rpc(ep, 'eth_call', [{ to: r.feed.proxy, data }, 'latest'])
    if (!res) { row.witnesses[ep] = 'no answer'; continue }
    const answer = hexWord(res, 1), updatedAt = Number(hexWord(res, 3))
    const value = (Number(answer) / 1e8).toFixed(4)
    row.witnesses[ep] = { answerRaw: answer.toString(), value, updatedAt: new Date(updatedAt * 1000).toISOString(), agrees: value === Number(r.price.value).toFixed(4) && new Date(updatedAt * 1000).toISOString() === r.price.updatedAt }
  }
  out.rounds.push(row)
}
// 4. one batch of 194 uiMultiplier() reads at one block, on two archive endpoints
const headHex = await rpc('BM', 'eth_blockNumber', [])
const pinned = headHex ? Number(headHex) - 50 : null
out.head = { BM: headHex ? Number(headHex) : null, pinnedBlock: pinned }
if (pinned) {
  const tokens = registry.map((a) => a.deployments.find((d) => d.chainId === 4663).contractAddress.toLowerCase())
  const batch = async (ep) => {
    const body = tokens.map((t, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: t, data: SEL.uiMultiplier }, '0x' + pinned.toString(16)] }))
    try {
      const r = await fetch(EP[ep], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })
      const j = await r.json()
      if (!Array.isArray(j)) return { error: JSON.stringify(j).slice(0, 200) }
      return Object.fromEntries(j.map((x) => [tokens[x.id - 1], x.result ? BigInt(x.result).toString() : `error:${JSON.stringify(x.error).slice(0, 80)}`]))
    } catch (e) { return { error: String(e).slice(0, 200) } }
  }
  const [bm, or] = await Promise.all([batch('BM'), batch('OR')])
  const compare = bm.error || or.error ? null : tokens.map((t) => ({ token: t, BM: bm[t], OR: or[t], agrees: bm[t] === or[t] }))
  const regMult = Object.fromEntries(registry.map((a) => [a.deployments.find((d) => d.chainId === 4663).contractAddress.toLowerCase(), a.currentMultiplier]))
  out.batch = { block: pinned, tokens: tokens.length, BMerror: bm.error ?? null, ORerror: or.error ?? null, disagreements: compare ? compare.filter((c) => !c.agrees) : null, movedTokens: compare ? compare.filter((c) => c.BM !== '1000000000000000000').map((c) => ({ token: c.token, BM: c.BM, registrySnapshot: regMult[c.token] })) : null }
}
out.summary = {
  receipts: { total: out.receipts.length, RH: out.receipts.filter((r) => r.witnesses.RH?.agrees).length, BM: out.receipts.filter((r) => r.witnesses.BM?.agrees).length },
  state: { total: out.state.length, BM: out.state.filter((r) => r.witnesses.BM?.agrees).length, OR: out.state.filter((r) => r.witnesses.OR?.agrees).length },
  rounds: { total: out.rounds.length, RH: out.rounds.filter((r) => r.witnesses.RH?.agrees).length, BM: out.rounds.filter((r) => r.witnesses.BM?.agrees).length },
  batch: out.batch ? { disagreements: out.batch.disagreements?.length ?? 'n/a', moved: out.batch.movedTokens?.length ?? 'n/a' } : null,
  errors: out.errors.length,
}
writeFileSync('/home/user/Exdate/docs/audit/2026-09-05-data/witnesses.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out.summary, null, 1))
console.log('disagreements:', JSON.stringify(out.batch?.disagreements?.slice(0, 5)))
console.log('moved:', JSON.stringify(out.batch?.movedTokens))
console.log('errors:', out.errors.slice(0, 5))
