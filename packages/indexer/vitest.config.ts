import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * `ponder:schema` and `ponder:registry` are virtual modules the Ponder runtime
 * provides. Aliasing them lets the outbox and the poller be tested as plain
 * code, without a chain, a database or the Ponder process - see
 * test/webhooks.test.ts and test/poll.test.ts for what that does and does not
 * cover. The registry double captures the handler instead of scheduling it,
 * which is the only way to call a poller that is registered rather than
 * exported.
 */
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
  resolve: {
    alias: {
      'ponder:schema': fileURLToPath(new URL('./ponder.schema.ts', import.meta.url)),
      'ponder:registry': fileURLToPath(new URL('./test/fixtures/ponder-registry.ts', import.meta.url)),
    },
  },
})
