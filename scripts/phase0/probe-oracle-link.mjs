// Is there an on-chain link between a Stock Token and its Chainlink feed?
//
// `data/token-feed-map.json` is derived from the feed's display name - the one
// place exdate identifies a token by symbol, and the reason every reconciliation
// row is `confidence: low`. A first-party, address-based link would fix that, so
// this script looks for one instead of assuming there is none.
//
// It does not guess function names. It reads the contract's own bytecode, pulls
// every 4-byte selector out of the dispatcher, calls each one with no arguments,
// and reports the ones that answer with something address-shaped. Whatever a
// contract is willing to tell you about another address, this finds.
//
//   node scripts/phase0/probe-oracle-link.mjs [tokenAddress] [feedProxyAddress]

import { rpc } from './rpc.mjs'

const TOKEN = (process.argv[2] ?? '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5').toLowerCase()
const FEED = (process.argv[3] ?? '0xa0DF4ee0fFf975306345875E3548Fcc519577A11').toLowerCase()
const BEACON_IMPLEMENTATION = '0xe10b6f6b275de231345c20d14ab812db62151b00'

/**
 * Every `PUSH4 <selector>` in the runtime code. Solidity's dispatcher compares
 * the incoming selector against each one, so this over-collects (a PUSH4 can be
 * any constant) but never misses a public function.
 */
function selectorsFrom(code) {
  const bytes = code.startsWith('0x') ? code.slice(2) : code
  const found = new Set()
  for (let i = 0; i + 10 <= bytes.length; i += 2) {
    if (bytes.slice(i, i + 2) !== '63') continue // PUSH4
    const selector = bytes.slice(i + 2, i + 10)
    if (/^[0-9a-f]{8}$/.test(selector) && selector !== '00000000' && selector !== 'ffffffff') {
      found.add(`0x${selector}`)
    }
  }
  return [...found]
}

const ADDRESS_SHAPED = /^0x000000000000000000000000[0-9a-f]{40}$/

async function probe(target, selectors, label) {
  console.log(`\n# ${label} (${target}) - ${selectors.length} candidate selectors`)
  const hits = []
  for (const selector of selectors) {
    let result
    try {
      result = await rpc('eth_call', [{ to: target, data: selector }, 'latest'])
    } catch {
      continue // reverts, needs arguments, or is not a function at all
    }
    if (typeof result !== 'string' || result.length !== 66) continue
    if (!ADDRESS_SHAPED.test(result)) continue
    const address = `0x${result.slice(26)}`
    if (address === '0x0000000000000000000000000000000000000000') continue
    hits.push({ selector, address })
    console.log(`  ${selector} -> ${address}`)
  }
  if (hits.length === 0) console.log('  (nothing address-shaped)')
  return hits
}

const [tokenCode, feedCode, implementationCode] = await Promise.all([
  rpc('eth_getCode', [TOKEN, 'latest']),
  rpc('eth_getCode', [FEED, 'latest']),
  rpc('eth_getCode', [BEACON_IMPLEMENTATION, 'latest']),
])

console.log(`token proxy code: ${(tokenCode.length - 2) / 2} bytes`)
console.log(`token implementation code: ${(implementationCode.length - 2) / 2} bytes`)
console.log(`feed proxy code: ${(feedCode.length - 2) / 2} bytes`)

// The token is a 283-byte beacon proxy, so its own code holds no dispatcher:
// the selectors to try are the implementation's, called through the proxy.
const tokenSelectors = selectorsFrom(implementationCode)
const feedSelectors = selectorsFrom(feedCode)

const tokenHits = await probe(TOKEN, tokenSelectors, 'Stock Token')
const feedHits = await probe(FEED, feedSelectors, 'Chainlink proxy')

console.log('\n# verdict')
const tokenNamesFeed = tokenHits.some((hit) => hit.address.toLowerCase() === FEED)
const feedNamesToken = feedHits.some((hit) => hit.address.toLowerCase() === TOKEN)
if (tokenNamesFeed) console.log(`  the token names ${FEED} - the mapping can be verified on chain`)
if (feedNamesToken) console.log(`  the feed names ${TOKEN} - the mapping can be verified on chain`)
if (!tokenNamesFeed && !feedNamesToken) {
  console.log('  neither contract names the other.')
  console.log('  Addresses either side points at, for the record:')
  for (const hit of [...tokenHits, ...feedHits]) console.log(`    ${hit.selector} -> ${hit.address}`)
}
