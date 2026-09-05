// Phase 3: the six tasks, operated in a real browser on the live site, mobile
// viewport, with timings, the texts the persona actually meets, and screenshots.
// Plus keyboard-only passes for phase 5. Expert cognitive walkthrough - no real
// users were involved, and the report says so.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const ROOT = __dirname
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))
const BASE = 'https://www.exdate.me'
const out = { ranAt: new Date().toISOString(), holder: cfg.holder, tasks: {} }
let n = 0
const shot = async (page, label) => { n += 1; const f = `w${String(n).padStart(2, '0')}-${label}.png`; await page.screenshot({ path: path.join(ROOT, 'shots', f), fullPage: false }); return f }
const txt = async (page, sel) => page.$$eval(sel, (els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean))
const bodyText = async (page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '))

;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:34395' }, args: ['--ssl-version-max=tls1.2'] })
  const mk = async () => { const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', reducedMotion: 'reduce' }); return [ctx, await ctx.newPage()] }

  // ---------- T1: P1 finds AAPL and what it got ----------
  {
    const t = { steps: [], shots: [] }; const [ctx, page] = await mk(); const t0 = Date.now()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    t.shots.push(await shot(page, 't1-home'))
    const finderVisible = await page.evaluate(() => { const i = document.getElementById('find-input'); if (!i) return null; const r = i.getBoundingClientRect(); return { top: Math.round(r.top), inFold: r.top < innerHeight } })
    t.steps.push({ step: 'locate the finder on the home page', finderVisible })
    await page.fill('#find-input', 'AAPL')
    await page.waitForTimeout(400)
    const results = await txt(page, '#find ~ * a, #find a, [id^=find] a, #find-results a, #find li a')
    t.steps.push({ step: 'type AAPL', resultsShown: results.slice(0, 5) })
    t.shots.push(await shot(page, 't1-finder-aapl'))
    const link = await page.$(`a[href*="${cfg.AAPL.address.toLowerCase()}"], a[href*="${cfg.AAPL.address}"]`)
    if (link) { await link.click(); await page.waitForLoadState('networkidle') } else { await page.goto(BASE + `/t/${cfg.AAPL.address}/`, { waitUntil: 'networkidle' }) ; t.steps.push({ step: 'no result link matched the address; navigated directly', fallback: true }) }
    t.shots.push(await shot(page, 't1-aapl-fold'))
    const h1 = await txt(page, 'h1'); const h2 = await txt(page, 'h2')
    const body = await bodyText(page)
    const has = (re) => re.test(body)
    t.steps.push({ step: 'land on the AAPL token page', h1, h2, showsDeclared: has(/declared/i), showsArrived: has(/arrived/i), showsGap: /gap|never arrived|missing/i.test(body), showsDollar: /\$\s?0\.\d+/.test(body), jargonAboveFold: (await page.evaluate(() => { const t = (document.body.innerText || '').slice(0, 1200); return ['bps', 'ERC-8056', 'reconcil', 'oracle', 'multiplier', 'WAD', 'Chainlink', 'feed'].filter((w) => t.toLowerCase().includes(w.toLowerCase())) })) })
    const summaries = await txt(page, 'summary')
    t.steps.push({ step: 'find how it was measured', disclosures: summaries })
    const s = await page.$('summary'); if (s) { await s.click(); await page.waitForTimeout(300); t.shots.push(await shot(page, 't1-aapl-details-open')) }
    // the sentence a holder would read as "what I got"
    const m = body.match(/.{0,120}(arrived|received).{0,160}/i)
    t.steps.push({ step: 'the sentence answering "what did I get"', quote: m ? m[0].trim() : null })
    t.elapsedMs = Date.now() - t0; t.success = !!(finderVisible && finderVisible.inFold) && has(/arrived/i)
    out.tasks.T1 = t; await ctx.close()
  }

  // ---------- T2: P1 wallet, no connection ----------
  {
    const t = { steps: [], shots: [] }; const [ctx, page] = await mk(); const t0 = Date.now()
    await page.goto(BASE + '/wallet/', { waitUntil: 'networkidle' })
    t.shots.push(await shot(page, 't2-wallet-empty'))
    const fold = await page.evaluate(() => (document.body.innerText || '').slice(0, 900))
    t.steps.push({ step: 'read the empty state', foldText: fold })
    const input = await page.$('input[placeholder="0x…"], input[type=text], input')
    if (!input) { t.steps.push({ step: 'no input found', fail: true }); out.tasks.T2 = t; await ctx.close() } else {
      await input.fill(cfg.holder)
      const submit = await page.$('button[type=submit]')
      const tRead = Date.now()
      await submit.click()
      await page.waitForTimeout(600)
      t.shots.push(await shot(page, 't2-wallet-waiting'))
      t.steps.push({ step: 'state 600 ms after submit', text: (await bodyText(page)).slice(0, 600) })
      // wait for the headline
      let settled = false
      for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); const b = await bodyText(page); if (/owed|nothing declared|due|holds/i.test(b) && !/reading/i.test(b.slice(0, 400))) { settled = true; break } }
      t.steps.push({ step: 'holdings read', settled, readMs: Date.now() - tRead })
      t.shots.push(await shot(page, 't2-wallet-holdings'))
      const b1 = await bodyText(page)
      t.steps.push({ step: 'headline as read', headline: b1.slice(0, 1400) })
      // history: wait longer
      let hist = false
      for (let i = 0; i < 90; i++) { await page.waitForTimeout(1000); const b = await bodyText(page); if (/gained|shares held then|history|past dividend/i.test(b) && !/reading history|replaying/i.test(b)) { hist = true; break } }
      t.steps.push({ step: 'history read', settled: hist, totalMs: Date.now() - tRead })
      t.shots.push(await shot(page, 't2-wallet-history'))
      const b2 = await bodyText(page)
      t.steps.push({ step: 'history text', excerpt: (b2.match(/.{0,80}(gained|history|past dividend|not seen|inside a protocol).{0,300}/i) || [null])[0] })
      t.steps.push({ step: 'CSV export present', csv: /Download as CSV/i.test(b2), whichNode: (b2.match(/.{0,60}(answered by|node|archive).{0,120}/i) || [null])[0] })
      t.elapsedMs = Date.now() - t0; t.success = settled
      out.tasks.T2 = t; await ctx.close()
    }
  }

  // ---------- T3: P2 oracle safety for a token ----------
  {
    const t = { steps: [], shots: [] }; const [ctx, page] = await mk(); const t0 = Date.now()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    const navTexts = await txt(page, 'header a, nav a')
    t.steps.push({ step: 'from home, which header label leads to oracle safety?', header: navTexts })
    await page.goto(BASE + '/gap/', { waitUntil: 'networkidle' })
    t.shots.push(await shot(page, 't3-gap-fold'))
    const body = await bodyText(page)
    t.steps.push({ step: 'gap page fold', foldText: body.slice(0, 1200) })
    const row = body.match(/.{0,40}SGOV.{0,260}/) || body.match(/.{0,40}AAPL.{0,260}/)
    t.steps.push({ step: 'per-token row', quote: row ? row[0] : null, hasFeedAge: /age|stale|old|minutes|hours/i.test(body), hasPoolDepth: /\$[\d,]+|depth|liquidity|holding/i.test(body), hasCorroboration: /corroborat|multiplier-step|traded-price|confidence/i.test(body), hasSession: /overnight|pre-market|regular|weekend|after-hours/i.test(body), refusalWording: (body.match(/.{0,80}(not enough|refus|needs \d+ readings|until each has).{0,120}/i) || [null])[0] })
    // per-token link from gap to token page?
    const perTokenLinks = await page.$$eval('a[href*="/t/0x"]', (a) => a.length)
    t.steps.push({ step: 'links from a gap row to its token page', count: perTokenLinks })
    await page.goto(BASE + `/t/${cfg.SGOV.address}/`, { waitUntil: 'networkidle' })
    const b2 = await bodyText(page)
    t.steps.push({ step: 'token page feed section', quote: (b2.match(/.{0,60}(Chainlink|price feed|heartbeat|deviation|proxy).{0,300}/i) || [null])[0], apiLinked: /api\.exdate\.me|\/docs\/api/i.test(await page.content()), webhookMentioned: /webhook/i.test(b2) })
    t.shots.push(await shot(page, 't3-sgov-feed'))
    t.elapsedMs = Date.now() - t0; t.success = !!row
    out.tasks.T3 = t; await ctx.close()
  }

  // ---------- T4: P3 token list, licence, schema ----------
  {
    const t = { steps: [], shots: [] }; const [ctx, page] = await mk(); const t0 = Date.now()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ t: (a.innerText || '').trim().slice(0, 60), h: a.getAttribute('href') })))
    const tl = links.filter((l) => /tokenlist|token list/i.test(l.t + ' ' + l.h))
    const lic = links.filter((l) => /licen|DATA-LICENSE|CC BY|MIT/i.test(l.t + ' ' + l.h))
    t.steps.push({ step: 'home links to the token list / licence', tokenListLinks: tl, licenceLinks: lic })
    await page.goto(BASE + '/#developers', { waitUntil: 'networkidle' })
    t.shots.push(await shot(page, 't4-developers'))
    const dev = await page.evaluate(() => { const s = document.getElementById('developers'); return s ? (s.innerText || '').replace(/\s+/g, ' ').slice(0, 1500) : null })
    t.steps.push({ step: 'developers section text', text: dev })
    const r = await fetch(BASE + '/tokenlist.json'); const j = await r.json()
    t.steps.push({ step: 'tokenlist.json', status: r.status, cors: r.headers.get('access-control-allow-origin'), name: j.name, version: j.version, tokens: j.tokens && j.tokens.length, extensionKeys: j.tokens && Object.keys(j.tokens[0].extensions || {}), hasLicenceField: Object.keys(j).filter((k) => /licen/i.test(k)), keywords: j.keywords })
    await page.goto(BASE + '/data/', { waitUntil: 'networkidle' })
    const b = await bodyText(page)
    t.steps.push({ step: '/data/ page', mentionsLicence: (b.match(/.{0,80}(licen|CC BY|carve|Robinhood Materials).{0,160}/i) || [null])[0], mentionsTokenList: /tokenlist|token list/i.test(b) })
    t.shots.push(await shot(page, 't4-data'))
    await page.goto(BASE + '/docs/api/', { waitUntil: 'networkidle' })
    const api = await bodyText(page)
    t.steps.push({ step: '/docs/api/ signals for a PM', versioning: /version|v1|changelog|deprecat/i.test(api), contact: /contact|email|@|issues/i.test(api), rateLimits: /rate limit|X-RateLimit|429/i.test(api), keys: /api key|EXDATE_API_KEYS|Bearer|X-API-Key/i.test(api), sla: /uptime|SLA|status/i.test(api) })
    t.elapsedMs = Date.now() - t0; t.success = r.status === 200 && (lic.length > 0 || /licen/i.test(b))
    out.tasks.T4 = t; await ctx.close()
  }

  // ---------- T5: P4 cite the off-hours share ----------
  {
    const t = { steps: [], shots: [] }; const [ctx, page] = await mk(); const t0 = Date.now()
    const hits = []
    for (const r of ['/', '/record/', '/gap/', '/flows/', '/data/', '/calendar/']) {
      await page.goto(BASE + r, { waitUntil: 'networkidle' })
      const b = await bodyText(page)
      const m = b.match(/.{0,80}(73\.9|off-hours|outside (the )?US market|outside NYSE|46 ?%).{0,120}/i)
      hits.push({ route: r, found: !!m, quote: m ? m[0] : null })
    }
    t.steps.push({ step: 'search every likely page for the off-hours share', hits })
    // the OG card an analyst would share
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    const og = await page.$$eval('meta[property^="og:"], meta[name^="twitter:"]', (m) => m.map((x) => [x.getAttribute('property') || x.getAttribute('name'), (x.getAttribute('content') || '').slice(0, 120)]))
    t.steps.push({ step: 'share card metadata on /', og })
    const dated = await page.evaluate(() => (document.body.innerText || '').match(/.{0,60}(last observed|observed on|as of|updated).{0,80}/i))
    t.steps.push({ step: 'is the home page dated?', quote: dated ? dated[0] : null })
    t.elapsedMs = Date.now() - t0; t.success = hits.some((h) => h.found && /73\.9/.test(h.quote || ''))
    out.tasks.T5 = t; await ctx.close()
  }

  // ---------- T6: P5 verify a webhook from the SDK docs ----------
  {
    const t = { steps: [], shots: [] }; const [ctx, page] = await mk(); const t0 = Date.now()
    await page.goto(BASE + '/docs/sdk/', { waitUntil: 'networkidle' })
    t.shots.push(await shot(page, 't6-sdk-fold'))
    const b = await bodyText(page)
    const codes = await page.$$eval('pre', (p) => p.map((x) => (x.innerText || '').trim()).filter((x) => /webhook|verify|sign/i.test(x)).slice(0, 3).map((x) => x.slice(0, 600)))
    t.steps.push({ step: 'webhook code samples on /docs/sdk/', count: codes.length, samples: codes })
    t.steps.push({ step: 'install + registry truth', installLine: (b.match(/(pnpm add|npm i(nstall)?|yarn add)[^\n]{0,60}/i) || [null])[0], saysNotPublished: /not (yet )?published|not on npm/i.test(b), namesHeader: /exdate-signature/i.test(b), namesTolerance: /300|tolerance|five minutes/i.test(b), namesFailureReasons: /signature_mismatch|timestamp_outside_tolerance|malformed_header/i.test(b) })
    await page.goto(BASE + '/docs/api/', { waitUntil: 'networkidle' })
    const a = await bodyText(page)
    t.steps.push({ step: '/docs/api/ webhook section', catalogue: /webhooks?/i.test(a), eventTypes: (a.match(/multiplier\.scheduled|dividend\.reconciled|multiplier\.applied/g) || []).length, exampleResponse: /"schema"|"events"|HMAC/i.test(a) })
    t.elapsedMs = Date.now() - t0; t.success = codes.length > 0
    out.tasks.T6 = t; await ctx.close()
  }

  // ---------- keyboard-only passes (phase 5 manual) ----------
  {
    const k = {}; const [ctx, page] = await mk()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    let tabs = 0; let focusedId = null; const order = []
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); tabs++; const f = await page.evaluate(() => { const e = document.activeElement; if (!e) return null; const s = getComputedStyle(e); return { tag: e.tagName, id: e.id, text: (e.innerText || e.value || '').trim().slice(0, 30), outline: s.outlineStyle + ' ' + s.outlineWidth, box: s.boxShadow !== 'none' } }); order.push(f); if (f && f.id === 'find-input') { focusedId = f; break } }
    k.home = { tabsToFinder: focusedId ? tabs : null, firstStops: order.slice(0, 6), finderFocusVisible: focusedId ? (focusedId.outline !== 'none 0px' || focusedId.box) : null, skipLinkFirst: order[0] && /skip/i.test(order[0].text) }
    await page.goto(BASE + '/wallet/', { waitUntil: 'networkidle' })
    tabs = 0; let hit = null
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); tabs++; const f = await page.evaluate(() => { const e = document.activeElement; return e ? { tag: e.tagName, type: e.type, text: (e.innerText || e.placeholder || '').trim().slice(0, 30) } : null }); if (f && f.tag === 'INPUT') { hit = { tabs, f }; break } }
    k.wallet = { tabsToInput: hit ? hit.tabs : null }
    await page.goto(BASE + `/t/${cfg.AAPL.address}/`, { waitUntil: 'networkidle' })
    const summaryKeyboard = await page.evaluate(async () => { const s = document.querySelector('summary'); if (!s) return null; s.focus(); const before = s.parentElement.open; const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }); s.dispatchEvent(ev); return { focusable: document.activeElement === s, nativeDetails: s.parentElement.tagName === 'DETAILS', openBefore: before } })
    k.tokenDisclosure = summaryKeyboard
    out.keyboard = k; await ctx.close()
  }

  await browser.close()
  fs.writeFileSync(path.join(ROOT, 'walkthrough.json'), JSON.stringify(out, null, 1))
  for (const [k, v] of Object.entries(out.tasks)) console.log(k, v.success ? 'SUCCESS' : 'FAIL', `${v.elapsedMs} ms`, v.shots.join(' '))
  console.log('keyboard', JSON.stringify(out.keyboard))
})().catch((e) => { console.error(e); process.exit(1) })
