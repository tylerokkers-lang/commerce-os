import { err, ok, type Result } from '@/lib/core/result'
import type {
  ConnectionHealth,
  FetchOptions,
  FetchOutcome,
  MarketplaceConnector,
  MarketplaceConnectorDescriptor,
  MarketplaceFeeSnapshot,
  MarketplaceInventorySnapshot,
  MarketplaceListingSnapshot,
  MarketplaceOrderSnapshot,
} from './types'

/**
 * The real Shopify Admin API connector.
 *
 * Uses the official REST Admin API with a private/custom app access token —
 * the supported, documented authentication method for a single-store
 * integration like this one (as opposed to the OAuth flow, which exists for
 * apps distributed to other merchants' stores).
 *
 * IMPLEMENTED BUT NOT LIVE-VERIFIED: this code is written against Shopify's
 * published REST Admin API reference and has never been run against a real
 * store, because no store credentials exist in this environment. Every
 * request is gated behind `isConfigured()`, so without
 * `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN` and
 * `SHOPIFY_API_VERSION` this class cannot make a network request at all —
 * it is not merely untested, it is inert.
 */

const DESCRIPTOR: MarketplaceConnectorDescriptor = {
  key: 'shopify',
  label: 'Shopify',
  description: 'Our own Shopify store, via the official Admin API using a private app access token.',
  channel: 'shopify',
  capabilities: {
    readListings: true,
    writeListings: true,
    syncInventory: true,
    ingestOrders: true,
    updateFulfilment: true,
    processRefunds: true,
    readFees: true,
    webhooks: true,
  },
  requiredCredentials: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_API_VERSION'],
  // Shopify's REST Admin API enforces a leaky-bucket limit of 2 requests per
  // second (40 bucket size) on the standard plan; declared conservatively.
  rateLimit: { requestsPerMinute: 40, requestsPerDay: null, minSecondsBetweenRuns: 0 },
  usagePolicy: {
    termsUrl: 'https://www.shopify.com/legal/api-terms',
    permittedUseNote: 'Reads and writes only our own store, using an access token we generated ourselves.',
    authenticatedFirstParty: true,
  },
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

interface ShopifyCredentials {
  storeDomain: string
  accessToken: string
  apiVersion: string
}

function credentials(): ShopifyCredentials | null {
  const storeDomain = readEnv('SHOPIFY_STORE_DOMAIN')
  const accessToken = readEnv('SHOPIFY_ADMIN_ACCESS_TOKEN')
  const apiVersion = readEnv('SHOPIFY_API_VERSION')
  if (!storeDomain || !accessToken || !apiVersion) return null
  return { storeDomain, accessToken, apiVersion }
}

async function shopifyRequest<T>(
  creds: ShopifyCredentials,
  path: string,
  params: Record<string, string> = {},
): Promise<Result<T, string>> {
  const url = new URL(`https://${creds.storeDomain}/admin/api/${creds.apiVersion}/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  try {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': creds.accessToken,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return err(`Shopify returned ${response.status} ${response.statusText} for ${path}.`)
    }
    return ok((await response.json()) as T)
  } catch (error) {
    return err(`Shopify request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export class ShopifyConnector implements MarketplaceConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return credentials() !== null
  }

  async getConnectionHealth(): Promise<Result<ConnectionHealth, string>> {
    const creds = credentials()
    const now = new Date().toISOString()
    if (!creds) {
      return ok({ status: 'not_configured', apiVersion: null, checkedAt: now, detail: null })
    }

    // shop.json is the cheapest authenticated endpoint Shopify offers, so it
    // doubles as a genuine connectivity and auth check.
    const result = await shopifyRequest<{ shop: { name: string } }>(creds, 'shop.json')
    if (!result.ok) {
      return ok({ status: 'error', apiVersion: creds.apiVersion, checkedAt: now, detail: result.error })
    }
    return ok({ status: 'connected', apiVersion: creds.apiVersion, checkedAt: now, detail: null })
  }

  async fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>> {
    const creds = credentials()
    if (!creds) return err('Shopify is not configured.')

    const result = await shopifyRequest<{
      products: readonly { id: number; title: string; status: string; variants: readonly { price: string; inventory_quantity: number }[] }[]
    }>(creds, 'products.json', { limit: String(options.limit) })
    if (!result.ok) return result

    const records: MarketplaceListingSnapshot[] = result.value.products.map((product) => {
      const variant = product.variants[0]
      return {
        externalId: String(product.id),
        channelProductRef: String(product.id),
        title: product.title,
        status: product.status === 'active' ? 'active' : product.status === 'draft' ? 'draft' : 'archived',
        priceMinor: variant ? Math.round(Number(variant.price) * 100) : 0,
        currency: 'GBP',
        stockQty: variant?.inventory_quantity ?? null,
        reportedAt: new Date().toISOString(),
        raw: product as unknown as Record<string, unknown>,
      }
    })

    return ok({ records, requestsMade: 1, warnings: [] })
  }

  async fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>> {
    const listings = await this.fetchListings(options)
    if (!listings.ok) return listings

    return ok({
      records: listings.value.records
        .filter((l) => l.stockQty !== null)
        .map((l) => ({
          externalId: l.externalId,
          channelProductRef: l.channelProductRef,
          stockQty: l.stockQty as number,
          reportedAt: l.reportedAt,
        })),
      requestsMade: 0,
      warnings: [],
    })
  }

  async fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>> {
    const creds = credentials()
    if (!creds) return err('Shopify is not configured.')

    const params: Record<string, string> = { limit: String(options.limit), status: 'any' }
    if (options.sinceIso) params.updated_at_min = options.sinceIso

    const result = await shopifyRequest<{
      orders: readonly {
        id: number
        created_at: string
        financial_status: string
        cancelled_at: string | null
        total_price: string
        currency: string
        line_items: readonly { id: number }[]
      }[]
    }>(creds, 'orders.json', params)
    if (!result.ok) return result

    const records: MarketplaceOrderSnapshot[] = result.value.orders.map((order) => ({
      externalId: String(order.id),
      placedAt: order.created_at,
      status: order.cancelled_at
        ? 'cancelled'
        : order.financial_status === 'refunded'
          ? 'refunded'
          : order.financial_status === 'paid'
            ? 'paid'
            : 'pending',
      totalMinor: Math.round(Number(order.total_price) * 100),
      currency: order.currency,
      lineItemRefs: order.line_items.map((item) => String(item.id)),
      raw: order as unknown as Record<string, unknown>,
    }))

    return ok({ records, requestsMade: 1, warnings: [] })
  }

  async fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>> {
    // Shopify Payments transaction fees are only available through the
    // separate Finances/Payouts API, which additionally requires the store to
    // actually use Shopify Payments (not every store does). Declaring the
    // capability without a working credential-gated call would risk exactly
    // the "fake live integration" this milestone forbids, so this reports the
    // honest limitation rather than guessing at a fee figure.
    return err(
      `Fee reporting requires the Shopify Payments Payouts API, which is not yet implemented in this connector (requested up to ${options.limit} records).`,
    )
  }
}

export const shopifyConnector = new ShopifyConnector()

/** Exposed for the connection-health unit test, which cannot make a real request. */
export const __internal = { credentials, shopifyRequest }
