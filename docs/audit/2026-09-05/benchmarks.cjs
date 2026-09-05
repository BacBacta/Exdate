// Phase 10 support: open the comparables LIVE, today, and keep a screenshot and
// the visible above-the-fold text of the specific screen compared. Anything that
// blocks a headless browser is recorded as such rather than described from memory.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const ROOT = __dirname
const out = { capturedAt: new Date().toISOString(), sites: {} }

// The screen compared, per comparable, chosen to match one of the six tasks.
const targets = [
  ['etherscan-token', 'https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7', 'token page (task 1: a holder finds a token and what it did)'],
  ['blockscout-token', 'https://eth.blockscout.com/token/0xdAC17F958D2ee523a2206206994597C13D831ec7', 'token page'],
  ['defillama-home', 'https://defillama.com/', 'data home (task 5: cite a number with method/date)'],
  ['dune-home', 'https://dune.com/', 'data home'],
  ['tokenterminal', 'https://tokenterminal.com/', 'metrics home'],
  ['messari', 'https://messari.io/', 'research home'],
  ['zerion', 'https://app.zerion.io/', 'portfolio view (task 2: what my wallet holds and is owed)'],
  ['zapper', 'https://zapper.xyz/', 'portfolio view'],
  ['rabby', 'https://rabby.io/', 'wallet'],
  ['nasdaq-dividends', 'https://www.nasdaq.com/market-activity/dividends', 'dividend calendar (calendar page comparable)'],
  ['dividend-com', 'https://www.dividend.com/', 'dividend data for non-specialists'],
  ['yahoo-aapl', 'https://finance.yahoo.com/quote/AAPL/', 'quote page for non-specialists'],
  ['tradingview', 'https://www.tradingview.com/symbols/NASDAQ-AAPL/', 'symbol page'],
  ['stripe-docs', 'https://docs.stripe.com/api', 'API reference (task 6: verify a webhook from docs alone)'],
  ['stripe-webhooks', 'https://docs.stripe.com/webhooks', 'webhook docs'],
  ['linear-docs', 'https://linear.app/docs', 'docs'],
  ['vercel-docs', 'https://vercel.com/docs', 'docs'],
]

;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:34395' }, args: ['--ssl-version-max=tls1.2'] })
  for (const [key, url, why] of targets) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
    const page = await ctx.newPage()
    const rec = { url, why, status: null, blocked: false, title: null, fold: [], shot: null }
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      rec.status = resp && resp.status()
      await page.waitForTimeout(3500)
      rec.title = await page.title()
      const info = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.top < innerHeight }
        const seen = new Set(); const fold = []
        for (const el of document.querySelectorAll('h1,h2,h3,p,a,button,li,span,td,th')) { if (!vis(el)) continue; const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t.length > 2 && t.length < 160 && !seen.has(t)) { seen.add(t); fold.push(t) } }
        const blockedWords = /verify you are human|access denied|enable javascript|checking your browser|just a moment|captcha|forbidden|attention required/i
        return { fold: fold.slice(0, 40), blocked: blockedWords.test(document.body.innerText || '') }
      })
      rec.fold = info.fold; rec.blocked = info.blocked || (rec.status && rec.status >= 400)
      rec.shot = `bench-${key}.png`
      await page.screenshot({ path: path.join(ROOT, 'shots', rec.shot), fullPage: false })
    } catch (e) { rec.error = String(e).slice(0, 160); rec.blocked = true }
    await ctx.close()
    out.sites[key] = rec
    console.log(`${key}: ${rec.status} ${rec.blocked ? 'BLOCKED/unusable' : 'ok'} — ${rec.title}`)
  }
  await browser.close()
  fs.writeFileSync(path.join(ROOT, 'benchmarks.json'), JSON.stringify(out, null, 1))
  console.log('benchmarks.json written')
})().catch((e) => { console.error(e); process.exit(1) })
