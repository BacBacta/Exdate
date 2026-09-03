// Read Coinbase's tokenized stocks on Base back from the chain, by address.
//
// docs.base.org/specifications/b20/tokenized-stocks-on-base publishes what
// Chainlink names but never gives: the oracle registry address, the thirteen
// B20 token addresses, and the thirteen feed proxies - all in one first-party
// document. That closes the two open items in docs/second-issuer-base.md.
//
// A published table is a claim, so this checks every row against Base mainnet:
//
//   node scripts/phase0/verify-base-b20.mjs [--out data/base-b20-verification.json]
//
// What it establishes, or fails to:
//   1. the registry has bytecode, and which of its selectors take a token address
//   2. the tokens answer the ERC-8056 views, at the selectors the changelog names
//   3. those are precompiles - no bytecode at the address - which breaks any
//      "is this a contract" check an indexer might do
//   4. each feed proxy names its own ticker in description(), the same way
//      Robinhood's do, which is what a token to feed pairing has to rest on
//
// Read-only. BASE_RPC_URL overrides the public endpoint.

import { writeFileSync } from 'node:fs'
import { makeRpc, decodeString, decodeLatestRoundData, SELECTOR } from './rpc.mjs'

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'data/base-b20-verification.json'

const base = makeRpc(process.env.BASE_RPC_URL || 'https://mainnet.base.org', { minGap: 250 })
const call = (to, data) => base('eth_call', [{ to, data }, 'latest'])

// Every address below is copied from the Base documentation page named above and
// is verified here, never guessed. Nothing in this file invents one.
const SOURCE = 'https://docs.base.org/specifications/b20/tokenized-stocks-on-base'
const REGISTRY = '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD'
const TOKENS = {
  AAPLc: '0xb200000000000000000000C2e324d24d7eEcd1fb',
  AMZNc: '0xb200000000000000000000d9192b6B456483C2E8',
  COINc: '0xb200000000000000000000c85a31389D71F3ecfb',
  CRCLc: '0xB20000000000000000000019f6E7C675b73C2e4D',
  GOOGLc: '0xb2000000000000000000002D0BA3164cc74f58B7',
  INTCc: '0xB2000000000000000000004AFF16039bA04bdFBc',
  METAc: '0xb2000000000000000000008bC8786B856E61707C',
  MSFTc: '0xB200000000000000000000Ab99cFa739E253872B',
  MSTRc: '0xb2000000000000000000004884b426556b92883d',
  NVDAc: '0xb20000000000000000000078ee7ce2fE4908108C',
  SNDKc: '0xb200000000000000000000397293Cb8cda9a10c5',
  SPCXc: '0xb2000000000000000000007b9fcbd005511aCBd5',
  TSLAc: '0xb2000000000000000000001e800a7f5189430cD0',
}
const FEEDS = {
  AAPL: '0x787f13dEa48Db0897CbCDD985de77809D837F988',
  AMZN: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295',
  COIN: '0x408e44f504A7371a345F03a73dDC96A4b48e8aa7',
  CRCL: '0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33',
  GOOGL: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2',
  INTC: '0xAB657C39bac0D5886250D70849e2E3E008F2EECB',
  META: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D',
  MSFT: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c',
  MSTR: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a',
  NVDA: '0x04689a41629776563E6822F76f2e57D148d28513',
  SNDK: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA',
  SPCX: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68',
  TSLA: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4',
}

// Selectors from the Cobalt changelog's own table, which states them as the
// values from the frozen ABIs. The ERC-8056 ones are byte-identical to the ones
// exdate already dials on Robinhood Chain - that is the headline, and it is
// checked here rather than assumed.
const B20 = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  multiplier: '0x1b3ed722', // Beryl, deprecated-name-kept
  uiMultiplier: '0xa60bf13d', // ERC-8056
  newUIMultiplier: '0xdc767007',
  effectiveAt: '0x97a4064f',
  totalSupplyUI: '0x9bea6429',
  WAD_PRECISION: '0x785c0cf0',
}
const FEED = {
  description: '0x7284e416',
  decimals: '0x313ce567',
  latestRoundData: '0xfeaf968c',
  aggregator: '0x245a7bfc',
}

const uint = (hex) => (hex && hex !== '0x' ? BigInt(hex) : null)
const pad = (address) => `000000000000000000000000${address.replace(/^0x/, '').toLowerCase()}`

async function tryCall(to, data) {
  try {
    return { ok: true, data: await call(to, data) }
  } catch (error) {
    return { ok: false, error: error.message.replace(/^eth_call: /, '') }
  }
}

