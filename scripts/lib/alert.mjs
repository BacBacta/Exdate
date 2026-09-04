// Where a notice goes, and how it gets there.
//
// Shared by scripts/notify.mjs (the announcement and the applied notice), the
// persistent watcher, and the watchdog that checks on it. Sinks come from the
// environment, so in CI they are repository secrets and on a machine they are an
// .env file - the same names either way:
//
//   EXDATE_ALERT_WEBHOOK_URL    a Discord or Slack incoming webhook, or any endpoint
//                               that accepts { content, text }
//   EXDATE_TELEGRAM_BOT_TOKEN   with EXDATE_TELEGRAM_CHAT_ID
//
// With none configured nothing is sent, and the caller is told so it can say so:
// silence is a choice here, never a failure that went unnoticed.

export function sinksFromEnv(env = process.env) {
  const sinks = []
  if (env.EXDATE_ALERT_WEBHOOK_URL) sinks.push({ kind: 'webhook', url: env.EXDATE_ALERT_WEBHOOK_URL })
  if (env.EXDATE_TELEGRAM_BOT_TOKEN && env.EXDATE_TELEGRAM_CHAT_ID) {
    sinks.push({ kind: 'telegram', token: env.EXDATE_TELEGRAM_BOT_TOKEN, chatId: env.EXDATE_TELEGRAM_CHAT_ID })
  }
  return sinks
}

export async function post(sink, text, { fetchImpl = fetch } = {}) {
  const request =
    sink.kind === 'telegram'
      ? [
          `https://api.telegram.org/bot${sink.token}/sendMessage`,
          { chat_id: sink.chatId, text, disable_web_page_preview: true },
        ]
      : [sink.url, { content: text, text }]
  const response = await fetchImpl(request[0], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request[1]),
  })
  if (!response.ok) throw new Error(`${sink.kind} answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
}

/**
 * Sends to every sink; one failing sink must not stop the others, and a partial
 * send is not a send. Resolves true only when every sink took it; throws when
 * none did, so a caller that records "sent" cannot do so on silence.
 */
export async function send(sinks, text, { log = () => {}, fetchImpl = fetch } = {}) {
  if (sinks.length === 0) return false
  const failures = []
  for (const sink of sinks) {
    try {
      await post(sink, text, { fetchImpl })
    } catch (error) {
      failures.push(`${sink.kind}: ${error.message}`)
    }
  }
  if (failures.length === sinks.length) throw new Error(failures.join('; '))
  if (failures.length) log(`# partial delivery: ${failures.join('; ')}`)
  return failures.length === 0
}
