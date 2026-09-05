// Phase 0 - step 3b: pair each Stock Token with its Chainlink feed.
//
// PROVENANCE WARNING. Chainlink's directory identifies a feed only by a display
// name ("Robinhood AAPL / USD", "Robinhood SGOV-USD", "RHTSLA / USD"). There is
// no on-chain link from the token contract to the aggregator, so this mapping is
// derived from the ticker and is therefore a heuristic, not a verified fact.
// Every row is emitted with verified:false. Do not promote a row to verified
// without an issuer- or Chainlink-published token->feed statement.
import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { fetchRegistry, toRows } from './registry.mjs'

const FEEDS_SNAPSHOT = new URL('../../data/chainlink-feeds.snapshot.json', import.meta.url)
const OUT = new URL('../../data/token-feed-map.json', import.meta.url)

const tickerOf = (feedName) =>
  feedName
    .replace(/^Robinhood\s+/i, '')
    .replace(/^RH/, '')
    .replace(/\s*\/\s*USD$/i, '')
    .replace(/-USD$/i, '')
    .trim()
    .toUpperCase()

const feedsSnapshot = JSON.parse(await readFile(FEEDS_SNAPSHOT, 'utf8'))
// The snapshot gained an envelope on 2026-09-05 (F07); accept either shape.
const feeds = feedsSnapshot.feeds ?? feedsSnapshot
const equityFeeds = feeds.filter((f) => f.docs?.marketHours === 'us_equities_24/5')
const byTicker = new Map(equityFeeds.map((f) => [tickerOf(f.name), f]))

const tokens = toRows(await fetchRegistry()).filter((r) => r.chainId === 4663)
const mapped = []
const unmapped = []

for (const token of tokens) {
  const feed = byTicker.get(token.symbol.toUpperCase())
  if (!feed) {
    unmapped.push(token.symbol)
    continue
  }
  mapped.push({
    chainId: 4663,
    token: token.address,
    symbol: token.symbol,
    feedName: feed.name,
    feedProxy: feed.proxyAddress,
    feedDecimals: feed.decimals,
    heartbeatSeconds: feed.heartbeat,
    deviationThresholdPercent: feed.threshold,
    marketHours: feed.docs?.marketHours,
    matchedBy: 'ticker-heuristic',
    verified: false,
  })
}

await writeFile(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: 'Ticker-derived mapping. See scripts/phase0/map-feeds.mjs. Nothing here is issuer-confirmed.',
      tokensTotal: tokens.length,
      equityFeedsTotal: equityFeeds.length,
      mapped: mapped.length,
      unmappedSymbols: unmapped.sort(),
      pairs: mapped.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    },
    null,
    2,
  ) + '\n',
)

console.log(`${tokens.length} tokens, ${equityFeeds.length} equity feeds, ${mapped.length} mapped, ${unmapped.length} without a feed`)
