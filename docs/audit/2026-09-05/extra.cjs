const fs = require('fs'); const path = require('path')
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
const BASE = 'https://www.exdate.me'
const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [l1, l2] = [lum(...a), lum(...b)].sort((x, y) => y - x); return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2) }
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)
;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY }, args: ['--ssl-version-max=tls1.2'] })
  const out = {}
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    out[scheme] = await page.evaluate(() => {
      const b = document.querySelector('#find button, form button, button.btn, [id^=find] button')
      const cs = b && getComputedStyle(b)
      const bodyBg = getComputedStyle(document.body).backgroundColor
      const muted = [...document.querySelectorAll('p,span,small,div')].map((e) => getComputedStyle(e).color).filter((c, i, a) => a.indexOf(c) === i)
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, button: b && { text: b.innerText, color: cs.color, bg: cs.backgroundColor, fontSize: cs.fontSize, disabled: b.disabled }, bodyBg, colorsUsed: muted.slice(0, 8), widest: (() => { let w = null; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > innerWidth + 1 && (!w || r.right > w.right)) w = { tag: el.tagName, cls: el.className, right: Math.round(r.right), text: (el.innerText || '').slice(0, 30) } } return w })() }
    })
    if (out[scheme].button) { const b = out[scheme].button; b.contrast = ratio(rgb(b.color), rgb(b.bg)); b.contrastVsPage = ratio(rgb(b.bg), rgb(out[scheme].bodyBg)) }
    await ctx.close()
  }
  // token page: the small targets, and the "0 dividend s" wording
  {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(BASE + `/t/${cfg.COST.address}/`, { waitUntil: 'networkidle' })
    out.tokenCost = await page.evaluate(() => {
      const t = (document.body.innerText || '').replace(/\s+/g, ' ')
      const small = [...document.querySelectorAll('a,button,summary')].map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, text: (el.innerText || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) } }).filter((x) => x.w && x.h && (x.w < 24 || x.h < 24))
      return { pluralGlitch: (t.match(/.{0,30}dividend ?s reconciled.{0,20}/) || [null])[0], small, addressShown: (t.match(/0x[0-9a-fA-F]{40}/) || [null])[0], copyButton: !!document.querySelector('button[aria-label*="opy"], button[title*="opy"]') }
    })
    await ctx.close()
  }
  // wallet: full page after the history read
  {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(BASE + '/wallet/', { waitUntil: 'networkidle' })
    await page.fill('input', cfg.holder); await page.click('button[type=submit]')
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); const b = await page.evaluate(() => document.body.innerText); if (/What past dividends delivered/i.test(b) && !/to go\./.test(b)) break }
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(__dirname, 'shots', 'w14-wallet-results-full.png'), fullPage: true })
    out.wallet = await page.evaluate(() => { const t = (document.body.innerText || '').replace(/\s+/g, ' '); const i = t.indexOf('What past dividends'); return { history: t.slice(i, i + 700), csv: /Download as CSV/.test(t), source: (t.match(/.{0,80}(archive|answered|node that serves).{0,120}/i) || [null])[0] } })
    await ctx.close()
  }
  await browser.close()
  fs.writeFileSync(path.join(__dirname, 'extra.json'), JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
})().catch((e) => { console.error(e); process.exit(1) })
