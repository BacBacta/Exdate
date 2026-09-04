// Before every build: copy the committed datasets into public/data so the site
// serves them itself. The repository may be private; the numbers are not.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const source = new URL('../../../data/', import.meta.url)
const target = new URL('../public/data/', import.meta.url)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
let n = 0
for (const name of readdirSync(source)) {
  if (!name.endsWith('.json')) continue
  copyFileSync(join(source.pathname, name), join(target.pathname, name))
  n++
}
console.log(`public/data: ${n} files`)

/**
 * The token list also gets a clean path at the site root. A token list is imported by
 * URL into a wallet or an aggregator, and that URL is quoted, bookmarked and cached by
 * consumers - so it should read like an address and not like an implementation detail
 * under /data.
 */
copyFileSync(new URL('exdate.tokenlist.json', source), new URL('../public/tokenlist.json', import.meta.url))
console.log('public/tokenlist.json: 1 file')
