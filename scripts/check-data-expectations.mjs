// Standing expectations over data/ — the checks the 2026-09-05 data audit found worth keeping.
//
//   node scripts/check-data-expectations.mjs            # exit 1 on any FAIL
//   EXDATE_EXPECT_SKIP_CADENCE=1 node scripts/...       # on an old checkout, skip the "within cadence" checks
//
// Plain ESM, no dependency: viem is used for EIP-55 checksums only when it resolves from
// packages/core, and the checksum check is reported as skipped otherwise, never as passed.
// Every check names the file and the field it reads, so a failure can be reproduced by hand.
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { classifyMarketSession, MARKET_SESSIONS } from './lib/market-session.mjs'

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const iso = (d) => (typeof d === 'string' ? d : `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`)
const low = (s) => String(s).toLowerCase()
const sec = (t) => Math.floor(Date.parse(t) / 1000)
const hoursAgo = (t) => (Date.now() - Date.parse(t)) / 3600e3
const dec = (s, places) => { const [i, f = ''] = String(s).split('.'); return BigInt(i + f.padEnd(places, '0').slice(0, places)) }
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const skipCadence = process.env.EXDATE_EXPECT_SKIP_CADENCE === '1'

let failures = 0, warnings = 0, skips = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const warn = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'warn'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) warnings++ }
const skip = (name, why) => { console.log(`skip ${name} — ${why}`); skips++ }
const within = (name, at, cadenceHours, factor = 3) => {
  if (skipCadence) return skip(name, 'EXDATE_EXPECT_SKIP_CADENCE=1')
  const age = hoursAgo(at)
  check(name, age <= cadenceHours * factor, `${age.toFixed(1)} h old, cadence ${cadenceHours} h, limit ${cadenceHours * factor} h`)
}

let getAddress = null
try { getAddress = createRequire(new URL('../packages/core/package.json', import.meta.url))('viem').getAddress } catch { /* reported per check */ }
const isChecksummed = (a) => (getAddress ? getAddress(a) === a : null)

