import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * `ponder:schema` is a virtual module the Ponder runtime provides. Aliasing it
 * to the real schema file lets the outbox be tested as plain code, without a
 * chain, a database or the Ponder process - see test/webhooks.test.ts for what
 * that does and does not cover.
 */
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
  resolve: {
    alias: {
      'ponder:schema': fileURLToPath(new URL('./ponder.schema.ts', import.meta.url)),
    },
  },
})
