import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What this build was made from, in one machine-readable file.
 *
 * The site is static and every figure on it is read at build time from data/. So the site can be
 * correct and still be WRONG, by being a build of an older record - which has happened twice: a
 * checkout a commit behind its own branch published 74.1 % over 60 samples while data/ already
 * held 74.3 % over 61 (audit F11), and for part of 2026-09-05 the Vercel project was deleted and
 * the domain answered 404 while every collector went on committing.
 *
 * Nothing on a page can reveal either failure: the pages look finished. This file is what makes
 * them checkable from outside - scripts/check-site-freshness.mjs fetches it and compares the
 * stamps against the committed files. It carries stamps and a commit, never a figure: a figure
 * here would be a second copy of a number that already has one place to live.
 */
export const dynamic = 'force-static'

const ROOT = join(process.cwd(), '..', '..')

/** Each dataset's own observation timestamp, read from the file rather than from the build clock. */
function stamps(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(join(ROOT, 'data')).sort()) {
    if (!name.endsWith('.json')) continue
    let json: Record<string, unknown>
    try {
      json = JSON.parse(readFileSync(join(ROOT, 'data', name), 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    // Whichever field this file uses to date itself. A file with none is listed with no stamp
    // rather than left out, so the probe can tell "undated" from "absent".
    const at = ['observedAt', 'fetchedAt', 'generatedAt', 'builtAt', 'scannedAt', 'lastRunAt', 'lastArchivedAt', 'lastSampleAt', 'timestamp']
      .map((key) => json[key])
      .find((value) => typeof value === 'string')
    out[name] = typeof at === 'string' ? at : ''
  }
  return out
}

export function GET() {
  return new Response(
    JSON.stringify(
      {
        note: 'What this build of www.exdate.me was made from. Stamps are each dataset’s own, not this build’s clock.',
        // Set by scripts/deploy-web.sh, which uploads a tree with no .git so Vercel cannot read it
        // itself; VERCEL_GIT_COMMIT_SHA covers a git-connected deploy. Empty means neither, which
        // the probe reports rather than treating as current.
        commit: process.env.EXDATE_BUILD_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || '',
        builtAt: new Date().toISOString(),
        data: stamps(),
      },
      null,
      2,
    ) + '\n',
    { headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' } },
  )
}