// ---------------------------------------------------------------- A. first-party snapshots
const assets = read('data/robinhood-assets.snapshot.json')
const registry = new Map(assets.assets.map((a) => [low(a.deployments[0].contractAddress), a]))
{
  const rows = assets.assets
  check('assets: 194 rows', rows.length === 194, `${rows.length}`)
  check('assets: unique addresses', registry.size === rows.length)
  check('assets: every deployment on chain 4663', rows.every((a) => a.deployments.every((d) => d.chainId === 4663)))
  check('assets: 18 decimals everywhere', rows.every((a) => a.tokenDecimals === 18))
  check('assets: 194 distinct tickers', new Set(rows.map((a) => a.tokenSymbol)).size === rows.length)
  const luhn = (isin) => { if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false; const digits = [...isin.slice(0, 11)].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join(''); let sum = 0; const arr = [...digits].reverse(); for (let i = 0; i < arr.length; i++) { let d = Number(arr[i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 } sum += d }; return (10 - (sum % 10)) % 10 === Number(isin[11]) }
  const badIsin = rows.filter((a) => !luhn(a.isin)).map((a) => a.tokenSymbol)
  check('assets: every ISIN passes its check digit', badIsin.length === 0, badIsin.join(' '))
  if (getAddress) check('assets: every address EIP-55 checksummed', rows.every((a) => isChecksummed(a.deployments[0].contractAddress)))
  else skip('assets: every address EIP-55 checksummed', 'viem not resolvable from packages/core; run pnpm install')
  check('assets: fetchedAt present', typeof assets.fetchedAt === 'string')
}

const caSnap = read('data/robinhood-corporate-actions.snapshot.json')
const archive = read('data/corporate-actions.archive.json')
const caKey = (r) => `${r.id}:${iso(r.processDate)}`
const STATUSES = new Set(['CORPORATE_ACTION_STATUS_IN_PROGRESS', 'CORPORATE_ACTION_STATUS_COMPLETED', 'CORPORATE_ACTION_STATUS_UNSPECIFIED', 'CORPORATE_ACTION_STATUS_CANCELLED'])
{
  const rows = caSnap.corpActions
  check('corporate-actions snapshot: unique (id, processDate)', new Set(rows.map(caKey)).size === rows.length, `${rows.length} rows`)
  check('corporate-actions snapshot: every address in the registry', rows.every((r) => r.deployments.every((d) => registry.has(low(d.contractAddress)))))
  warn('corporate-actions snapshot: carries its own fetchedAt', typeof caSnap.fetchedAt === 'string', 'no top-level timestamp in the file')
  const A = new Map(archive.actions.map((r) => [caKey(r), r]))
  check('archive: unique (id, processDate)', A.size === archive.actions.length, `${archive.actions.length} rows`)
  check('archive: archivedRows equals the row count', archive.archivedRows === archive.actions.length, `${archive.archivedRows} vs ${archive.actions.length}`)
  check('archive: every snapshot row is archived', rows.every((r) => A.has(caKey(r))), rows.filter((r) => !A.has(caKey(r))).map((r) => r.tokenSymbol).join(' '))
  check('archive: firstSeenAt <= lastSeenAt', archive.actions.every((r) => Date.parse(r.firstSeenAt) <= Date.parse(r.lastSeenAt)))
  check('archive: statuses in the closed set', archive.actions.every((r) => STATUSES.has(r.status)), [...new Set(archive.actions.map((r) => r.status))].join(' '))
  check('archive: every address in the registry', archive.actions.every((r) => r.deployments.every((d) => registry.has(low(d.contractAddress)))))
  within('archive: lastArchivedAt within cadence (daily)', archive.lastArchivedAt, 24)
}

const feeds = read('data/chainlink-feeds.snapshot.json')
const feedByProxy = new Map((Array.isArray(feeds) ? feeds : feeds.feeds).map((f) => [low(f.proxyAddress), f]))
{
  const rows = Array.isArray(feeds) ? feeds : feeds.feeds
  check('chainlink snapshot: unique proxy addresses', feedByProxy.size === rows.length, `${rows.length} feeds`)
  warn('chainlink snapshot: carries its own fetchedAt', !Array.isArray(feeds) && typeof feeds.fetchedAt === 'string', 'the file is a bare array with no timestamp')
}

// ---------------------------------------------------------------- B. observations
const events = read('data/multiplier-events.observed.json')
const evKey = (e) => `${low(e.token)}:${sec(e.effectiveAt)}`
const distinct = new Map()
{
  const rows = events.events
  for (const e of rows) distinct.set(evKey(e), e)
  check('events: every token in the registry', rows.every((e) => registry.has(low(e.token))))
  check('events: announcedAt < effectiveAt', rows.every((e) => Date.parse(e.announcedAt) < Date.parse(e.effectiveAt)))
  check('events: every block within the scanned range', rows.every((e) => e.block >= events.scannedFromBlock && e.block <= events.scannedThroughBlock))
  check('events: newMultiplier > oldMultiplier', rows.every((e) => BigInt(e.newMultiplier) > BigInt(e.oldMultiplier)))
  check('events: stepBps recomputes from the multipliers', rows.every((e) => Math.abs(Number((BigInt(e.newMultiplier) - BigInt(e.oldMultiplier)) * 10n ** 8n / BigInt(e.oldMultiplier)) / 1e4 - e.stepBps) < 0.01))
  check('events: a re-announcement repeats the same (newMultiplier, effectiveAt)', rows.every((e) => distinct.get(evKey(e)).newMultiplier === e.newMultiplier))
  check('events: tx hashes unique', new Set(rows.map((e) => e.tx)).size === rows.length)
  // the registry snapshot must agree with the last step of every token it was fetched after (by more than an hour)
  const disagree = []
  for (const [k, e] of distinct) { const a = registry.get(low(e.token)); if (!a) continue; if (Date.parse(assets.fetchedAt) > Date.parse(e.effectiveAt) + 3600e3) { const last = [...distinct.values()].filter((x) => low(x.token) === low(e.token)).sort((x, y) => Date.parse(y.effectiveAt) - Date.parse(x.effectiveAt))[0]; if (dec(a.currentMultiplier, 18) !== BigInt(last.newMultiplier)) disagree.push(`${e.symbol}:${a.currentMultiplier}`) } }
  check('events: registry snapshot multiplier equals the last step it postdates by > 1 h', disagree.length === 0, [...new Set(disagree)].join(' '))
}

const blocks = read('data/effective-blocks.json')
{
  const keys = new Set(blocks.blocks.map((b) => `${low(b.token)}:${sec(b.effectiveAt)}`))
  check('effective-blocks: one row per distinct change', keys.size === distinct.size && [...distinct.keys()].every((k) => keys.has(k)), `${keys.size} blocks, ${distinct.size} changes`)
  check('effective-blocks: previousBlockTimestamp < effectiveAt <= effectiveBlockTimestamp', blocks.blocks.every((b) => sec(b.previousBlockTimestamp) < sec(b.effectiveAt) && sec(b.effectiveAt) <= sec(b.effectiveBlockTimestamp)))
  check('effective-blocks: effectiveBlock > announcedBlock', blocks.blocks.every((b) => b.effectiveBlock > b.announcedBlock))
}

const state = read('data/multiplier-state-verification.json')
{
  const keys = new Set(state.steps.map((s) => `${low(s.token)}:${sec(s.effectiveAt)}`))
  check('state-verification: one row per distinct change', keys.size === distinct.size && [...distinct.keys()].every((k) => keys.has(k)), `${keys.size} vs ${distinct.size}`)
  check('state-verification: every transition observed', state.steps.every((s) => s.transitionObserved === true && s.beforeMatches === true && s.afterMatches === true))
  check('state-verification: summary equals the recount', state.summary.transitionConfirmed === state.steps.filter((s) => s.transitionObserved).length && state.summary.steps === state.steps.length)
  check('state-verification: states equal the declared multipliers', state.steps.every((s) => s.stateBefore === s.declaredOldMultiplier && s.stateAfter === s.declaredNewMultiplier))
}

const prices = read('data/effective-prices.observed.json')
{
  const missing = prices.steps.filter((s) => !distinct.has(`${low(s.token)}:${sec(s.effectiveAt)}`)).map((s) => `${s.symbol}@${s.effectiveAt}`)
  check('effective-prices: every captured step is in multiplier-events (else rescan: node scripts/backfill-multiplier-events.mjs)', missing.length === 0, missing.join(' '))
  const tol = prices.toleranceSeconds ?? 120
  check('effective-prices: givenUp exactly when no quote lies within tolerance', prices.steps.every((s) => { const near = (s.quotes ?? []).some((q) => Math.abs(sec(q.generatedAt) - sec(s.effectiveAt)) <= tol); return s.givenUp ? !near : near }))
  check('effective-prices: summary equals the recount', prices.summary.steps === prices.steps.length && prices.summary.givenUp === prices.steps.filter((s) => s.givenUp).length)
  if (prices.watcher?.heartbeatAt) within('effective-prices: watcher heartbeat within cadence (6 h)', prices.watcher.heartbeatAt, 6, 1.2)
  else warn('effective-prices: a watcher heartbeat is recorded', false, 'no watcher block')
}

const rec = read('data/reconciliations.observed.json')
{
  const rows = rec.rows
  const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
  check('reconciliations: summary equals the recount', rec.summary.total === rows.length && ['matched', 'anomaly', 'pending', 'unmatched'].every((s) => (rec.summary[s] ?? 0) === (counts[s] ?? 0)), JSON.stringify(counts))
  check('reconciliations: every token in the registry', rows.every((r) => registry.has(low(r.token))))
  check('reconciliations: every step in effective-blocks', rows.filter((r) => r.change).every((r) => blocks.blocks.some((b) => low(b.token) === low(r.token) && sec(b.effectiveAt) === sec(r.change.effectiveAt))))
  const matched = rows.filter((r) => r.status === 'matched')
  check('reconciliations: matched haircut within [0, 10000] bps', matched.every((r) => r.impliedHaircutBps >= 0 && r.impliedHaircutBps <= 10000), matched.map((r) => `${r.symbol}:${r.impliedHaircutBps}`).join(' '))
  check('reconciliations: received <= declared on matched rows', matched.every((r) => dec(r.receivedPerShare, 18) <= dec(r.rate, 18)))
  check('reconciliations: matched haircut recomputes from expected and observed steps (±1 bps)', matched.every((r) => Math.abs((1 - Number(BigInt(r.observedStepWad) * 10n ** 6n / BigInt(r.expectedStepWad)) / 1e6) * 1e4 - r.impliedHaircutBps) <= 1))
  check('reconciliations: an anomaly haircut, when priced, lies outside the plausible band', rows.filter((r) => r.status === 'anomaly' && r.impliedHaircutBps != null).every((r) => r.impliedHaircutBps < rec.plausibleHaircutBps[0] || r.impliedHaircutBps > rec.plausibleHaircutBps[1]), rows.filter((r) => r.status === 'anomaly').map((r) => `${r.symbol}:${r.impliedHaircutBps ?? 'unpriced'}`).join(' '))
  check('reconciliations: pending rows carry no change', rows.filter((r) => r.status === 'pending').every((r) => !r.change))
  const A = new Map(archive.actions.map((r) => [caKey(r), r]))
  const declared = rows.filter((r) => r.actionId)
  check('reconciliations: every declared row is in the archive', declared.every((r) => A.has(`${r.actionId}:${r.processDate}`)))
  const landedTokens = new Set(rows.filter((r) => r.change && r.actionId).map((r) => `${r.actionId}:${r.processDate}`))
  const absent = [...A.values()].filter((r) => r.inWindow && !declared.some((d) => `${d.actionId}:${d.processDate}` === caKey(r))).map((r) => `${r.tokenSymbol}@${iso(r.processDate)}`)
  check('reconciliations: every in-window archive row is present (else rebuild from the archive: node scripts/build-reconciliations.mjs)', absent.length === 0, absent.join(' '))
  warn('reconciliations: carries its own timestamp', typeof (rec.builtAt ?? rec.generatedAt) === 'string', 'no top-level timestamp in the file')
  warn('reconciliations: built from the archive rather than the one-month snapshot', rec.builtFrom?.corporateActions === 'data/corporate-actions.archive.json', `builtFrom.corporateActions = ${rec.builtFrom?.corporateActions}`)
}

// ---------------------------------------------------------------- C. derived
const map = read('data/token-feed-map.json')
const pairByToken = new Map(map.pairs.map((p) => [low(p.token), p]))
{
  check('token-feed-map: every token in the registry', map.pairs.every((p) => registry.has(low(p.token))))
  check('token-feed-map: every feed proxy in the Chainlink directory', map.pairs.every((p) => feedByProxy.has(low(p.feedProxy))))
  check('token-feed-map: verified is false everywhere (no first-party link exists)', map.pairs.every((p) => p.verified === false))
  check('token-feed-map: mapped equals the pair count', map.mapped === map.pairs.length)
  const byPrice = map.pairs.filter((p) => (p.corroboratedBy ?? []).includes('traded-price')).length
  const byStep = map.pairs.filter((p) => (p.corroboratedBy ?? []).includes('multiplier-step')).length
  const any = map.pairs.filter((p) => (p.corroboratedBy ?? []).length > 0).length
  check('token-feed-map: corroboration counts equal the recount', map.corroboratedByPrice === byPrice && map.corroboratedByStep === byStep && map.corroborated === any, `price ${byPrice}, step ${byStep}, any ${any}`)
  check('token-feed-map: corroborated flag agrees with corroboratedBy on every row', map.pairs.every((p) => p.corroborated === ((p.corroboratedBy ?? []).length > 0)))
  within('token-feed-map: corroboratedAt within cadence (hourly)', map.corroboratedAt, 1)
}

const list = read('data/exdate.tokenlist.json')
{
  check('tokenlist: name <= 30 chars and ^[\\w ]+$', list.name.length <= 30 && /^[\w ]+$/.test(list.name), list.name)
  check('tokenlist: version has integer major/minor/patch', ['major', 'minor', 'patch'].every((k) => Number.isInteger(list.version[k])))
  check('tokenlist: 194 tokens, unique by (chainId, address)', list.tokens.length === 194 && new Set(list.tokens.map((t) => `${t.chainId}:${low(t.address)}`)).size === list.tokens.length)
  check('tokenlist: every token in the registry, chain 4663, 18 decimals', list.tokens.every((t) => registry.has(low(t.address)) && t.chainId === 4663 && t.decimals === 18))
  check('tokenlist: symbol <= 20 and name <= 60 chars', list.tokens.every((t) => t.symbol.length <= 20 && t.name.length <= 60))
  if (getAddress) check('tokenlist: every address EIP-55 checksummed', list.tokens.every((t) => isChecksummed(t.address)))
  else skip('tokenlist: every address EIP-55 checksummed', 'viem not resolvable')
  const feedDrift = list.tokens.filter((t) => { const p = pairByToken.get(low(t.address)); return (t.extensions?.priceFeed ?? null) !== (p?.feedProxy ?? null) }).map((t) => t.symbol)
  check('tokenlist: priceFeed equals the map', feedDrift.length === 0, feedDrift.join(' '))
  const corrDrift = list.tokens.filter((t) => { const p = pairByToken.get(low(t.address)); const want = p ? ((p.corroboratedBy ?? []).join(',') || null) : null; return (t.extensions?.priceFeedCorroboratedBy ?? null) !== want }).map((t) => t.symbol)
  check('tokenlist: priceFeedCorroboratedBy equals the map (else rebuild: node scripts/build-token-list.mjs)', corrDrift.length === 0, corrDrift.join(' '))
  const mult = new Map(); for (const e of [...distinct.values()].sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt))) mult.set(low(e.token), e.newMultiplier)
  const shareDrift = list.tokens.filter((t) => dec(t.extensions?.underlyingSharesPerToken ?? '1', 18) !== BigInt(mult.get(low(t.address)) ?? '1000000000000000000')).map((t) => t.symbol)
  check('tokenlist: underlyingSharesPerToken equals the last observed multiplier', shareDrift.length === 0, shareDrift.join(' '))
  const owedBad = list.tokens.filter((t) => t.extensions?.dividendOwedPerToken).filter((t) => { const x = t.extensions; const rate = archive.actions.find((r) => r.deployments.some((d) => low(d.contractAddress) === low(t.address)) && iso(r.processDate) === x.dividendProcessDate)?.details?.cashDividend?.rate; if (!rate) return true; const owed = dec(rate, 18) * dec(x.underlyingSharesPerToken, 18) / 10n ** 18n; const o6 = owed / 10n ** 12n; const want = dec(x.dividendOwedPerToken, 6); return !(o6 === want || o6 + 1n === want) }).map((t) => `${t.symbol}:${t.extensions.dividendOwedPerToken}`)
  check('tokenlist: dividendOwedPerToken = rate x multiplier at 6 dp', owedBad.length === 0, owedBad.join(' '))
}

