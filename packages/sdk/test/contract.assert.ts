import type {
  MeResponse as ServedMe,
  serializeCorporateAction,
  serializeMultiplierEvent,
  serializeReconciliation,
  serializeToken,
  serializeWebhookEvent,
  serializeSubscription,
  serializeSubscriptionCreated,
  serializeSubscriptionStatus,
  TestDeliveryResult as ServedTestDeliveryResult,
} from '@exdate/api'
import type {
  CorporateActionView,
  MeResponse,
  MultiplierEventView,
  ReconciliationView,
  TokenView,
  WebhookOutboxResponse,
  WebhookSubscriptionCreated,
  WebhookSubscriptionStatus,
  WebhookSubscriptionView,
  WebhookTestResult,
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

// /v1/me is a plain object in the route, typed there as MeResponse; both directions must hold.
declare const servedMe: ServedMe
declare const sdkMe: MeResponse
export const meIsCompatible: MeResponse = servedMe
export const meIsComplete: ServedMe = sdkMe

export const contractChecked = true

// A subscription, as the API describes it to its owner: the plain view, the
// one reply that carries the secret, the view with the outbox's tally, and a
// test delivery's report.
type ApiSubscription = ReturnType<typeof serializeSubscription>
const _subscriptionMatches: (row: ApiSubscription) => WebhookSubscriptionView = (row) => row
never_<Extra<ApiSubscription, WebhookSubscriptionView>>()
type ApiSubscriptionCreated = ReturnType<typeof serializeSubscriptionCreated>
const _createdMatches: (row: ApiSubscriptionCreated) => WebhookSubscriptionCreated = (row) => row
never_<Extra<ApiSubscriptionCreated, WebhookSubscriptionCreated>>()
type ApiSubscriptionStatus = ReturnType<typeof serializeSubscriptionStatus>
const _statusMatches: (row: ApiSubscriptionStatus) => WebhookSubscriptionStatus = (row) => row
never_<Extra<ApiSubscriptionStatus, WebhookSubscriptionStatus>>()
const _testMatches: (row: ServedTestDeliveryResult) => WebhookTestResult = (row) => row
never_<Extra<ServedTestDeliveryResult, WebhookTestResult>>()
