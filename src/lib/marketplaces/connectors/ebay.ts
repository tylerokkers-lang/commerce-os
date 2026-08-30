import { err, ok, type Result } from '@/lib/core/result'
import type {
  ConnectionHealth,
  CreateListingOutcome,
  FetchOptions,
  FetchOutcome,
  FulfilmentUpdateInput,
  FulfilmentUpdateOutcome,
  MarketplaceCapabilities,
  MarketplaceConnectionStatus,
  MarketplaceConnector,
  MarketplaceConnectorDescriptor,
  MarketplaceFeeSnapshot,
  MarketplaceInventorySnapshot,
  MarketplaceListingSnapshot,
  MarketplaceOrderSnapshot,
  WriteFailure,
  WriteOutcome,
} from './types'

/**
 * The real eBay connector (Milestone 21 — the first real, non-Shopify/
 * Amazon marketplace channel).
 *
 * eBay's Sell APIs use plain OAuth 2.0 (no request signing, unlike Amazon
 * SP-API's added AWS SigV4 layer) — a long-lived refresh token, obtained
 * once via eBay's user-consent authorization-code flow outside this
 * codebase (there is no in-app OAuth-grant UI here, matching how
 * `AMAZON_SP_REFRESH_TOKEN`/`AMAZON_ADS_REFRESH_TOKEN` are also obtained
 * out of band and only the resulting long-lived token is ever configured),
 * exchanged for a short-lived access token on every call — the identical
 * shape `amazon.ts`/`amazonAds.ts` already use for their own LWA exchange.
 *
 * MINIMUM PERMISSIONS (Phase 4 of this milestone's brief): this connector
 * requests only read scopes for orders/inventory, plus the narrower
 * read-write `sell.fulfillment` scope needed to push tracking back to
 * eBay (informational, never a purchase or financial action) — never a
 * payments/finances scope, and this connector implements no write path
 * for listings, price, or inventory at all yet (`writeListings: false`,
 * `syncInventory: false`, `processRefunds: false`). The refresh token
 * itself must have been consented with at least:
 *   - https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly
 *   - https://api.ebay.com/oauth/api_scope/sell.inventory.readonly
 *   - https://api.ebay.com/oauth/api_scope/sell.fulfillment (for `submitFulfilmentUpdate`)
 * — this connector cannot itself request or expand scopes; if the
 * configured token lacks one, the corresponding call fails honestly with
 * eBay's own permission error, never silently degraded.
 *
 * IMPLEMENTED BUT NOT LIVE-VERIFIED: there is no eBay seller account or
 * registered application against this codebase, so none of this has ever
 * exchanged a real token or called a real endpoint. Every method is gated
 * behind `isConfigured()` — without all three required variables this
 * class makes no network call of any kind. Matches the exact same honesty
 * convention as `amazon.ts`/`amazonAds.ts`: this codebase never claims a
 * connector is live-verified without a genuine successful call against a
 * real account.
 *
 * DOCUMENTATION VERIFICATION (Milestone 21 Step 1.5): every endpoint path,
 * scope name and response field name below was cross-checked against
 * eBay's official OpenAPI-generated API reference (mirrored, since
 * developer.ebay.com itself blocks automated fetches — verified via the
 * generated PHP SDK docs at github.com/zVPS/ebay-sell-fulfillment-php-client
 * and github.com/zVPS/ebay-sell-inventory-php-client, which document eBay's
 * own OpenAPI spec field-for-field) plus eBay's public OAuth scope list
 * (developer.ebay.com/api-docs/static/oauth-scopes.html, mirrored via
 * apitut.com/ebay/api/scopelist.html). Confirmed correct: the token
 * endpoint, all three read endpoints and their query parameters, every
 * scope string, and every response field this connector reads
 * (`orders[].orderId/creationDate/orderFulfillmentStatus/orderPaymentStatus/
 * cancelStatus.cancelState/pricingSummary.total.value|currency/lineItems[].lineItemId`,
 * `inventoryItems[].sku/product.title/availability.shipToLocationAvailability.quantity`).
 * One real discrepancy was found and corrected: `createShippingFulfillment`
 * returns its `fulfillmentId` in the HTTP `Location` response header (a
 * 201 with a possibly-empty JSON body), not as a body field — `submitFulfilmentUpdate`
 * below now reads it from there. This has not been exercised against a
 * live account (Step 1.5 is read-only by instruction), so it is corrected
 * against documentation but still untested in practice.
 *
 * STILL UNVERIFIED / OUT OF SCOPE, not because they were overlooked:
 *   - eBay's Inventory API deliberately separates *identity* (inventory
 *     items: SKU, title, stock) from *price* (a separate "offer" resource
 *     per SKU) — `fetchListings` below reads identity/stock only and
 *     reports `priceMinor: 0` with an honest warning, the same "price
 *     requires a separate call not yet made here" pattern `amazon.ts`'s
 *     own `fetchListings` already uses for the identical reason.
 *   - `fetchFees`/`syncInventory`(write)/all three price-and-inventory
 *     write methods are honestly `not_supported`/unimplemented — eBay fee
 *     reporting requires the separate Finances API, not implemented here.
 *   - `getAccessToken` never caches the access token — every call
 *     re-exchanges the refresh token, the same known, shared inefficiency
 *     `amazon.ts`/`amazonAds.ts` both already have, not a new one.
 *
 * SANDBOX/PRODUCTION (eBay connection verification & hardening): eBay
 * issues separate credential sets and hosts per environment
 * (`api.sandbox.ebay.com` vs `api.ebay.com`) — `resolveEbayEnvironment()`
 * below decides which one a given `EBAY_CLIENT_ID` belongs to, using
 * eBay's own, publicly documented naming convention (a `-SBX-`/`-PRD-`
 * marker in the Client ID — not a secret; eBay's own docs describe it as
 * a public application identifier, distinct from the Client Secret and
 * refresh token). An optional `EBAY_ENVIRONMENT` env var lets a caller
 * state it explicitly; if it disagrees with what the Client ID's own
 * marker indicates, that is treated as a genuine configuration conflict
 * — refused outright, never guessed at, never silently resolved in
 * either direction. When neither signal is present at all, this
 * preserves the connector's original, pre-existing behaviour exactly
 * (defaults to production) rather than introducing a new failure mode
 * for every caller that predates this feature.
 */

