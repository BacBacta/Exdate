// Audit P5: the same facts across data/ (what the site reads), the hosted API, and the token list.
// Read-only: writes docs/audit/2026-09-05-data/cross-surface.json.
import { readFileSync, writeFileSync } from 'node:fs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const API = 'https://api.exdate.me'
const get = async (p) => { const r = await fetch(API + p); return { status: r.status, body: await r.json().catch(() => null) } }
const iso = (d) => (typeof d === 'string' ? d : `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`)
const low = (s) => String(s).toLowerCase()
const sec = (t) => Math.floor(Date.parse(t) / 1000)

const rec = read('data/reconciliations.observed.json')
const ev = read('data/multiplier-events.observed.json')
const map = read('data/token-feed-map.json')
const list = read('data/exdate.tokenlist.json')
const archive = read('data/corporate-actions.archive.json')
const snap = read('data/robinhood-corporate-actions.snapshot.json')
const rows = rec.reconciliations ?? rec.rows
console.log('reconciliation row keys:', Object.keys(rows[0]).join(','), '| change keys:', Object.keys(rows.find((r) => r.change)?.change ?? {}).join(','))
const out = { fetchedAt: new Date().toISOString() }

// --- 1. reconciliations: file vs API
{
  const api = await get('/v1/4663/reconciliations')
  const A = api.body.reconciliations
  const effF = (r) => r.change?.effectiveAt ?? r.effectiveAt ?? null
const keyF = (r) => `${low(r.token)}:${effF(r) ? sec(effF(r)) : 'none'}:${r.actionId ?? 'none'}`
  const keyA = (r) => `${low(r.token)}:${r.observed?.effectiveAt ? sec(r.observed.effectiveAt) : 'none'}:${r.declared?.actionId ?? 'none'}`
  const F = new Map(rows.map((r) => [keyF(r), r])), M = new Map(A.map((r) => [keyA(r), r]))
  const hc = (r) => r.impliedHaircutBps ?? r.result?.impliedHaircutBps ?? null
  const diffs = []
  for (const [k, f] of F) {
    const a = M.get(k); if (!a) continue
    const d = {}
    if (f.status !== a.status) d.status = [f.status, a.status]
    if ((f.change?.confidence ?? f.confidence ?? null) !== (a.confidence ?? null)) d.confidence = [f.change?.confidence ?? f.confidence ?? null, a.confidence ?? null]
    if (hc(f) !== hc(a)) d.haircutBps = [hc(f), hc(a)]
    const fb = JSON.stringify(f.feed?.corroboratedBy ?? []), ab = JSON.stringify(a.feedCorroboratedBy ?? [])
    if (fb !== ab) d.feedCorroboratedBy = [fb, ab]
    const fp = f.change?.price?.value ?? f.price?.value ?? null, ap = a.price?.value ?? null
    if (fp !== null && ap !== null && Number(fp) !== Number(ap)) d.priceValue = [fp, ap]
    if (Object.keys(d).length) diffs.push({ symbol: f.symbol, key: k, ...d })
  }
  out.reconciliations = {
    file: { total: rows.length, summary: rec.summary, builtFrom: rec.builtFrom, generatedAt: rec.generatedAt ?? rec.builtAt ?? null },
    api: { total: A.length, counts: api.body.counts, newestComputedAt: A.map((r) => r.computedAt).sort().at(-1) },
    onlyApi: [...M].filter(([k]) => !F.has(k)).map(([k, r]) => ({ symbol: r.symbol, status: r.status, key: k })),
    onlyFile: [...F].filter(([k]) => !M.has(k)).map(([k, r]) => ({ symbol: r.symbol, status: r.status, key: k })),
    sameRowDiffers: diffs,
  }
}

// --- 2. multiplier events: file vs API vs UPS token route
{
  const api = await get('/v1/4663/events?limit=500')
  const A = api.body.events
  const k = (e) => `${low(e.token)}:${sec(e.effectiveAt)}`
  const F = new Set(ev.events.map(k)), M = new Map(A.map((e) => [k(e), e]))
  const ups = await get('/v1/4663/tokens/0xf23250dac154d05bb671cb0d0ebef3c635c79ce2')
  out.multiplierEvents = {
    file: { distinct: F.size, logs: ev.events.length, scannedThroughBlock: ev.scannedThroughBlock, scannedAt: ev.scannedAt },
    api: { count: api.body.count, returned: A.length, sources: Object.fromEntries(A.reduce((m, e) => m.set(e.source, (m.get(e.source) ?? 0) + 1), new Map())) },
    onlyApi: [...M].filter(([x]) => !F.has(x)).map(([, e]) => ({ token: e.token, effectiveAt: e.effectiveAt, stepBps: e.stepBps, source: e.source })),
    onlyFile: [...F].filter((x) => !M.has(x)),
    upsTokenRoute: { multiplier: ups.body?.token?.multiplier?.currentDecimal, events: ups.body?.events?.map((e) => ({ effectiveAt: e.effectiveAt, stepBps: e.stepBps, source: e.source })) },
  }
}

