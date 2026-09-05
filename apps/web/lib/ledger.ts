import { observed } from './observed'

/**
 * The measured ledger in the order both the home page excerpt and the full
 * page show it: dividends that reconciled first, newest first, then the rest,
 * newest first. One definition, so the excerpt is the head of the page.
 */
export const ledgerRows = [...observed.reconciled].sort((a, b) => {
  const aClean = a.status === 'matched' ? 0 : 1
  const bClean = b.status === 'matched' ? 0 : 1
  return aClean - bClean || (b.processDate ?? '').localeCompare(a.processDate ?? '')
})

export const ledgerMatched = ledgerRows.filter((row) => row.status === 'matched')