const DESCRIPTOR: MarketplaceConnectorDescriptor = {
  key: 'ebay',
  label: 'eBay',
  description: 'Our own eBay Business seller account, via the official eBay Sell APIs (Fulfillment + Inventory).',
  channel: 'ebay',
  capabilities: {
    readListings: true,
    writeListings: false,
    syncInventory: false,
    ingestOrders: true,
    updateFulfilment: true, // Tracking push only — informational, never a purchase/financial action.
    processRefunds: false, // eBay refunds are a Post-Order/Returns API concern this connector does not implement.
    readFees: false, // Requires the separate Finances API, not implemented here.
    webhooks: false, // eBay's Notification API exists but is not implemented here — see HANDOVER.md.
    verifyWrites: false,
    createListings: false, // Out of scope for the Shopify-specific Phase 6 milestone — untouched otherwise, including the blocked OAuth issue tracked as ticket #260827-000029.
  },
  requiredCredentials: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_REFRESH_TOKEN'],
  // eBay's default per-app daily call limit varies by API and account tier;
  // declared conservatively rather than assuming a higher negotiated quota,
  // the same discipline every other connector's `rateLimit` follows.
  rateLimit: { requestsPerMinute: 5, requestsPerDay: 5000, minSecondsBetweenRuns: 10 },
  usagePolicy: {
    termsUrl: 'https://developer.ebay.com/develop/apis/restful-api-guides',
    permittedUseNote: 'Used only with our own seller credentials, for data relating to our own selling account.',
    authenticatedFirstParty: true,
  },
}

export type EbayEnvironment = 'sandbox' | 'production'

