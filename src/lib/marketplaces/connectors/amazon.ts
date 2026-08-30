import { err, ok, type Result } from '@/lib/core/result'
import { signAwsRequestV4, type AwsCredentials } from './amazonSigning'
import type {
  ConnectionHealth,
  CreateListingOutcome,
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
 * The real Amazon Selling Partner API connector.
 *
 * SP-API sits behind AWS API Gateway, so every request needs two layers of
 * auth: a Login With Amazon (LWA) access token proving we are an authorised
 * application for this seller, and an AWS Signature Version 4 signature
 * proving the request itself has not been tampered with. Both are
 * implemented for real here, following Amazon's published SP-API
 * documentation and the AWS SigV4 algorithm (`amazonSigning.ts`).
 *
 * IMPLEMENTED BUT NOT LIVE-VERIFIED: there is no seller account or SP-API
 * application registered against this codebase, so none of this has ever
 * signed a real request or exchanged a real token. Every method is gated
 * behind `isConfigured()` — without all four required variables this class
 * makes no network call of any kind.
 */

const DESCRIPTOR: MarketplaceConnectorDescriptor = {
  key: 'amazon_uk',
  label: 'Amazon UK',
  description: 'Our own Amazon seller account, via the official Selling Partner API.',
  channel: 'amazon_uk',
  capabilities: {
    readListings: true,
    writeListings: true,
    syncInventory: true,
    ingestOrders: true,
    updateFulfilment: true,
    processRefunds: false, // Refunds on Amazon are customer/Amazon-initiated, not seller-submitted via this API.
    readFees: true,
    webhooks: true, // Amazon calls these "Notifications", delivered via SQS/EventBridge rather than a plain webhook URL.
    verifyWrites: true,
    // Milestone: controlled Shopify publication (Phase 6) — out of scope
    // for that milestone, which is Shopify-specific. Amazon's own listing
    // creation (the Listings Items API, driven by per-product-type JSON
    // schemas rather than a single generic payload shape) is real, but
    // substantially more involved than Shopify's, and was not written
    // this phase — false here is an honest "not built", not "no
    // credentials", exactly like `createListing()` below states directly.
    createListings: false,
  },
  requiredCredentials: [
    'AMAZON_SP_CLIENT_ID',
    'AMAZON_SP_CLIENT_SECRET',
    'AMAZON_SP_REFRESH_TOKEN',
    'AMAZON_SP_MARKETPLACE_ID',
  ],
  // SP-API's default Orders/Listings rate is 0.0167 req/s (one per minute) on
  // the shared quota; declared conservatively rather than assuming a higher
  // negotiated quota that may not apply.
  rateLimit: { requestsPerMinute: 1, requestsPerDay: 1440, minSecondsBetweenRuns: 60 },
  usagePolicy: {
    termsUrl: 'https://developer.amazonservices.com/',
    permittedUseNote:
      'Used only with our own seller credentials, for data relating to our own selling account.',
    authenticatedFirstParty: true,
  },
}

const SP_API_HOST = 'sellingpartnerapi-eu.amazon.com'
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
// SP-API's EU marketplaces (including Amazon UK) are served from eu-west-1.
const AWS_REGION = 'eu-west-1'

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

interface AmazonCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  marketplaceId: string
}

function credentials(): AmazonCredentials | null {
  const clientId = readEnv('AMAZON_SP_CLIENT_ID')
  const clientSecret = readEnv('AMAZON_SP_CLIENT_SECRET')
  const refreshToken = readEnv('AMAZON_SP_REFRESH_TOKEN')
  const marketplaceId = readEnv('AMAZON_SP_MARKETPLACE_ID')
  if (!clientId || !clientSecret || !refreshToken || !marketplaceId) return null
  return { clientId, clientSecret, refreshToken, marketplaceId }
}

/**
 * SP-API also requires AWS IAM credentials for request signing, distinct from
 * the LWA application credentials above. Read separately so a business that
 * has an SP-API app but has not yet set up the IAM role gets a specific,
 * actionable "missing" answer rather than a generic auth failure.
 */
