// What every public RPC endpoint for this chain can actually do.
//
// The repository spent its first weeks believing "there is no archive" - true of
// Robinhood's own endpoint, and it was the only one anyone had looked at. It is
// false of the chain: the public chain registries list several other endpoints,
// and at least one serves state at any height. That belief had shaped real
// decisions (two-tier indexing, a browser that replays transfer logs rather than
// reading a past balance, transfers declared unindexable), so the endpoints are
// now probed and the result committed like any other measurement.
//
// Three things are measured per endpoint, because they are independent and an
// endpoint can be excellent at one and useless at another:
//
//   archive     eth_call on a token's totalSupply() at several depths. State, not
//               block.number - Multicall3's getBlockNumber() answers on ANY node
//               and would report archive everywhere. A depth counts only when it
//               returns a value DIFFERENT from latest, since an endpoint that
//               silently serves head state for every height would otherwise pass.
//   logRange    the widest eth_getLogs span it accepts. Robinhood's own endpoint
//               takes 2,000,000 blocks; the archive one caps at 10,000. Neither
//               dominates, which is why the project uses both.
//   browser     whether it answers cross-origin, since /wallet/ reads the chain
//               from the visitor's own browser with no server in between.
//
// Cross-checking is the point, not a nicety: where two endpoints both answer a
// depth, their answers are compared, and a lone witness is reported as a lone
// witness.
//
//   node scripts/probe-rpc-endpoints.mjs
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const OUT = process.env.EXDATE_RPC_PROBE_OUT || 'data/rpc-endpoints.observed.json'
const CHAIN_ID = 4663
/** AAPL. Any Stock Token would do; this one has the deepest history to compare against. */
const PROBE_TOKEN = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
const TOTAL_SUPPLY = '0x18160ddd'
const UI_MULTIPLIER_UPDATED = '0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055'
const DEPTHS = [5_000, 100_000, 1_000_000, 20_000_000, 50_000_000]
/**
 * Arbitrary depths say how deep a node goes; this says whether it goes deep
 * enough to be useful. The oldest multiplier step is the oldest block exdate
 * ever needs to read, and a node that cannot reach it fails on exactly the
 * wallets the archive path exists for.
 */
const OLDEST_STEP_BLOCK = Math.min(
  ...JSON.parse(readFileSync(new URL('data/effective-blocks.json', root), 'utf8')).blocks.map((b) => b.effectiveBlock),
)
const LOG_SPANS = [2_000_000, 100_000, 10_000, 1_000]
const ORIGIN = 'https://exdate-bactas-projects.vercel.app'

const hex = (n) => '0x' + BigInt(n).toString(16)

async function call(url, method, params, ms = 25_000) {
  const began = Date.now()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(ms),
    })
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return { err: `HTTP ${response.status}, not JSON`, ms: Date.now() - began }
    }
    if (body.error) return { err: String(body.error.message).slice(0, 120), ms: Date.now() - began }
    return { ok: body.result, ms: Date.now() - began }
  } catch (error) {
    return { err: error.name === 'TimeoutError' ? 'timeout' : String(error.message).slice(0, 80), ms: Date.now() - began }
  }
}

/** The chain's own registries name the endpoints; this script does not invent any. */
async function discover() {
  const sources = [
    ['chainlist.org', 'https://chainlist.org/rpcs.json'],
    ['chainid.network', 'https://chainid.network/chains_mini.json'],
  ]
  const urls = new Map()
  const used = []
  for (const [name, url] of sources) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      const body = await response.json()
      const list = Array.isArray(body) ? body : Object.values(body)
      const chain = list.find((c) => c && typeof c === 'object' && c.chainId === CHAIN_ID)
      if (!chain) continue
      used.push(name)
      for (const entry of chain.rpc ?? []) {
        const u = typeof entry === 'string' ? entry : entry.url
        if (u?.startsWith('https://')) urls.set(u, true)
      }
    } catch {
      // a registry that does not answer is simply not a source this run
    }
  }
  return { urls: [...urls.keys()], sources: used }
}

const { urls, sources } = await discover()
if (urls.length === 0) throw new Error('no endpoint discovered; refusing to write a file that would read as "none exist"')
console.error(`# ${urls.length} https endpoint(s) from ${sources.join(' + ')}`)

