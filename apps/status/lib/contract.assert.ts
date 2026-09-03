/**
 * Compile-time proof that the shapes this page declares are the shapes the API
 * actually serves.
 *
 * `lib/api.ts` re-declares a subset of each response rather than importing the
 * API package, because the page must not carry the HTTP framework the API is
 * built on. That freedom costs a drift risk, and this file is the check: both
 * routes hand `buildYieldLedger` / `buildPendingView` straight to `c.json()`,
 * so the functions' return types ARE the JSON. If a field is renamed, retyped,
 * or dropped in core, this file stops compiling and `pnpm typecheck` fails
 * before the page renders a blank column.
 *
 * The same test in @exdate/sdk caught `/v1/status` serving `undefined` where
 * the rule is `null` - a field `JSON.stringify` drops entirely.
 *
 * Types only: nothing here runs.
 */

import type { buildPendingView } from '@exdate/core/pending'
import type { buildYieldLedger } from '@exdate/core/yield'
import type { PendingView, YieldLedgerView } from './api'

/** What the API serves must satisfy what the page reads. */
declare const servedLedger: ReturnType<typeof buildYieldLedger>
declare const servedPending: ReturnType<typeof buildPendingView>

export const ledgerIsCompatible: YieldLedgerView = servedLedger
export const pendingIsCompatible: PendingView = servedPending
