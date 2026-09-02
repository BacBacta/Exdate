import type {
  serializeCorporateAction,
  serializeMultiplierEvent,
  serializeReconciliation,
  serializeToken,
  serializeWebhookEvent,
} from '@exdate/api'
import type {
  CorporateActionView,
  MultiplierEventView,
  ReconciliationView,
  TokenView,
  WebhookOutboxResponse,
} from '../src/index.js'

/**
 * The SDK declares the API's response shapes by hand so that installing it does
 * not drag in the server and its HTTP framework. That duplication is only safe
 * if it cannot drift, so this file compiles the two against each other - in
 * this repo, where both exist. It is types only: nothing runs, and `tsc` is the
 * whole test.
 *
 * Each pair checks both directions:
 *
 *  - assignability, so the SDK cannot promise a field the API never sends;
 *  - `Exclude<keyof api, keyof sdk>` must be `never`, so a field the API adds
 *    cannot stay invisible to consumers.
 */

type Extra<Api, Sdk> = Exclude<keyof Api, keyof Sdk>
const never_ = <T extends never>(_value?: T) => undefined

// --- tokens -----------------------------------------------------------------
type ApiToken = ReturnType<typeof serializeToken>
const _tokenMatches: (row: ApiToken) => TokenView = (row) => row
never_<Extra<ApiToken, TokenView>>()

// --- multiplier events ------------------------------------------------------
type ApiEvent = ReturnType<typeof serializeMultiplierEvent>
const _eventMatches: (row: ApiEvent) => MultiplierEventView = (row) => row
never_<Extra<ApiEvent, MultiplierEventView>>()

// --- reconciliations --------------------------------------------------------
type ApiReconciliation = ReturnType<typeof serializeReconciliation>
const _reconciliationMatches: (row: ApiReconciliation) => ReconciliationView = (row) => row
never_<Extra<ApiReconciliation, ReconciliationView>>()

// --- corporate actions ------------------------------------------------------
type ApiCorporateAction = ReturnType<typeof serializeCorporateAction>
const _actionMatches: (row: ApiCorporateAction) => CorporateActionView = (row) => row
never_<Extra<ApiCorporateAction, CorporateActionView>>()

// --- the webhook outbox -----------------------------------------------------
type ApiWebhookEvent = ReturnType<typeof serializeWebhookEvent>
type SdkWebhookEvent = WebhookOutboxResponse['events'][number]
const _webhookMatches: (row: ApiWebhookEvent) => SdkWebhookEvent = (row) => row
never_<Extra<ApiWebhookEvent, SdkWebhookEvent>>()

export const contractChecked = true
