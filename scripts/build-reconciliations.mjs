// Pair every issuer corporate action with the multiplier step it produced, resolve
// the reference price at the instant the step took effect, and write the result.
//
//   node scripts/build-reconciliations.mjs
//
// Three inputs, all first-party:
//   data/robinhood-corporate-actions.snapshot.json   the issuer's declared rate
//   data/multiplier-events.observed.json             the on-chain step
//   Chainlink getRoundData(roundId)                  the price at effectiveAt
//
// The price read needs no archive node: an aggregator keeps its own round history
// in current storage, so a plain full node answers a historical round.
//
// Nothing here estimates. An action with no matching step is `pending`; a step with
// no action is `unmatched`; a token with no feed yields no haircut at all, only the
// price the step would have implied - which is exactly how CCL and COST were caught.
import { readFile, writeFile } from 'node:fs/promises'
import { rpc, SELECTOR, decodeLatestRoundData } from './phase0/rpc.mjs'

const ROBINHOOD_API_BASE = 'https://api.robinhood.com/rhj'

/**
 * The issuer's own mid price for a token, TODAY.
 *
 * This is a sanity check and never a reconciliation input. `/rhj/prices` returns
 * the raw underlying bid/ask at the moment of the call, not the price that was in
 * force when a past multiplier step took effect, so using it as the denominator
 * would silently reconcile a July dividend against a September price.
 *
 * What it is good for: comparing the price a step *implies* against a price that
 * actually exists. CCL's step implies $6.98 a share against a ~$23.5 spot, which
 * is how you can tell the reinvestment model does not describe that event - and it
 * works for the 159 tokens that have no Chainlink feed at all.
 */
async function issuerSpot(symbol, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${ROBINHOOD_API_BASE}/prices/${symbol}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      const text = await response.text()
      // The issuer answers rate limiting with the plain-text body
      // "local_rate_limited" and HTTP 200, so a status check alone is not enough.
      if (response.ok && text.trimStart().startsWith('{')) {
        const quote = JSON.parse(text).quotes?.[0]
        if (quote?.bid && quote?.ask) {
          return {
            bid: quote.bid,
            ask: quote.ask,
            mid: ((Number(quote.bid) + Number(quote.ask)) / 2).toFixed(4),
            generatedAt: quote.generatedAt,
          }
        }
        return null
      }
    } catch {
      // fall through to the backoff
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
  }
  return null
}

const CHAIN_ID = 4663
const WAD = 10n ** 18n
const MATCH_WINDOW_DAYS = 4
const GET_ROUND_DATA = '0x9a6fc8f5'

const root = new URL('../', import.meta.url)
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

const corporateActions = (await read('data/robinhood-corporate-actions.snapshot.json')).corpActions ?? []
const scan = await read('data/multiplier-events.observed.json')
const feedMap = await read('data/token-feed-map.json')

const feedForToken = new Map(feedMap.pairs.map((pair) => [pair.token.toLowerCase(), pair]))

const parseDecimal = (value, decimals) => {
  const trimmed = String(value).trim()
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') throw new Error(`not a decimal: ${value}`)
  const negative = trimmed.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.')
  const scaled = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, '0'))
  return negative ? -scaled : scaled
}

const isoDate = (processDate) =>
  processDate
    ? `${processDate.year}-${String(processDate.month).padStart(2, '0')}-${String(processDate.day).padStart(2, '0')}`
    : null

const word = (n) => n.toString(16).padStart(64, '0')

/**
 * The Chainlink round in force at `targetSeconds`.
 *
 * Round ids on a proxy are phase-encoded as (phaseId << 64) | aggregatorRoundId.
 * Only the current phase is searched: a feed that rolled over its aggregator since
 * the target instant would report the earliest round of the current phase, so the
 * result carries `phase` and the caller can tell.
 */
async function roundAt(feed, targetSeconds) {
  const call = (data) => rpc('eth_call', [{ to: feed, data }, 'latest'], { minGap: 120, tries: 10 })
  const decimals = Number(BigInt(await call(SELECTOR.decimals)))
  const latest = decodeLatestRoundData(await call(SELECTOR.latestRoundData))
  const phase = latest.roundId >> 64n
  const latestAggregatorRound = latest.roundId & ((1n << 64n) - 1n)

  const at = async (aggregatorRound) => {
    try {
      return decodeLatestRoundData(await call(GET_ROUND_DATA + word((phase << 64n) | aggregatorRound)))
    } catch {
      return null
    }
  }

  let lo = 1n
  let hi = latestAggregatorRound
  let best = null
  while (lo <= hi) {
    const mid = (lo + hi) / 2n
    const round = await at(mid)
    if (!round || round.updatedAt === 0n) {
      lo = mid + 1n
      continue
    }
    if (round.updatedAt <= BigInt(targetSeconds)) {
      best = round
      lo = mid + 1n
    } else {
      hi = mid - 1n
    }
  }
  return best
    ? {
        decimals,
        phase: Number(phase),
        roundsInPhase: Number(latestAggregatorRound),
        atPhaseFloor: (best.roundId & ((1n << 64n) - 1n)) === 1n,
        ...best,
      }
    : null
}

