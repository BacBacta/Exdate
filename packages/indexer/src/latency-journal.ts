import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DeliveryJournal, DeliveryJournalEntry } from '@exdate/core'

/**
 * Concluded webhook deliveries, in a file the process owns.
 *
 * The same shape and the same reason as FileSubscriptionStore: a schema drop must not reach it.
 * `deploy/update-api.sh` drops the Ponder schema whenever a code deploy changes its build id, and
 * on 2026-09-06 that took every delivery row with it - so the one figure the outbox exists to
 * support, the latency, would have restarted from zero at every deploy.
 *
 * JSONL rather than one JSON document, because this is append-only: a concluded delivery is never
 * edited. Trimmed to the newest CAP entries when it grows past them, since the published figure is
 * a median over recent deliveries and an unbounded file on a volume is its own failure.
 */
const CAP = Number(process.env.EXDATE_LATENCY_JOURNAL_CAP ?? 5_000)

export class FileDeliveryJournal implements DeliveryJournal {
  constructor(private readonly path: string) {}

  async list(): Promise<DeliveryJournalEntry[]> {
    if (!existsSync(this.path)) return []
    const rows: DeliveryJournalEntry[] = []
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        rows.push(JSON.parse(line) as DeliveryJournalEntry)
      } catch {
        // One unreadable line must not cost the whole record. A truncated last line is what a
        // process killed mid-append leaves behind, and every other line is still a fact.
      }
    }
    return rows
  }

  async append(entry: DeliveryJournalEntry): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true })
    const rows = await this.list()
    rows.push(entry)
    const kept = rows.length > CAP ? rows.slice(rows.length - CAP) : rows
    // Written whole and renamed into place, like the subscription store: a reader never sees a
    // half-written file, and the trim happens without a second code path.
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, kept.map((row) => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 })
    renameSync(temporary, this.path)
  }
}

/**
 * The journal this process uses. A path is always configured - unlike the subscription store,
 * which is off unless the operator turns it on - because the measurement it protects is not
 * optional and it costs nothing when nothing is delivered.
 */
export const deliveryJournal = new FileDeliveryJournal(
  process.env.EXDATE_LATENCY_JOURNAL_FILE ?? '.exdate/webhook-deliveries.jsonl',
)
