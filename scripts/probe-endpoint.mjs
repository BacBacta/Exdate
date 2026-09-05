// What can THIS endpoint do? Run it against your own, keyed URL.
//
// The public-registry probe (scripts/probe-rpc-endpoints.mjs) answers the same
// questions for endpoints anyone can reach. This one answers them for yours,
// whose URL carries a secret - so it never prints the URL, only the host with
// its path redacted, and it writes no file. Paste its output anywhere; paste the
// URL nowhere.
//
//   RHC_RPC_URLS='https://…/v2/YOUR_KEY' node scripts/probe-endpoint.mjs
//   node scripts/probe-endpoint.mjs 'https://…/v2/YOUR_KEY'
//
// The two tests that decide where an endpoint can be used here:
//
//   watcher span   eth_getLogs over 900 000 blocks, which is what
//                  scripts/watch-effective-prices.mjs scans on every tick. An
//                  endpoint that refuses it cannot be the watcher's primary: it
//                  would fail and fall through to the next one every 30 seconds,
//                  costing a request and still reaching the fallback.
//   oldest step    eth_call at the block of the oldest multiplier change, which
//                  is what the wallet history and the state verification need.
//                  Tested as state that DIFFERS from latest, because an endpoint
//                  serving head state at every height would otherwise pass.
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)

/**
 * Where the URL comes from, in order: an argument, the environment, then the
 * .env file beside this checkout.
 *
 * The last one exists because pasting a keyed URL onto a command line is where
 * this goes wrong. A phone terminal wraps it, the wrap arrives as a newline, the
 * shell takes the first half as the command and the rest as another line - and
 * the endpoint answers 401 for a truncated key, which reads exactly like a
 * billing problem. Editing .env once in an editor has no such failure, and the
 * URL then lives only where the watcher already needs it.
 */
function fromEnvFile() {
  for (const path of [process.env.EXDATE_ENV_FILE, new URL('.env', root).pathname]) {
    if (!path) continue
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const name of ['RHC_RPC_URLS', 'RHC_RPC_URL_ARCHIVE', 'RHC_RPC_URL']) {
      const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'))
      const value = match?.[1]?.trim().replace(/^["']|["']$/g, '')
      if (value) return { value, from: `${name} in ${path}` }
    }
  }
  return null
}

const fromArg = process.argv[2]
const fromEnv = (process.env.RHC_RPC_URLS || process.env.RHC_RPC_URL || '').split(',')[0]?.trim()
const file = fromArg || fromEnv ? null : fromEnvFile()
const url = (fromArg || fromEnv || file?.value || '').split(',')[0]?.trim()
if (!url) {
  console.error(`No endpoint to probe. Either:

  put it in ${new URL('.env', root).pathname} as
      RHC_RPC_URLS=https://…,https://rpc.mainnet.chain.robinhood.com
  and run this with no arguments — no pasting onto a command line, which is
  where a wrapped URL gets truncated and answers 401;

  or pass it as an argument, in single quotes.`)
  process.exit(1)
}
if (file) console.log(`Taking the endpoint from ${file.from}`)
/** Host only. The path is where a key lives, so it never reaches the output. */
const safe = (u) => {
  try {
    const parsed = new URL(u)
    return parsed.pathname === '/' ? parsed.host : `${parsed.host}/…redacted…`
  } catch {
    return '(unparseable URL)'
  }
}

// A URL whose key segment is missing, a placeholder, or truncated by a paste
// produces an HTTP 401 that reads like a billing problem. Say so before asking.
{
  const path = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return ''
    }
  })()
  const key = path.split('/').filter(Boolean).pop() ?? ''
  if (/^(YOUR_KEY|VOTRE_CLE|API_KEY|<.*>|\{.*\})$/i.test(key)) {
    console.error(`The URL still carries the placeholder "${key}". Put your real key there.`)
    process.exit(1)
  }
  if (path.includes('/v2/') && key.length < 20) {
    console.error(
      `The key segment of that URL is only ${key.length} characters, which is shorter than any real one —\n` +
        'the paste was probably truncated. Copy the whole URL from the Alchemy dashboard again.',
    )
    process.exit(1)
  }
}

const PROBE_TOKEN = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
const TOTAL_SUPPLY = '0x18160ddd'
const UI_MULTIPLIER_UPDATED = '0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055'
const WATCHER_SPAN = Number(process.env.EXDATE_WATCH_LOOKBACK_BLOCKS || 900_000)
const OLDEST_STEP_BLOCK = Math.min(
  ...JSON.parse(readFileSync(new URL('data/effective-blocks.json', root), 'utf8')).blocks.map((b) => b.effectiveBlock),
)
const hex = (n) => '0x' + BigInt(n).toString(16)

