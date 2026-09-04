// Is this machine able to do the watcher's job? Ask before it matters.
//
// The watcher exists to be present at an instant that happens once and cannot be
// read back. Finding out it could not push, or could not reach the issuer, at
// the moment a dividend lands is finding out too late. So every dependency it
// has is checked here, on demand, and each check says what it actually did.
//
// The clock check is the one that is easy to forget and expensive to get wrong:
// the watcher wakes at effectiveAt minus thirty seconds by the machine's own
// clock, so a clock minutes off samples the wrong moment. It would not record a
// false distance - that is computed from the issuer's own timestamp against the
// chain's - but it would miss the window and record nothing, which is the same
// loss.
//
//   node scripts/check-watcher.mjs
//   node scripts/check-watcher.mjs --send-test-alert    also proves delivery
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { rpc } from './phase0/rpc.mjs'
import { DEFAULT_OUT, loadState, loadSymbolMap, quote } from './lib/effective-prices.mjs'
import { send, sinksFromEnv } from './lib/alert.mjs'

const root = new URL('../', import.meta.url)
const cwd = new URL('.', root).pathname
const OUT = process.env.EXDATE_CAPTURE_OUT || DEFAULT_OUT
const SEND_TEST = process.argv.includes('--send-test-alert')
const PUSH = process.env.EXDATE_WATCH_PUSH !== 'false'
/** Beyond this the watcher wakes at the wrong second and misses windows it would otherwise catch. */
const CLOCK_TOLERANCE_SECONDS = 5

const checks = []
const record = (name, ok, detail, { fatal = true } = {}) => {
  checks.push({ name, ok, detail, fatal })
  console.log(`${ok ? ' ok ' : fatal ? 'FAIL' : 'warn'}  ${name.padEnd(22)} ${detail}`)
}

const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

console.log(`exdate watcher preflight on ${hostname()}\n`)

// 1. Node. The scripts use top-level await and modern built-ins.
const major = Number(process.versions.node.split('.')[0])
record('node', major >= 20, `v${process.versions.node}${major >= 20 ? '' : ' — needs 20 or newer'}`)

// 2. A working copy on a branch, with a remote to push to.
let branch = null
try {
  branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const remote = git(['remote', 'get-url', 'origin'])
  record('repository', branch !== 'HEAD', `branch ${branch}, origin ${remote.replace(/\/\/[^@]*@/, '//')}`)
} catch (error) {
  record('repository', false, `not a usable git checkout: ${String(error.message).split('\n')[0]}`)
}

// 3. Push access, proved without writing anything: the same handshake a real
//    push does, refused early. A read-only key passes fetch and fails here.
if (!PUSH) {
  record('push access', true, 'EXDATE_WATCH_PUSH=false — the watcher will not push, so this is not checked', { fatal: false })
} else if (branch) {
  try {
    git(['push', '--dry-run', '--quiet', 'origin', `HEAD:${branch}`])
    record('push access', true, `origin accepts a push to ${branch}`)
  } catch (error) {
    const why = String(error.stderr || error.message).split('\n').filter(Boolean).slice(-1)[0] ?? 'refused'
    record('push access', false, `cannot push to ${branch}: ${why.slice(0, 120)}`)
  }
}

// 4. The chain, through the exact scan a tick performs.
try {
  const head = Number(await rpc('eth_blockNumber', []))
  const logs = await rpc('eth_getLogs', [
    { fromBlock: '0x' + BigInt(Math.max(1, head - 900_000)).toString(16), toBlock: '0x' + BigInt(head).toString(16), topics: ['0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055'] },
  ])
  record('chain', true, `head ${head}, a day of announcements scanned, ${logs.length} log(s)`)
} catch (error) {
  record('chain', false, `RPC unusable: ${String(error.message).slice(0, 110)}`)
}

// 5. The issuer's quote endpoint, on a real symbol. This is the thing that
//    cannot be read back, so a machine that cannot reach it is useless here -
//    and a datacenter address may be treated differently from a GitHub runner.
const symbols = [...loadSymbolMap(root).values()]
const probeSymbol = symbols.includes('AAPL') ? 'AAPL' : symbols[0]
const q = await quote(probeSymbol)
record('issuer quotes', Boolean(q), q ? `${probeSymbol} mid ${q.mid}, issuer timestamp ${q.generatedAt}` : `no quote for ${probeSymbol}: rate limited, blocked, or unreachable`)

// 6. The clock. Measured against the issuer's own Date header, since that is the
//    server the sampling is timed against.
try {
  const began = Date.now()
  const response = await fetch(`https://api.robinhood.com/rhj/prices/${probeSymbol}`, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
  const roundTrip = Date.now() - began
  const served = Date.parse(response.headers.get('date') ?? '')
  if (Number.isFinite(served)) {
    // The header has one-second resolution and the reply spent half the round
    // trip in flight, so anything inside a couple of seconds is simply agreement.
    const skew = Math.abs(Date.now() - roundTrip / 2 - served) / 1000
    record('clock', skew <= CLOCK_TOLERANCE_SECONDS, `${skew.toFixed(1)} s from the issuer's clock (round trip ${roundTrip} ms)${skew > CLOCK_TOLERANCE_SECONDS ? ' — enable NTP, the watcher samples on this clock' : ''}`)
  } else {
    record('clock', true, 'no Date header to compare against; assumed correct', { fatal: false })
  }
} catch (error) {
  record('clock', true, `not checked: ${String(error.message).slice(0, 60)}`, { fatal: false })
}

// 7. Where a notice would go. Not fatal: the watcher's job is the capture, and
//    an unarmed sink loses an alert, not a measurement.
const sinks = sinksFromEnv()
if (sinks.length === 0) {
  record('alerts', true, 'no sink configured — the nine-minute lead is measured and told to nobody', { fatal: false })
} else if (SEND_TEST) {
  try {
    const delivered = await send(sinks, `exdate watcher preflight on ${hostname()}: this is a test notice.`)
    record('alerts', delivered, delivered ? `${sinks.length} sink(s), test notice delivered` : 'some sinks refused the test notice', { fatal: false })
  } catch (error) {
    record('alerts', false, `every sink refused: ${String(error.message).slice(0, 100)}`, { fatal: false })
  }
} else {
  record('alerts', true, `${sinks.map((s) => s.kind).join(', ')} configured — pass --send-test-alert to prove delivery`, { fatal: false })
}

// 8. The state file the watcher shares with the GitHub watchdog.
try {
  const { state, captures } = loadState(root, OUT)
  const watcher = state.watcher
  record(
    'state file',
    true,
    `${captures.length} step(s) on record` +
      (watcher ? `, last heartbeat ${watcher.heartbeatAt} from ${watcher.host ?? 'unknown host'}` : ', no watcher heartbeat yet'),
  )
} catch (error) {
  record('state file', false, `${OUT} unreadable: ${String(error.message).slice(0, 90)}`)
}

const failed = checks.filter((c) => !c.ok && c.fatal)
const warned = checks.filter((c) => !c.ok && !c.fatal)
console.log(
  `\n${checks.length - failed.length - warned.length}/${checks.length} ready` +
    (warned.length ? `, ${warned.length} warning(s)` : '') +
    (failed.length ? `, ${failed.length} blocking: ${failed.map((c) => c.name).join(', ')}` : ''),
)
if (failed.length) {
  console.log('\nThe watcher would run but could not do its job. Fix the blocking checks first.')
  process.exit(1)
}
console.log('\nStart it with: systemctl enable --now exdate-watcher   (or: node scripts/watch-effective-prices.mjs)')