const seconds = (iso) => Math.floor(Date.parse(iso) / 1000)
const dayMs = 86_400_000

// --- pair the two sides ------------------------------------------------------
const events = scan.events.filter((event) => event.chainId === CHAIN_ID)

// Collapse re-announcements: the table is keyed on (token, effectiveAt).
const changes = new Map()
for (const event of events) {
  const key = `${event.token.toLowerCase()}:${event.effectiveAt}`
  const bucket = changes.get(key)
  if (bucket) bucket.push(event)
  else changes.set(key, [event])
}

const rows = []
const matchedChangeKeys = new Set()

for (const action of corporateActions) {
  const deployment = (action.deployments ?? []).find((entry) => entry.chainId === CHAIN_ID)
  if (!deployment) continue
  const address = deployment.contractAddress.toLowerCase()
  const processDate = isoDate(action.processDate)
  const detail = action.details ? Object.values(action.details)[0] : undefined

  let matchKey = null
  if (processDate) {
    const processedMs = Date.parse(`${processDate}T00:00:00Z`)
    for (const [key, group] of changes) {
      if (!key.startsWith(`${address}:`)) continue
      const lagMs = Date.parse(group[0].effectiveAt) - processedMs
      if (lagMs >= 0 && lagMs <= MATCH_WINDOW_DAYS * dayMs) {
        matchKey = key
        break
      }
    }
  }

  const group = matchKey ? changes.get(matchKey) : null
  if (matchKey) matchedChangeKeys.add(matchKey)

  rows.push({
    actionId: action.id,
    chainId: CHAIN_ID,
    token: deployment.contractAddress,
    symbol: action.tokenSymbol,
    type: action.type,
    actionStatus: action.status,
    processDate,
    rate: detail?.rate ?? null,
    oldRate: detail?.oldRate ?? null,
    newRate: detail?.newRate ?? null,
    change: group
      ? {
          effectiveAt: group[0].effectiveAt,
          announcedAt: group[0].announcedAt,
          announcementCount: group.length,
          oldMultiplier: group[group.length - 1].oldMultiplier,
          newMultiplier: group[group.length - 1].newMultiplier,
          stepBps: group[group.length - 1].stepBps,
          // Calendar days in UTC, matching packages/core/src/pairing.ts. Rounding
          // elapsed time instead would report AAPL's next-business-day step as 2.
          lagDays: Math.round(
            (Date.parse(`${group[0].effectiveAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${processDate}T00:00:00Z`)) / dayMs,
          ),
        }
      : null,
  })
}

// On-chain changes the issuer's feed does not explain. Its history is only about a
// month deep, so July's events are expected here - that absence is the finding.
for (const [key, group] of changes) {
  if (matchedChangeKeys.has(key)) continue
  const first = group[0]
  const last = group[group.length - 1]
  rows.push({
    actionId: null,
    chainId: CHAIN_ID,
    token: first.token,
    symbol: first.symbol,
    type: null,
    actionStatus: null,
    processDate: null,
    rate: null,
    oldRate: null,
    newRate: null,
    change: {
      effectiveAt: first.effectiveAt,
      announcedAt: first.announcedAt,
      announcementCount: group.length,
      oldMultiplier: last.oldMultiplier,
      newMultiplier: last.newMultiplier,
      stepBps: last.stepBps,
      lagDays: null,
    },
  })
}

// --- resolve the price and reconcile ----------------------------------------
console.error(`# ${rows.length} rows: ${rows.filter((r) => r.change).length} with an on-chain step`)

