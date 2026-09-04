// Send what exdate knows first, to somewhere a person actually reads.
//
// The most perishable thing this project measures is the announcement lead: a
// multiplier change is published on chain about nine minutes before it takes effect,
// and until now nobody was told. A webhook outbox exists in the indexer, but the
// indexer is not hosted anywhere, so it has never delivered anything.
//
// This needs no host. It rides the capture run that is already watching for
// announcements every five minutes, reads the same committed file, and posts to
// whichever sinks are configured:
//
//   EXDATE_ALERT_WEBHOOK_URL    a Discord or Slack incoming webhook, or any endpoint
//                               that accepts { content, text }
//   EXDATE_TELEGRAM_BOT_TOKEN   with EXDATE_TELEGRAM_CHAT_ID
//
// With none configured it does nothing and says so: silence is a choice here, never a
// failure that went unnoticed. Delivery is recorded in the same file, which makes it
// an audit trail of what was announced and when it went out - the evidence for the
// lead the product claims.
//
//   node scripts/notify.mjs
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const CAPTURES = process.env.EXDATE_CAPTURE_OUT ?? 'data/effective-prices.observed.json'
const SITE = (process.env.EXDATE_SITE_URL ?? 'https://exdate-bactas-projects.vercel.app').replace(/\/+$/, '')
const EXPLORER = 'https://robinhoodchain.blockscout.com'

/** An announcement older than this was missed, not caught; sending it now would misrepresent the lead. */
const ANNOUNCE_MAX_AGE_SECONDS = Number(process.env.EXDATE_NOTIFY_MAX_AGE ?? 3600)

const sinks = []
if (process.env.EXDATE_ALERT_WEBHOOK_URL) sinks.push({ kind: 'webhook', url: process.env.EXDATE_ALERT_WEBHOOK_URL })
if (process.env.EXDATE_TELEGRAM_BOT_TOKEN && process.env.EXDATE_TELEGRAM_CHAT_ID) {
  sinks.push({ kind: 'telegram', token: process.env.EXDATE_TELEGRAM_BOT_TOKEN, chatId: process.env.EXDATE_TELEGRAM_CHAT_ID })
}
if (sinks.length === 0) {
  console.error('# no sink configured (EXDATE_ALERT_WEBHOOK_URL or EXDATE_TELEGRAM_BOT_TOKEN + EXDATE_TELEGRAM_CHAT_ID); nothing sent')
  process.exit(0)
}

let state
try {
  state = JSON.parse(readFileSync(new URL(CAPTURES, root), 'utf8'))
} catch {
  console.error(`# ${CAPTURES} does not exist yet; nothing to send`)
  process.exit(0)
}
const steps = state.steps ?? []

const bps = (oldM, newM) => Number(((BigInt(newM) - BigInt(oldM)) * 1_000_000n) / BigInt(oldM)) / 100
const decimal = (wad) => {
  const value = BigInt(wad)
  const whole = value / 10n ** 18n
  const fraction = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}
const minutes = (fromIso, toIso) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000)

async function post(sink, text) {
  const request =
    sink.kind === 'telegram'
      ? [
          `https://api.telegram.org/bot${sink.token}/sendMessage`,
          { chat_id: sink.chatId, text, disable_web_page_preview: true },
        ]
      : [sink.url, { content: text, text }]
  const response = await fetch(request[0], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request[1]),
  })
  if (!response.ok) throw new Error(`${sink.kind} answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
}

/** Sends to every sink; one failing sink must not stop the others, and a partial send is not a send. */
async function send(text) {
  const failures = []
  for (const sink of sinks) {
    try {
      await post(sink, text)
    } catch (error) {
      failures.push(`${sink.kind}: ${error.message}`)
    }
  }
  if (failures.length === sinks.length) throw new Error(failures.join('; '))
  if (failures.length) console.error(`# partial delivery: ${failures.join('; ')}`)
  return failures.length === 0
}

const now = Date.now()
let changed = false
let sent = 0

for (const step of steps) {
  const symbol = step.symbol ?? step.token
  const page = `${SITE}/t/${step.token.toLowerCase()}/`
  const step_bps = bps(step.oldMultiplier, step.newMultiplier)
  const sign = step_bps >= 0 ? '+' : ''

  // 1. The announcement, while the lead it reports is still true.
  if (!step.announcedNotifiedAt) {
    const age = (now - Date.parse(step.announcedAt)) / 1000
    const lead = minutes(step.announcedAt, step.effectiveAt)
    if (age > ANNOUNCE_MAX_AGE_SECONDS) {
      step.announcedNotifiedAt = null
      step.announcedNotSentReason = `seen ${Math.round(age / 60)} min after the announcement, past the point where sending it would report a lead rather than give one`
      changed = true
    } else {
      const text =
        `${symbol} · multiplier change announced, effective in ${lead} min\n` +
        `${decimal(step.oldMultiplier)} -> ${decimal(step.newMultiplier)}  (${sign}${step_bps.toFixed(2)} bps)\n` +
        `effective ${step.effectiveAt}\n` +
        `${EXPLORER}/tx/${step.announcedTx}\n${page}`
      if (await send(text)) {
        step.announcedNotifiedAt = new Date().toISOString()
        changed = true
        sent++
        console.error(`# sent announcement for ${symbol} (lead ${lead} min)`)
      }
    }
  }

  // 2. The moment it takes effect. Nothing is emitted on chain then - the clock is
  //    the only signal - so this is the one notice a log watcher cannot produce.
  if (!step.appliedNotifiedAt && Date.parse(step.effectiveAt) <= now) {
    const quote = step.quotes?.find((q) => Math.abs(q.distanceSeconds) <= 120)
    const text =
      `${symbol} · multiplier now applied  (${sign}${step_bps.toFixed(2)} bps)\n` +
      `${decimal(step.oldMultiplier)} -> ${decimal(step.newMultiplier)}\n` +
      `effective ${step.effectiveAt}\n` +
      (quote
        ? `underlying price at effect $${quote.mid} (${quote.distanceSeconds >= 0 ? '+' : ''}${quote.distanceSeconds}s)\n`
        : 'no price captured at the instant of the step\n') +
      page
    if (await send(text)) {
      step.appliedNotifiedAt = new Date().toISOString()
      changed = true
      sent++
      console.error(`# sent applied notice for ${symbol}`)
    }
  }
}

if (!changed) {
  console.error(`# nothing new to send (${steps.length} step(s) known, ${sinks.length} sink(s))`)
  process.exit(0)
}
state.steps = steps
await writeFile(new URL(CAPTURES, root), JSON.stringify(state, null, 2) + '\n')
console.error(`# sent ${sent} notice(s) to ${sinks.length} sink(s)`)
