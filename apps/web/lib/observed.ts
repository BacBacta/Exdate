/**
 * Everything the site says with a number, read from the committed observations.
 *
 * The site is built, not served: it never talks to the API or to an RPC. Each
 * figure below comes from a file under ../../data that a script wrote from the
 * chain or from the issuer's own endpoint, and each carries the timestamp of
 * that read. If a number is not in those files, the page does not show it.
 */

import archiveJson from '../../../data/corporate-actions.archive.json'
import feedsJson from '../../../data/chainlink-feeds.snapshot.json'
import eventsJson from '../../../data/multiplier-events.observed.json'
import reconciliationsJson from '../../../data/reconciliations.observed.json'
import registryJson from '../../../data/robinhood-assets.snapshot.json'
import sessionShareJson from '../../../data/session-share.observed.json'
import feedMapJson from '../../../data/token-feed-map.json'

// The JSON files are cast to the handful of fields the page reads, so a field
// the page does not use can change shape without touching this module.
interface ReconciliationRow {
  symbol: string
  token: string
  processDate: string | null
  rate: string | null
  status: string
  change: { effectiveAt: string; stepBps: number; oldMultiplier: string; newMultiplier: string } | null
  price: { value: string; updatedAt: string } | null
  receivedPerShare: string | null
  impliedHaircutBps: number | null
  impliedReinvestPrice: string | null
  issuerSpotToday: { mid: string; impliedOverSpot: number } | null
  feed: { proxy: string; corroborated: boolean } | null
}
interface MultiplierEvent {
  symbol: string
  token: string
  announcedAt: string
  effectiveAt: string
  leadMinutes: number
  oldMultiplier: string
  newMultiplier: string
  stepBps: number
  tx: string
}
interface ArchivedAction {
  symbol?: string
  processDate: { year: number; month: number; day: number } | null
  status: string
  details?: { cashDividend?: { rate?: string } }
  deployments?: { contractAddress: string; chainId: number }[]
  contractAddress?: string
}

const reconciliations = reconciliationsJson as unknown as {
  summary: Record<string, number>
  rows: ReconciliationRow[]
}
const events = eventsJson as unknown as { scannedAt: string; events: MultiplierEvent[] }
const registry = registryJson as unknown as {
  fetchedAt: string
  assets: { tokenSymbol: string; tokenName: string; deployments?: { contractAddress: string; chainId: number }[] }[]
}
const feeds = feedsJson as unknown as { name: string }[]
const feedMap = feedMapJson as unknown as { generatedAt: string; pairs: unknown[]; corroborated?: number }
const archive = archiveJson as unknown as {
  lastArchivedAt: string
  archivedRows: number
  beyondWindow: number
  earliestProcessDate: string
  actions: ArchivedAction[]
}
const sessionShare = sessionShareJson as unknown as {
  sampleCount: number
  sufficient: boolean
  lastSampleAt: string
  easternHourOfWeekSlotsCovered: number
}

// --- arithmetic on WAD values, exact, no floats ------------------------------
const WAD = 10n ** 18n

function parseDecimal(value: string): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole || '0') * WAD + BigInt((fraction + '0'.repeat(18)).slice(0, 18))
}

