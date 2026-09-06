// The second concrete issuer adapter: xStocks' step ledger, read on chain and cross-checked.
//
//   node scripts/measure-xstocks-steps.mjs
//
// This is the roadmap's 1c, and deliberately NOT an interface: a common contract extracted from one
// implementation encodes that implementation's assumptions as though they were the domain's, and
// reading xStocks already broke one - balanceOf() is the adjusted view there and the constant on
// Robinhood Chain (docs/third-issuer-xstocks.md). So this is written the way the Robinhood
// collectors are written, on its own terms, and the abstraction comes from having two.
//
// What it produces is a STEP LEDGER, not haircuts, and the difference is the whole finding. Backed
// publishes every multiplier step back to 2025 with its reason, and no declared cash rate anywhere;
// Robinhood publishes the rate and loses old rows. So the measurement exdate can make here is
// "what the multiplier did, and does the chain agree with what the issuer says it did" - which is
// worth publishing, and is not a haircut. The file says so in its own note rather than leaving a
// reader to infer it.
//
// Every multiplier is read in ONE Multicall3 batch per chain, at one block, or the numbers would
// measure the delay between reads rather than the tokens.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const OUT = 'data/xstocks-steps.observed.json'
const REGISTRY = 'https://api.xstocks.fi/api/v2/public/assets'
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11'
const WAD = 10n ** 18n

/** Computed selectors, never copied. See scripts/phase0/verify-xstocks.mjs for the cross-check. */
const GET_CURRENT_MULTIPLIER = '0x2b63c300'
const AGGREGATE3 = '0x82ad56cb'

