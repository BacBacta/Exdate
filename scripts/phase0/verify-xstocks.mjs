// xStocks (Backed) read back on chain, not taken from the page.
//
//   node scripts/phase0/verify-xstocks.mjs
//
// The roadmap's chantier 1 rested on a summary that said xStocks uses the same mechanism as
// Robinhood, and recorded that `docs.xstocks.fi` answered 403 to an automated reader. Both changed
// on inspection: the page answers 200 today, and read first-party it says something materially
// different. That is why this script exists in the shape it does - the same shape as
// scripts/phase0/verify-base-b20.mjs, where reading the chain corrected the documentation.
//
// What the issuer states first-party, and what this checks against the chain:
//
//   "On EVM chains, the contract handles this automatically - when the multiplier updates, it
//    adjusts all user balances directly, so balanceOf() always returns the current
//    equity-adjusted value."   -- docs.xstocks.fi/developers/multipliers
//
// That INVERTS ERC-8056. Robinhood's balanceOf() is the constant and balanceOfUI() is adjusted;
// xStocks' balanceOf() is adjusted and sharesOf() is the constant. Anything built on "balanceOf is
// the raw amount" is wrong here, in the direction that silently reports the post-dividend number
// as the pre-dividend one - so it is checked rather than assumed, per token, on both chains.
//
// Every selector below is computed from its signature, never copied. Every address comes from the
// issuer's own registry at api.xstocks.fi and is confirmed to hold code and answer as claimed.
import { writeFileSync } from 'node:fs'

const OUT = new URL('../../data/xstocks-verification.json', import.meta.url)
const REGISTRY = 'https://api.xstocks.fi/api/v2/public/assets'

/**
 * Endpoints are candidates, not facts: each is confirmed by asking eth_chainId and comparing the
 * answer to the chain it claims to be. An endpoint that answers the wrong id is dropped rather
 * than trusted, which is the same rule scripts/probe-rpc-endpoints.mjs applies on chain 4663.
 */
const CHAINS = {
  Ethereum: {
    chainId: 1,
    candidates: ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'],
    explorer: 'https://etherscan.io',
  },
  BinanceSmartChain: {
    chainId: 56,
    candidates: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
    explorer: 'https://bscscan.com',
  },
}

/**
 * Computed with viem's toFunctionSelector from the signatures the issuer's own page names, and
 * written down here so this script needs no dependency. The ERC-8056 pair is included on purpose:
 * proving they REVERT is what establishes that this is a different standard rather than a variant
 * of the one exdate already reads.
 */
const SELECTOR = {
  // xStocks, from docs.xstocks.fi/developers/multipliers
  getCurrentMultiplier: '0x2b63c300',
  sharesOf: '0xf5eb42dc',
  // ERC-20
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  balanceOf: '0x70a08231',
  // Backed's BackedAutoFeeTokenImplementation, whose name says a fee accrues in the multiplier
  lastTimeFeeApplied: '0x3dfa34cd',
  feePerPeriod: '0xf00c1dff',
  periodLength: '0xd2ca2115',
  // ERC-8056, expected to revert here. Robinhood's, not Backed's.
  uiMultiplier: '0xa60bf13d',
  balanceOfUI: '0x437a9958',
  // Coinbase B20's, also expected to revert: three issuers, three spellings of one idea.
  multiplier: '0x1b3ed722',
}

const WAD = 10n ** 18n
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function rpcCall(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(body.error.message ?? 'rpc error')
  return body.result
}

/** An endpoint that answers the wrong chain id is not this chain's endpoint, whatever its name says. */
async function pickEndpoint(name, chain) {
  for (const url of chain.candidates) {
    try {
      const id = await rpcCall(url, 'eth_chainId', [])
      if (Number(BigInt(id)) === chain.chainId) return url
      console.error(`# ${name}: ${new URL(url).host} answered chain ${Number(BigInt(id))}, not ${chain.chainId}; skipped`)
    } catch (error) {
      console.error(`# ${name}: ${new URL(url).host} did not answer (${error.message}); skipped`)
    }
  }
  return null
}

const call = async (url, to, data) => {
  try {
    const result = await rpcCall(url, 'eth_call', [{ to, data }, 'latest'])
    return { ok: result !== '0x', value: result }
  } catch (error) {
    return { ok: false, value: null, error: String(error.message).slice(0, 80) }
  }
}

