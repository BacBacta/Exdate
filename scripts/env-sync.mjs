// Copy the root .env into the per-package .env.local files the tools read.
//
// Ponder loads packages/indexer/.env.local and Next loads apps/status/.env.local;
// neither reads a repository-root .env. Rather than document three files, the
// root .env is the one a developer edits and this copies it where it is read.
// A missing root .env is fine: every variable has a default that points at the
// public RPC and the local API.
import { copyFileSync, existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const source = new URL('.env', root)
if (!existsSync(source)) process.exit(0)
for (const target of ['packages/indexer/.env.local', 'apps/status/.env.local']) {
  copyFileSync(source, new URL(target, root))
}
