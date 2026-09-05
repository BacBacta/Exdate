// Phase 0 + automated parts of phases 5/6: evidence capture for the exdate audit.
// Screenshots at three viewports, two colour schemes, motion on/off; per-page
// text/link/heading/target inventory; axe-core; lab vitals under a mobile profile.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/opt/node22/lib/node_modules/playwright')

const ROOT = __dirname
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))
const BASE = 'https://www.exdate.me'
const routes = [
  ['home', '/'],
  ['token-sgov', `/t/${cfg.SGOV.address}/`],
  ['token-cost-nofeed', `/t/${cfg.COST.address}/`],
  ['wallet', '/wallet/'],
  ['calendar', '/calendar/'],
  ['record', '/record/'],
  ['flows', '/flows/'],
  ['gap', '/gap/'],
  ['docs-api', '/docs/api/'],
  ['docs-sdk', '/docs/sdk/'],
  ['data', '/data/'],
]
const viewports = { mobile: { width: 360, height: 800 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1440, height: 900 } }

const AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
let axeSrc = null
async function fetchAxe() {
  try { const r = await fetch(AXE); if (r.ok) axeSrc = await r.text() } catch (e) { axeSrc = null }
}

const evidence = { capturedAt: new Date().toISOString(), base: BASE, shots: [], pages: {}, axeAvailable: false }
let shotN = 0
function shotName(route, vp, scheme, motion, kind) {
  shotN += 1
  const n = String(shotN).padStart(3, '0')
  return `${n}-${route}-${vp}-${scheme}-${motion}-${kind}.png`
}

async function inventory(page, vpHeight) {
  return page.evaluate((vpHeight) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    const text = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim()
    const headings = [...document.querySelectorAll('h1,h2,h3')].filter(vis).map((h) => ({ tag: h.tagName, text: text(h), top: Math.round(h.getBoundingClientRect().top + scrollY) }))
    // above-the-fold text: block-ish elements whose top is inside the first viewport
    const foldEls = [...document.querySelectorAll('main *, header *, body > *')].filter((el) => {
      if (!vis(el)) return false
      const r = el.getBoundingClientRect()
      return r.top + scrollY < vpHeight && ['P', 'H1', 'H2', 'H3', 'LI', 'A', 'BUTTON', 'LABEL', 'DT', 'DD', 'SPAN', 'SUMMARY', 'INPUT', 'TD', 'TH'].includes(el.tagName)
    })
    const seen = new Set(); const fold = []
    for (const el of foldEls) { const t = text(el); if (t && !seen.has(t) && t.length > 1) { seen.add(t); fold.push(t) } }
    const body = text(document.body)
    const links = [...document.querySelectorAll('a[href]')].filter(vis).map((a) => ({ text: text(a).slice(0, 80), href: a.getAttribute('href') }))
    const nav = [...document.querySelectorAll('header a, nav a')].filter(vis).map((a) => text(a))
    const targets = [...document.querySelectorAll('a,button,input,select,textarea,summary,[role=button]')].filter(vis).map((el) => {
      const r = el.getBoundingClientRect(); return { tag: el.tagName, text: text(el).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }
    })
    const small = targets.filter((t) => t.w < 24 || t.h < 24)
    const imgsNoAlt = [...document.querySelectorAll('img:not([alt]), svg:not([aria-label]):not([aria-hidden])')].length
    const details = [...document.querySelectorAll('details')].length
    const inputs = [...document.querySelectorAll('input,textarea,select')].map((i) => ({ type: i.type, label: !!(i.labels && i.labels.length) || !!i.getAttribute('aria-label') || !!i.getAttribute('aria-labelledby'), placeholder: i.placeholder || '' }))
    const fontSizes = {}
    for (const el of document.querySelectorAll('p,li,a,span,td,th,dd,dt,small,summary,button,label')) { if (!vis(el)) continue; const fs = getComputedStyle(el).fontSize; fontSizes[fs] = (fontSizes[fs] || 0) + 1 }
    const landmarks = ['header', 'nav', 'main', 'footer'].map((t) => `${t}:${document.querySelectorAll(t).length}`).join(' ')
    const skip = !!document.querySelector('a[href="#main"], a[href^="#"][class*="skip"]')
    const lang = document.documentElement.lang
    return { title: document.title, lang, headings, fold, bodyWords: body.split(' ').filter(Boolean).length, links, nav, targetsTotal: targets.length, smallTargets: small, imgsNoAlt, details, inputs, fontSizes, landmarks, skip, h1Count: document.querySelectorAll('h1').length }
  }, vpHeight)
}

