// Phase 0 - step 3: read latestRoundData() on every Chainlink feed deployed on
// Robinhood Chain and report its age. The feed list comes from Chainlink's own
// reference-data-directory, which is what docs.chain.link renders.
import { rpc, SELECTOR, decodeLatestRoundData, decodeString } from './rpc.mjs'
import { readFile, writeFile } from 'node:fs/promises'

const FEEDS_URL = 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json'
const SNAPSHOT = new URL('../../data/chainlink-feeds.snapshot.json', import.meta.url)

let feeds
try {
  const res = await fetch(FEEDS_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  feeds = await res.json()
  // Enveloped rather than dumped as a bare array: a served file that cannot say when
  // it was taken or where from is a figure without a date (audit 2026-09-05, F07).
  // Readers take `.feeds ?? the file`, so an older checkout still loads.
  await writeFile(
    SNAPSHOT,
    JSON.stringify({ fetchedAt: new Date().toISOString(), source: FEEDS_URL, note: "Chainlink's own reference-data-directory for Robinhood Chain, as docs.chain.link renders it. Copied verbatim; exdate measures nothing here.", feeds }, null, 2) + '\n',
  )
} catch (error) {
  console.error(`# live fetch failed (${error.message}), falling back to snapshot`)
  const snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8'))
  feeds = snapshot.feeds ?? snapshot
}

const equity = feeds.filter((f) => f.docs?.marketHours === 'us_equities_24/5')
const now = Math.floor(Date.now() / 1000)
console.log(`# ${feeds.length} feeds total, ${equity.length} tokenized-equity feeds`)
console.log(['name', 'proxy', 'decimals', 'price', 'updatedAt', 'ageMinutes', 'description()'].join('\t'))

for (const feed of equity) {
  try {
    const decimals = Number(BigInt(await rpc('eth_call', [{ to: feed.proxyAddress, data: SELECTOR.decimals }, 'latest'])))
    const round = decodeLatestRoundData(await rpc('eth_call', [{ to: feed.proxyAddress, data: SELECTOR.latestRoundData }, 'latest']))
    let description = ''
    try {
      description = decodeString(await rpc('eth_call', [{ to: feed.proxyAddress, data: SELECTOR.description }, 'latest']))
    } catch {}
    console.log([
      feed.name,
      feed.proxyAddress,
      decimals,
      (Number(round.answer) / 10 ** decimals).toFixed(4),
      new Date(Number(round.updatedAt) * 1000).toISOString(),
      ((now - Number(round.updatedAt)) / 60).toFixed(1),
      description,
    ].join('\t'))
  } catch (error) {
    console.log([feed.name, feed.proxyAddress, 'ERROR', String(error.message).slice(0, 60)].join('\t'))
  }
}