// --- 0. the ERC-8056 selectors, against a second first-party source -----------
//
// exdate computed its ERC-8056 selectors from the signatures and has been
// dialling them on Robinhood Chain since Phase 0. Base's Cobalt changelog states
// the same four as the values from its own frozen ABI - an independent source
// for the numbers, and free to check.
const CROSS_CHECK = {
  uiMultiplier: '0xa60bf13d',
  newUIMultiplier: '0xdc767007',
  effectiveAt: '0x97a4064f',
  totalSupplyUI: '0x9bea6429',
}
const selectorCrossCheck = Object.entries(CROSS_CHECK).map(([view, stated]) => ({
  view,
  exdate: SELECTOR[view] ?? null,
  baseFrozenAbi: stated,
  agrees: SELECTOR[view] === stated,
}))
console.log(
  `# ERC-8056 selectors: ${selectorCrossCheck.filter((row) => row.agrees).length}/${
    selectorCrossCheck.length
  } agree with Base's frozen ABI\n`,
)

const chainId = Number(BigInt(await base('eth_chainId', [])))
console.log(`# Base, chainId ${chainId}\n`)
if (chainId !== 8453) throw new Error(`expected chain 8453, got ${chainId}`)

// --- 1. the registry ----------------------------------------------------------
const registryCode = await base('eth_getCode', [REGISTRY, 'latest'])
const registryBytes = (registryCode.length - 2) / 2
console.log(`# registry ${REGISTRY}: ${registryBytes} bytes of code`)

/**
 * The docs name the registry and describe what it returns, but publish no ABI.
 * Rather than guess a signature, read the dispatcher: solc emits every public
 * selector as a PUSH4 immediate, so the contract states its own surface. Each
 * one is then dialled with a real token address to see which take one.
 */
const pushed = [...registryCode.matchAll(/63([0-9a-f]{8})/gi)].map((match) => `0x${match[1].toLowerCase()}`)
const selectors = [...new Set(pushed)]
/**
 * Three of the four answering selectors are OpenZeppelin AccessControl, checked
 * by hashing the signature (viem's toFunctionSelector) rather than recognised by
 * eye. The fourth matched none of 46 candidate names tried the same way, so it
 * is published as a selector and what it demonstrably returns - naming it would
 * be inventing an ABI, and rule 1 forbids that.
 */
const KNOWN_SELECTORS = {
  '0xa217fddf': 'DEFAULT_ADMIN_ROLE()',
  '0xe63ab1e9': 'PAUSER_ROLE()',
  '0x248a9ca3': 'getRoleAdmin(bytes32)',
}
const MULTIPLIER_AND_PAUSE = '0xd4197e82'
const probe = TOKENS.AAPLc
const registrySurface = []
for (const selector of selectors) {
  const [withArg, without] = [
    await tryCall(REGISTRY, `${selector}${pad(probe)}`),
    await tryCall(REGISTRY, selector),
  ]
  if (!withArg.ok && !without.ok) continue
  registrySurface.push({
    selector,
    signature: KNOWN_SELECTORS[selector] ?? null,
    takesATokenAddress: withArg.ok && withArg.data !== '0x' && withArg.data !== without.data,
    withTokenArg: withArg.ok ? withArg.data : null,
    noArg: without.ok ? without.data : null,
  })
}
console.log(`  ${selectors.length} selector(s) in the dispatcher, ${registrySurface.length} answered a call`)
for (const row of registrySurface) {
  console.log(
    `    ${row.selector} ${(row.signature ?? 'unknown signature').padEnd(22)} ` +
      `${row.takesATokenAddress ? 'takes a token address ->' : 'no-arg ->'} ` +
      `${(row.takesATokenAddress ? row.withTokenArg : row.noArg)?.slice(0, 74)}`,
  )
}