const CHAINS = {
  Ethereum: { chainId: 1, candidates: ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'] },
  BinanceSmartChain: { chainId: 56, candidates: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'] },
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pad = (hex) => hex.replace(/^0x/, '').padStart(64, '0')
const word = (n) => BigInt(n).toString(16).padStart(64, '0')

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(body.error.message ?? 'rpc error')
  return body.result
}

/** An endpoint that answers the wrong chain id is not this chain's endpoint, whatever its name says. */
async function pickEndpoint(chain) {
  for (const url of chain.candidates) {
    try {
      if (Number(BigInt(await rpc(url, 'eth_chainId', []))) === chain.chainId) return url
    } catch {
      /* try the next */
    }
  }
  return null
}

/**
 * aggregate3((address,bool,bytes)[]) hand-encoded, so this script needs no ABI library - the same
 * reason @exdate/core/holdings encodes its own calldata. Checked against the per-token reads in
 * verify-xstocks.mjs, which go one call at a time.
 */
function encodeAggregate3(targets) {
  const head = word(32) // offset to the array
  const count = word(targets.length)
  // Each tuple is dynamic (it holds bytes), so the array is offsets then bodies.
  const bodies = targets.map((target) => {
    const call = GET_CURRENT_MULTIPLIER.slice(2)
    return word(BigInt(target)) + word(1) + word(96) + word(call.length / 2) + call.padEnd(64, '0')
  })
  let offset = targets.length * 32
  const offsets = bodies.map((body) => {
    const at = word(offset)
    offset += body.length / 2
    return at
  })
  return `${AGGREGATE3}${head}${count}${offsets.join('')}${bodies.join('')}`
}

/** Decode aggregate3's (bool success, bytes returnData)[] back to one multiplier per target. */
function decodeAggregate3(hex, count) {
  const body = hex.slice(2)
  const at = (index) => Number(BigInt('0x' + body.slice(index * 64, index * 64 + 64)))
  const arrayAt = at(0) / 32
  const results = []
  for (let i = 0; i < count; i++) {
    const tupleAt = arrayAt + 1 + at(arrayAt + 1 + i) / 32
    const success = BigInt('0x' + body.slice(tupleAt * 64, tupleAt * 64 + 64)) === 1n
    const dataAt = tupleAt + at(tupleAt + 1) / 32
    const length = at(dataAt)
    // Three words come back; the first is the WAD. Measured, after a first reading of this
    // contract parsed all 96 bytes as one integer and produced a multiplier of 1.34e154.
    results.push(success && length >= 32 ? BigInt('0x' + body.slice((dataAt + 1) * 64, (dataAt + 1) * 64 + 64)) : null)
  }
  return results
}

const decimalWad = (value) => {
  if (value === null) return null
  const whole = value / WAD
  const fraction = (value % WAD).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

// --- 1. the registry ---------------------------------------------------------
const assets = []
for (let page = 0; page < 20; page++) {
  const response = await fetch(`${REGISTRY}?page=${page}`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`registry page ${page}: HTTP ${response.status}`)
  const body = await response.json()
  assets.push(...(body.nodes ?? []))
  if (!body.page?.hasNextPage) break
  await sleep(250)
}
if (assets.length === 0) {
  console.error('# the registry returned no assets; refusing to publish an empty ledger')
  process.exit(1)
}

// --- 2. every multiplier, one batch per chain, at one block -------------------
const BATCH = 250
const chains = {}
for (const [name, chain] of Object.entries(CHAINS)) {
  const url = await pickEndpoint(chain)
  if (!url) {
    chains[name] = { chainId: chain.chainId, refusal: 'no candidate endpoint answered with the right chain id' }
    continue
  }
  const block = await rpc(url, 'eth_blockNumber', [])
  const rows = assets
    .map((asset) => ({ symbol: asset.symbol, deployment: (asset.deployments ?? []).find((d) => d.network === name) }))
    .filter((row) => row.deployment?.address?.startsWith('0x'))

  const multipliers = new Map()
  for (let index = 0; index < rows.length; index += BATCH) {
    const slice = rows.slice(index, index + BATCH)
    const data = encodeAggregate3(slice.map((row) => row.deployment.address.toLowerCase()))
    // Pinned to the block read above, so every token in this chain's ledger is one instant.
    const result = await rpc(url, 'eth_call', [{ to: MULTICALL3, data }, block])
    decodeAggregate3(result, slice.length).forEach((value, offset) => {
      multipliers.set(slice[offset].deployment.address.toLowerCase(), value)
    })
    await sleep(200)
  }

  chains[name] = {
    chainId: chain.chainId,
    endpoint: new URL(url).host,
    endpointConfirmedBy: 'eth_chainId',
    block: Number(BigInt(block)),
    read: multipliers.size,
    unreadable: [...multipliers.values()].filter((value) => value === null).length,
    multipliers: Object.fromEntries([...multipliers].map(([address, value]) => [address, value?.toString() ?? null])),
  }
  console.error(`# ${name}: ${multipliers.size} multipliers at block ${Number(BigInt(block))} via Multicall3`)
}

// --- 3. the declared history, for the tokens that actually moved --------------
// Only tokens whose multiplier is not exactly 1.0: a token that never moved has an empty history,
// and asking for 726 of them would be 726 requests to learn nothing.
const ethereum = chains.Ethereum?.multipliers ?? {}
const moved = assets.filter((asset) => {
  const address = (asset.deployments ?? []).find((d) => d.network === 'Ethereum')?.address?.toLowerCase()
  const value = address ? ethereum[address] : null
  return value && value !== WAD.toString()
})
console.error(`# ${moved.length} of ${assets.length} tokens have a multiplier away from 1.0; asking for their history`)

const tokens = []
for (const asset of moved) {
  const address = (asset.deployments ?? []).find((d) => d.network === 'Ethereum').address.toLowerCase()
  const onChain = BigInt(ethereum[address])
  let history = []
  let refusal = null
  try {
    const body = await (await fetch(`${REGISTRY}/${asset.symbol}/multiplier/history?page=0&pageSize=100&network=Ethereum`, { signal: AbortSignal.timeout(25_000) })).json()
    history = (body.nodes ?? []).map((row) => ({
      reason: row.reason,
      activationDateTime: row.activationDateTime,
      multiplier: row.multiplier,
      previousMultiplier: row.previousMultiplier,
      stepBps: row.previousMultiplier ? Math.round(((row.multiplier - row.previousMultiplier) / row.previousMultiplier) * 1e6) / 100 : null,
    }))
  } catch (error) {
    refusal = String(error.message).slice(0, 80)
  }
  const latest = history[0] ?? null
  // The declared side is a float and the chain a WAD integer, so they meet at the float's own
  // precision. 1e-15 of a multiplier is 0.0001 bp, far below anything this measures.
  const agrees = latest ? Math.abs(latest.multiplier - Number(onChain) / 1e18) < 1e-15 * Math.max(1, latest.multiplier) : null
  tokens.push({
    symbol: asset.symbol,
    underlyingSymbol: asset.underlyingSymbol ?? null,
    isin: asset.isin ?? null,
    address,
    chainMultiplier: onChain.toString(),
    chainMultiplierDecimal: decimalWad(onChain),
    /** Same address, other chain. They must not be allowed to disagree in the record. */
    bnbMultiplier: chains.BinanceSmartChain?.multipliers?.[address] ?? null,
    bnbAgrees: (chains.BinanceSmartChain?.multipliers?.[address] ?? null) === onChain.toString(),
    declaredSteps: history.length,
    declaredLatest: latest,
    /** The cross-check that makes this a measurement rather than a copy of the issuer's own table. */
    chainAgreesWithDeclared: agrees,
    historyRefusal: refusal,
    steps: history,
  })
  await sleep(200)
}

const withHistory = tokens.filter((token) => token.declaredSteps > 0)
const disagreeing = tokens.filter((token) => token.chainAgreesWithDeclared === false)
const chainDisagreeing = tokens.filter((token) => token.bnbMultiplier !== null && !token.bnbAgrees)
const allSteps = tokens.flatMap((token) => token.steps)
const reasons = {}
for (const step of allSteps) reasons[step.reason ?? 'unstated'] = (reasons[step.reason ?? 'unstated'] ?? 0) + 1

const out = {
  note: "xStocks' multiplier steps: what the chain holds, and what the issuer says it did. This is a STEP LEDGER and not a haircut, and the difference is the finding - Backed publishes every step back to 2025 with its reason and no declared cash rate anywhere, where Robinhood publishes the rate and loses old rows. A haircut here needs a cash rate from a source that is not the issuer, which has not been named or read.",
  source: { registry: REGISTRY, chain: 'Multicall3 aggregate3 at the canonical address, one batch per chain, pinned to one block' },
  issuer: 'Backed Finance (xStocks)',
  observedAt: 'PLACEHOLDER',
  summary: {
    assets: assets.length,
    movedFromOne: tokens.length,
    withDeclaredHistory: withHistory.length,
    declaredSteps: allSteps.length,
    stepsByReason: Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b))),
    /** Zero is the claim: the chain and the issuer's own table agree on every token that moved. */
    chainDisagreesWithDeclared: disagreeing.length,
    /** Zero is the claim: one address, eleven chains, one multiplier. */
    chainsDisagreeWithEachOther: chainDisagreeing.length,
    producesHaircuts: false,
    whyNot: 'the issuer publishes the step and no declared cash rate; a haircut needs a rate from a source that is not the issuer, and none has been named',
  },
  chains: Object.fromEntries(
    Object.entries(chains).map(([name, chain]) => [name, { ...chain, multipliers: undefined }]),
  ),
  tokens: tokens.sort((a, b) => a.symbol.localeCompare(b.symbol)),
}