const share = read('data/session-share.observed.json')
{
  const s = share.samples
  check('session-share: sampleCount equals the sample rows', share.sampleCount === s.length, `${s.length}`)
  check('session-share: samples strictly increasing in time', s.every((x, i) => i === 0 || Date.parse(x.observedAt) > Date.parse(s[i - 1].observedAt)))
  check('session-share: every sample classified as its own session', s.every((x) => classifyMarketSession(new Date(x.observedAt)) === x.session))
  check('session-share: per-session sample counts equal the recount', share.sessions.every((row) => row.samples === s.filter((x) => x.session === row.session).length))
  if (share.sufficient) {
    check('session-share: every session has at least minSamplesPerSession', share.sessions.every((row) => row.samples >= share.minSamplesPerSession))
    const weighted = (sel) => share.sessions.reduce((sum, row) => sum + (sel(row) ? row.transfersPerSecondMean * row.hoursPerWeek : 0), 0)
    const off = weighted((r) => r.offHours) / weighted(() => true)
    check('session-share: offHours share recomputes as an hour-weighted rate (±0.001)', Math.abs(off - share.transferShare.offHours) < 0.001, `${off.toFixed(4)} vs ${share.transferShare.offHours}`)
    check('session-share: off-hours hours sum to 135.5 of 168', Math.abs(Object.values(MARKET_SESSIONS).filter((m) => m.offHours).reduce((a, m) => a + m.hoursPerWeek, 0) - 135.5) < 1e-9)
  }
  within('session-share: lastSampleAt within cadence (hourly)', share.lastSampleAt, 1)
}