// Scope identifier strings are environment-agnostic (confirmed via eBay's
// own OAuth documentation) — only the token endpoint and API host differ.
const EBAY_HOSTS: Record<EbayEnvironment, { tokenUrl: string; apiHost: string }> = {
  production: { tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token', apiHost: 'api.ebay.com' },
  sandbox: { tokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token', apiHost: 'api.sandbox.ebay.com' },
}
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
].join(' ')

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Never guesses. `clientId` is not a secret (eBay's own docs describe the
 * Client ID as a public application identifier, distinct from the Client
 * Secret/refresh token) — checking it for eBay's own `-SBX-`/`-PRD-`
 * naming marker is safe and never logs the value itself. Three outcomes:
 *   - both signals present and agree, or only one is present -> that
 *     environment, with its source recorded for the verification report.
 *   - both present and DISAGREE -> a genuine conflict, refused outright
 *     rather than picking a side.
 *   - neither present -> 'production', preserving this connector's
 *     original, pre-existing behaviour exactly, so every caller that
 *     predates this feature (and every existing test using a placeholder
 *     Client ID like `'x'`) is completely unaffected.
 */
export function resolveEbayEnvironment(
  clientId: string,
  explicitOverride: string | undefined,
): { ok: true; environment: EbayEnvironment; source: 'explicit' | 'detected' | 'default' } | { ok: false; detail: string } {
  const detected: EbayEnvironment | null = clientId.includes('-SBX-') ? 'sandbox' : clientId.includes('-PRD-') ? 'production' : null

  let explicit: EbayEnvironment | null = null
  if (explicitOverride !== undefined) {
    const normalised = explicitOverride.trim().toLowerCase()
    if (normalised !== 'sandbox' && normalised !== 'production') {
      return { ok: false, detail: `EBAY_ENVIRONMENT must be "sandbox" or "production", got "${explicitOverride}".` }
    }
    explicit = normalised
  }

  if (explicit && detected && explicit !== detected) {
    return { ok: false, detail: `EBAY_ENVIRONMENT ("${explicit}") disagrees with the Client ID's own environment marker ("${detected}") — refusing to guess which is correct.` }
  }

  if (explicit) return { ok: true, environment: explicit, source: 'explicit' }
  if (detected) return { ok: true, environment: detected, source: 'detected' }
  return { ok: true, environment: 'production', source: 'default' }
}

interface EbayCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  environment: EbayEnvironment
  environmentSource: 'explicit' | 'detected' | 'default'
}

