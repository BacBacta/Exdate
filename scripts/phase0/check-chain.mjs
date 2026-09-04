// Phase 0 - step 1: confirm the RPC endpoint, the chain id and the block cadence.
import { rpc, hex, RPC_URLS_IN_USE } from './rpc.mjs'

const chainId = Number(BigInt(await rpc('eth_chainId', [])))
const latest = BigInt(await rpc('eth_blockNumber', []))
const head = await rpc('eth_getBlockByNumber', [hex(latest), false])
const first = await rpc('eth_getBlockByNumber', ['0x1', false])
const back = await rpc('eth_getBlockByNumber', [hex(latest - 10_000n), false])

const cadence = Number(BigInt(head.timestamp) - BigInt(back.timestamp)) / 10_000

console.log('rpc            ', RPC_URLS_IN_USE.join(' -> '))
console.log('chainId        ', chainId, chainId === 4663 ? '(expected 4663 OK)' : '(UNEXPECTED)')
console.log('latest block   ', latest.toString())
console.log('head timestamp ', new Date(Number(BigInt(head.timestamp)) * 1000).toISOString())
console.log('block 1        ', new Date(Number(BigInt(first.timestamp)) * 1000).toISOString())
console.log('cadence        ', cadence.toFixed(4), 's/block')
console.log('blocks per day ', Math.round(86_400 / cadence).toLocaleString('en-US'))
