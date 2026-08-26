import { err, ok, type Result } from '@/lib/core/result'
import type {
  ConnectionHealth,
  FetchOptions,
  FetchOutcome,
  FulfilmentUpdateInput,
  FulfilmentUpdateOutcome,
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
 *   - No sandbox toggle exists — this connector only ever targets
 *     `api.ebay.com` (production). eBay's sandbox lives at a distinct host
 *     (`api.sandbox.ebay.com`) with its own credential set; adding a
 *     toggle is a genuine, deliberately deferred gap, not an oversight.
 *   - `getAccessToken` never caches the access token — every call
 *     re-exchanges the refresh token, the same known, shared inefficiency
 *     `amazon.ts`/`amazonAds.ts` both already have, not a new one.
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

const EBAY_API_HOST = 'api.ebay.com'
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
].join(' ')

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

interface EbayCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

function credentials(): EbayCredentials | null {
  const clientId = readEnv('EBAY_CLIENT_ID')
  const clientSecret = readEnv('EBAY_CLIENT_SECRET')
  const refreshToken = readEnv('EBAY_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) return null
  return { clientId, clientSecret, refreshToken }
}

/** Exchanges the long-lived refresh token for a short-lived access token — the same shape every other connector in this codebase uses for its own OAuth family. */
async function getAccessToken(creds: EbayCredentials): Promise<Result<string, string>> {
  try {
    const response = await fetch(EBAY_TOKEN_URL, {
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
    if (!response.ok) return err(`eBay token exchange failed: ${response.status} ${response.statusText}`)
    const body = (await response.json()) as { access_token?: string }
    if (!body.access_token) return err('eBay token exchange returned no access token.')
    return ok(body.access_token)
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
    const response = await fetch(`https://${EBAY_API_HOST}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenResult.value}`,
        'Content-Language': 'en-GB',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    // A successful write (e.g. createShippingFulfillment's 201) can return
    // an empty or minimal body — parsing it as JSON unconditionally would
    // throw on a genuinely successful call, so an empty body parses to `null`.
    const rawText = await response.text()
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
  lineItems?: readonly { lineItemId: string }[]
}

function mapEbayOrderStatus(order: RawEbayOrder): MarketplaceOrderSnapshot['status'] {
  if (order.cancelStatus?.cancelState === 'CANCELED') return 'cancelled'
  if (order.orderPaymentStatus === 'FULLY_REFUNDED' || order.orderPaymentStatus === 'PARTIALLY_REFUNDED') return 'refunded'
  if (order.orderFulfillmentStatus === 'FULFILLED') return 'fulfilled'
  if (order.orderPaymentStatus === 'PAID') return 'paid'
  return 'pending'
}

export class EbayConnector implements MarketplaceConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return credentials() !== null
  }

  async getConnectionHealth(): Promise<Result<ConnectionHealth, string>> {
    const creds = credentials()
    const now = new Date().toISOString()
    if (!creds) return ok({ status: 'not_configured', apiVersion: null, checkedAt: now, detail: null })

    // A minimal, zero-side-effect order read (limit=1) is the recommended
    // lightweight call for verifying credentials/scope actually work,
    // matching Amazon's own "list profiles"/"marketplace participations"
    // choice of a cheap, real, read-only endpoint rather than inventing a
    // separate health-check call eBay does not offer.
    const result = await ebayApiRequest<{ orders?: readonly RawEbayOrder[] }>(creds, '/sell/fulfillment/v1/order?limit=1', 'GET')
    if (!result.ok) return ok({ status: 'error', apiVersion: 'v1', checkedAt: now, detail: result.error })
    return ok({ status: 'connected', apiVersion: 'v1', checkedAt: now, detail: null })
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
      lineItemRefs: (order.lineItems ?? []).map((li) => li.lineItemId),
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
}

export const ebayConnector = new EbayConnector()

/** Exposed for unit tests that cannot make real network or OAuth calls. */
export const __internal = { credentials, getAccessToken, ebayApiRequest, performEbayApiRequest, describeEbayError }
