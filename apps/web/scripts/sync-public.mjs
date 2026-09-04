// Before every build: copy the committed datasets into public/data so the site
// serves them itself. The repository may be private; the numbers are not.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const source = new URL('../../../data/', import.meta.url)
const target = new URL('../public/data/', import.meta.url)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
/**
 * The issuer's own files are not mirrored. They are copied from Robinhood's
 * Stock Token API and reproduced in the repository as the input every
 * reconciliation is checked against; exdate holds a personal, non-sublicensable
 * licence to that content (docs/terms-review.md, DATA-LICENSE.md), so serving
 * them from the site as downloadable datasets is the one thing here that is
 * not exdate's to offer. The pages still read them at build time - a declared
 * rate next to the step it explains is the product - and the /data/ page names
 * them and says where they live.
 */
const ISSUER_FILES = new Set([
  'robinhood-assets.snapshot.json',
  'robinhood-corporate-actions.snapshot.json',
  'corporate-actions.archive.json',
])
let n = 0
let skipped = 0
for (const name of readdirSync(source)) {
  if (!name.endsWith('.json')) continue
  if (ISSUER_FILES.has(name)) {
    skipped++
    continue
  }
  copyFileSync(join(source.pathname, name), join(target.pathname, name))
  n++
}
console.log(`public/data: ${n} files, ${skipped} issuer file(s) left in the repository`)

/**
 * The token list also gets a clean path at the site root. A token list is imported by
 * URL into a wallet or an aggregator, and that URL is quoted, bookmarked and cached by
 * consumers - so it should read like an address and not like an implementation detail
 * under /data.
 */
copyFileSync(new URL('exdate.tokenlist.json', source), new URL('../public/tokenlist.json', import.meta.url))
console.log('public/tokenlist.json: 1 file')