const flows = read('data/primary-flows.observed.json')
{
  const w = flows.windows
  check('primary-flows: windows contiguous', w.every((x, i) => i === 0 || x.fromBlock === w[i - 1].toBlock + 1 || x.precededByGap === true))
  check('primary-flows: netCreated = totalMinted - totalBurned', w.every((x) => dec(x.netCreated, 18) === dec(x.totalMinted, 18) - dec(x.totalBurned, 18)))
  check('primary-flows: an incomplete window lists its unread ranges', w.every((x) => x.incomplete === (x.unreadRanges.length > 0)))
  check('primary-flows: every token in the registry', w.every((x) => x.tokens.every((t) => registry.has(low(t.token)))))
  within('primary-flows: lastRunAt within cadence (daily)', flows.lastRunAt, 24)
}

const gap = read('data/dex-feed-gap.observed.json')
{
  const rows = gap.tokens ?? gap.rows
  const withFeed = rows.filter((r) => r.hasFeed && r.deviationBps != null)
  const abs = withFeed.map((r) => Math.abs(r.deviationBps))
  check('dex-feed-gap: summary medians recompute from the rows', Math.abs(median(abs) - gap.summary.medianAbsDeviationBps) < 0.01 && Math.abs(Math.max(...abs) - gap.summary.maxAbsDeviationBps) < 0.01 && median(withFeed.map((r) => r.feedAgeSeconds)) === gap.summary.medianFeedAgeSeconds, `median ${median(abs)}, max ${Math.max(...abs)}`)
  check('dex-feed-gap: summary counts recompute', gap.summary.withFeed === withFeed.length && gap.summary.feedsBeyondHeartbeat === withFeed.filter((r) => r.beyondHeartbeat).length && gap.summary.tokensQuotable === rows.length)
  check('dex-feed-gap: every token in the registry', rows.every((r) => registry.has(low(r.token))))
  check('dex-feed-gap: every feed read is the mapped feed', withFeed.every((r) => low(pairByToken.get(low(r.token))?.feedProxy ?? '') === low(r.feed)))
  check('dex-feed-gap: beyondHeartbeat agrees with the age', withFeed.every((r) => r.beyondHeartbeat === (r.feedAgeSeconds > gap.heartbeatSeconds)))
  within('dex-feed-gap: observedAt within cadence (hourly)', gap.observedAt, 1)
}