// --- 2. the tokens ------------------------------------------------------------
console.log(`\n# ${Object.keys(TOKENS).length} B20 tokens, read by address`)
const tokens = []
for (const [ticker, address] of Object.entries(TOKENS)) {
  const code = await base('eth_getCode', [address, 'latest'])
  const reads = {}
  for (const [view, selector] of Object.entries(B20)) reads[view] = await tryCall(address, selector)

  const row = {
    ticker,
    address,
    codeBytes: (code.length - 2) / 2,
    name: reads.name.ok ? decodeString(reads.name.data) : null,
    symbol: reads.symbol.ok ? decodeString(reads.symbol.data) : null,
    decimals: reads.decimals.ok ? Number(uint(reads.decimals.data)) : null,
    totalSupply: reads.totalSupply.ok ? uint(reads.totalSupply.data)?.toString() : null,
    multiplier: reads.multiplier.ok ? uint(reads.multiplier.data)?.toString() : null,
    uiMultiplier: reads.uiMultiplier.ok ? uint(reads.uiMultiplier.data)?.toString() : null,
    newUIMultiplier: reads.newUIMultiplier.ok ? uint(reads.newUIMultiplier.data)?.toString() : null,
    effectiveAt: reads.effectiveAt.ok ? uint(reads.effectiveAt.data)?.toString() : null,
    totalSupplyUI: reads.totalSupplyUI.ok ? uint(reads.totalSupplyUI.data)?.toString() : null,
    wadPrecision: reads.WAD_PRECISION.ok ? uint(reads.WAD_PRECISION.data)?.toString() : null,
    reverted: Object.entries(reads)
      .filter(([, result]) => !result.ok)
      .map(([view]) => view),
  }
  // The Cobalt alias is only an alias if it answers the same value.
  row.multiplierAliasAgrees =
    row.multiplier !== null && row.uiMultiplier !== null ? row.multiplier === row.uiMultiplier : null
  row.symbolMatchesDocsTicker = row.symbol === ticker
  tokens.push(row)

  console.log(
    `  ${ticker.padEnd(7)} ${String(row.codeBytes).padStart(4)}B code  ` +
      `${(row.symbol ?? '?').padEnd(7)} ${String(row.decimals ?? '?').padStart(2)}dp  ` +
      `multiplier ${row.multiplier === null ? '-' : (Number(row.multiplier) / 1e18).toFixed(9)}` +
      `${row.reverted.length ? `  reverted: ${row.reverted.join(',')}` : ''}`,
  )
}

// --- 3. the registry against every token --------------------------------------
//
// Chainlink says the registry "returns the multiplier and pause state for each
// token in a single call". That is testable without an ABI: dial the one
// selector that takes an address for all thirteen tokens and check the first
// word against what the token itself answers. If they agree everywhere, the
// registry IS the read path, and the token to registry link is established by
// address rather than by a document.
console.log(`\n# the registry at ${MULTIPLIER_AND_PAUSE}, against each token's own multiplier()`)
const registryReads = []
for (const row of tokens) {
  const result = await tryCall(REGISTRY, `${MULTIPLIER_AND_PAUSE}${pad(row.address)}`)
  const body = result.ok ? result.data.slice(2) : null
  const first = body ? BigInt(`0x${body.slice(0, 64)}`).toString() : null
  const second = body && body.length >= 128 ? BigInt(`0x${body.slice(64, 128)}`) : null
  registryReads.push({
    ticker: row.ticker,
    token: row.address,
    ok: result.ok,
    words: body ? body.length / 64 : 0,
    multiplier: first,
    secondWord: second === null ? null : second.toString(),
    agreesWithToken: first !== null && first === row.multiplier,
    error: result.ok ? null : result.error,
  })
  console.log(
    `  ${row.ticker.padEnd(7)} registry ${first ?? 'reverted'}  token ${row.multiplier ?? '-'}  ` +
      `${first !== null && first === row.multiplier ? 'agree' : 'DISAGREE'}  second word ${second ?? '-'}`,
  )
}

/**
 * A control: an address that is not a B20 token. If the registry answers the
 * same shape for anything, agreement above would prove nothing - so ask it about
 * WETH on Base and about an address that holds nothing at all.
 */
const CONTROLS = {
  'WETH (Base)': '0x4200000000000000000000000000000000000006',
  'no code': '0x0000000000000000000000000000000000000001',
}
const controls = []
for (const [label, address] of Object.entries(CONTROLS)) {
  const result = await tryCall(REGISTRY, `${MULTIPLIER_AND_PAUSE}${pad(address)}`)
  controls.push({ label, address, ok: result.ok, data: result.ok ? result.data : null, error: result.ok ? null : result.error })
  console.log(`  control ${label.padEnd(12)} ${result.ok ? result.data.slice(0, 66) : `reverted: ${result.error}`}`)
}

// --- 4. the feeds -------------------------------------------------------------
console.log(`\n# ${Object.keys(FEEDS).length} Chainlink proxies, read by address`)
const feeds = []
for (const [ticker, address] of Object.entries(FEEDS)) {
  const [description, decimals, round, aggregator] = await Promise.all([
    tryCall(address, FEED.description),
    tryCall(address, FEED.decimals),
    tryCall(address, FEED.latestRoundData),
    tryCall(address, FEED.aggregator),
  ])
  const parsed = round.ok ? decodeLatestRoundData(round.data) : null
  const row = {
    ticker,
    proxy: address,
    description: description.ok ? decodeString(description.data) : null,
    decimals: decimals.ok ? Number(uint(decimals.data)) : null,
    aggregator: aggregator.ok ? `0x${aggregator.data.slice(26)}` : null,
    roundId: parsed ? parsed.roundId.toString() : null,
    answer: parsed ? parsed.answer.toString() : null,
    updatedAt: parsed ? new Date(Number(parsed.updatedAt) * 1000).toISOString() : null,
    ageSeconds: parsed ? Math.round(Date.now() / 1000) - Number(parsed.updatedAt) : null,
  }
  // The same test the Robinhood map rests on: does the feed name its ticker?
  row.descriptionNamesTicker = row.description ? new RegExp(`\\b${ticker}\\b`).test(row.description) : false
  feeds.push(row)
  console.log(
    `  ${ticker.padEnd(6)} ${(row.description ?? '?').padEnd(16)} ${row.decimals}dp  ` +
      `${row.answer ?? '-'}  ${row.ageSeconds === null ? '' : `${Math.round(row.ageSeconds / 60)} min old`}`,
  )
}

