// Minimal JSON-RPC client with a global rate limiter.
//
// The public Robinhood Chain endpoint answers 429 aggressively and times out on
// wide eth_getLogs ranges, so every Phase 0 script funnels through here rather
// than through a library that would fan out concurrent requests.

const RPC_URL = process.env.RHC_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'

let lastCallAt = 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function rpc(method, params, { minGap = 350, tries = 8 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const wait = minGap - (Date.now() - lastCallAt)
    if (wait > 0) await sleep(wait)
    lastCallAt = Date.now()

    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1))
      continue
    }
    const body = await res.json()
    if (body.error) {
      if (/rate|too many/i.test(body.error.message ?? '')) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw new Error(`${method}: ${body.error.message}`)
    }
    return body.result
  }
  throw new Error(`${method}: still rate limited after ${tries} attempts`)
}

export const hex = (n) => '0x' + BigInt(n).toString(16)
export const RPC_URL_IN_USE = RPC_URL

// Function selectors used by the Phase 0 scripts.
export const SELECTOR = {
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  uiMultiplier: '0xa60bf13d',
  newUIMultiplier: '0xdc767007',
  effectiveAt: '0x97a4064f',
  oraclePaused: '0x7706ba52',
  totalSupplyUI: '0x9bea6429',
  latestRoundData: '0xfeaf968c',
  description: '0x7284e416',
}

// Event topic0 values.
export const TOPIC = {
  UIMultiplierUpdated: '0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055',
  TransferWithScaledUI: '0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802',
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
}

export function decodeString(returnData) {
  const words = returnData.slice(2)
  const length = Number(BigInt('0x' + words.slice(64, 128)))
  return Buffer.from(words.slice(128, 128 + length * 2), 'hex').toString('utf8')
}

export function decodeUIMultiplierUpdated(data) {
  const words = data.slice(2)
  return {
    oldMultiplier: BigInt('0x' + words.slice(0, 64)),
    newMultiplier: BigInt('0x' + words.slice(64, 128)),
    effectiveAt: BigInt('0x' + words.slice(128, 192)),
  }
}

export function decodeLatestRoundData(data) {
  const words = data.slice(2)
  let answer = BigInt('0x' + words.slice(64, 128))
  if (answer >= 2n ** 255n) answer -= 2n ** 256n // int256
  return {
    roundId: BigInt('0x' + words.slice(0, 64)),
    answer,
    startedAt: BigInt('0x' + words.slice(128, 192)),
    updatedAt: BigInt('0x' + words.slice(192, 256)),
  }
}