function credentials(): EbayCredentials | null {
  const clientId = readEnv('EBAY_CLIENT_ID')
  const clientSecret = readEnv('EBAY_CLIENT_SECRET')
  const refreshToken = readEnv('EBAY_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) return null

  const resolved = resolveEbayEnvironment(clientId, readEnv('EBAY_ENVIRONMENT'))
  // A genuine Sandbox/Production conflict is treated as unconfigured
  // (not_configured) rather than guessed — matches "if the environment
  // cannot be determined safely, mark the integration as degraded/not
  // configured rather than guessing."
  if (!resolved.ok) return null

  return { clientId, clientSecret, refreshToken, environment: resolved.environment, environmentSource: resolved.source }
}

/** Exchanges the long-lived refresh token for a short-lived access token — the same shape every other connector in this codebase uses for its own OAuth family. */
async function getAccessToken(creds: EbayCredentials): Promise<Result<{ accessToken: string; scopeGranted: string }, string>> {
  try {
    const response = await fetch(EBAY_HOSTS[creds.environment].tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // eBay's token endpoint authenticates the app via HTTP Basic auth
        // (client_id:client_secret), distinct from Amazon's LWA exchange,
        // which sends both as form fields instead.
        Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        scope: EBAY_SCOPES,
      }),
    })
    if (!response.ok) {
      // eBay's token endpoint returns `{ error: 'invalid_client' | 'invalid_grant' | ..., error_description }`
      // on failure — surfaced in the message (never the credential itself)
      // so a caller can tell "the app's own client id/secret pair is
      // wrong" (invalid_client) apart from "the refresh token itself is
      // bad/expired/revoked" (invalid_grant, or anything else at this
      // step) without a second parse elsewhere.
      const errorBody = await response.json().catch(() => null) as { error?: string; error_description?: string } | null
      const code = errorBody?.error ?? 'unknown_error'
      const description = errorBody?.error_description ? ` — ${errorBody.error_description}` : ''
      if (response.status === 429 || response.status >= 500) {
        return err(`eBay token exchange degraded: ${response.status} ${response.statusText} (${code})${description}`)
      }
      return err(`eBay token exchange failed: ${code} (${response.status} ${response.statusText})${description}`)
    }
    const body = (await response.json()) as { access_token?: string; scope?: string }
    if (!body.access_token) return err('eBay token exchange returned no access token.')
    return ok({ accessToken: body.access_token, scopeGranted: body.scope ?? '' })
  } catch (error) {
    return err(`eBay token exchange threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface EbayApiSuccess<T> {
  status: number
  data: T
  /** The `Location` response header, when eBay returns one (e.g. `createShippingFulfillment`'s 201). */
  location: string | null
}

interface EbayApiErrorBody {
  errors?: readonly { errorId?: number; message?: string; longMessage?: string }[]
}

/**
 * Turns eBay's own error envelope (`{ errors: [{ errorId, message,
 * longMessage, ... }] }`, confirmed via the official `Error` model —
 * see the module doc comment) into a precise, attributable message —
 * distinguishing "eBay rejected this" (with eBay's own reason) from a
 * generic HTTP status, which matters for telling AUTH_FAILED apart from
 * PERMISSION_INSUFFICIENT apart from a genuine API-surface mismatch.
 */
function describeEbayError(status: number, statusText: string, body: unknown): string {
  const firstError = (body as EbayApiErrorBody | null)?.errors?.[0]
  if (firstError?.message) {
    const idPart = firstError.errorId !== undefined ? ` (errorId ${firstError.errorId})` : ''
    return `eBay API error ${status}${idPart}: ${firstError.longMessage ?? firstError.message}`
  }
  return `eBay API returned ${status} ${statusText}.`
}

/**
 * The shared low-level request: exchanges the token, calls the endpoint,
 * and returns the parsed body alongside the status and `Location` header
 * — `submitFulfilmentUpdate` needs the header, every read method only
 * needs the body, via the `ebayApiRequest` wrapper below.
 */
async function performEbayApiRequest(creds: EbayCredentials, path: string, method: 'GET' | 'POST', body?: unknown): Promise<Result<EbayApiSuccess<unknown>, string>> {
  const tokenResult = await getAccessToken(creds)
  if (!tokenResult.ok) return tokenResult

  try {
    const response = await fetch(`https://${EBAY_HOSTS[creds.environment].apiHost}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenResult.value.accessToken}`,
        'Content-Language': 'en-GB',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    const rawText = await response.text()

    // A rate limit or eBay-side outage is transient, not a genuine
    // access/permission failure — classified from the HTTP status alone,
    // before attempting to parse a body, since an infrastructure-level
    // 503 (a gateway/load-balancer page, not eBay's own JSON error
    // envelope) is exactly the shape this needs to catch, not the
    // non-JSON-response error path below.
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      return err(`eBay API degraded: eBay API returned ${response.status} ${response.statusText}.`)
    }

    // A successful write (e.g. createShippingFulfillment's 201) can return
    // an empty or minimal body — parsing it as JSON unconditionally would
    // throw on a genuinely successful call, so an empty body parses to `null`.
    let parsed: unknown = null
    if (rawText.length > 0) {
      try {
        parsed = JSON.parse(rawText)
      } catch {
        return err(`eBay API returned a non-JSON response for ${path}: ${rawText.slice(0, 200)}`)
      }
    }

    if (!response.ok) return err(describeEbayError(response.status, response.statusText, parsed))
    return ok({ status: response.status, data: parsed, location: response.headers.get('location') })
  } catch (error) {
    return err(`eBay API request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function ebayApiRequest<T>(creds: EbayCredentials, path: string, method: 'GET' | 'POST', body?: unknown): Promise<Result<T, string>> {
  const result = await performEbayApiRequest(creds, path, method, body)
  if (!result.ok) return result
  return ok(result.value.data as T)
}

interface RawEbayOrder {
  orderId: string
  creationDate: string
  orderFulfillmentStatus?: string
  orderPaymentStatus?: string
  cancelStatus?: { cancelState?: string }
  pricingSummary?: { total?: { value?: string; currency?: string } }
  lineItems?: readonly { lineItemId: string; sku?: string; quantity?: number; lineItemCost?: { value?: string } }[]
}

function mapEbayOrderStatus(order: RawEbayOrder): MarketplaceOrderSnapshot['status'] {
  if (order.cancelStatus?.cancelState === 'CANCELED') return 'cancelled'
  if (order.orderPaymentStatus === 'FULLY_REFUNDED' || order.orderPaymentStatus === 'PARTIALLY_REFUNDED') return 'refunded'
  if (order.orderFulfillmentStatus === 'FULFILLED') return 'fulfilled'
  if (order.orderPaymentStatus === 'PAID') return 'paid'
  return 'pending'
}

/**
 * The full connection verification sequence: credentials present -> OAuth
 * token refresh -> authenticated read-only API call. Never reports
 * `CONNECTED` on anything less than a genuine, successful authenticated
 * eBay API response — env vars existing only ever satisfies the first
 * step. `getConnectionHealth()` (the shared `MarketplaceConnector`
 * interface method every other caller already relies on) is a thin
 * wrapper over this same function, mapped down to the coarser shared
 * status — one real check, two views of it, never two implementations.
 */
export type EbayVerificationStatus = 'NOT_CONFIGURED' | 'AUTHENTICATION_FAILED' | 'TOKEN_REFRESH_FAILED' | 'API_ACCESS_FAILED' | 'CONNECTED' | 'DEGRADED'

export interface EbayVerificationResult {
  status: EbayVerificationStatus
  environment: EbayEnvironment | null
  environmentSource: 'explicit' | 'detected' | 'default' | null
  checkedAt: string
  operationTested: string | null
  latencyMs: number | null
  /** Safe, human-readable detail — structurally cannot contain a credential (built only from eBay's own error text or a fixed success string). */
  detail: string
  /** From the token response's own `scope` field — not a secret. Empty when the check never reached a successful token exchange. */
  oauthScopesGranted: readonly string[]
}

export async function verifyEbayConnection(): Promise<EbayVerificationResult> {
  const now = new Date().toISOString()
  const creds = credentials()
  if (!creds) {
    return {
      status: 'NOT_CONFIGURED',
      environment: null,
      environmentSource: null,
      checkedAt: now,
      operationTested: null,
      latencyMs: null,
      detail: 'Required credentials are missing, or the Sandbox/Production environment could not be safely determined from them.',
      oauthScopesGranted: [],
    }
  }

  const startedAt = Date.now()
  const tokenResult = await getAccessToken(creds)

  if (!tokenResult.ok) {
    const degraded = tokenResult.error.startsWith('eBay token exchange degraded:')
    const authFailed = tokenResult.error.includes('invalid_client')
    return {
      status: degraded ? 'DEGRADED' : authFailed ? 'AUTHENTICATION_FAILED' : 'TOKEN_REFRESH_FAILED',
      environment: creds.environment,
      environmentSource: creds.environmentSource,
      checkedAt: now,
      operationTested: 'POST /identity/v1/oauth2/token',
      latencyMs: Date.now() - startedAt,
      detail: tokenResult.error,
      oauthScopesGranted: [],
    }
  }

  const oauthScopesGranted = tokenResult.value.scopeGranted.split(' ').filter(Boolean)
  const operationTested = 'GET /sell/fulfillment/v1/order?limit=1'
  const apiResult = await performEbayApiRequest(creds, '/sell/fulfillment/v1/order?limit=1', 'GET')
  const latencyMs = Date.now() - startedAt

  if (!apiResult.ok) {
    const degraded = apiResult.error.startsWith('eBay API degraded:')
    return {
      status: degraded ? 'DEGRADED' : 'API_ACCESS_FAILED',
      environment: creds.environment,
      environmentSource: creds.environmentSource,
      checkedAt: now,
      operationTested,
      latencyMs,
      detail: apiResult.error,
      oauthScopesGranted,
    }
  }

  return {
    status: 'CONNECTED',
    environment: creds.environment,
    environmentSource: creds.environmentSource,
    checkedAt: now,
    operationTested,
    latencyMs,
    detail: `Authenticated eBay API call succeeded against ${creds.environment}.`,
    oauthScopesGranted,
  }
}

/**
 * The four capability layers Task 4 requires kept distinct — reported
 * here from facts that already exist elsewhere in this file, never a new
 * enforcement mechanism (the real enforcement is the capability
 * descriptor plus the honest write-method stubs below, unchanged). A
 * granted OAuth scope alone never implies Commerce OS may act on it —
 * `explicitlyEnabled`/`policyPermitted` are the two facts every caller
 * (`publicationGate.ts`, `priceExecution.ts`, etc.) actually gates on,
 * and neither is derived from `oauthScopesGranted`.
 */
export interface EbayCapabilityLayers {
  /** 1. What eBay's OAuth grant actually returned — informational only. */
  oauthScopesGranted: readonly string[]
  /** 2. What this connector's code can technically do, regardless of whether it's turned on. */
  technicallyImplemented: readonly string[]
  /** 3. What's actually turned on — DESCRIPTOR.capabilities, the real source of truth every gate reads. */
  explicitlyEnabled: MarketplaceCapabilities
  /** 4. What Commerce OS policy currently permits acting on autonomously. */
  policyPermitted: 'read_only'
}

export function describeEbayCapabilityLayers(oauthScopesGranted: readonly string[] = []): EbayCapabilityLayers {
  return {
    oauthScopesGranted,
    technicallyImplemented: ['readListings (fetchListings)', 'ingestOrders (fetchOrders)', 'updateFulfilment (tracking push only, informational — never financial)'],
    explicitlyEnabled: DESCRIPTOR.capabilities,
    policyPermitted: 'read_only',
  }
}

const EBAY_VERIFICATION_TO_MARKETPLACE_STATUS: Record<EbayVerificationStatus, MarketplaceConnectionStatus> = {
  NOT_CONFIGURED: 'not_configured',
  CONNECTED: 'connected',
  DEGRADED: 'degraded',
  AUTHENTICATION_FAILED: 'error',
  TOKEN_REFRESH_FAILED: 'error',
  API_ACCESS_FAILED: 'error',
}

export class EbayConnector implements MarketplaceConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return credentials() !== null
  }

  async getConnectionHealth(): Promise<Result<ConnectionHealth, string>> {
    const result = await verifyEbayConnection()
    return ok({
      status: EBAY_VERIFICATION_TO_MARKETPLACE_STATUS[result.status],
      apiVersion: result.status === 'NOT_CONFIGURED' ? null : 'v1',
      checkedAt: result.checkedAt,
      detail: result.status === 'CONNECTED' ? null : result.detail,
    })
  }

  async fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>> {
    const creds = credentials()
    if (!creds) return err('eBay is not configured.')

    // getInventoryItems' documented limit is 1-100 (distinct from getOrders'
    // 1-1000) — clamped here rather than left to fail against eBay's own
    // validation, confirmed via the official getInventoryItems reference.
    const limit = Math.min(Math.max(options.limit, 1), 100)
    const result = await ebayApiRequest<{
      inventoryItems?: readonly { sku: string; product?: { title?: string }; availability?: { shipToLocationAvailability?: { quantity?: number } } }[]
    }>(creds, `/sell/inventory/v1/inventory_item?limit=${limit}`, 'GET')
    if (!result.ok) return result

    const records: MarketplaceListingSnapshot[] = (result.value.inventoryItems ?? []).map((item) => ({
      externalId: item.sku,
      channelProductRef: item.sku,
      title: item.product?.title ?? item.sku,
      status: 'active',
      priceMinor: 0, // Price requires a separate call per SKU to the Offer resource — not made here, matching amazon.ts's identical honesty for the identical reason.
      currency: 'GBP',
      stockQty: item.availability?.shipToLocationAvailability?.quantity ?? null,
      reportedAt: new Date().toISOString(),
      raw: item as unknown as Record<string, unknown>,
    }))

    return ok({ records, requestsMade: 1, warnings: ['Price and listing status require a separate call to the Offer resource per SKU, not yet made here.'] })
  }

  async fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>> {
    const listings = await this.fetchListings(options)
    if (!listings.ok) return listings
    return ok({
      records: listings.value.records.map((l) => ({ externalId: l.externalId, channelProductRef: l.channelProductRef, stockQty: l.stockQty ?? 0, reportedAt: l.reportedAt })),
      requestsMade: listings.value.requestsMade,
      warnings: listings.value.warnings,
    })
  }

  async fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>> {
    const creds = credentials()
    if (!creds) return err('eBay is not configured.')

    const params = new URLSearchParams({ limit: String(options.limit) })
    if (options.sinceIso) params.set('filter', `creationdate:[${options.sinceIso}..]`)

    const result = await ebayApiRequest<{ orders?: readonly RawEbayOrder[] }>(creds, `/sell/fulfillment/v1/order?${params.toString()}`, 'GET')
    if (!result.ok) return result

    const records: MarketplaceOrderSnapshot[] = (result.value.orders ?? []).map((order) => ({
      externalId: order.orderId,
      placedAt: order.creationDate,
      status: mapEbayOrderStatus(order),
      totalMinor: order.pricingSummary?.total?.value ? Math.round(Number(order.pricingSummary.total.value) * 100) : 0,
      currency: order.pricingSummary?.total?.currency ?? 'GBP',
      // Never called live this session — eBay remains CONFIGURATION_INCOMPLETE
      // — but sku/quantity/cost are already present on the same response
      // this connector fetches, so mapping them is a structural correctness
      // fix, not new API surface. `lineItemCost` is documented as the
      // line's TOTAL (unit price x quantity), not a per-unit price, so it
      // is divided by quantity here to match `unitPriceMinor`'s contract.
      lineItems: (order.lineItems ?? []).map((li) => {
        const quantity = li.quantity ?? 0
        const totalMinor = li.lineItemCost?.value ? Math.round(Number(li.lineItemCost.value) * 100) : 0
        return {
          externalId: li.lineItemId,
          sku: li.sku ?? null,
          quantity,
          unitPriceMinor: quantity > 0 ? Math.round(totalMinor / quantity) : 0,
        }
      }),
      raw: order as unknown as Record<string, unknown>,
    }))

    return ok({ records, requestsMade: 1, warnings: [] })
  }

  async fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>> {
    return err(`eBay fee reporting requires the separate Finances API, not implemented in this connector (requested up to ${options.limit} records).`)
  }

  /**
   * Confirms shipment for an order — the only write this connector
   * implements, and deliberately so: pushing tracking to eBay is
   * informational (telling eBay a package shipped), never a purchase or
   * financial action, matching this milestone's explicit "minimum
   * permissions necessary" requirement.
   */
  async submitFulfilmentUpdate(update: FulfilmentUpdateInput): Promise<Result<FulfilmentUpdateOutcome, string>> {
    const creds = credentials()
    if (!creds) return err('eBay is not configured.')

    const result = await performEbayApiRequest(
      creds,
      `/sell/fulfillment/v1/order/${encodeURIComponent(update.externalOrderId)}/shipping_fulfillment`,
      'POST',
      {
        lineItems: [], // eBay requires the specific line items being shipped — this connector currently ships the whole order; see HANDOVER.md for the per-line-item gap.
        shippedDate: new Date().toISOString(),
        shippingCarrierCode: update.carrier,
        trackingNumber: update.trackingNumber,
      },
    )
    if (!result.ok) return result
    // Confirmed via eBay's official createShippingFulfillment reference: the
    // fulfillmentId is returned in the Location header's last path segment
    // (.../shipping_fulfillment/{fulfillmentId}), not as a JSON body field.
    const fulfillmentId = result.value.location?.split('/').filter(Boolean).pop() ?? null
    return ok({ accepted: true, marketplaceReference: fulfillmentId })
  }

  /**
   * eBay's write side (price via the Offer resource, inventory quantity,
   * listing publish/withdraw) is not implemented here — `writeListings`/
   * `syncInventory` are honestly `false` on the descriptor (Phase 4's
   * "minimum permissions" requirement), so these three are never called
   * by any capability-gated caller in the first place; implemented
   * honestly rather than omitted, matching every other connector
   * interface method in this codebase.
   */
  async updateListingPrice(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay price writes require the Inventory API\'s Offer resource, not implemented in this connector.' })
  }

  async updateInventory(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay inventory writes are not implemented in this connector.' })
  }

  async setListingStatus(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay listing publish/withdraw is not implemented in this connector.' })
  }

  async verifyListingState(externalId: string): Promise<Result<MarketplaceListingSnapshot, string>> {
    return err(`eBay listing verification for ${externalId} is not implemented in this connector (capabilities.verifyWrites is false).`)
  }

  /** `capabilities.createListings` is false — out of scope for the Shopify-specific Phase 6 milestone. */
  async createListing(): Promise<Result<CreateListingOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay product creation is not implemented in this connector — out of scope for the Shopify-specific controlled publication milestone.' })
  }
}

export const ebayConnector = new EbayConnector()

/** Exposed for unit tests that cannot make real network or OAuth calls. */
export const __internal = { credentials, getAccessToken, ebayApiRequest, performEbayApiRequest, describeEbayError, resolveEbayEnvironment }