// --- verdict ------------------------------------------------------------------
const answered = tokens.filter((token) => token.uiMultiplier !== null)
const erc8056 = tokens.filter((token) => token.reverted.length === 0)
const aliasAgrees = tokens.filter((token) => token.multiplierAliasAgrees === true)
const noBytecode = tokens.filter((token) => token.codeBytes === 0)
const tickerMatch = feeds.filter((feed) => feed.descriptionNamesTicker)
const registryAgrees = registryReads.filter((row) => row.agreesWithToken)
const controlsRefuse = controls.filter((row) => !row.ok || /^0x0*$/.test(row.data ?? ''))
const symbolMatch = tokens.filter((token) => token.symbolMatchesDocsTicker)

console.log(`\n# verdict`)
console.log(`  tokens answering uiMultiplier():          ${answered.length}/${tokens.length}`)
console.log(`  tokens answering every ERC-8056 view:     ${erc8056.length}/${tokens.length}`)
console.log(`  multiplier() == uiMultiplier():           ${aliasAgrees.length}/${tokens.length}`)
console.log(`  tokens with no bytecode (precompiles):    ${noBytecode.length}/${tokens.length}`)
console.log(`  token symbol() matches the docs ticker:   ${symbolMatch.length}/${tokens.length}`)
console.log(`  feeds naming their ticker in description: ${tickerMatch.length}/${feeds.length}`)
console.log(`  registry agrees with the token itself:    ${registryAgrees.length}/${tokens.length}`)
console.log(`  controls the registry refuses or zeroes:  ${controlsRefuse.length}/${controls.length}`)

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      note: 'Coinbase tokenized stocks on Base, read back from the chain by address. Every address here is copied from the Base documentation page in `source` and checked against mainnet; none is guessed. This closes the two items docs/second-issuer-base.md listed as unknown: the oracle registry address and the B20 token addresses.',
      source: SOURCE,
      chainId,
      erc8056SelectorCrossCheck: {
        note: "exdate computed these from the signatures for Robinhood Chain; the Cobalt changelog states them as the values from Base's frozen ABI. Two independent sources for the same four numbers.",
        source: 'https://docs.base.org/base-chain/specs/reference/b20/changelog/02-cobalt-b20asset-multiplier',
        agree: selectorCrossCheck.filter((row) => row.agrees).length,
        of: selectorCrossCheck.length,
        rows: selectorCrossCheck,
      },
      registry: {
        address: REGISTRY,
        codeBytes: registryBytes,
        note: 'The docs name the registry and describe what it returns but publish no ABI, so its public selectors are read out of its own dispatcher rather than guessed, then dialled with a real token address.',
        dispatcherSelectors: selectors.length,
        surface: registrySurface,
        multiplierAndPauseSelector: MULTIPLIER_AND_PAUSE,
        multiplierAndPauseSignature: null,
        multiplierAndPauseNote:
          'No candidate signature tried matched this selector, so it is left unnamed rather than guessed. What it does is measured: called with a token address it returns two words - the WAD multiplier the token itself reports, and a flag that reads false on every token today, which is the pause state Chainlink describes.',
        readsPerToken: registryReads,
        controls,
      },
      summary: {
        tokens: tokens.length,
        tokensAnsweringUiMultiplier: answered.length,
        tokensAnsweringEveryErc8056View: erc8056.length,
        multiplierAliasAgrees: aliasAgrees.length,
        tokensWithNoBytecode: noBytecode.length,
        tokenSymbolMatchesDocsTicker: symbolMatch.length,
        feeds: feeds.length,
        feedsNamingTheirTicker: tickerMatch.length,
        registryAgreesWithToken: registryAgrees.length,
        controlsRefusedOrZeroed: controlsRefuse.length,
      },
      tokens,
      feeds,
    },
    null,
    2,
  )}\n`,
)
console.log(`\nwrote ${OUT}`)