/** Rounded half-up at `places`, the way the API's own serialisers read back. */
function formatWad(value: bigint, places: number): string {
  const unit = 10n ** BigInt(18 - places)
  const rounded = (value + unit / 2n) / unit
  const whole = rounded / 10n ** BigInt(places)
  const fraction = (rounded % 10n ** BigInt(places)).toString().padStart(places, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

// A field an earlier scan did not fill is absent rather than null in some rows.
const money = (value: string | null | undefined, places = 4) =>
  value === null || value === undefined ? null : formatWad(parseDecimal(value), places)

const day = (iso: string) => iso.slice(0, 10)

/** Dollars to the cent, padded: "0.2" reads as a typo, "0.20" as a price. */
export function cents(value: string | null | undefined): string | null {
  const rounded = money(value, 2)
  if (rounded === null) return null
  const [whole, fraction = ''] = rounded.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

/**
 * The company, by address, from the issuer's own registry - minus the suffix
 * every token carries. A reader sees "Apple", never a ticker.
 */
const nameByAddress = new Map(
  registry.assets.flatMap((asset) =>
    (asset.deployments ?? []).map((d) => [
      d.contractAddress.toLowerCase(),
      asset.tokenName.replace(/\s*[•·-]\s*Robinhood Token$/i, '').trim(),
    ]),
  ),
)

// --- what the page shows ------------------------------------------------------

/** One event per (token, effectiveAt): CRWD announced the same change twice. */
const distinctEvents = [...new Map(events.events.map((e) => [`${e.token}:${e.effectiveAt}`, e])).values()].sort(
  (a, b) => a.effectiveAt.localeCompare(b.effectiveAt),
)

const reconciled = reconciliations.rows
  .filter((row) => row.status === 'matched' || row.status === 'anomaly')
  .sort((a, b) => (a.processDate ?? '').localeCompare(b.processDate ?? ''))
  .map((row) => ({
    symbol: row.symbol,
    token: row.token,
    name: nameByAddress.get(row.token.toLowerCase()) ?? row.symbol,
    processDate: row.processDate,
    declared: money(row.rate, 6),
    stepBps: row.change?.stepBps ?? null,
    effectiveAt: row.change?.effectiveAt ?? null,
    priceAtEffect: row.price ? money(row.price.value, 2) : null,
    received: money(row.receivedPerShare, 4),
    haircutBps: row.impliedHaircutBps ?? null,
    impliedReinvestPrice: money(row.impliedReinvestPrice, 2),
    impliedOverSpot: row.issuerSpotToday?.impliedOverSpot ?? null,
    status: row.status as 'matched' | 'anomaly',
    hasFeed: Boolean(row.feed),
  }))

/** The most recent dividend that reconciled: the page's one headline figure. */
const hero = [...reconciled]
  .filter((row) => row.status === 'matched' && row.haircutBps !== null)
  .sort((a, b) => (b.processDate ?? '').localeCompare(a.processDate ?? ''))[0]!

/**
 * What is owed per token needs no oracle: the declared rate is per underlying
 * share and one raw token carries `multiplier` of them. Shown for the token
 * with the longest history - SGOV, three chained steps - picked by address.
 */
const SGOV = '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'
const sgovLastStep = [...distinctEvents].reverse().find((e) => e.token.toLowerCase() === SGOV.toLowerCase())
const sgovDeclared = archive.actions
  .filter((action) => {
    const address = action.deployments?.[0]?.contractAddress ?? action.contractAddress
    return address?.toLowerCase() === SGOV.toLowerCase() && action.details?.cashDividend?.rate
  })
  .map((action) => ({
    processDate: action.processDate
      ? `${action.processDate.year}-${String(action.processDate.month).padStart(2, '0')}-${String(action.processDate.day).padStart(2, '0')}`
      : null,
    rate: action.details!.cashDividend!.rate!,
    status: action.status,
  }))
  .sort((a, b) => (b.processDate ?? '').localeCompare(a.processDate ?? ''))[0]

const pendingExample =
  sgovLastStep && sgovDeclared
    ? {
        symbol: sgovLastStep.symbol,
        token: SGOV,
        processDate: sgovDeclared.processDate,
        multiplier: formatWad(BigInt(sgovLastStep.newMultiplier), 18),
        grossPerShare: money(sgovDeclared.rate, 6)!,
        grossPerToken: formatWad((parseDecimal(sgovDeclared.rate) * BigInt(sgovLastStep.newMultiplier)) / WAD, 6),
      }
    : null

const tokens = registry.assets.filter((asset) => asset.deployments?.some((d) => d.chainId === 4663))

export const observed = {
  chain: { id: 4663, name: 'Robinhood Chain' },
  counts: {
    tokens: tokens.length,
    feeds: feeds.filter((feed) => /^Robinhood /.test(feed.name)).length,
    mappedFeeds: feedMap.pairs.length,
    corroboratedFeeds: feedMap.corroborated ?? 0,
    distinctEvents: distinctEvents.length,
    tokensMoved: new Set(distinctEvents.map((e) => e.token)).size,
    archivedActions: archive.archivedRows,
    reconciliations: reconciliations.summary,
  },
  observedAt: {
    registry: registry.fetchedAt,
    events: events.scannedAt,
    archive: archive.lastArchivedAt,
    feedMap: feedMap.generatedAt,
    sessionShare: sessionShare.lastSampleAt,
  },
  hero: {
    ...hero,
    haircutPct: (hero.haircutBps! / 100).toFixed(1),
    /** The share of the declared dividend that never arrived, 0-1, for the ring. */
    gapFraction: hero.haircutBps! / 10_000,
  },
  /** The newest of every dataset's own timestamp: when the site last saw the chain. */
  lastObservedAt: [registry.fetchedAt, events.scannedAt, archive.lastArchivedAt, sessionShare.lastSampleAt]
    .filter(Boolean)
    .sort()
    .at(-1)!,
  reconciled,
  steps: distinctEvents.map((e) => ({
    symbol: e.symbol,
    token: e.token,
    date: day(e.effectiveAt),
    from: formatWad(BigInt(e.oldMultiplier), 6),
    to: formatWad(BigInt(e.newMultiplier), 6),
    stepBps: e.stepBps,
    leadMinutes: e.leadMinutes,
    tx: e.tx,
  })),
  stepRange: {
    min: [...distinctEvents].sort((a, b) => a.stepBps - b.stepBps)[0]!,
    max: [...distinctEvents].filter((e) => e.stepBps < 10_000).sort((a, b) => b.stepBps - a.stepBps)[0]!,
    medianLeadMinutes: [...distinctEvents.map((e) => e.leadMinutes)].sort((a, b) => a - b)[
      Math.floor(distinctEvents.length / 2)
    ]!,
  },
  pendingExample,
  sessionShare: {
    sampleCount: sessionShare.sampleCount,
    sufficient: sessionShare.sufficient,
    slotsCovered: sessionShare.easternHourOfWeekSlotsCovered,
  },
  links: {
    github: 'https://github.com/BacBacta/Exdate',
    api: process.env.NEXT_PUBLIC_EXDATE_API_URL ?? 'https://api.exdate.xyz',
    status: process.env.NEXT_PUBLIC_EXDATE_STATUS_URL ?? 'http://localhost:3000',
    apiDocs: 'https://github.com/BacBacta/Exdate/blob/HEAD/docs/api.md',
    sdkDocs: 'https://github.com/BacBacta/Exdate/blob/HEAD/packages/sdk/README.md',
    verification: 'https://github.com/BacBacta/Exdate/blob/HEAD/docs/phase-0-verification.md',
  },
}

export type Observed = typeof observed