// --- 3. feed corroboration: map vs token list vs API token route (all 35)
{
  const api = await get('/v1/4663/tokens')
  const T = new Map(api.body.tokens.map((t) => [low(t.address), t]))
  const L = new Map(list.tokens.map((t) => [low(t.address), t]))
  const byKind = (x) => (Array.isArray(x) ? x.join('+') : x == null ? '' : String(x))
  const rowsOut = []
  for (const p of map.pairs) {
    const m = byKind(p.corroboratedBy), l = byKind(L.get(low(p.token))?.extensions?.priceFeedCorroboratedBy)
    const t = T.get(low(p.token)); const a = byKind(t?.feed?.corroboratedBy)
    const r = rows.filter((x) => low(x.token) === low(p.token) && x.feed).map((x) => byKind(x.feed.corroboratedBy))
    if (m !== l || m !== a || r.some((x) => x !== m)) rowsOut.push({ symbol: p.symbol, map: m, tokenList: l, api: a, reconciliationFile: [...new Set(r)] })
  }
  out.feedCorroboration = { mapCorroboratedAt: map.corroboratedAt, tokenListTimestamp: list.timestamp, disagreements: rowsOut, apiFeedKeysSample: Object.keys(T.get(low(map.pairs[0].token))?.feed ?? {}) }
}

// --- 4. declared dividends: archive vs snapshot vs reconciliation file vs token list vs API calendar
{
  const k = (r) => `${r.id}:${iso(r.processDate)}`
  const A = new Map(archive.actions.map((r) => [k(r), r])), S = new Set(snap.corpActions.map(k))
  const recKeys = new Set(rows.map((r) => `${r.actionId ?? r.declared?.actionId ?? r.corporateActionId ?? r.id?.split(':')[0]}:${r.processDate ?? r.declared?.processDate ?? ''}`))
  const cal = await get('/v1/calendar')
  const up = cal.body.chains[0].upcomingCorporateActions
  const upKeys = new Set(up.map((r) => `${r.actionId ?? r.issuerId ?? r.id}:${r.processDate}`))
  const listDeclared = list.tokens.filter((t) => t.extensions.dividendDeclaredNotOnChain)
  out.declaredDividends = {
    archive: A.size, snapshot: S.size, reconciliationFileDeclared: [...recKeys].filter((x) => !x.endsWith(':')).length,
    archiveNotInSnapshot: [...A].filter(([x]) => !S.has(x)).map(([x, r]) => ({ symbol: r.tokenSymbol, processDate: iso(r.processDate), firstSeenAt: r.firstSeenAt, inWindow: r.inWindow })),
    archiveNotInReconciliationFile: [...A].filter(([x]) => !recKeys.has(x)).map(([x, r]) => ({ symbol: r.tokenSymbol, processDate: iso(r.processDate), firstSeenAt: r.firstSeenAt, status: r.status })),
    tokenListDeclaredTokens: listDeclared.length,
    apiCalendarUpcoming: up.length, apiCalendarSampleKeys: Object.keys(up[0] ?? {}),
    apiCalendarNotInArchive: [...upKeys].filter((x) => !A.has(x)),
  }
}

// --- 5. yield + pending on the reference tokens
{
  const aapl = await get('/v1/4663/tokens/0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9/yield')
  const sgov = await get('/v1/4663/tokens/0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5/yield')
  const upsP = await get('/v1/4663/tokens/0xf23250dac154d05bb671cb0d0ebef3c635c79ce2/pending')
  const pick = (y) => ({ observedAt: y.body.observedAt, closes: y.body.coverage?.closes, multiplierNow: y.body.coverage?.multiplierNow, ledger: y.body.ledger?.map((l) => ({ status: l.status, kind: l.kind, haircutBps: l.result?.impliedHaircutBps ?? null, netYieldBps: l.result?.netYieldBps ?? null, effectiveAt: l.observed?.effectiveAt })), totals: y.body.totals, notComputed: y.body.notComputed?.map((n) => n.field + ':' + n.reasonCode) })
  const fileAapl = rows.filter((r) => r.symbol === 'AAPL' && r.status === 'matched').map((r) => r.impliedHaircutBps ?? null)
  const fileSgov = rows.filter((r) => r.symbol === 'SGOV').map((r) => ({ status: r.status, hc: r.impliedHaircutBps ?? null, effectiveAt: r.change?.effectiveAt ?? null }))
  out.referenceTokens = { aapl: { file: fileAapl, api: pick(aapl) }, sgov: { file: fileSgov, api: pick(sgov) }, upsPending: { state: upsP.body.state, summary: upsP.body.summary, multiplier: upsP.body.multiplier, declared: upsP.body.declared } }
}

writeFileSync('docs/audit/2026-09-05-data/cross-surface.json', `${JSON.stringify(out, null, 1)}\n`)
console.log(JSON.stringify(out, null, 1))
