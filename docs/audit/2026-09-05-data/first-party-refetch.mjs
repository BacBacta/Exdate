// Audit P3: re-fetch every first-party source and diff it against the committed snapshots.
// Read-only: writes docs/audit/2026-09-05-data/first-party-refetch.json and nothing under data/.
import { readFileSync, writeFileSync } from 'node:fs'

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const iso = (d) => (typeof d === 'string' ? d : `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`)
const fetchJson = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: null, text: text.slice(0, 200) } }
}

const out = { fetchedAt: new Date().toISOString() }

// --- /rhj/assets vs data/robinhood-assets.snapshot.json
{
  const snap = read('data/robinhood-assets.snapshot.json')
  const live = await fetchJson('https://api.robinhood.com/rhj/assets')
  const rows = live.body?.assets ?? live.body?.results ?? []
  const key = (a) => (a.deployments?.[0]?.contractAddress ?? '').toLowerCase()
  const L = new Map(rows.map((a) => [key(a), a])), S = new Map(snap.assets.map((a) => [key(a), a]))
  out.assets = {
    status: live.status, live: L.size, snapshot: S.size, snapshotFetchedAt: snap.fetchedAt,
    onlyLive: [...L.keys()].filter((k) => !S.has(k)), onlySnapshot: [...S.keys()].filter((k) => !L.has(k)),
    multiplierChanged: [...L].filter(([k, a]) => S.has(k) && S.get(k).currentMultiplier !== a.currentMultiplier).map(([k, a]) => ({ symbol: a.tokenSymbol, token: k, snapshot: S.get(k).currentMultiplier, live: a.currentMultiplier })),
    symbolChanged: [...L].filter(([k, a]) => S.has(k) && S.get(k).tokenSymbol !== a.tokenSymbol).map(([k, a]) => ({ token: k, snapshot: S.get(k).tokenSymbol, live: a.tokenSymbol })),
    isinChanged: [...L].filter(([k, a]) => S.has(k) && S.get(k).isin !== a.isin).map(([k, a]) => ({ token: k, snapshot: S.get(k).isin, live: a.isin })),
    statusChanged: [...L].filter(([k, a]) => S.has(k) && S.get(k).status !== a.status).map(([k, a]) => ({ token: k, snapshot: S.get(k).status, live: a.status })),
    pendingLive: rows.filter((a) => a.pendingMultiplier && a.pendingMultiplier !== a.currentMultiplier).map((a) => ({ symbol: a.tokenSymbol, pendingMultiplier: a.pendingMultiplier, effectiveTime: a.pendingMultiplierEffectiveTime ?? null })),
    notAllChain4663: rows.filter((a) => !a.deployments?.every((d) => d.chainId === 4663)).length,
    notAll18Decimals: rows.filter((a) => a.tokenDecimals !== 18).length,
  }
}

// --- /rhj/corporate-actions vs the snapshot (43) and the archive (45)
{
  const snap = read('data/robinhood-corporate-actions.snapshot.json')
  const archive = read('data/corporate-actions.archive.json')
  const live = await fetchJson('https://api.robinhood.com/rhj/corporate-actions?limit=500')
  const rows = live.body?.corpActions ?? []
  const k = (r) => `${r.id}:${iso(r.processDate)}`
  const rate = (r) => r.details?.cashDividend?.rate ?? null
  const L = new Map(rows.map((r) => [k(r), r])), S = new Map(snap.corpActions.map((r) => [k(r), r])), A = new Map(archive.actions.map((r) => [k(r), r]))
  const ids = new Map(); for (const r of rows) ids.set(r.id, (ids.get(r.id) ?? 0) + 1)
  const dates = rows.map((r) => iso(r.processDate)).sort()
  out.corporateActions = {
    status: live.status, liveRows: L.size, snapshotRows: S.size, archiveRows: A.size, archiveLastArchivedAt: archive.lastArchivedAt,
    liveNotInArchive: [...L.keys()].filter((x) => !A.has(x)),
    liveNotInSnapshot: [...L].filter(([x]) => !S.has(x)).map(([x, r]) => ({ key: x, symbol: r.tokenSymbol, processDate: iso(r.processDate), rate: rate(r), status: r.status })),
    snapshotNotInLive: [...S].filter(([x]) => !L.has(x)).map(([x, r]) => ({ key: x, symbol: r.tokenSymbol, processDate: iso(r.processDate) })),
    archiveNotInLive: [...A].filter(([x]) => !L.has(x)).map(([x, r]) => ({ key: x, symbol: r.tokenSymbol, processDate: iso(r.processDate), inWindow: r.inWindow })),
    statusChangedSinceArchive: [...L].filter(([x, r]) => A.has(x) && A.get(x).status !== r.status).map(([x, r]) => ({ symbol: r.tokenSymbol, processDate: iso(r.processDate), archive: A.get(x).status, live: r.status })),
    rateChangedSinceArchive: [...L].filter(([x, r]) => A.has(x) && rate(A.get(x)) !== rate(r)).map(([x, r]) => ({ symbol: r.tokenSymbol, archive: rate(A.get(x)), live: rate(r) })),
    idsSeenMoreThanOnceLive: [...ids].filter(([, n]) => n > 1).map(([id, n]) => ({ id, rows: n })),
    typesLive: Object.fromEntries(rows.reduce((m, r) => m.set(r.type, (m.get(r.type) ?? 0) + 1), new Map())),
    oldestLiveProcessDate: dates[0] ?? null, newestLiveProcessDate: dates.at(-1) ?? null,
    addressesNotInRegistry: rows.filter((r) => !r.deployments?.some((d) => d.chainId === 4663)).map((r) => r.tokenSymbol),
  }
}

// --- Chainlink directory vs data/chainlink-feeds.snapshot.json
{
  const snap = read('data/chainlink-feeds.snapshot.json')
  const live = await fetchJson('https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json')
  const rows = Array.isArray(live.body) ? live.body : []
  const srows = Array.isArray(snap) ? snap : snap.feeds ?? []
  const k = (f) => (f.proxyAddress ?? '').toLowerCase()
  const L = new Map(rows.map((f) => [k(f), f])), S = new Map(srows.map((f) => [k(f), f]))
  const fields = ['name', 'decimals', 'heartbeat', 'threshold', 'contractAddress', 'secondaryProxyAddress', 'feedCategory', 'docs']
  out.chainlink = {
    status: live.status, live: L.size, snapshot: S.size,
    onlyLive: [...L.keys()].filter((x) => !S.has(x)), onlySnapshot: [...S.keys()].filter((x) => !L.has(x)),
    equityLive: rows.filter((f) => /equit|stock|tokenized/i.test(JSON.stringify(f.docs ?? {}) + (f.feedCategory ?? '') + (f.name ?? ''))).length,
    fieldChanged: [...L].flatMap(([x, f]) => (S.has(x) ? fields.filter((n) => JSON.stringify(S.get(x)[n]) !== JSON.stringify(f[n])).map((n) => ({ proxy: x, field: n, snapshot: S.get(x)[n], live: f[n] })) : [])),
  }
}

writeFileSync('docs/audit/2026-09-05-data/first-party-refetch.json', `${JSON.stringify(out, null, 1)}\n`)
console.log(JSON.stringify(out, null, 1))