for (const row of rows) {
  const feed = feedForToken.get(row.token.toLowerCase())
  row.feed = feed ? { proxy: feed.feedProxy, verified: feed.verified } : null

  if (!row.change) {
    row.status = 'pending'
    row.note = 'declared by the issuer, no multiplier step observed on chain'
    continue
  }
  if (!row.rate) {
    row.status = row.actionId ? 'unsupported_action_type' : 'unmatched'
    row.note = row.actionId
      ? 'matched to a step, but this action type carries no per-share rate'
      : "on-chain step with no issuer row - the issuer's feed only goes back about a month"
    continue
  }

  const rateWad = parseDecimal(row.rate, 18)
  const observedStepWad =
    ((BigInt(row.change.newMultiplier) - BigInt(row.change.oldMultiplier)) * WAD) / BigInt(row.change.oldMultiplier)
  row.observedStepWad = observedStepWad.toString()
  row.impliedReinvestPrice =
    observedStepWad === 0n ? null : (Number((rateWad * WAD) / observedStepWad) / 1e18).toFixed(4)

  // Sanity check only - see issuerSpot(). Rate limited, so pace it.
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const spot = await issuerSpot(row.symbol)
  if (spot && row.impliedReinvestPrice) {
    row.issuerSpotToday = {
      ...spot,
      note: 'price today, NOT the price at effectiveAt - a plausibility check, never a reconciliation input',
      impliedOverSpot: Number((Number(row.impliedReinvestPrice) / Number(spot.mid)).toFixed(3)),
    }
  }

  if (!feed) {
    row.status = 'anomaly'
    row.note = 'no Chainlink feed for this token, so there is no reference price to reconcile against'
    continue
  }

  const round = await roundAt(feed.feedProxy, seconds(row.change.effectiveAt))
  if (!round) {
    row.status = 'anomaly'
    row.note = 'no Chainlink round at or before effectiveAt in the current aggregator phase'
    continue
  }
  if (round.atPhaseFloor) {
    row.status = 'anomaly'
    row.note = "the only round available is the first of the aggregator's current phase; the price at effectiveAt may predate a rollover and is not a measurement"
    continue
  }

  const tokenPriceWad = round.answer * 10n ** BigInt(18 - round.decimals)
  // The Chainlink answer is total return: P_token = P_equity x multiplier. The
  // dividend is paid per underlying share and reinvested at the equity price, so
  // unwind the multiplier that was in force (oldMultiplier) before comparing.
  // Same arithmetic as packages/core/src/reconcile.ts underlyingPriceWad().
  const priceWad = (tokenPriceWad * WAD) / BigInt(row.change.oldMultiplier)
  const expectedStepWad = (rateWad * WAD) / priceWad
  const receivedWad = (priceWad * observedStepWad) / WAD
  const haircutBps = Number(((rateWad - receivedWad) * 10_000n) / rateWad)
  const haircutBpsPrecise = Number(((rateWad - receivedWad) * 1_000_000n) / rateWad) / 100

  row.price = {
    /** The Chainlink answer as published: the token price, multiplier included. */
    value: (Number(tokenPriceWad) / 1e18).toFixed(4),
    /** The equity price it implies at oldMultiplier; the reconciliation input. */
    underlying: (Number(priceWad) / 1e18).toFixed(4),
    multiplierInForce: row.change.oldMultiplier,
    roundId: round.roundId.toString(),
    updatedAt: new Date(Number(round.updatedAt) * 1000).toISOString(),
    stalenessSecondsAtEffectiveAt: seconds(row.change.effectiveAt) - Number(round.updatedAt),
    aggregatorPhase: round.phase,
  }
  row.expectedStepWad = expectedStepWad.toString()
  row.receivedPerShare = (Number(receivedWad) / 1e18).toFixed(6)
  row.impliedHaircutBps = haircutBps
  // Band checked on the precise value so truncation cannot pull a row inside.
  row.status = haircutBpsPrecise >= -100 && haircutBpsPrecise <= 5_000 ? 'matched' : 'anomaly'
  row.note =
    row.status === 'matched'
      ? undefined
      : `implied haircut ${(haircutBpsPrecise / 100).toFixed(1)} % falls outside the plausible band; the reinvestment model does not describe this event`

  console.error(
    `#   ${row.symbol.padEnd(5)} ${row.status.padEnd(8)} gross=${row.rate} price=${row.price.value} ` +
      `observed=${(Number(observedStepWad) / 1e14).toFixed(2)}bps haircut=${(haircutBps / 100).toFixed(1)}%`,
  )
}

rows.sort((a, b) => (a.processDate ?? a.change?.effectiveAt ?? '').localeCompare(b.processDate ?? b.change?.effectiveAt ?? ''))

const tally = (status) => rows.filter((row) => row.status === status).length
await writeFile(new URL('data/reconciliations.observed.json', root), JSON.stringify({
  note: 'Issuer corporate actions paired with the multiplier steps they produced, priced at the Chainlink round in force at effectiveAt. Every input is first-party or on-chain; nothing is estimated. Rebuild with: node scripts/build-reconciliations.mjs',
  chainId: CHAIN_ID,
  matchWindowDays: MATCH_WINDOW_DAYS,
  plausibleHaircutBps: [-100, 5000],
  builtFrom: {
    corporateActions: 'data/robinhood-corporate-actions.snapshot.json',
    multiplierEvents: 'data/multiplier-events.observed.json',
    prices: 'Chainlink getRoundData at effectiveAt',
  },
  summary: {
    total: rows.length,
    matched: tally('matched'),
    anomaly: tally('anomaly'),
    pending: tally('pending'),
    unmatched: tally('unmatched'),
    unsupportedActionType: tally('unsupported_action_type'),
  },
  rows,
}, null, 2) + '\n')

console.error(`# matched=${tally('matched')} anomaly=${tally('anomaly')} pending=${tally('pending')} unmatched=${tally('unmatched')} -> data/reconciliations.observed.json`)