const uint = (hex) => (hex && hex !== '0x' ? BigInt(hex) : null)
/**
 * The return data as 32-byte words.
 *
 * Needed because `getCurrentMultiplier()` returns THREE words, not one - measured, after a first
 * run parsed all 96 bytes as a single integer and published a multiplier of 1.34e154. The first
 * word is the WAD; the other two are recorded rather than named, because nothing first-party says
 * what they are and a guessed field name is a made-up fact.
 */
const words = (hex) => {
  if (!hex || hex === '0x') return []
  const body = hex.slice(2)
  return Array.from({ length: Math.floor(body.length / 64) }, (_, i) => BigInt('0x' + body.slice(i * 64, i * 64 + 64)))
}
const decodeString = (hex) => {
  if (!hex || hex.length < 130) return null
  const length = Number(BigInt('0x' + hex.slice(2).slice(64, 128)))
  return Buffer.from(hex.slice(2).slice(128, 128 + length * 2), 'hex').toString('utf8')
}
const decimalWad = (value) => {
  if (value === null) return null
  const whole = value / WAD
  const fraction = (value % WAD).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

// --- 1. the issuer's own registry, every page --------------------------------
const assets = []
for (let page = 0; page < 20; page++) {
  const response = await fetch(`${REGISTRY}?page=${page}`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`registry page ${page}: HTTP ${response.status}`)
  const body = await response.json()
  assets.push(...(body.nodes ?? []))
  if (!body.page?.hasNextPage) break
  await sleep(300)
}
console.error(`# registry: ${assets.length} assets from ${REGISTRY}`)

const byNetwork = {}
for (const asset of assets) {
  for (const deployment of asset.deployments ?? []) {
    byNetwork[deployment.network] = (byNetwork[deployment.network] ?? 0) + 1
  }
}

// --- 2. read the chain --------------------------------------------------------
// A sample rather than every token: the claim under test is about the CONTRACT, and the tokens are
// one implementation behind one factory, so reading a handful of them on each chain settles it as
// well as reading a hundred would - and says so, rather than implying a census it did not take.
// Named rather than "the first six": the claim is about the contract, but a sample of obscure
// tickers that have never had a corporate event cannot show a multiplier that moved, which is the
// second thing this has to establish. These are large, dividend-paying names plus two that pay
// none, so the reads include both states.
const SAMPLE_SYMBOLS = (process.env.XSTOCKS_SYMBOLS ?? 'AAPLx,SPYx,NVDAx,TSLAx,MSTRx,KOx').split(',')
const SAMPLE = Number(process.env.XSTOCKS_SAMPLE ?? SAMPLE_SYMBOLS.length)
const chains = {}

for (const [name, chain] of Object.entries(CHAINS)) {
  const url = await pickEndpoint(name, chain)
  if (!url) {
    chains[name] = { chainId: chain.chainId, endpoint: null, refusal: 'no candidate endpoint answered with the right chain id', tokens: [] }
    continue
  }
  const host = new URL(url).host
  const deployed = assets
    .map((asset) => ({ asset, deployment: (asset.deployments ?? []).find((d) => d.network === name) }))
    .filter((row) => row.deployment?.address?.startsWith('0x'))
  // The named sample first, then whatever else the registry holds, so a renamed ticker degrades to
  // reading something rather than reading nothing.
  deployed.sort((a, b) => {
    const rank = (row) => {
      const index = SAMPLE_SYMBOLS.indexOf(row.asset.symbol)
      return index === -1 ? SAMPLE_SYMBOLS.length : index
    }
    return rank(a) - rank(b)
  })

  const tokens = []
  for (const { asset, deployment } of deployed.slice(0, SAMPLE)) {
    const address = deployment.address.toLowerCase()
    const code = await rpcCall(url, 'eth_getCode', [address, 'latest'])
    const results = {}
    for (const [view, selector] of Object.entries(SELECTOR)) {
      // The address-taking views are asked about the token itself: a contract that holds tokens is
      // not guaranteed, but the call either answers or reverts, which is what is being tested.
      const data = ['sharesOf', 'balanceOf', 'balanceOfUI'].includes(view)
        ? selector + address.slice(2).padStart(64, '0')
        : selector
      results[view] = await call(url, address, data)
      await sleep(60)
    }
    const currentWords = results.getCurrentMultiplier.ok ? words(results.getCurrentMultiplier.value) : []
    const multiplier = currentWords[0] ?? null
    const plainMultiplier = results.multiplier.ok ? uint(results.multiplier.value) : null
    tokens.push({
      symbol: asset.symbol,
      underlyingSymbol: asset.underlyingSymbol ?? null,
      isin: asset.isin ?? null,
      address,
      explorer: `${chain.explorer}/address/${address}`,
      codeBytes: code === '0x' ? 0 : (code.length - 2) / 2,
      onChainSymbol: results.symbol.ok ? decodeString(results.symbol.value) : null,
      symbolMatches: results.symbol.ok ? decodeString(results.symbol.value) === asset.symbol : false,
      decimals: results.decimals.ok ? Number(uint(results.decimals.value)) : null,
      totalSupply: results.totalSupply.ok ? uint(results.totalSupply.value)?.toString() ?? null : null,
      multiplierWad: multiplier?.toString() ?? null,
      multiplierDecimal: decimalWad(multiplier),
      /** The two words that follow it. Unnamed on purpose: no first-party source says what they are. */
      getCurrentMultiplierExtraWords: currentWords.slice(1).map((word) => word.toString()),
      /**
       * The bare `multiplier()` selector, which is the one Coinbase B20 uses on Base. It answers
       * here too, with the same value - so the same four bytes mean the same thing on two unrelated
       * issuers. Recorded as measured; the first version of this script asserted it would revert.
       */
      plainMultiplierWad: plainMultiplier?.toString() ?? null,
      plainMultiplierAgrees: plainMultiplier !== null && multiplier !== null && plainMultiplier === multiplier,
      /** The claim under test: which answers, and which reverts. */
      answers: Object.fromEntries(Object.entries(results).map(([view, r]) => [view, r.ok])),
      feePerPeriod: results.feePerPeriod.ok ? uint(results.feePerPeriod.value)?.toString() ?? null : null,
      periodLengthSeconds: results.periodLength.ok ? Number(uint(results.periodLength.value)) : null,
      lastTimeFeeApplied: results.lastTimeFeeApplied.ok ? Number(uint(results.lastTimeFeeApplied.value)) : null,
    })
    console.error(
      `#   ${name} ${asset.symbol} ${address} code=${tokens.at(-1).codeBytes}B multiplier=${tokens.at(-1).multiplierDecimal ?? 'REVERT'} sharesOf=${results.sharesOf.ok} uiMultiplier=${results.uiMultiplier.ok}`,
    )
  }

  chains[name] = {
    chainId: chain.chainId,
    endpoint: host,
    endpointConfirmedBy: 'eth_chainId',
    deployments: deployed.length,
    sampled: tokens.length,
    tokens,
  }
}

// --- 3. the issuer's own API against the chain --------------------------------
// The strongest thing available here, and the thing Robinhood Chain has nowhere: two INDEPENDENT
// first-party sources for one number. The issuer publishes a multiplier per asset and a full step
// history back to 2025; the contract answers with its own. Agreement is a cross-check; disagreement
// would say which of the two is stale, which is exactly the question a reconciliation turns on.
const apiChecks = []
const history = {}
for (const symbol of SAMPLE_SYMBOLS) {
  const onChain = (chains.Ethereum?.tokens ?? []).find((token) => token.symbol === symbol)
  if (!onChain?.multiplierWad) continue
  try {
    const current = await (await fetch(`${REGISTRY}/${symbol}/multiplier?network=Ethereum`, { signal: AbortSignal.timeout(20_000) })).json()
    // The API publishes a float and the chain a WAD integer, so they are compared at the precision
    // the float can carry - 1e-15 of a multiplier is 0.0001 bp, far below anything measurable.
    const stated = Number(current.currentMultiplier)
    const read = Number(onChain.multiplierWad) / 1e18
    apiChecks.push({
      symbol,
      apiMultiplier: stated,
      chainMultiplier: read,
      agreesTo1e15: Math.abs(stated - read) < 1e-15 * Math.max(1, stated),
      /** The issuer's own pending shape, and it carries a reason where Robinhood's carries none. */
      pending: current.newMultiplier ? { newMultiplier: current.newMultiplier, activationDateTime: current.activationDateTime, reason: current.reason } : null,
    })
    const past = await (await fetch(`${REGISTRY}/${symbol}/multiplier/history?page=0&pageSize=50&network=Ethereum`, { signal: AbortSignal.timeout(20_000) })).json()
    history[symbol] = (past.nodes ?? []).map((row) => ({
      reason: row.reason,
      multiplier: row.multiplier,
      previousMultiplier: row.previousMultiplier,
      activationDateTime: row.activationDateTime,
      stepBps: row.previousMultiplier ? Math.round(((row.multiplier - row.previousMultiplier) / row.previousMultiplier) * 1e6) / 100 : null,
    }))
    await sleep(250)
  } catch (error) {
    apiChecks.push({ symbol, refusal: String(error.message).slice(0, 80) })
  }
}

// --- 4. what the reads establish ---------------------------------------------
const sampled = Object.values(chains).flatMap((chain) => chain.tokens ?? [])
const finding = (name, test) => ({ name, holds: sampled.length > 0 && sampled.every(test), of: sampled.length })

const out = {
  note: 'xStocks (Backed) read back on chain from the issuer’s own address-keyed registry. Every selector is computed from its signature; every address comes from api.xstocks.fi and is confirmed to hold code. A sample per chain, not a census, because the claim under test is about one shared implementation.',
  source: { registry: REGISTRY, documentation: 'https://docs.xstocks.fi/developers/multipliers' },
  observedAt: new Date().toISOString(),
  issuer: 'Backed Finance (xStocks)',
  registry: { assets: assets.length, deploymentsByNetwork: byNetwork },
  selectors: SELECTOR,
  chains,
  /** The issuer's API against the chain, per sampled token. */
  apiVersusChain: apiChecks,
  /**
   * The issuer's own step history. Robinhood publishes a one-month window with no pagination and
   * loses a row that falls out of it - five July actions are unrecoverable because of it. Backed
   * publishes every step back to 2025 with its reason, which changes what an archive is for here.
   */
  declaredHistory: history,
  findings: [
    finding('every sampled address holds code', (t) => t.codeBytes > 0),
    finding('on-chain symbol matches the registry', (t) => t.symbolMatches),
    finding('getCurrentMultiplier() answers', (t) => t.answers.getCurrentMultiplier),
    finding('sharesOf() answers - the constant is here, not in balanceOf', (t) => t.answers.sharesOf),
    finding('ERC-8056 uiMultiplier() reverts - this is NOT Robinhood’s standard', (t) => !t.answers.uiMultiplier),
    finding('ERC-8056 balanceOfUI() reverts', (t) => !t.answers.balanceOfUI),
    // Stated as measured, not as expected. The first run of this script asserted that Coinbase B20's
    // bare `multiplier()` would revert here, on the reasoning that three issuers means three ABIs.
    // It answers on 12 of 12, with the same value getCurrentMultiplier()'s first word carries - so
    // one selector means one thing on two unrelated issuers, which is a fact worth an abstraction
    // rather than a coincidence worth hiding.
    finding('Coinbase B20’s bare multiplier() ALSO answers here, and agrees', (t) => t.plainMultiplierAgrees),
    finding('a fee accrues in the multiplier (feePerPeriod answers)', (t) => t.answers.feePerPeriod),
    {
      name: 'the issuer’s API and the contract agree on the multiplier',
      holds: apiChecks.length > 0 && apiChecks.every((row) => row.agreesTo1e15),
      of: apiChecks.length,
    },
    {
      name: 'the same address carries the same multiplier on Ethereum and BNB Chain',
      holds:
        (chains.Ethereum?.tokens ?? []).length > 0 &&
        (chains.Ethereum?.tokens ?? []).every((token) => {
          const other = (chains.BinanceSmartChain?.tokens ?? []).find((row) => row.address === token.address)
          return other && other.multiplierWad === token.multiplierWad
        }),
      of: (chains.Ethereum?.tokens ?? []).length,
    },
  ],
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.error(`\n# ${assets.length} assets, ${sampled.length} sampled on chain -> data/xstocks-verification.json`)
for (const row of out.findings) console.error(`#   ${row.holds ? 'yes' : 'NO '}  ${row.name} (${row.of} sampled)`)