async function call(method, params, ms = 30_000) {
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
      // The server's own words, not "not JSON". A 401 says whether the key is
      // wrong, absent or not entitled to this network, and none of that is a
      // secret - it is what the endpoint tells anyone who asks. Trimmed and
      // capped so a stray HTML error page cannot flood the terminal.
      const said = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
      return { err: `HTTP ${response.status}${said ? `: ${said}` : ', empty body'}`, ms: Date.now() - began }
    }
    if (body.error) return { err: String(body.error.message).slice(0, 130), ms: Date.now() - began }
    return { ok: body.result, ms: Date.now() - began }
  } catch (error) {
    return { err: error.name === 'TimeoutError' ? 'timeout' : String(error.message).slice(0, 90), ms: Date.now() - began }
  }
}

/**
 * Says what it is about to do before doing it, then overwrites that with the
 * answer. The widest check asks for 900 000 blocks of logs and can sit there for
 * a minute or more; without this the whole probe looks dead, which is how it was
 * first reported.
 */
const start = (name) => process.stdout.write(`  …  ${name.padEnd(22)} asking…`)
const line = (name, verdict, detail) =>
  process.stdout.write(`\r${verdict ? ' ok ' : 'NO  '} ${name.padEnd(22)} ${detail}\u001b[K\n`)
console.log(`Probing ${safe(url)}\n`)

start('chain')
const chain = await call('eth_chainId', [])
if (chain.err) {
  line('reachable', false, chain.err)
  if (/^HTTP 401/.test(chain.err)) {
    // The key's LENGTH, never the key. An Alchemy key is 32 characters; 33 means
    // a stray quote or space rode along with the paste, and that is a different
    // fix from a key the dashboard no longer recognises.
    const key = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    const stray = /[^A-Za-z0-9_-]/.test(key)
    console.log(
      `\n     The endpoint rejected the credential itself. The key segment is ${key.length} characters` +
        (stray ? ` and contains a character no key has - a quote or space from the paste. Remove it.` : `.`) +
        (!stray && key.length !== 32 ? ` Alchemy's are 32; check it against the dashboard.` : '') +
        (!stray && key.length === 32
          ? ` That is the right shape, so the dashboard no longer accepts this key: copy the current one for the Robinhood Mainnet app.`
          : ''),
    )
  }
  process.exit(1)
}
const chainId = parseInt(chain.ok, 16)
line('chain', chainId === 4663, `chainId ${chainId}${chainId === 4663 ? '' : ' — not Robinhood Chain'} (${chain.ms} ms)`)
if (chainId !== 4663) process.exit(1)

start('head')
const headCall = await call('eth_blockNumber', [])
const head = Number(headCall.ok)
if (!Number.isFinite(head) || head < 1) {
  line('head', false, headCall.err ?? 'unusable head')
  process.exit(1)
}
line('head', true, `block ${head.toLocaleString()} (${headCall.ms} ms)`)

start('state at head')
const latest = await call('eth_call', [{ to: PROBE_TOKEN, data: TOTAL_SUPPLY }, 'latest'])
const latestSupply = latest.ok ? BigInt(latest.ok).toString() : null
line('state at head', Boolean(latestSupply), latestSupply ? `read in ${latest.ms} ms` : (latest.err ?? 'no answer'))

start('watcher span')
const logs = await call('eth_getLogs', [
  { fromBlock: hex(Math.max(1, head - WATCHER_SPAN)), toBlock: hex(head), topics: [UI_MULTIPLIER_UPDATED] },
])
line(
  'watcher span',
  Boolean(logs.ok),
  logs.ok
    ? `${WATCHER_SPAN.toLocaleString()} blocks accepted, ${logs.ok.length} log(s), ${logs.ms} ms — can be the watcher's primary`
    : `${WATCHER_SPAN.toLocaleString()} blocks refused: ${logs.err} — do NOT put this first in RHC_RPC_URLS`,
)

start('oldest step')
const oldest = await call('eth_call', [{ to: PROBE_TOKEN, data: TOTAL_SUPPLY }, hex(OLDEST_STEP_BLOCK)])
const reachesOldest = Boolean(oldest.ok) && BigInt(oldest.ok).toString() !== latestSupply
line(
  'oldest step',
  reachesOldest,
  reachesOldest
    ? `block ${OLDEST_STEP_BLOCK.toLocaleString()} answers with state of its own (${oldest.ms} ms) — usable as RHC_RPC_URL_ARCHIVE`
    : oldest.err
      ? `block ${OLDEST_STEP_BLOCK.toLocaleString()}: ${oldest.err}`
      : `block ${OLDEST_STEP_BLOCK.toLocaleString()} answered, but with head state — not a real archive`,
)

start('browsers')
const cors = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://www.exdate.me' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  signal: AbortSignal.timeout(20_000),
}).catch(() => null)
const browsers = cors?.headers.get('access-control-allow-origin') === '*'
line('browsers', browsers, browsers ? 'answers cross-origin — could serve /wallet/' : 'no wildcard CORS — server-side use only, which is all exdate needs of it')

console.log(`
Where this endpoint can go, from the above:
  watcher span ok        -> put it first in RHC_RPC_URLS on the watcher machine
  oldest step ok         -> put it in RHC_RPC_URL_ARCHIVE
  neither                -> leave the defaults alone; this endpoint adds nothing here
Never paste the URL itself anywhere. This output contains no key.`)
