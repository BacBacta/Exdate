// Is the published site a build of the record as it stands today?
//
//   node scripts/check-site-freshness.mjs                 # against https://www.exdate.me
//   EXDATE_SITE_URL=https://... node scripts/...          # somewhere else
//   EXDATE_SITE_MAX_LAG_HOURS=6 node scripts/...          # how far behind is tolerated
//
// The site is static: every figure on it is read at build time from data/, and it is deployed by
// a workflow on a push. So the pages can be internally perfect and still publish an older record
// than the one in git, and nothing on them can show it. That has happened twice, both measured:
//
//   * 2026-09-05 (audit F11) - a checkout one commit behind its own branch published 74.1 % over
//     60 samples while data/ already held 74.3 % over 61. deploy-web.sh now refuses to publish a
//     checkout behind its branch, which fixes one cause and not the class.
//   * 2026-09-05, hours later - the Vercel project was deleted, www.exdate.me answered 404
//     DEPLOYMENT_NOT_FOUND, and every collector went on committing to a site nobody was serving.
//
// Neither is visible from inside the repository, and neither is visible from a page. This asks the
// live host what it was built from (/build.json) and compares it with the files in this checkout.
//
// It is a CHECK, not a collector: it writes nothing to data/. A file recording the site's
// freshness would itself be a commit that redeploys the site and changes the thing it measures.
// A failed scheduled run emails the repository owner with no configuration at all, which is the
// same mechanism the capture watchdog uses.
import { readFileSync, readdirSync } from 'node:fs'

const SITE = (process.env.EXDATE_SITE_URL || 'https://www.exdate.me').replace(/\/$/, '')
const MAX_LAG_HOURS = Number(process.env.EXDATE_SITE_MAX_LAG_HOURS || 6)
/** A build older than this is stale whatever the record says: the deploy path itself has stopped. */
const MAX_BUILD_AGE_HOURS = Number(process.env.EXDATE_SITE_MAX_BUILD_AGE_HOURS || 24)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const warn = (name, detail) => console.log(`warn ${name} — ${detail}`)
const hours = (a, b) => (Date.parse(a) - Date.parse(b)) / 3_600_000

/** The stamp a dataset dates itself by, read the same way the site's manifest reads it. */
const DATE_FIELDS = ['observedAt', 'fetchedAt', 'generatedAt', 'builtAt', 'scannedAt', 'lastRunAt', 'lastArchivedAt', 'lastSampleAt', 'timestamp']
function localStamps() {
  const out = new Map()
  for (const name of readdirSync('data').sort()) {
    if (!name.endsWith('.json')) continue
    let json
    try {
      json = JSON.parse(readFileSync(`data/${name}`, 'utf8'))
    } catch {
      continue
    }
    const at = DATE_FIELDS.map((k) => json[k]).find((v) => typeof v === 'string')
    out.set(name, typeof at === 'string' ? at : '')
  }
  return out
}

const response = await fetch(`${SITE}/build.json`, { headers: { accept: 'application/json' } }).catch((error) => {
  console.log(`FAIL site: ${SITE}/build.json is reachable — ${error.message}`)
  process.exit(1)
})
if (!response.ok) {
  // Two very different failures answer 404 here, and telling them apart is the difference between
  // "deploy the manifest" and "the site is gone". So the root is asked as well: it answered 404
  // for hours on 2026-09-05 when the Vercel project had been deleted, and that is the loud one.
  const root = await fetch(`${SITE}/`, { redirect: 'follow' }).catch(() => null)
  const rootOk = root?.ok === true
  console.log(
    rootOk
      ? `FAIL site: ${SITE}/build.json is served — HTTP ${response.status}, but ${SITE}/ answers ${root.status}: the site is up and predates the manifest, so deploy it`
      : `FAIL site: ${SITE} is serving the site — /build.json ${response.status}, / ${root ? root.status : 'unreachable'}`,
  )
  process.exit(1)
}
const text = await response.text()
let manifest
try {
  manifest = JSON.parse(text)
} catch {
  console.log(`FAIL site: ${SITE}/build.json is JSON — got ${text.slice(0, 80)}`)
  process.exit(1)
}
check(`site: ${SITE}/build.json is reachable`, true, `built ${manifest.builtAt}`)

const buildAge = hours(new Date().toISOString(), manifest.builtAt)
check('site: the last build is recent', buildAge <= MAX_BUILD_AGE_HOURS, `${buildAge.toFixed(1)} h old, limit ${MAX_BUILD_AGE_HOURS} h`)

// The commit is informative and not decisive: a build from an older commit is fine as long as no
// dataset moved since, which is exactly what the per-file comparison below decides. A build with
// no commit at all is reported rather than assumed current - it means the deploy path lost it.
if (!manifest.commit) warn('site: the build names the commit it came from', 'no commit in the manifest')
else console.log(`ok   site: built from ${manifest.commit.slice(0, 8)}`)

const local = localStamps()
const served = manifest.data ?? {}
const missing = [...local.keys()].filter((name) => !(name in served))
check('site: the build carries every committed dataset', missing.length === 0, missing.join(' '))

// The verdict. A file is behind when its committed stamp is newer than the one the site was built
// from, by more than the tolerance - the collectors commit continuously, so a few minutes of lag
// is the deploy running, not a fault.
const behind = []
for (const [name, at] of local) {
  const there = served[name]
  if (!at || !there) continue
  const lag = hours(at, there)
  if (lag > MAX_LAG_HOURS) behind.push(`${name} (${lag.toFixed(1)} h)`)
}
check(`site: no dataset is more than ${MAX_LAG_HOURS} h behind the record`, behind.length === 0, behind.join(' '))

// A file that dates itself nowhere cannot be compared by date. It is counted and named rather
// than passed over in silence, so the coverage of this check is legible: a dataset that quietly
// stopped carrying a stamp would otherwise leave the check reporting green about less and less.
const undated = [...local.entries()].filter(([, at]) => !at).map(([name]) => name)
if (undated.length) console.log(`ok   site: ${undated.length} dataset(s) date themselves nowhere, so no lag is computed for them — ${undated.join(' ')}`)

console.log(`\n${failures} failed`)
process.exit(failures > 0 ? 1 : 0)