{
  const rpc = read('data/rpc-endpoints.observed.json')
  const eps = Object.values(rpc).find((v) => Array.isArray(v) && v.length > 3 && v[0]?.url)
  check('rpc-endpoints: summary.reachingOldestStep equals the recount', rpc.summary.reachingOldestStep === eps.filter((e) => e.reachesOldestStep === true).length)
  const svr = read('data/svr-proxy-check.json')
  check('svr-proxy-check: every pair shares its aggregator and answer', svr.sameAggregator === svr.rows.length && svr.sameAnswer === svr.rows.length && svr.feeds === svr.rows.length)
  const base = read('data/base-b20-verification.json')
  check('base-b20: 13 tokens', (base.tokens ?? []).length === 13, `${(base.tokens ?? []).length}`)
}

// ---------------------------------------------------------------- D. the built site, when present
{
  const home = 'apps/web/out/index.html'
  if (existsSync(home)) {
    const html = readFileSync(home, 'utf8').replace(/<[^>]+>/g, ' ')
    const aapl = rec.rows.find((r) => r.symbol === 'AAPL' && r.status === 'matched')
    check('site: home haircut equals the reconciliation row', aapl && html.includes(`${Math.round(aapl.impliedHaircutBps / 100)}%`))
    if (share.sufficient) check('site: home off-hours share equals the dataset', html.includes(`${(share.transferShare.offHours * 100).toFixed(1)}%`) && html.includes(`${share.sampleCount} samples`))
    const net = Math.round(Number(flows.windows.at(-1).netCreated)).toLocaleString('en-US')
    check('site: home net creation equals the last window', html.includes(net), net)
  } else skip('site: home figures equal their dataset fields', 'apps/web/out/index.html not built')
  const ics = 'apps/web/out/calendar.ics'
  if (existsSync(ics)) {
    const buf = readFileSync(ics)
    const text = buf.toString('latin1')
    check('site: calendar.ics uses CRLF only', !/[^\r]\n/.test(text))
    check('site: calendar.ics lines <= 75 octets', text.split('\r\n').every((l) => Buffer.byteLength(l, 'latin1') <= 75))
    const unfolded = buf.toString('utf8').replace(/\r\n[ \t]/g, '')
    const events = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []
    check('site: one DTSTART and one UID per VEVENT', events.every((e) => (e.match(/\r\nDTSTART/g) ?? []).length === 1 && (e.match(/\r\nUID:/g) ?? []).length === 1), `${events.length} events`)
    check('site: UIDs unique', new Set(events.map((e) => e.match(/UID:(.*)/)[1])).size === events.length)
  } else skip('site: calendar.ics folding and structure', 'apps/web/out/calendar.ics not built')
}

console.log(`\n${failures} failed, ${warnings} warnings, ${skips} skipped`)
process.exit(failures ? 1 : 0)
