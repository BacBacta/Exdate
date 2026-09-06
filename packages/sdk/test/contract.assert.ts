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
  WebhookLatencyResponse as ServedLatency,
} from '@exdate/api'
import type {
  CorporateActionView,
  MeResponse,
  MultiplierEventView,
  ReconciliationView,
  TokenView,
  WebhookLatencyResponse,
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

/**
 * The same completeness check, one level down.
 *
 * `Extra` above compares top-level keys only, and assignability does not close the gap: an API
 * object with six fields is assignable to an SDK type declaring five, because excess properties
 * are only rejected on object literals. So a field added inside a nested block - `identifiers`,
 * `multiplier`, `feed` - stayed invisible to consumers with both checks green. Found by removing
 * `shareClassFigi` from the SDK's `identifiers` and watching `tsc` pass.
 *
 * Only nullable-free, non-array object properties are walked. A union like `{...} | null` does
 * not extend `object`, so `scheduled` is skipped rather than reported wrongly; arrays are skipped
 * explicitly, because `keyof string[]` carries `pop` and `push` while `keyof readonly string[]`
 * does not - which reported `feedCorroboratedBy.pop` as drift on the first run. The result is the
 * offending path as a string literal, so the error names `identifiers.shareClassFigi`, not `never`.
 */
type NestedExtra<Api, Sdk> = {
  [K in keyof Api & keyof Sdk]: Api[K] extends readonly unknown[]
    ? never
    : Api[K] extends object
    ? Sdk[K] extends object
      ? Exclude<keyof Api[K], keyof Sdk[K]> extends infer Missing
        ? Missing extends string
          ? `${K & string}.${Missing}`
          : never
        : never
      : never
    : never
}[keyof Api & keyof Sdk]

// --- tokens -----------------------------------------------------------------
type ApiToken = ReturnType<typeof serializeToken>
const _tokenMatches: (row: ApiToken) => TokenView = (row) => row
never_<Extra<ApiToken, TokenView>>()
never_<NestedExtra<ApiToken, TokenView>>()

// --- multiplier events ------------------------------------------------------
type ApiEvent = ReturnType<typeof serializeMultiplierEvent>
const _eventMatches: (row: ApiEvent) => MultiplierEventView = (row) => row
never_<Extra<ApiEvent, MultiplierEventView>>()
never_<NestedExtra<ApiEvent, MultiplierEventView>>()

// --- reconciliations --------------------------------------------------------
type ApiReconciliation = ReturnType<typeof serializeReconciliation>
const _reconciliationMatches: (row: ApiReconciliation) => ReconciliationView = (row) => row
never_<Extra<ApiReconciliation, ReconciliationView>>()
never_<NestedExtra<ApiReconciliation, ReconciliationView>>()

// --- corporate actions ------------------------------------------------------
type ApiCorporateAction = ReturnType<typeof serializeCorporateAction>
const _actionMatches: (row: ApiCorporateAction) => CorporateActionView = (row) => row
never_<Extra<ApiCorporateAction, CorporateActionView>>()
never_<NestedExtra<ApiCorporateAction, CorporateActionView>>()

// --- the webhook outbox -----------------------------------------------------
type ApiWebhookEvent = ReturnType<typeof serializeWebhookEvent>
type SdkWebhookEvent = WebhookOutboxResponse['events'][number]
const _webhookMatches: (row: ApiWebhookEvent) => SdkWebhookEvent = (row) => row
never_<Extra<ApiWebhookEvent, SdkWebhookEvent>>()
never_<NestedExtra<ApiWebhookEvent, SdkWebhookEvent>>()

// --- the delivery latency ---------------------------------------------------
// The route is a plain object, so its type is checked in both directions like /v1/me: the SDK
// must not promise a leg the API never sends, and a field the API adds must not stay invisible.
declare const servedLatency: ServedLatency
declare const sdkLatency: WebhookLatencyResponse
export const latencyIsCompatible: WebhookLatencyResponse = servedLatency
export const latencyIsComplete: ServedLatency = sdkLatency

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