async function runAxe(page) {
  if (!axeSrc) return null
  try {
    await page.addScriptTag({ content: axeSrc })
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
      return { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, wcag: v.tags.filter((t) => /wcag\d/.test(t)), nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary && n.failureSummary.split('\n')[1] })) })), passes: r.passes.length, incomplete: r.incomplete.length }
    })
    return res
  } catch (e) { return { error: String(e).slice(0, 200) } }
}

async function vitals(browser, url) {
  // Lab profile approximating Lighthouse mobile: 4x CPU slowdown, ~1.6 Mbps down, 150 ms RTT.
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: viewports.mobile, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36' })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true })
    } catch (e) {}
  })
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'load', timeout: 90000 })
  await page.waitForTimeout(3000)
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const res = performance.getEntriesByType('resource')
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0) + (nav.transferSize || 0)
    const byType = {}
    for (const r of res) { const k = r.initiatorType || 'other'; byType[k] = (byType[k] || 0) + (r.transferSize || 0) }
    return { ttfb: Math.round(nav.responseStart || 0), dcl: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0), lcp: Math.round(window.__lcp || 0), cls: Number((window.__cls || 0).toFixed(3)), transferKB: Math.round(bytes / 1024), byTypeKB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])), requests: res.length + 1 }
  })
  m.wallclockMs = Date.now() - t0
  await ctx.close()
  return m
}

;(async () => {
  await fetchAxe()
  evidence.axeAvailable = !!axeSrc
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:34395' }, args: ['--ssl-version-max=tls1.2'] })

  for (const [key, route] of routes) {
    const url = BASE + route
    const rec = { route, url, shots: [], inventory: {}, axe: null, vitals: null }
    for (const [vp, size] of Object.entries(viewports)) {
      const motions = vp === 'mobile' ? ['reduce', 'no-preference'] : ['reduce']
      for (const scheme of ['light', 'dark']) {
        for (const motion of motions) {
          const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: size, deviceScaleFactor: vp === 'mobile' ? 2 : 1, colorScheme: scheme, reducedMotion: motion, isMobile: vp === 'mobile', hasTouch: vp === 'mobile' })
          const page = await ctx.newPage()
          try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
            await page.waitForTimeout(motion === 'reduce' ? 400 : 1600)
            const fold = shotName(key, vp, scheme, motion, 'fold')
            await page.screenshot({ path: path.join(ROOT, 'shots', fold), fullPage: false })
            rec.shots.push(fold); evidence.shots.push(fold)
            if (motion === 'reduce') {
              const full = shotName(key, vp, scheme, motion, 'full')
              await page.screenshot({ path: path.join(ROOT, 'shots', full), fullPage: true })
              rec.shots.push(full); evidence.shots.push(full)
            }
            if (scheme === 'light' && motion === 'reduce') {
              rec.inventory[vp] = await inventory(page, size.height)
              if (vp === 'mobile') rec.axe = await runAxe(page)
            }
          } catch (e) { rec.errors = rec.errors || []; rec.errors.push(`${vp}/${scheme}/${motion}: ${String(e).slice(0, 160)}`) }
          await ctx.close()
        }
      }
    }
    try { rec.vitals = await vitals(browser, url) } catch (e) { rec.vitals = { error: String(e).slice(0, 160) } }
    evidence.pages[key] = rec
    console.log(`${key}: ${rec.shots.length} shots, words=${rec.inventory.mobile && rec.inventory.mobile.bodyWords}, axe=${rec.axe ? rec.axe.violations.length + ' violations' : 'n/a'}, LCP=${rec.vitals && rec.vitals.lcp}ms CLS=${rec.vitals && rec.vitals.cls} ${rec.vitals && rec.vitals.transferKB}KB`)
  }
  await browser.close()
  fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 1))
  console.log('evidence.json written;', evidence.shots.length, 'screenshots; axe', evidence.axeAvailable ? 'ran' : 'NOT available')
})().catch((e) => { console.error(e); process.exit(1) })