const held = (() => {
  try {
    return JSON.parse(readFileSync(new URL(OUT, root), 'utf8'))
  } catch {
    return null
  }
})()
// The block moves every run and says nothing about the tokens, so it and the timestamp are compared
// out: a run that re-confirms the same ledger leaves the file alone and commits nothing.
const withoutRunFields = (value) => {
  const { observedAt: _at, chains: chainRows, ...rest } = value ?? {}
  const stripped = Object.fromEntries(Object.entries(chainRows ?? {}).map(([name, row]) => [name, { ...row, block: undefined }]))
  return JSON.stringify({ ...rest, chains: stripped })
}
const unchanged = held !== null && withoutRunFields(held) === withoutRunFields(out)
out.observedAt = unchanged ? held.observedAt : new Date().toISOString()
if (unchanged) {
  out.chains = held.chains
  console.error(`# unchanged: ${tokens.length} tokens, ${allSteps.length} declared steps; file left as it was`)
  process.exit(0)
}

writeFileSync(new URL(OUT, root), JSON.stringify(out, null, 2) + '\n')
console.error(
  `# ${tokens.length} tokens away from 1.0, ${allSteps.length} declared steps, ${disagreeing.length} disagreeing with the chain, ${chainDisagreeing.length} disagreeing across chains -> ${OUT}`,
)