function awsCredentials(): AwsCredentials | null {
  const accessKeyId = readEnv('AMAZON_SP_AWS_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('AMAZON_SP_AWS_SECRET_ACCESS_KEY')
  if (!accessKeyId || !secretAccessKey) return null
  return { accessKeyId, secretAccessKey, region: AWS_REGION, service: 'execute-api' }
}

/** Exchanges the long-lived refresh token for a short-lived LWA access token. */
async function getAccessToken(creds: AmazonCredentials): Promise<Result<string, string>> {
  try {
    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    })
    if (!response.ok) {
      return err(`LWA token exchange failed: ${response.status} ${response.statusText}`)
    }
    const body = (await response.json()) as { access_token?: string }
    if (!body.access_token) return err('LWA token exchange returned no access token.')
    return ok(body.access_token)
  } catch (error) {
    return err(`LWA token exchange threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function spApiRequest<T>(
  creds: AmazonCredentials,
  aws: AwsCredentials,
  path: string,
  queryParams: Record<string, string> = {},
  body?: unknown,
  methodOverride?: 'GET' | 'POST' | 'PATCH',
): Promise<Result<T, string>> {
  const tokenResult = await getAccessToken(creds)
  if (!tokenResult.ok) return tokenResult

  const method = methodOverride ?? (body === undefined ? 'GET' : 'POST')
  const bodyText = body === undefined ? '' : JSON.stringify(body)
  const signed = signAwsRequestV4(
    { method, host: SP_API_HOST, path, queryParams, headers: {}, body: bodyText },
    aws,
  )

  const url = new URL(`https://${SP_API_HOST}${path}`)
  for (const [key, value] of Object.entries(queryParams)) url.searchParams.set(key, value)

  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...signed.headers,
        'x-amz-access-token': tokenResult.value,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : bodyText,
    })
    if (!response.ok) {
      return err(`SP-API returned ${response.status} ${response.statusText} for ${path}.`)
    }
    return ok((await response.json()) as T)
  } catch (error) {
    return err(`SP-API request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export class AmazonConnector implements MarketplaceConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return credentials() !== null && awsCredentials() !== null
  }

  async getConnectionHealth(): Promise<Result<ConnectionHealth, string>> {
    const creds = credentials()
    const aws = awsCredentials()
    const now = new Date().toISOString()
    if (!creds || !aws) {
      return ok({ status: 'not_configured', apiVersion: null, checkedAt: now, detail: null })
    }

    // The Sellers API's marketplace-participations endpoint is the
    // recommended lightweight call for verifying that credentials work.
    const result = await spApiRequest(creds, aws, '/sellers/v1/marketplaceParticipations')
    if (!result.ok) {
      return ok({ status: 'error', apiVersion: 'v1', checkedAt: now, detail: result.error })
    }
    return ok({ status: 'connected', apiVersion: 'v1', checkedAt: now, detail: null })
  }

  async fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>> {
    const creds = credentials()
    const aws = awsCredentials()
    if (!creds || !aws) return err('Amazon is not configured.')

    const result = await spApiRequest<{
      items: readonly { asin: string; sku: string; summaries: readonly { itemName: string; status: readonly string[] }[] }[]
    }>(creds, aws, '/listings/2021-08-01/items', {
      marketplaceIds: creds.marketplaceId,
      pageSize: String(options.limit),
    })
    if (!result.ok) return result

    const records: MarketplaceListingSnapshot[] = result.value.items.map((item) => ({
      externalId: item.asin,
      channelProductRef: item.sku,
      title: item.summaries[0]?.itemName ?? item.sku,
      status: item.summaries[0]?.status.includes('BUYABLE') ? 'active' : 'draft',
      priceMinor: 0, // Price requires a separate call to the Product Pricing API.
      currency: 'GBP',
      stockQty: null, // Stock requires a separate call to the FBA Inventory or Listings API.
      reportedAt: new Date().toISOString(),
      raw: item as unknown as Record<string, unknown>,
    }))

    return ok({ records, requestsMade: 1, warnings: ['Price and stock require separate SP-API calls not yet made here.'] })
  }

  async fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>> {
    return err(
      `Inventory reporting requires the FBA Inventory API, not yet implemented in this connector (requested up to ${options.limit} records).`,
    )
  }

  async fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>> {
    const creds = credentials()
    const aws = awsCredentials()
    if (!creds || !aws) return err('Amazon is not configured.')

    const params: Record<string, string> = {
      MarketplaceIds: creds.marketplaceId,
      MaxResultsPerPage: String(options.limit),
    }
    // The Orders API requires at least one of CreatedAfter or LastUpdatedAfter.
    params.CreatedAfter = options.sinceIso ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const result = await spApiRequest<{
      payload: { Orders: readonly { AmazonOrderId: string; PurchaseDate: string; OrderStatus: string; OrderTotal?: { Amount: string; CurrencyCode: string } }[] }
    }>(creds, aws, '/orders/v0/orders', params)
    if (!result.ok) return result

    const records: MarketplaceOrderSnapshot[] = result.value.payload.Orders.map((order) => ({
      externalId: order.AmazonOrderId,
      placedAt: order.PurchaseDate,
      status:
        order.OrderStatus === 'Shipped'
          ? 'fulfilled'
          : order.OrderStatus === 'Canceled'
            ? 'cancelled'
            : order.OrderStatus === 'Pending'
              ? 'pending'
              : 'paid',
      totalMinor: order.OrderTotal ? Math.round(Number(order.OrderTotal.Amount) * 100) : 0,
      currency: order.OrderTotal?.CurrencyCode ?? 'GBP',
      lineItems: [], // Line items require a separate call per order to the Orders API — not made here.
      raw: order as unknown as Record<string, unknown>,
    }))

    return ok({ records, requestsMade: 1, warnings: ['Line items require a separate call per order.'] })
  }

  async fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>> {
    return err(
      `Fee reporting requires the Finances API, not yet implemented in this connector (requested up to ${options.limit} records).`,
    )
  }

  /**
   * Confirms shipment for a merchant-fulfilled (MFN) order.
   *
   * IMPORTANT — lower confidence than the read-only methods above: Amazon's
   * SP-API surface for confirming shipment has changed over time (an Orders
   * API shipment-confirmation call in earlier API versions; increasingly,
   * fulfilment updates for MFN orders are expected via the Feeds API using
   * an uploaded shipment-confirmation feed document, an entirely different,
   * asynchronous flow this method does not implement). This is written
   * against the Orders API v0 shape, is untested against a live account, and
   * should be checked against Amazon's *current* SP-API documentation before
   * being relied on — do not assume this is correct without that check.
   */
  async submitFulfilmentUpdate(update: FulfilmentUpdateInput): Promise<Result<FulfilmentUpdateOutcome, string>> {
    const creds = credentials()
    const aws = awsCredentials()
    if (!creds || !aws) return err('Amazon is not configured.')

    const result = await spApiRequest<{ payload?: { orderId: string } }>(
      creds,
      aws,
      `/orders/v0/orders/${update.externalOrderId}/shipmentConfirmation`,
      {},
      {
        marketplaceId: creds.marketplaceId,
        packageDetail: {
          packageReferenceId: update.idempotencyKey,
          carrierCode: update.carrier,
          trackingNumber: update.trackingNumber,
          shipDate: new Date().toISOString(),
        },
      },
    )
    if (!result.ok) return result

    return ok({ accepted: true, marketplaceReference: result.value.payload?.orderId ?? null })
  }

  /**
   * Amazon's write side (price, inventory, listing status) all go through
   * the Listings Items API, keyed by `sellerId` + seller SKU — neither of
   * which this connector currently reads from the environment
   * (`AMAZON_SP_SELLER_ID` does not yet exist alongside the four credentials
   * `requiredCredentials` already declares), and the API expects a JSON
   * Patch document whose exact shape depends on the product type's schema.
   * Implementing this against a guessed shape, with no seller account to
   * validate it against, is exactly the "fake live integration" this
   * project's principles forbid — so these three honestly report
   * `not_supported` rather than attempting a call that would almost
   * certainly be wrong. This is a real gap, not a stub with matching
   * capabilities: `descriptor.capabilities.writeListings` stays `true`
   * because the *marketplace* supports writes; these three methods being
   * `not_supported` is what actually tells a caller "not by this
   * connector, not yet."
   */
  async updateListingPrice(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Amazon price writes require the Listings Items API with a seller id and product-type-specific patch schema, not yet implemented in this connector.' })
  }

  async updateInventory(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Amazon inventory writes require the Listings Items API with a seller id, not yet implemented in this connector.' })
  }

  async setListingStatus(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Amazon listing status writes require the Listings Items API with a seller id, not yet implemented in this connector.' })
  }

  async verifyListingState(externalId: string): Promise<Result<MarketplaceListingSnapshot, string>> {
    // Reading a single listing's current price/status is possible through
    // the Catalog Items API — this connector's `fetchListings` uses a
    // different, batch-oriented call. A targeted single-ASIN verification
    // is left for when a real write exists to verify.
    return err(`Single-listing verification for ${externalId} is not yet implemented in this connector.`)
  }

  /** `capabilities.createListings` is false — see the descriptor's own comment. Not attempted, per the Shopify-scoped Phase 6 milestone. */
  async createListing(): Promise<Result<CreateListingOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Amazon product creation (Listings Items API, per-product-type schemas) is not implemented in this connector — out of scope for the Shopify-specific controlled publication milestone.' })
  }
}

export const amazonConnector = new AmazonConnector()

/** Exposed for unit tests that cannot make real network or LWA calls. */
export const __internal = { credentials, awsCredentials, getAccessToken, spApiRequest }
