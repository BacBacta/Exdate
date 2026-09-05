import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSubscriptionStore } from '../src/subscriptions.js'
import type { WebhookSubscription } from '@exdate/api'

/**
 * The file store, as plain code: what it persists, what it refuses, what it
 * leaves on disk, and what the outbox sees.
 */
const row = (id: string, extra: Partial<WebhookSubscription> = {}): WebhookSubscription => ({
  id,
  url: `https://hooks.example.test/${id}`,
  secret: `whsec_${'a'.repeat(64)}`,
  events: null,
  description: null,
  createdAt: '2026-09-05T16:00:00.000Z',
  createdFrom: '203.0.113.7',
  revokedAt: null,
  ...extra,
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exdate-subs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('FileSubscriptionStore', () => {
  it('starts empty when the file does not exist, and creates it on the first write', async () => {
    const store = new FileSubscriptionStore(join(dir, 'nested', 'subs.json'))
    expect(await store.list()).toEqual([])
    await store.create(row('sub_1'))
    const mode = statSync(store.path).mode & 0o777
    expect(mode).toBe(0o600)
    expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700)
    expect(readdirSync(join(dir, 'nested'))).toEqual(['subs.json'])
  })

  it('persists across instances, rejects a duplicate id, and revokes once', async () => {
    const path = join(dir, 'subs.json')
    const first = new FileSubscriptionStore(path)
    await first.create(row('sub_1'))
    await first.create(row('sub_2', { events: ['feed.stale'] }))
    await expect(first.create(row('sub_1'))).rejects.toThrow('duplicate')
    const second = new FileSubscriptionStore(path)
    expect((await second.list()).map((r) => r.id)).toEqual(['sub_1', 'sub_2'])
    expect(await second.revoke('sub_1', '2026-09-05T17:00:00.000Z')).toBe(true)
    expect(await second.revoke('sub_1', '2026-09-05T18:00:00.000Z')).toBe(false)
    expect(await second.revoke('sub_9', '2026-09-05T18:00:00.000Z')).toBe(false)
    // The first instance sees the change: the cache is keyed on the file's mtime.
    expect((await first.list()).find((r) => r.id === 'sub_1')!.revokedAt).toBe('2026-09-05T17:00:00.000Z')
  })

  it('gives the outbox only the active subscriptions, as endpoints', async () => {
    const store = new FileSubscriptionStore(join(dir, 'subs.json'))
    await store.create(row('sub_1'))
    await store.create(row('sub_2', { events: ['dividend.reconciled'], revokedAt: '2026-09-05T17:00:00.000Z' }))
    await store.create(row('sub_3', { events: ['feed.stale', 'feed.resumed'] }))
    expect(store.activeEndpoints()).toEqual([
      { id: 'sub_1', url: 'https://hooks.example.test/sub_1', secret: `whsec_${'a'.repeat(64)}` },
      { id: 'sub_3', url: 'https://hooks.example.test/sub_3', secret: `whsec_${'a'.repeat(64)}`, events: ['feed.stale', 'feed.resumed'] },
    ])
  })

  it('refuses to read a file it cannot parse rather than overwrite it', async () => {
    const path = join(dir, 'subs.json')
    writeFileSync(path, '{not json')
    const store = new FileSubscriptionStore(path)
    await expect(store.list()).rejects.toThrow('not valid JSON')
    await expect(store.create(row('sub_1'))).rejects.toThrow('not valid JSON')
    expect(readFileSync(path, 'utf8')).toBe('{not json')
  })

  it('does not hand out its own rows to be mutated', async () => {
    const store = new FileSubscriptionStore(join(dir, 'subs.json'))
    await store.create(row('sub_1'))
    const rows = await store.list()
    rows[0]!.revokedAt = 'tampered'
    expect((await store.list())[0]!.revokedAt).toBeNull()
  })
})
