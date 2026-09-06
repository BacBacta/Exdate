import { getTableName } from 'drizzle-orm'

/**
 * A Ponder-shaped store over Maps, one per table.
 *
 * It implements the calls the indexer actually makes - find, insert().values() with
 * onConflictDoNothing / onConflictDoUpdate, update, delete, and sql.select().from() - and nothing
 * else. A double that implemented more would start asserting things about Ponder rather than about
 * this code, which is the same rule test/webhooks.test.ts states for its own smaller store.
 *
 * Rows are keyed on the table's primary key, read from the schema rather than hardcoded, because
 * the poller writes eight tables with five different key shapes and a hardcoded `id` would quietly
 * collapse 194 tokens into one row.
 */
type Row = Record<string, unknown>

/**
 * How a row is keyed, per table.
 *
 * Declared rather than introspected. Ponder's composite keys live in `primaryKey({columns})` in
 * the table's third argument, not on the columns, so reading them back means reaching into
 * Drizzle's internals - and a double that guessed wrong would silently collapse 194 tokens into
 * one row and pass every assertion about "the latest state".
 */
export const PONDER_KEYS: Record<string, string[]> = {
  tokens: ['chainId', 'address'],
  token_states: ['chainId', 'address'],
  multiplier_events: ['chainId', 'token', 'effectiveAt'],
  pause_events: ['chainId', 'token', 'at'],
  feed_rounds: ['chainId', 'feed', 'roundId'],
  feed_states: ['chainId', 'feed'],
  corporate_actions: ['id'],
  reconciliations: ['id'],
  sync_markers: ['chainId', 'key'],
  webhook_events: ['id'],
  webhook_deliveries: ['id'],
}

export function ponderStore(keys: Record<string, string[]> = PONDER_KEYS) {
  const tables = new Map<string, Map<string, Row>>()
  const nameOf = (table: unknown) => getTableName(table as never)
  const keysOf = (table: unknown) => {
    const declared = keys[nameOf(table)]
    if (!declared) throw new Error(`no key declared for table ${nameOf(table)}; add it to PONDER_KEYS`)
    return declared
  }
  const idOf = (table: unknown, row: Row) => keysOf(table).map((k) => String(row[k])).join('|')
  const rowsOf = (table: unknown) => {
    const name = nameOf(table)
    let rows = tables.get(name)
    if (!rows) tables.set(name, (rows = new Map()))
    return rows
  }

  const db = {
    find: async (table: unknown, key: Row) => rowsOf(table).get(idOf(table, key)) ?? null,
    insert: (table: unknown) => ({
      values: (row: Row) => {
        const rows = rowsOf(table)
        const id = idOf(table, row)
        return {
          onConflictDoNothing: async () => {
            if (rows.has(id)) return null
            rows.set(id, { ...row })
            return { ...row }
          },
          onConflictDoUpdate: async (patch: (existing: Row) => Row) => {
            const existing = rows.get(id)
            const next = existing ? { ...existing, ...patch(existing) } : { ...row }
            rows.set(id, next)
            return { ...next }
          },
          // A bare insert with no conflict clause, which Ponder resolves on await.
          then: (resolve: (value: Row) => unknown) => {
            rows.set(id, { ...row })
            return Promise.resolve({ ...row }).then(resolve)
          },
        }
      },
    }),
    update: (table: unknown, key: Row) => ({
      set: async (patch: Row | ((existing: Row) => Row)) => {
        const rows = rowsOf(table)
        const id = idOf(table, key)
        const existing = rows.get(id)
        if (!existing) return null
        const next = { ...existing, ...(typeof patch === 'function' ? patch(existing) : patch) }
        rows.set(id, next)
        return { ...next }
      },
    }),
    delete: async (table: unknown, key: Row) => rowsOf(table).delete(idOf(table, key)),
    sql: {
      select: () => ({
        from: async (table: unknown) => [...rowsOf(table).values()].map((row) => ({ ...row })),
      }),
    },
  }

  return {
    db,
    /** Every row of a table, for assertions. */
    rows: (table: unknown) => [...rowsOf(table).values()],
    /** Seed a row directly, to replay a poll that is not the first one. */
    put: (table: unknown, row: Row) => rowsOf(table).set(idOf(table, row), { ...row }),
    tables,
  }
}
