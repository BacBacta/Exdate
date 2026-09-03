import { defineConfig } from 'vitest/config'

export default defineConfig({
  // .mjs so the market-session classifier can be tested where it lives: it must
  // run on a bare `node` in the hourly sampling Action, with no install step.
  test: { include: ['test/**/*.test.{ts,mjs}'] },
})
