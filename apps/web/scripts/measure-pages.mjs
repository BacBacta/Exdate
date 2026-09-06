// Measure the built site the way the 2026-09-05 audit did, from the repository this time.
//
//   pnpm --filter @exdate/web build
//   pnpm --filter @exdate/web measure                      # the default routes
//   pnpm --filter @exdate/web measure /subscribe/ /about/  # named routes
//
// For every route at 320, 360, 768 and 1280 px: the page must not scroll horizontally, and at
// 360 px axe must find no WCAG 2.2 AA violation. When a page does overflow, the element that
// actually widens it is named - not the widest element, which is usually a code block scrolling
// harmlessly inside its own box, and which is what a first version of this reported.
//
// Chromium is launched with --no-proxy-server: the audit once measured the egress proxy's 405
// page instead of the site and reported five violations of an empty document. The binary is
// taken from EXDATE_CHROMIUM, else found under PLAYWRIGHT_BROWSERS_PATH; playwright-core ships
// no browser and downloads none, which is why it is the dependency and not `playwright`.
import { createServer } from 'node:http'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const OUT = fileURLToPath(new URL('../out/', import.meta.url))
const DEFAULT_ROUTES = ['/', '/dividends/', '/wallet/', '/market/', '/subscribe/', '/about/', '/docs/', '/data/']
const ROUTES = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_ROUTES
const WIDTHS = [320, 360, 768, 1280]
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ics': 'text/calendar', '.xml': 'application/rss+xml', '.png': 'image/png', '.txt': 'text/plain' }

if (!existsSync(join(OUT, 'index.html'))) {
  console.error(`# ${OUT} holds no build; run: pnpm --filter @exdate/web build`)
  process.exit(1)
}

function findChromium() {
  if (process.env.EXDATE_CHROMIUM) return process.env.EXDATE_CHROMIUM
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1)
  const candidate = dir && join(root, dir, 'chrome-linux', 'chrome')
  return candidate && existsSync(candidate) ? candidate : undefined
}

const server = createServer((req, res) => {
  let file = join(OUT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const executablePath = findChromium()
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--no-proxy-server'] })
const axe = readFileSync(fileURLToPath(import.meta.resolve('axe-core/axe.min.js')), 'utf8')
let failures = 0

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const status = (await page.goto(`${base}${route}`, { waitUntil: 'load' })).status()
    const m = await page.evaluate(() => {
      // An element inside a box that scrolls or clips horizontally has a wide rectangle and
      // pushes nothing. Name only what actually widens the document.
      const contained = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(a).overflowX)) return true
        }
        return false
      }
      const de = document.documentElement
      const wide = [...document.querySelectorAll('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.right > window.innerWidth + 1 && r.width > 0 && !contained(el))
        .sort((a, b) => b.r.right - a.r.right)[0]
      const name = wide ? `${wide.el.tagName.toLowerCase()}${wide.el.className ? '.' + String(wide.el.className).split(' ')[0] : ''} right=${Math.round(wide.r.right)}` : null
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, culprit: name }
    })
    const over = m.scrollWidth > m.clientWidth
    let axeLine = ''
    if (width === 360) {
      await page.addScriptTag({ content: axe })
      const violations = await page.evaluate(async () =>
        (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map(
          (v) => `${v.id}(${v.impact}) ${v.nodes[0]?.target?.[0] ?? ''}`,
        ),
      )
      axeLine = violations.length ? ` axe: ${violations.join('; ')}` : ' axe: clean'
      if (violations.length) failures++
    }
    if (over || status !== 200) failures++
    console.log(`${over || status !== 200 ? 'FAIL' : 'ok  '} ${route.padEnd(14)} ${String(width).padStart(4)}px http=${status} scroll=${m.scrollWidth}${over ? ` OVERFLOW by ${m.culprit}` : ''}${axeLine}`)
    await page.close()
  }
}
await browser.close()
server.close()
console.log(failures ? `${failures} failure(s)` : `all clean: ${ROUTES.length} routes x ${WIDTHS.length} widths`)
process.exit(failures ? 1 : 0)
