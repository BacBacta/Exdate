// Phase 0 - step 6: pull Robinhood's first-party corporate-actions feed and
// reconcile it against the UIMultiplierUpdated logs observed onchain.
//
//   GET https://api.robinhood.com/rhj/corporate-actions   (cache 1 h)
//
// This is the issuer's own record of each dividend (USD per share) and split
// (old/new rate), keyed by contract address. It is the "traditional side" of the
// reconciliation table - no third-party market-data vendor is needed for it.
//
// Caveats, all observed on 2026-09-02:
//   - history is shallow: the oldest COMPLETED row is processDate 2026-08-05.
//     Onchain events from July (CRWD, SGOV, MU, ORCL, DELL) have no row.
//     exdate must snapshot this endpoint continuously; Robinhood does not keep it.
//   - processDate is the issuer's scheduling day. The onchain effectiveAt lands
//     the next business day at ~15:10 UTC. Match on address + a 0-4 day window.
//   - only CASH_DIVIDEND rows are present so far; the CRWD x4 split is absent.
import { readFile, writeFile } from 'node:fs/promises'

const ENDPOINT = 'https://api.robinhood.com/rhj/corporate-actions'
const SNAPSHOT = new URL('../../data/robinhood-corporate-actions.snapshot.json', import.meta.url)
const EVENTS = new URL('../../data/multiplier-events.observed.json', import.meta.url)

let payload
try {
  const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  payload = await res.json()
  await writeFile(SNAPSHOT, JSON.stringify(payload, null, 2) + '\n')
} catch (error) {
  console.error(`# live fetch failed (${error.message}), falling back to snapshot`)
  payload = JSON.parse(await readFile(SNAPSHOT, 'utf8'))
}

const actions = payload.corpActions ?? []
const events = JSON.parse(await readFile(EVENTS, 'utf8')).events
const dateOf = (p) => (p ? `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` : null)
const dayMs = 86_400_000

const completed = actions.filter((a) => a.status === 'CORPORATE_ACTION_STATUS_COMPLETED')
const upcoming = actions.filter((a) => a.status === 'CORPORATE_ACTION_STATUS_IN_PROGRESS')
console.log(`# ${actions.length} corporate actions: ${completed.length} completed, ${upcoming.length} in progress`)

console.log('\n## completed actions -> matching onchain event (same address, effectiveAt within 0-4 days after processDate)')
console.log(['symbol', 'processDate', 'type', 'rate', 'onchain effectiveAt', 'observed step (bps)', 'implied reinvest price'].join('\t'))
const matchedEventBlocks = new Set()
for (const action of completed.sort((a, b) => dateOf(a.processDate).localeCompare(dateOf(b.processDate)))) {
  const address = action.deployments[0]?.contractAddress.toLowerCase()
  const processed = Date.parse(dateOf(action.processDate) + 'T00:00:00Z')
  const match = events.find((e) => {
    const lag = Date.parse(e.effectiveAt) - processed
    return e.token.toLowerCase() === address && lag >= 0 && lag <= 4 * dayMs
  })
  const detail = Object.values(action.details)[0]
  const rate = detail.rate ?? `${detail.oldRate}->${detail.newRate}`
  let implied = ''
  if (match && detail.rate) {
    // A reinvested cash dividend of R USD per share at price P raises the
    // multiplier by R / P. The observed step therefore implies the price at
    // which the issuer effectively reinvested, before knowing the real one.
    const step = Number(BigInt(match.newMultiplier) - BigInt(match.oldMultiplier)) / Number(BigInt(match.oldMultiplier))
    implied = (Number(detail.rate) / step).toFixed(2)
    matchedEventBlocks.add(match.block)
  }
  console.log([action.tokenSymbol, dateOf(action.processDate), action.type.replace('CORPORATE_ACTION_TYPE_', ''), rate, match?.effectiveAt ?? 'NONE', match?.stepBps ?? '', implied].join('\t'))
}

console.log('\n## onchain events with no corporate-action row')
for (const e of events) {
  if (!matchedEventBlocks.has(e.block)) console.log([e.symbol, e.effectiveAt, `+${e.stepBps} bps`].join('\t'))
}

console.log('\n## upcoming (this is the /v1/calendar input)')
console.log(['processDate', 'symbol', 'rate', 'address'].join('\t'))
for (const action of upcoming.sort((a, b) => (dateOf(a.processDate) ?? '').localeCompare(dateOf(b.processDate) ?? ''))) {
  const detail = Object.values(action.details)[0]
  console.log([dateOf(action.processDate) ?? '(unscheduled)', action.tokenSymbol, detail.rate ?? `${detail.oldRate}->${detail.newRate}`, action.deployments[0]?.contractAddress].join('\t'))
}