const endpoints = []
for (const url of urls) {
  const host = new URL(url).host
  const row = { url, host }

  const chain = await call(url, 'eth_chainId', [])
  if (chain.err) {
    row.reachable = false
    row.error = chain.err
    console.error(`#   ${host.padEnd(34)} unreachable: ${chain.err}`)
    endpoints.push(row)
    continue
  }
  row.reachable = true
  row.chainId = parseInt(chain.ok, 16)
  if (row.chainId !== CHAIN_ID) {
    row.error = `answers chainId ${row.chainId}, not ${CHAIN_ID}`
    endpoints.push(row)
    continue
  }

  // An endpoint can answer eth_chainId and then fail on the head, which would
  // otherwise carry NaN into every block tag below.
  const headCall = await call(url, 'eth_blockNumber', [])
  const head = Number(headCall.ok)
  if (!Number.isFinite(head) || head < 1) {
    row.error = `answers eth_chainId but not eth_blockNumber: ${headCall.err ?? 'unusable head'}`
    console.error(`#   ${host.padEnd(34)} ${row.error}`)
    endpoints.push(row)
    continue
  }
  row.head = head
  const latest = await call(url, 'eth_call', [{ to: PROBE_TOKEN, data: TOTAL_SUPPLY }, 'latest'])
  row.latestSupply = latest.ok ? BigInt(latest.ok).toString() : null

  // Archive: a depth counts only when the value differs from latest.
  row.archive = {}
  for (const depth of DEPTHS) {
    const block = head - depth
    if (block < 1) continue
    const r = await call(url, 'eth_call', [{ to: PROBE_TOKEN, data: TOTAL_SUPPLY }, hex(block)])
    row.archive[depth] = r.err
      ? { block, answered: false, error: r.err }
      : {
          block,
          answered: true,
          supply: BigInt(r.ok).toString(),
          differsFromLatest: row.latestSupply !== null && BigInt(r.ok).toString() !== row.latestSupply,
        }
  }
  const deepest = Object.entries(row.archive)
    .filter(([, v]) => v.answered && v.differsFromLatest)
    .map(([d]) => Number(d))
  row.deepestArchiveDepth = deepest.length ? Math.max(...deepest) : 0
  row.servesArchive = row.deepestArchiveDepth > 0

  // The block that decides whether this node is usable for the wallet history.
  const oldest = await call(url, 'eth_call', [{ to: PROBE_TOKEN, data: TOTAL_SUPPLY }, hex(OLDEST_STEP_BLOCK)])
  row.oldestStepBlock = OLDEST_STEP_BLOCK
  row.reachesOldestStep = Boolean(oldest.ok) && BigInt(oldest.ok).toString() !== row.latestSupply
  if (oldest.err) row.oldestStepError = oldest.err
  if (row.reachesOldestStep) row.deepestArchiveDepth = Math.max(row.deepestArchiveDepth, head - OLDEST_STEP_BLOCK)

  // The widest eth_getLogs span accepted, topic-filtered.
  row.logs = {}
  for (const span of LOG_SPANS) {
    const r = await call(url, 'eth_getLogs', [{ fromBlock: hex(head - span), toBlock: hex(head), topics: [UI_MULTIPLIER_UPDATED] }])
    row.logs[span] = r.err ? { accepted: false, error: r.err } : { accepted: true, logs: r.ok.length, ms: r.ms }
    if (!r.err) break // spans are tried widest first; the first accepted one is the answer
  }
  row.widestLogSpan = Number(Object.entries(row.logs).find(([, v]) => v.accepted)?.[0] ?? 0)

  // Can a browser read it? /wallet/ has no server in between.
  const cors = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  row.answersBrowsers = cors?.headers.get('access-control-allow-origin') === '*'

  console.error(
    `#   ${host.padEnd(34)} archive ${row.servesArchive ? `${row.deepestArchiveDepth / 1e6}M deep` : 'no'}, ` +
      `oldest step ${row.reachesOldestStep ? 'reached' : 'no'}, ` +
      `getLogs ${row.widestLogSpan.toLocaleString()} blocks, browsers ${row.answersBrowsers ? 'yes' : 'no'}`,
  )
  endpoints.push(row)
}

/**
 * Where two endpoints answered the same depth, do they agree? A single endpoint
 * serving history is a claim; two agreeing is evidence. Reported per depth so a
 * depth with one witness is never presented as corroborated.
 */
const crossChecks = DEPTHS.map((depth) => {
  const answers = endpoints
    .filter((e) => e.archive?.[depth]?.answered && e.archive[depth].differsFromLatest)
    .map((e) => ({ host: e.host, supply: e.archive[depth].supply }))
  const distinct = new Set(answers.map((a) => a.supply))
  return {
    depth,
    witnesses: answers.length,
    agree: answers.length >= 2 ? distinct.size === 1 : null,
    hosts: answers.map((a) => a.host),
  }
}).filter((c) => c.witnesses > 0)

const archival = endpoints.filter((e) => e.servesArchive)
const result = {
  note:
    "Every public RPC endpoint for Robinhood Chain, probed for what it can actually do. Robinhood's own endpoint serves no archive, which is why this repository long recorded that the chain has none; that is false of the chain. Archive is tested with a state read whose value must DIFFER from latest, since block.number answers on any node and head state served for every height would otherwise pass.",
  chainId: CHAIN_ID,
  probeToken: PROBE_TOKEN,
  discoveredFrom: sources,
  observedAt: new Date().toISOString(),
  summary: {
    discovered: endpoints.length,
    reachable: endpoints.filter((e) => e.reachable).length,
    servingArchive: archival.length,
    deepestArchiveHost: archival.sort((a, b) => b.deepestArchiveDepth - a.deepestArchiveDepth)[0]?.host ?? null,
    widestLogSpanHost: [...endpoints].sort((a, b) => (b.widestLogSpan ?? 0) - (a.widestLogSpan ?? 0))[0]?.host ?? null,
    reachingOldestStep: endpoints.filter((e) => e.reachesOldestStep).length,
    browserReadableArchive: endpoints.filter((e) => e.reachesOldestStep && e.answersBrowsers).map((e) => e.host),
  },
  crossChecks,
  caveat:
    'These are third-party public endpoints with no service commitment. They are sound for history, which can be re-read at any time, and must not be depended on for a capture that cannot be re-read.',
  endpoints,
}

await writeFile(new URL(OUT, root), JSON.stringify(result, null, 2) + '\n')
console.error(
  `# wrote ${OUT}: ${result.summary.reachable}/${endpoints.length} reachable, ` +
    `${archival.length} serving archive (deepest: ${result.summary.deepestArchiveHost ?? 'none'})`,
)
