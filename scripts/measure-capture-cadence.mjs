// How often the capture job actually runs, from GitHub's own record of it.
//
// The capture workflow is scheduled every five minutes and the announcement lead it
// has to catch is about nine. Whether it catches a step depends on the real gap
// between two runs, and GitHub's cron is best-effort: measured on 2026-09-04, the
// job fired every 7 to 25 minutes. That gap is a number the product depends on, so
// it is measured and committed like every other one - a page must not say "roughly
// every quarter hour" from memory.
//
// The source is first-party: the workflow-runs endpoint is GitHub's own log of when
// each run started. Only scheduled runs count; a run someone dispatched by hand
// says nothing about the schedule. The file is a rolling snapshot of the runs the
// API still lists, not an archive - GitHub keeps them for 90 days, which is far
// longer than the cadence takes to characterise.
//
//   GITHUB_TOKEN=... node scripts/measure-capture-cadence.mjs
//   EXDATE_CADENCE_RUNS_FILE=runs.json node scripts/measure-capture-cadence.mjs   # offline: a saved API page
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const REPO = process.env.GITHUB_REPOSITORY || 'BacBacta/Exdate'
const WORKFLOW = process.env.EXDATE_CADENCE_WORKFLOW || 'capture-effective-prices.yml'
const OUT = process.env.EXDATE_CADENCE_OUT || 'data/capture-cadence.observed.json'
/** What the workflow file asks for; the measurement is how far reality is from it. */
const NOMINAL_MINUTES = 5
/** How long one run waits for an effectiveAt. Mirrors the default in capture-effective-prices.mjs. */
const BUDGET_MINUTES = Number(process.env.EXDATE_CAPTURE_BUDGET_MS || 540_000) / 60_000
const PAGES = 3

async function fetchRuns() {
  if (process.env.EXDATE_CADENCE_RUNS_FILE) {
    const saved = JSON.parse(readFileSync(new URL(process.env.EXDATE_CADENCE_RUNS_FILE, root), 'utf8'))
    return saved.workflow_runs ?? saved
  }
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'exdate-cadence' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const runs = []
  for (let page = 1; page <= PAGES; page++) {
    const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=100&page=${page}`
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}: ${(await response.text()).slice(0, 200)}`)
    const body = await response.json()
    runs.push(...(body.workflow_runs ?? []))
    if ((body.workflow_runs ?? []).length < 100) break
  }
  return runs
}

const runs = await fetchRuns()
const scheduled = runs
  .filter((run) => run.event === 'schedule')
  .map((run) => Date.parse(run.run_started_at ?? run.created_at))
  .filter((ms) => Number.isFinite(ms))
  .sort((a, b) => a - b)

const intervals = []
for (let i = 1; i < scheduled.length; i++) intervals.push((scheduled[i] - scheduled[i - 1]) / 60_000)
const sorted = [...intervals].sort((a, b) => a - b)
const quantile = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null)
const round = (x) => (x === null ? null : Math.round(x * 10) / 10)

/**
 * The share of clock time in which a step landing at that instant would be caught
 * by a run that waits `budget` minutes. Inside a gap of g minutes, a run starts
 * at the end of it, so a step is caught when it lands in the last min(g, budget)
 * minutes of the gap. Summing over the observed gaps weights each by its length,
 * which is what "at a random instant" means. A model on top of a measurement, and
 * labelled as such.
 */
const covered = intervals.reduce((sum, g) => sum + Math.min(g, BUDGET_MINUTES), 0)
const total = intervals.reduce((sum, g) => sum + g, 0)

const result = {
  note:
    'When GitHub actually ran the capture job, from its own workflow-runs log. The job is scheduled every five minutes; the announcement lead it has to catch is about nine. GitHub schedules are best-effort, so the real gap between runs is what decides whether a step is caught, and this file measures it rather than assuming it.',
  source: `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs (event = schedule only)`,
  observedAt: new Date().toISOString(),
  nominalMinutes: NOMINAL_MINUTES,
  budgetMinutes: BUDGET_MINUTES,
  runs: scheduled.length,
  windowFrom: scheduled.length ? new Date(scheduled[0]).toISOString() : null,
  windowTo: scheduled.length ? new Date(scheduled.at(-1)).toISOString() : null,
  intervalMinutes:
    intervals.length >= 2
      ? {
          samples: intervals.length,
          min: round(sorted[0]),
          median: round(quantile(0.5)),
          mean: round(total / intervals.length),
          p90: round(quantile(0.9)),
          max: round(sorted.at(-1)),
          shareWithinNominal: round(intervals.filter((g) => g <= NOMINAL_MINUTES + 0.5).length / intervals.length),
        }
      : null,
  expectedCatchShare:
    intervals.length >= 2
      ? {
          value: round(covered / total),
          model:
            'a step landing at a uniformly random instant is caught when a run starts within budgetMinutes before it; computed over the observed gaps, each weighted by its length',
        }
      : null,
  notComputed:
    intervals.length >= 2 ? [] : [{ field: 'intervalMinutes / expectedCatchShare', reason: 'fewer than three scheduled runs on record' }],
}

await writeFile(new URL(OUT, root), JSON.stringify(result, null, 2) + '\n')
console.error(
  `# ${OUT}: ${scheduled.length} scheduled run(s)` +
    (result.intervalMinutes
      ? `, gap median ${result.intervalMinutes.median} min (nominal ${NOMINAL_MINUTES}), max ${result.intervalMinutes.max}; expected catch share ${(result.expectedCatchShare.value * 100).toFixed(0)} % at a ${BUDGET_MINUTES} min budget`
      : ', not enough to compute a cadence'),
)
