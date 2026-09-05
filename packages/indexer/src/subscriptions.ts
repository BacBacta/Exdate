import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { subscriptionEndpoint, type SubscriptionStore, type WebhookSubscription } from '@exdate/api'
import type { WebhookEndpoint } from '@exdate/core'

/**
 * Self-service subscriptions, kept in one JSON file beside the process.
 *
 * Why a file and not a table: the API runs inside the Ponder process and its
 * database handle is for reading; the subscriptions carry secrets and belong
 * in no table the API serves anyway. A file the process owns, mode 0600 in a
 * directory only it can enter, written whole under a temporary name and
 * renamed into place, is the same shape as the operator's own env var - a
 * list of endpoints outside the served data - with the one difference that
 * the API may append to it.
 *
 * The outbox reads the file at the start of every cycle and the API on every
 * request; both are cheap (the file is small) and cached on its mtime.
 */
export class FileSubscriptionStore implements SubscriptionStore {
  readonly path: string
  private cache: { mtimeMs: number; rows: WebhookSubscription[] } | null = null

  constructor(path: string) {
    this.path = resolve(path)
  }

  private read(): WebhookSubscription[] {
    if (!existsSync(this.path)) return []
    const mtimeMs = statSync(this.path).mtimeMs
    if (this.cache && this.cache.mtimeMs === mtimeMs) return this.cache.rows
    const raw = readFileSync(this.path, 'utf8')
    let parsed: unknown
    try {
      parsed = raw.trim() === '' ? [] : JSON.parse(raw)
    } catch {
      // A file this process could not parse is not one to overwrite: better
      // to refuse every subscription call than to silently drop them all.
      throw new Error(`${this.path} is not valid JSON; fix or remove it before subscriptions can be read`)
    }
    if (!Array.isArray(parsed)) throw new Error(`${this.path} must hold a JSON array`)
    const rows = parsed as WebhookSubscription[]
    this.cache = { mtimeMs, rows }
    return rows
  }

  private write(rows: WebhookSubscription[]) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.path)
    this.cache = null
  }

  async list() {
    return this.read().map((row) => ({ ...row }))
  }

  async create(subscription: WebhookSubscription) {
    const rows = this.read()
    if (rows.some((row) => row.id === subscription.id)) throw new Error(`duplicate subscription id ${subscription.id}`)
    this.write([...rows, { ...subscription }])
  }

  async revoke(id: string, at: string) {
    const rows = this.read()
    const row = rows.find((candidate) => candidate.id === id)
    if (!row || row.revokedAt) return false
    this.write(rows.map((candidate) => (candidate.id === id ? { ...candidate, revokedAt: at } : candidate)))
    return true
  }

  /** The endpoints the outbox delivers to: every subscription not revoked. Synchronous, for the drain. */
  activeEndpoints(): WebhookEndpoint[] {
    return this.read()
      .filter((row) => row.revokedAt === null)
      .map(subscriptionEndpoint)
  }
}

/**
 * Off with EXDATE_WEBHOOK_SELF_SERVICE=false; otherwise a file under the
 * indexer's working directory, or wherever EXDATE_WEBHOOK_SUBSCRIPTIONS_FILE
 * points (a volume, in Docker, or nothing survives a rebuild).
 */
export const subscriptionStore: FileSubscriptionStore | null =
  process.env.EXDATE_WEBHOOK_SELF_SERVICE === 'false'
    ? null
    : new FileSubscriptionStore(process.env.EXDATE_WEBHOOK_SUBSCRIPTIONS_FILE ?? '.exdate/webhook-subscriptions.json')
