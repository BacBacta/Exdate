/**
 * Everything the site says with a number, read from the committed observations.
 *
 * The site is built, not served: it never talks to the API or to an RPC. Each
 * figure below comes from a file under ../../data that a script wrote from the
 * chain or from the issuer's own endpoint, and each carries the timestamp of
 * that read. If a number is not in those files, the page does not show it.
 */

import { ROBINHOOD_CHAIN } from '@exdate/core/chains'
import baseJson from '../../../data/base-b20-verification.json'
import archiveJson from '../../../data/corporate-actions.archive.json'
import effectiveBlocksJson from '../../../data/effective-blocks.json'
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
  actionStatus?: string | null
  change: {
    effectiveAt: string
    stepBps: number
    oldMultiplier: string
    newMultiplier: string
    lagDays?: number | null
  } | null
  price: { value: string; updatedAt: string; stalenessSecondsAtEffectiveAt?: number | null } | null
  expectedStepWad?: string | null
  note?: string | null
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
  assets: { tokenSymbol: string; tokenName: string; isin?: string | null; deployments?: { contractAddress: string; chainId: number }[] }[]
}
const feeds = feedsJson as unknown as { name: string }[]
const feedMap = feedMapJson as unknown as {
  generatedAt: string
  pairs: {
    token: string
    feedProxy: string
    verified: boolean
    corroborated: boolean
    heartbeatSeconds?: number
    deviationThresholdPercent?: number
    marketHours?: string
  }[]
  corroborated?: number
}
const archive = archiveJson as unknown as {
  lastArchivedAt: string
  archivedRows: number
  beyondWindow: number
  earliestProcessDate: string
  actions: ArchivedAction[]
}
const base = baseJson as unknown as { verifiedAt: string; summary: { tokens: number; feeds: number } }
const effectiveBlocks = effectiveBlocksJson as unknown as {
  resolvedAt: string
  blocks: {
    token: string
    symbol: string
    effectiveAt: string
    effectiveBlock: number
    oldMultiplier: string
    newMultiplier: string
  }[]
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

/** Rounded and padded to `places`: "0.2" reads as a typo, "0.20" as a price. */
export function fixed(value: string | null | undefined, places: number): string | null {
  const rounded = money(value, places)
  if (rounded === null) return null
  const [whole, fraction = ''] = rounded.split('.')
  return `${whole}.${fraction.padEnd(places, '0')}`
}
/** Dollars to the cent. */
export const cents = (value: string | null | undefined) => fixed(value, 2)

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
const robinhoodFeeds = feeds.filter((feed) => /^Robinhood /.test(feed.name)).length

/** The newest of every dataset's own timestamp: when the site last saw the chain. */
const lastObservedAt = [registry.fetchedAt, events.scannedAt, archive.lastArchivedAt, sessionShare.lastSampleAt]
  .filter(Boolean)
  .sort()
  .at(-1)!

// --- one entry per token, for the finder and the token pages -----------------
export interface TokenSummary {
  address: string
  symbol: string
  name: string
  isin: string | null
}

const tokenIndex: TokenSummary[] = tokens
  .map((asset) => {
    const address = asset.deployments!.find((d) => d.chainId === 4663)!.contractAddress
    return {
      address,
      symbol: asset.tokenSymbol,
      name: nameByAddress.get(address.toLowerCase()) ?? asset.tokenSymbol,
      isin: asset.isin ?? null,
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

/** Events are sorted ascending, so the last write per token is its latest step. */
const lastStepByToken = new Map<string, MultiplierEvent>()
for (const event of distinctEvents) lastStepByToken.set(event.token.toLowerCase(), event)
/** The announcing transaction behind a step, by (token, instant of effect). */
const eventByEffect = new Map(distinctEvents.map((e) => [`${e.token.toLowerCase()}:${Date.parse(e.effectiveAt)}`, e]))
const feedByToken = new Map(feedMap.pairs.map((pair) => [pair.token.toLowerCase(), pair]))
const multiplierOf = (key: string) => (lastStepByToken.has(key) ? BigInt(lastStepByToken.get(key)!.newMultiplier) : WAD)
const observedDay = day(lastObservedAt)
const EXPLORER = 'https://robinhoodchain.blockscout.com'
/** The pairing window the reconciliation uses: the observed lag is one business day. */
const WINDOW_DAYS = 4
const DAY_MS = 86_400_000
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

export type DividendState = 'matched' | 'anomaly' | 'pending' | 'unmatched'

/**
 * Everything the site can say about one token, by address. Every figure comes
 * from the committed files: the registry for identity, the event scan for the
 * multiplier, the reconciliation dataset for each dividend, the feed map for
 * whether a price exists. A token that never moved has multiplier 1 by
 * construction - the scan covered the whole chain - and the page says so.
 */
export function tokenPage(address: string) {
  const key = address.toLowerCase()
  const summary = tokenIndex.find((token) => token.address.toLowerCase() === key)
  if (!summary) return null

  const lastStep = lastStepByToken.get(key) ?? null
  const multiplier = multiplierOf(key)
  const feed = feedByToken.get(key) ?? null

  const dividends = reconciliations.rows
    .filter((row) => row.token.toLowerCase() === key)
    .map((row) => {
      const state = row.status as DividendState
      const rateWad = row.rate ? parseDecimal(row.rate) : null
      return {
        key: `${row.processDate ?? row.change?.effectiveAt ?? 'undated'}:${state}`,
        state,
        processDate: row.processDate,
        effectiveAt: row.change?.effectiveAt ?? null,
        declared: fixed(row.rate, 4),
        arrived: fixed(row.receivedPerShare, 4),
        haircutBps: state === 'matched' ? (row.impliedHaircutBps ?? null) : null,
        stepBps: row.change?.stepBps ?? null,
        hasFeed: Boolean(row.feed),
        /** Owed per token while nothing has landed: rate x what a token represents today. No price. */
        owedPerToken:
          state === 'pending' && rateWad !== null ? fixed(formatWad((rateWad * multiplier) / WAD, 18), 4) : null,
        /** A process date the data has not reached yet: declared, not owed. */
        upcoming: state === 'pending' && row.processDate !== null && row.processDate > observedDay,
        issuerCompleted: row.actionStatus === 'CORPORATE_ACTION_STATUS_COMPLETED',
        /** How the row was measured, for a reader who opens it. Every field is from the same record. */
        detail: {
          priceAtEffect: row.price ? fixed(row.price.value, 2) : null,
          priceAgeAtEffectMinutes:
            row.price?.stalenessSecondsAtEffectiveAt != null ? Math.round(row.price.stalenessSecondsAtEffectiveAt / 60) : null,
          /** What a full payment would have moved the multiplier by, as a percentage. */
          expectedStepPct: row.expectedStepWad ? Number(BigInt(row.expectedStepWad)) / 1e16 : null,
          observedStepPct: row.change ? row.change.stepBps / 100 : null,
          impliedPrice: fixed(row.impliedReinvestPrice, 2),
          spotToday: row.issuerSpotToday ? fixed(row.issuerSpotToday.mid, 2) : null,
          impliedOverSpot: row.issuerSpotToday?.impliedOverSpot ?? null,
          lagDays: row.change?.lagDays ?? null,
          txUrl: (() => {
            const event = row.change ? eventByEffect.get(`${key}:${Date.parse(row.change.effectiveAt)}`) : undefined
            return event ? `${EXPLORER}/tx/${event.tx}` : null
          })(),
          note: row.note ?? null,
        },
      }
    })
    .sort((a, b) => (b.processDate ?? b.effectiveAt ?? '').localeCompare(a.processDate ?? a.effectiveAt ?? ''))

  const steps = distinctEvents
    .filter((event) => event.token.toLowerCase() === key)
    .map((event) => ({
      date: day(event.effectiveAt),
      from: formatWad(BigInt(event.oldMultiplier), 6),
      to: formatWad(BigInt(event.newMultiplier), 6),
      stepBps: event.stepBps,
      leadMinutes: Math.round(event.leadMinutes),
      txUrl: `${EXPLORER}/tx/${event.tx}`,
    }))
    .reverse()

  /** Growth in shares per token since launch, and what explains it. Observed, never annualised. */
  const sinceLaunch =
    lastStep === null
      ? null
      : {
          growthPct: (Number(multiplier - WAD) / 1e16).toFixed(2),
          reconciled: dividends.filter((d) => d.state === 'matched').length,
          unexplained: dividends.filter((d) => d.state === 'anomaly' || d.state === 'unmatched').length,
        }

  return {
    ...summary,
    explorerUrl: `${EXPLORER}/address/${summary.address}`,
    multiplier: formatWad(multiplier, 6),
    moved: lastStep !== null,
    lastChangedAt: lastStep ? day(lastStep.effectiveAt) : null,
    sinceLaunch,
    feed: feed
      ? {
          proxy: feed.feedProxy,
          proxyUrl: `${EXPLORER}/address/${feed.feedProxy}`,
          corroborated: feed.corroborated,
          heartbeatHours: feed.heartbeatSeconds ? Math.round(feed.heartbeatSeconds / 3600) : null,
          deviationPercent: feed.deviationThresholdPercent ?? null,
          marketHours: feed.marketHours === 'us_equities_24/5' ? 'US equities, 24/5' : (feed.marketHours ?? null),
        }
      : null,
    dividends,
    steps,
    observedAt: observedDay,
  }
}

export type CalendarGroup = 'paid_not_on_chain' | 'overdue' | 'awaiting' | 'upcoming'

/**
 * Every dividend declared by the issuer that has not produced a step on chain,
 * across all tokens, grouped the way the pending endpoint groups them: by
 * whether the date has arrived, whether the pairing window has passed, and
 * whether the issuer already calls it paid.
 */
export const calendar = (() => {
  const rows = reconciliations.rows
    .filter((row) => row.status === 'pending' && row.processDate)
    .map((row) => {
      const key = row.token.toLowerCase()
      const daysSince = daysBetween(row.processDate!, observedDay)
      const group: CalendarGroup =
        daysSince < 0
          ? 'upcoming'
          : daysSince <= WINDOW_DAYS
            ? 'awaiting'
            : row.actionStatus === 'CORPORATE_ACTION_STATUS_COMPLETED'
              ? 'paid_not_on_chain'
              : 'overdue'
      return {
        token: row.token,
        symbol: row.symbol,
        name: nameByAddress.get(key) ?? row.symbol,
        processDate: row.processDate!,
        rate: row.rate,
        declared: fixed(row.rate, 4),
        owedPerToken: row.rate ? fixed(formatWad((parseDecimal(row.rate) * multiplierOf(key)) / WAD, 18), 4) : null,
        daysSince,
        group,
      }
    })
  const pick = (group: CalendarGroup) =>
    rows.filter((row) => row.group === group).sort((a, b) => a.processDate.localeCompare(b.processDate))
  return {
    observedDay,
    windowDays: WINDOW_DAYS,
    total: rows.length,
    tokens: new Set(rows.map((row) => row.token.toLowerCase())).size,
    paidNotOnChain: pick('paid_not_on_chain'),
    overdue: pick('overdue'),
    awaiting: pick('awaiting'),
    upcoming: pick('upcoming'),
  }
})()

/**
 * What the wallet page hands the browser: where to read, and the declared
 * dividends not yet on chain per token, so a balance read live can be joined
 * with the committed record without a server. The multiplier is not passed:
 * the browser reads the one in force at the same block as the balance.
 */
export const wallet = (() => {
  const declaredByToken: Record<string, { processDate: string; rate: string; due: boolean; group: CalendarGroup }[]> = {}
  for (const row of [...calendar.paidNotOnChain, ...calendar.overdue, ...calendar.awaiting, ...calendar.upcoming]) {
    if (!row.rate) continue
    const key = row.token.toLowerCase()
    ;(declaredByToken[key] ??= []).push({
      processDate: row.processDate,
      rate: row.rate,
      due: row.group !== 'upcoming',
      group: row.group,
    })
  }
  for (const rows of Object.values(declaredByToken)) rows.sort((a, b) => a.processDate.localeCompare(b.processDate))
  /**
   * Every multiplier step ever observed, with the block it took effect at
   * (resolved once by scripts/resolve-effective-blocks.mjs) and the committed
   * reconciliation for it, so the browser can turn a balance-at-that-block
   * into shares gained, dollars declared and dollars arrived without
   * computing anything the site does not already publish.
   */
  const rowByEffect = new Map(
    reconciliations.rows.filter((row) => row.change).map((row) => [`${row.token.toLowerCase()}:${row.change!.effectiveAt}`, row]),
  )
  const steps = effectiveBlocks.blocks.map((block) => {
    const key = block.token.toLowerCase()
    const row = rowByEffect.get(`${key}:${block.effectiveAt}`)
    const status = (row?.status ?? 'unmatched') as 'matched' | 'anomaly' | 'unmatched' | 'pending'
    return {
      token: key,
      symbol: block.symbol,
      name: nameByAddress.get(key) ?? block.symbol,
      effectiveAt: block.effectiveAt,
      effectiveBlock: block.effectiveBlock,
      oldMultiplier: block.oldMultiplier,
      newMultiplier: block.newMultiplier,
      rate: row?.rate ?? null,
      receivedPerShare: row?.receivedPerShare ?? null,
      haircutBps: status === 'matched' ? (row?.impliedHaircutBps ?? null) : null,
      status,
      hasFeed: Boolean(row?.feed),
      processDate: row?.processDate ?? null,
    }
  })
  return {
    rpcUrl: ROBINHOOD_CHAIN.defaultRpcUrl,
    multicall3: ROBINHOOD_CHAIN.multicall3Address,
    steps,
    /** The history scan: from public mainnet to the last step, over the tokens that ever moved. */
    scan: {
      fromBlock: ROBINHOOD_CHAIN.startBlock,
      toBlock: Math.max(...steps.map((step) => step.effectiveBlock)),
      tokens: [...new Set(steps.map((step) => step.token))],
      resolvedAt: effectiveBlocks.resolvedAt,
    },
    /** ArbSys: `block.number` on this chain is the parent chain's, see chains.ts. */
    blockNumberSource: ROBINHOOD_CHAIN.blockNumberSource
      ? { target: ROBINHOOD_CHAIN.blockNumberSource.target, selector: ROBINHOOD_CHAIN.blockNumberSource.selector }
      : undefined,
    declaredByToken,
  }
})()

/** What the dozen observed changes say about timing. A pattern with its sample size, not a forecast. */
export const timing = (() => {
  const leads = distinctEvents.map((e) => e.leadMinutes).sort((a, b) => a - b)
  const lags = reconciliations.rows.map((row) => row.change?.lagDays).filter((v): v is number => typeof v === 'number')
  return {
    changes: distinctEvents.length,
    medianLeadMinutes: Math.round(leads[Math.floor(leads.length / 2)] ?? 0),
    lagOneDay: lags.filter((v) => v === 1).length,
    lagCases: lags.length,
  }
})()

export const observed = {
  chain: { id: 4663, name: 'Robinhood Chain' },
  counts: {
    tokens: tokens.length,
    feeds: robinhoodFeeds,
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
  lastObservedAt,
  tokens: tokenIndex,
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
  /**
   * Where exdate looks, and whether there is anything to measure there yet.
   * Every table carries a chain id; only one chain has data today. Base is
   * verified address by address but no Coinbase multiplier has ever moved.
   */
  chains: {
    robinhood: { name: 'Robinhood Chain', issuer: 'Robinhood Stock Tokens', tokens: tokens.length, feeds: robinhoodFeeds, measured: true },
    base: { name: 'Base', issuer: 'Coinbase tokenized stocks', tokens: base.summary.tokens, feeds: base.summary.feeds, measured: false, verifiedAt: base.verifiedAt },
  },
  links: {
    /** Set NEXT_PUBLIC_EXDATE_REPO_URL once the repository is public; a link to a private repository is a dead link. */
    github: process.env.NEXT_PUBLIC_EXDATE_REPO_URL ?? null,
    data: '/data/',
    api: process.env.NEXT_PUBLIC_EXDATE_API_URL ?? 'https://api.exdate.xyz',
    /** The live status page needs a running indexer; until one is hosted, no link is better than a dead one. */
    status: process.env.NEXT_PUBLIC_EXDATE_STATUS_URL ?? null,
    apiDocs: '/docs/api/',
    sdkDocs: '/docs/sdk/',
    verification: 'https://github.com/BacBacta/Exdate/blob/HEAD/docs/phase-0-verification.md',
  },
}

export type Observed = typeof observed
