import { err, ok, type Result } from '@/lib/core/result'
import type {
  ConnectionHealth,
  CreateListingInput,
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
 * The real Shopify Admin API connector (Milestone Shopify-Read-Only).
 *
 * MIGRATION FROM REST + STATIC TOKEN: this connector previously used the
 * REST Admin API with a static "custom app" access token generated once
 * from Settings → Apps → Develop apps. Both are now obsolete, confirmed
 * against Shopify's current developer documentation (developer.ebay.com-style
 * bot-blocking meant WebSearch summaries were used, cross-checked across
 * multiple independent sources — the same discipline the eBay connector's
 * own doc-verification pass used):
 *   - The entire REST Admin API was deprecated 2024-10-01; critical
 *     product/variant endpoints (exactly what this connector called) began
 *     failing for new setups from 2025-02-01, with annual sunset waves
 *     continuing through 2026. New organisations can only use the GraphQL
 *     Admin API for custom apps as of 2025-04-01.
 *   - Static custom-app tokens were removed from the Shopify admin UI as
 *     of 2026-01-01 — "Develop apps" no longer issues one. There is no
 *     `SHOPIFY_ADMIN_ACCESS_TOKEN` to obtain for a new setup.
 * This connector now uses the GraphQL Admin API exclusively, authenticated
 * via the client credentials grant — the documented flow for a server-side
 * app acting on stores in your own Shopify organisation (never usable for
 * another merchant's store, which is exactly this connector's use case: it
 * only ever reads/writes our own store). This mirrors the exact shape
 * `amazonAds.ts`/`ebay.ts` already use for their own OAuth exchanges in
 * this codebase — a client_id/client_secret pair exchanged for a
 * short-lived access token, never a long-lived static one, never cached
 * across calls (the same known, shared, deliberate inefficiency those two
 * connectors already carry, not a new one).
 *
 * READ-ONLY: `capabilities.writeListings`/`syncInventory` (write half)/
 * `updateFulfilment`/`processRefunds` are all honestly `false` — every
 * write method below returns `not_supported` unconditionally, never even
 * attempting a request. (`verifyWrites` is `true`, but verification is a
 * read: see the descriptor's own note.) This is a structural
 * gate, not a convention: `automation/priceExecution.ts` checks
 * `capabilities.writeListings` before ever calling `updateListingPrice`,
 * so a real Shopify write cannot be reached through the existing
 * execution pipeline while this flag is false, regardless of what a
 * caller might otherwise attempt.
 *
 * IMPLEMENTED BUT NOT LIVE-VERIFIED: every GraphQL query below is written
 * against Shopify's current published GraphQL Admin API reference and has
 * never been run against a real store — no store credentials exist in
 * this environment. Every request is gated behind `isConfigured()`; without
 * `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` and
 * `SHOPIFY_API_VERSION` this class makes no network call of any kind.
 *
 * UNVERIFIED API SURFACE — read before ever pointing this at a real store:
 *   - Field names (`ProductStatus`'s `ACTIVE`/`ARCHIVED`/`DRAFT` enum
 *     values, `OrderDisplayFinancialStatus`/`OrderDisplayFulfillmentStatus`
 *     enum values, `InventoryLevel.quantities(names: ["available"])`) are a
 *     best-effort reconstruction from Shopify's current documentation, not
 *     confirmed against a live response.
 *   - GraphQL object identifiers (`Product.id`, `Order.id`, `LineItem.id`)
 *     are full GIDs (e.g. `gid://shopify/Product/123`), not bare numeric
 *     REST ids. This connector stores the GID as `externalId` directly —
 *     a deliberate choice, not an oversight: no real Shopify data has ever
 *     been synced by this codebase, so there is no legacy numeric-id data
 *     to stay compatible with, and the GID is what any future GraphQL
 *     mutation would need directly anyway.
 */

const DESCRIPTOR: MarketplaceConnectorDescriptor = {
  key: 'shopify',
  label: 'Shopify',
  description: 'Our own Shopify store, via the official GraphQL Admin API using a client-credentials access token.',
  channel: 'shopify',
  capabilities: {
    readListings: true,
    writeListings: false, // Disabled this phase (SHOPIFY_READ_ONLY) — see module comment.
    syncInventory: true, // Read-inventory: this codebase's shared MarketplaceCapabilities has one inventory flag, not a read/write split — `updateInventory` below is unconditionally `not_supported`, so this flag never implies a write capability in practice.
    ingestOrders: true,
    updateFulfilment: false, // Fulfilment tracking WRITE disabled this phase — read-side fulfilment status still flows into fetchOrders()'s own status mapping below.
    processRefunds: false,
    readFees: false, // Fee reporting requires the separate Shopify Payments Payouts API, not implemented here — matches fetchFees()'s own honest error.
    webhooks: false,
    // Milestone: production autonomy proof. Genuinely implemented AND
    // live-verified: `verifyListingState` below runs a real single-product
    // GraphQL read that was executed against the connected store
    // (informax-pdy9ltd9.myshopify.com) and returned a real product with
    // its status, price, currency and inventory. Verification is a READ,
    // needing only `read_products`, which Shopify's own token response
    // confirms is granted — so unlike every write flag here, this one does
    // not depend on a scope the app does not hold.
    //
    // Enables no write. Every write path is gated on `writeListings` or
    // `createListings` (both false) BEFORE verification is ever reached;
    // all this changes is that the execution reaper and the
    // SUBMIT -> VERIFY -> RECONCILE pipeline can now genuinely confirm a
    // listing's state instead of recording "cannot verify" as a failed
    // verification.
    verifyWrites: true,
    // Milestone: controlled Shopify publication (Phase 6). Confirmed by
    // inspection: this app's configured OAuth scopes are read_products/
    // read_orders/read_inventory/read_fulfillments only — write_products
    // was never requested. Even with real credentials, product creation
    // would be rejected by Shopify's own API until that scope is added
    // in the Dev Dashboard and the app is reinstalled — a configuration
    // step outside this codebase, not something a code change can grant.
    createListings: false,
  },
  requiredCredentials: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_API_VERSION'],
  // The GraphQL Admin API is cost-based (a points bucket, not a flat
  // requests/second limit like REST was) — `MarketplaceRateLimit`'s shape
  // predates this connector's GraphQL migration and cannot represent a
  // cost bucket exactly. `requestsPerMinute` is a conservative estimate
  // for the small, bounded queries this connector issues, not a literal
  // translation of Shopify's own limit.
  rateLimit: { requestsPerMinute: 20, requestsPerDay: null, minSecondsBetweenRuns: 0 },
  usagePolicy: {
    termsUrl: 'https://www.shopify.com/legal/api-terms',
    permittedUseNote: 'Reads only our own store, using a client-credentials token we generated ourselves via the Dev Dashboard.',
    authenticatedFirstParty: true,
  },
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * `SHOPIFY_STORE_DOMAIN` is documented as the bare hostname
 * (`your-store.myshopify.com`), but a scheme-prefixed value
 * (`https://your-store.myshopify.com`, with or without a trailing slash)
 * is an extremely easy, common mistake — pasting the store's URL from a
 * browser address bar rather than just the domain. Normalised here rather
 * than left to fail: this connector always builds its own `https://`
 * prefix (`https://${storeDomain}/...`), so a doubled scheme would
 * otherwise resolve DNS for the literal hostname "https" and fail with a
 * confusing `ENOTFOUND` — found and diagnosed via a real live-verification
 * run, not a hypothetical.
 *
 * A second live-verification run (after the domain was hand-corrected)
 * found the prefix can also appear *repeated* — e.g.
 * `https://https:https:https://your-store.myshopify.com`, an accumulation
 * artifact from more than one manual edit — which a single-occurrence
 * strip leaves partially intact. The scheme-strip below therefore repeats
 * until no leading `http(s):` (with or without following slashes) remains,
 * rather than stripping only once. A bare hostname is never altered.
 */
function normalizeStoreDomain(value: string): string {
  return value.replace(/^(?:https?:\/*)+/i, '').replace(/\/+$/, '')
}

interface ShopifyCredentials {
  storeDomain: string
  clientId: string
  clientSecret: string
  apiVersion: string
}

function credentials(): ShopifyCredentials | null {
  const rawStoreDomain = readEnv('SHOPIFY_STORE_DOMAIN')
  const clientId = readEnv('SHOPIFY_CLIENT_ID')
  const clientSecret = readEnv('SHOPIFY_CLIENT_SECRET')
  const apiVersion = readEnv('SHOPIFY_API_VERSION')
  if (!rawStoreDomain || !clientId || !clientSecret || !apiVersion) return null
  return { storeDomain: normalizeStoreDomain(rawStoreDomain), clientId, clientSecret, apiVersion }
}

/**
 * The client credentials grant (documented for a server-side app acting on
 * stores in your own Shopify organisation): `POST /admin/oauth/access_token`
 * with `grant_type=client_credentials`, `client_id`, `client_secret` as a
 * form body. Returns `access_token` (always expires in 86399s / 24h) and
 * the granted `scope`. Never cached across calls — see module comment.
 */
interface ShopifyAccessToken {
  accessToken: string
  /** The real, comma-separated scope string Shopify's own token response returned — not a secret, an OAuth permission grant. `null` only if Shopify's response genuinely omitted it. */
  scope: string | null
}

async function getAccessToken(creds: ShopifyCredentials): Promise<Result<ShopifyAccessToken, string>> {
  try {
    const response = await fetch(`https://${creds.storeDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    })
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      return err(`Shopify token exchange failed: ${response.status} ${response.statusText}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ''}`)
    }
    const body = (await response.json()) as { access_token?: string; scope?: string }
    if (!body.access_token) return err('Shopify token exchange returned no access token.')
    return ok({ accessToken: body.access_token, scope: body.scope ?? null })
  } catch (error) {
    return err(`Shopify token exchange threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface ShopifyGraphqlError {
  message: string
  extensions?: { code?: string }
}

interface ShopifyGraphqlEnvelope<T> {
  data?: T
  errors?: readonly ShopifyGraphqlError[]
}

/**
 * The GraphQL request layer replacing the old REST `shopifyRequest` helper.
 * Every distinct failure mode is handled and labelled honestly, never
 * folded into "it worked" — Shopify's own GraphQL API can return a 200
 * with a populated `errors` array (including a genuine `Throttled` error
 * inside a 200, not only via HTTP 429), so a successful HTTP status alone
 * is never treated as success here.
 */
async function graphqlRequest<T>(creds: ShopifyCredentials, query: string, variables?: Record<string, unknown>): Promise<Result<{ data: T; scope: string | null }, string>> {
  const tokenResult = await getAccessToken(creds)
  if (!tokenResult.ok) return tokenResult

  let response: Response
  try {
    response = await fetch(`https://${creds.storeDomain}/admin/api/${creds.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': tokenResult.value.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (error) {
    return err(`Shopify GraphQL request failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Authentication failure: the access token itself was rejected outright.
  if (response.status === 401 || response.status === 403) {
    return err(`Shopify authentication failed: ${response.status} ${response.statusText} — the access token was rejected.`)
  }
  // Throttling can also arrive as a plain HTTP 429, distinct from the
  // in-body `Throttled` GraphQL error handled below.
  if (response.status === 429) {
    return err('Shopify GraphQL request was throttled (HTTP 429) — query cost exceeded the available bucket. Retry later, never immediately.')
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    return err(`Shopify GraphQL returned ${response.status} ${response.statusText}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ''}`)
  }

  let envelope: ShopifyGraphqlEnvelope<T>
  try {
    const rawText = await response.text()
    if (rawText.length === 0) return err('Shopify GraphQL returned an empty response body.')
    envelope = JSON.parse(rawText) as ShopifyGraphqlEnvelope<T>
  } catch {
    return err('Shopify GraphQL returned a malformed (non-JSON) response.')
  }

  if (envelope.errors && envelope.errors.length > 0) {
    // A response can carry `data` alongside `errors` (Shopify's GraphQL API
    // supports partial, per-field errors) — treated conservatively: any
    // error present fails the whole call, never trusting a partially
    // degraded `data` object as if it were complete. This is the one
    // place "never convert an API error into valid-looking data" is most
    // directly at stake.
    const throttled = envelope.errors.some((e) => e.message === 'Throttled' || e.extensions?.code === 'THROTTLED')
    const detail = envelope.errors.map((e) => e.message).join('; ')
    return err(throttled ? `Shopify GraphQL request was throttled — ${detail}` : `Shopify GraphQL returned application-level error(s): ${detail}`)
  }

  if (envelope.data === undefined || envelope.data === null) {
    return err('Shopify GraphQL returned no data and no errors — an empty response.')
  }

  return ok({ data: envelope.data, scope: tokenResult.value.scope })
}

const SHOP_QUERY = `query { shop { name } }`
interface ShopQueryResult {
  shop: { name: string }
}

const PRODUCTS_QUERY = `
  query($first: Int!) {
    shop { currencyCode }
    products(first: $first) {
      edges {
        node {
          id
          title
          status
          variants(first: 1) {
            edges { node { id price inventoryQuantity } }
          }
        }
      }
    }
  }
`
interface ProductsQueryResult {
  shop: { currencyCode: string }
  products: {
    edges: readonly {
      node: {
        id: string
        title: string
        status: string
        variants: { edges: readonly { node: { id: string; price: string; inventoryQuantity: number | null } }[] }
      }
    }[]
  }
}

/**
 * Single-product read for write verification (Milestone: production
 * autonomy proof). Deliberately requests the exact same fields as
 * `PRODUCTS_QUERY` above so both go through the identical `mapListing`
 * mapper — a verification that mapped status or price even slightly
 * differently from the listing read would be able to disagree with itself.
 *
 * Needs only `read_products`, which this app is genuinely granted (verified
 * against Shopify's own token response, not assumed from configuration), so
 * this is implementable and testable today even though `write_products` is
 * not granted and no write is possible.
 */
const PRODUCT_BY_ID_QUERY = `
  query($id: ID!) {
    shop { currencyCode }
    product(id: $id) {
      id
      title
      status
      variants(first: 1) {
        edges { node { id price inventoryQuantity } }
      }
    }
  }
`
interface ProductByIdQueryResult {
  shop: { currencyCode: string }
  product: ProductsQueryResult['products']['edges'][number]['node'] | null
}

const PRODUCT_STATUS_MAP: Record<string, MarketplaceListingSnapshot['status']> = {
  ACTIVE: 'active',
  DRAFT: 'draft',
  ARCHIVED: 'archived',
}

/**
 * `currency` used to be a hardcoded `'GBP'` literal rather than a real
 * Shopify value — found via a live-verification run against a real
 * product: it happened to match this store's actual currency by
 * coincidence, not because it was ever actually read from the API. A
 * product's price has no currency of its own in Shopify's model (only the
 * shop does), so it is threaded through from the same request's `shop`
 * field rather than queried per-product.
 */
function mapListing(node: ProductsQueryResult['products']['edges'][number]['node'], currency: string): MarketplaceListingSnapshot {
  const variant = node.variants.edges[0]?.node
  return {
    externalId: node.id,
    channelProductRef: node.id,
    title: node.title,
    status: PRODUCT_STATUS_MAP[node.status] ?? 'archived',
    priceMinor: variant ? Math.round(Number(variant.price) * 100) : 0,
    currency,
    stockQty: variant?.inventoryQuantity ?? null,
    reportedAt: new Date().toISOString(),
    raw: node as unknown as Record<string, unknown>,
  }
}

// Current GraphQL inventory model — `InventoryItem`/`InventoryLevel` with a
// named `quantities` list, replacing the old flat REST `inventory_quantity`
// field this connector used to read directly off the variant. Deliberately
// a separate query from PRODUCTS_QUERY (never derived from the listings
// read, unlike the old REST-era `fetchInventory` which reused
// `fetchListings`'s own output) — per-location granularity has no
// equivalent in the listings query at all. Bounded to a small number of
// locations per variant; summed across whatever is returned for a genuine
// total, not just the first location.
const INVENTORY_QUERY = `
  query($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          variants(first: 1) {
            edges {
              node {
                inventoryItem {
                  inventoryLevels(first: 5) {
                    edges { node { quantities(names: ["available"]) { name quantity } } }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`
interface InventoryQueryResult {
  products: {
    edges: readonly {
      node: {
        id: string
        variants: {
          edges: readonly {
            node: {
              inventoryItem: {
                inventoryLevels: { edges: readonly { node: { quantities: readonly { name: string; quantity: number }[] } }[] }
              } | null
            }
          }[]
        }
      }
    }[]
  }
}

const ORDERS_QUERY = `
  query($first: Int!, $query: String) {
    orders(first: $first, query: $query) {
      edges {
        node {
          id
          createdAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 50) {
            edges { node { id sku quantity originalUnitPriceSet { shopMoney { amount } } } }
          }
        }
      }
    }
  }
`
interface OrdersQueryResult {
  orders: {
    edges: readonly {
      node: {
        id: string
        createdAt: string
        cancelledAt: string | null
        displayFinancialStatus: string | null
        displayFulfillmentStatus: string | null
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
        lineItems: {
          edges: readonly { node: { id: string; sku: string | null; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } } } }[]
        }
      }
    }[]
  }
}

/**
 * Phase mapping (Milestone Shopify-Read-Only) — precise, documented, never
 * a guess. Priority order: a cancelled order is always `cancelled`
 * regardless of financial/fulfilment status; a refunded order is always
 * `refunded`; only then does fulfilment status promote an order to
 * `fulfilled`; otherwise financial status decides `paid` vs `pending`.
 * This is the read-side fulfilment mapping the existing
 * `MarketplaceConnector` interface actually has room for — there is no
 * separate fetch-fulfilment method on the interface, only the order
 * snapshot's own `status` field, so `displayFulfillmentStatus` feeds into
 * it here rather than being silently dropped.
 */
function mapOrderStatus(node: OrdersQueryResult['orders']['edges'][number]['node']): MarketplaceOrderSnapshot['status'] {
  if (node.cancelledAt) return 'cancelled'
  if (node.displayFinancialStatus === 'REFUNDED' || node.displayFinancialStatus === 'PARTIALLY_REFUNDED') return 'refunded'
  if (node.displayFulfillmentStatus === 'FULFILLED') return 'fulfilled'
  if (node.displayFinancialStatus === 'PAID') return 'paid'
  return 'pending'
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
      return ok({ status: 'not_configured', apiVersion: null, checkedAt: now, detail: null, grantedScope: null })
    }

    // The cheapest authenticated query Shopify's GraphQL API offers — the
    // GraphQL equivalent of the old REST connectivity check.
    const result = await graphqlRequest<ShopQueryResult>(creds, SHOP_QUERY)
    if (!result.ok) {
      return ok({ status: 'error', apiVersion: creds.apiVersion, checkedAt: now, detail: result.error, grantedScope: null })
    }
    return ok({ status: 'connected', apiVersion: creds.apiVersion, checkedAt: now, detail: null, grantedScope: result.value.scope })
  }

  async fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>> {
    const creds = credentials()
    if (!creds) return err('Shopify is not configured.')

    const result = await graphqlRequest<ProductsQueryResult>(creds, PRODUCTS_QUERY, { first: options.limit })
    if (!result.ok) return result

    const currency = result.value.data.shop.currencyCode
    const records = result.value.data.products.edges.map((edge) => mapListing(edge.node, currency))
    return ok({ records, requestsMade: 1, warnings: [] })
  }

  async fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>> {
    const creds = credentials()
    if (!creds) return err('Shopify is not configured.')

    const result = await graphqlRequest<InventoryQueryResult>(creds, INVENTORY_QUERY, { first: options.limit })
    if (!result.ok) return result

    const records: MarketplaceInventorySnapshot[] = result.value.data.products.edges.map((edge) => {
      const variant = edge.node.variants.edges[0]?.node
      const levels = variant?.inventoryItem?.inventoryLevels.edges ?? []
      const stockQty = levels.reduce((sum, level) => {
        const available = level.node.quantities.find((q) => q.name === 'available')
        return sum + (available?.quantity ?? 0)
      }, 0)
      return {
        externalId: edge.node.id,
        channelProductRef: edge.node.id,
        stockQty,
        reportedAt: new Date().toISOString(),
      }
    })

    return ok({ records, requestsMade: 1, warnings: [] })
  }

  async fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>> {
    const creds = credentials()
    if (!creds) return err('Shopify is not configured.')

    // Same search-syntax filter string the old REST `updated_at_min` param
    // used, now passed as GraphQL's `query` argument — confirmed as the
    // documented filtering mechanism for the `orders` connection.
    const searchQuery = options.sinceIso ? `updated_at:>=${options.sinceIso}` : undefined
    const result = await graphqlRequest<OrdersQueryResult>(creds, ORDERS_QUERY, { first: options.limit, query: searchQuery })
    if (!result.ok) return result

    const records: MarketplaceOrderSnapshot[] = result.value.data.orders.edges.map((edge) => {
      const node = edge.node
      return {
        externalId: node.id,
        placedAt: node.createdAt,
        status: mapOrderStatus(node),
        totalMinor: Math.round(Number(node.totalPriceSet.shopMoney.amount) * 100),
        currency: node.totalPriceSet.shopMoney.currencyCode,
        // Only id/sku/quantity/unit price are kept — Shopify's GraphQL line
        // item carries buyer-adjacent fields (custom attributes, discount
        // allocations) this connector has no use for and does not request,
        // per the "do not request unnecessary customer PII" instruction.
        // `sku` reads null, never invented, when Shopify itself has none set
        // on the variant.
        lineItems: node.lineItems.edges.map((li) => ({
          externalId: li.node.id,
          sku: li.node.sku,
          quantity: li.node.quantity,
          unitPriceMinor: Math.round(Number(li.node.originalUnitPriceSet.shopMoney.amount) * 100),
        })),
        raw: node as unknown as Record<string, unknown>,
      }
    })

    return ok({ records, requestsMade: 1, warnings: [] })
  }

  async fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>> {
    // Shopify Payments transaction fees require the separate Finances API,
    // which additionally requires the store to actually use Shopify
    // Payments (not every store does). Matches `capabilities.readFees: false`.
    return err(
      `Fee reporting requires the Shopify Payments Finances API, which is not implemented in this connector (requested up to ${options.limit} records).`,
    )
  }

  /**
   * Fulfilment WRITE (tracking push) is disabled this phase —
   * `capabilities.updateFulfilment: false`. Read-side fulfilment status is
   * still available through `fetchOrders()`'s own status mapping above.
   */
  async submitFulfilmentUpdate(update: FulfilmentUpdateInput): Promise<Result<FulfilmentUpdateOutcome, string>> {
    return err(
      `Shopify fulfilment writes are disabled for this phase (SHOPIFY_READ_ONLY) — capabilities.updateFulfilment is false. Requested for order ${update.externalOrderId}.`,
    )
  }

  /** Disabled this phase — capabilities.writeListings is false, so no capability-gated caller reaches this, but it is implemented honestly rather than omitted, matching every other connector in this codebase. */
  async updateListingPrice(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Shopify price writes are disabled for this phase (SHOPIFY_READ_ONLY).' })
  }

  async updateInventory(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Shopify inventory writes are disabled for this phase (SHOPIFY_READ_ONLY).' })
  }

  async setListingStatus(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Shopify listing-status writes are disabled for this phase (SHOPIFY_READ_ONLY).' })
  }

  /**
   * Reads one product back from Shopify so a write can be confirmed against
   * the marketplace's own reported state rather than against the write
   * call's acknowledgement.
   *
   * A `product` that resolves to `null` is a real, distinct answer — the
   * listing does not exist (or is not visible to this app) — and is
   * returned as an error rather than as an empty snapshot, so a caller can
   * never read "nothing there" as "there and correct". Callers treat any
   * error here as `uncertain`/failed verification, never as success.
   */
  async verifyListingState(externalId: string): Promise<Result<MarketplaceListingSnapshot, string>> {
    const creds = credentials()
    if (!creds) return err('Shopify is not configured.')

    const result = await graphqlRequest<ProductByIdQueryResult>(creds, PRODUCT_BY_ID_QUERY, { id: externalId })
    if (!result.ok) return result

    const node = result.value.data.product
    if (!node) return err(`Shopify returned no product for "${externalId}" — it does not exist, or this app cannot see it.`)

    return ok(mapListing(node, result.value.data.shop.currencyCode))
  }

  /**
   * A real `productCreate` mutation against Shopify's current documented
   * GraphQL Admin API — written and structured exactly like every read
   * query in this file, but genuinely never reachable in this environment:
   * `capabilities.createListings` is `false` (see the descriptor above),
   * and the JSDoc on this method's interface already establishes that a
   * capability-gated method must never be called at all when its flag is
   * false, so no caller in this codebase invokes this. IMPLEMENTED, NOT
   * LIVE-VERIFIED — the mutation shape has never been run against a real
   * store, and could not be even with credentials, since the configured
   * OAuth scope does not include `write_products`.
   */
  async createListing(input: CreateListingInput): Promise<Result<CreateListingOutcome, WriteFailure>> {
    const creds = credentials()
    if (!creds) return err({ reason: 'not_configured', detail: 'Shopify Admin API credentials are not configured.' })

    const variants = input.variants.length > 0 ? input.variants : [{ sku: null, priceMinor: input.compareAtPriceMinor ?? 0, options: [], weightGrams: null }]

    const mutation = `
      mutation ProductCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            handle
            onlineStoreUrl
          }
          userErrors { field message }
        }
      }
    `

    const variables = {
      input: {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        productType: input.productType ?? undefined,
        vendor: input.vendor ?? undefined,
        tags: input.tags,
        status: 'DRAFT',
        seo: input.seoTitle || input.seoDescription ? { title: input.seoTitle ?? undefined, description: input.seoDescription ?? undefined } : undefined,
        images: input.images.map((i) => ({ src: i.url, altText: i.altText ?? undefined })),
        variants: variants.map((v) => ({
          sku: v.sku ?? undefined,
          price: (v.priceMinor / 100).toFixed(2),
          compareAtPrice: input.compareAtPriceMinor !== null ? (input.compareAtPriceMinor / 100).toFixed(2) : undefined,
          weight: v.weightGrams ?? undefined,
          weightUnit: v.weightGrams !== null ? 'GRAMS' : undefined,
          options: v.options.map((o) => o.value),
        })),
        options: variants[0]?.options.map((o) => o.name) ?? undefined,
      },
    }

    const result = await graphqlRequest<{
      productCreate: { product: { id: string; handle: string; onlineStoreUrl: string | null } | null; userErrors: readonly { field: readonly string[]; message: string }[] }
    }>(creds, mutation, variables)

    if (!result.ok) return err({ reason: 'rejected', detail: result.error })

    const { product, userErrors } = result.value.data.productCreate
    if (userErrors.length > 0) {
      return err({ reason: 'rejected', detail: `Shopify rejected the product: ${userErrors.map((e) => e.message).join('; ')}` })
    }
    if (!product) return err({ reason: 'rejected', detail: 'Shopify returned no product and no error — treated as a rejection, never assumed successful.' })

    return ok({
      accepted: true,
      externalId: product.id,
      externalHandle: product.handle,
      adminUrl: `https://${creds.storeDomain}/admin/products/${product.id.split('/').pop()}`,
    })
  }
}

export const shopifyConnector = new ShopifyConnector()

/** Exposed for unit tests that cannot make real network or OAuth calls. */
export const __internal = { credentials, getAccessToken, graphqlRequest, mapListing, mapOrderStatus, normalizeStoreDomain }
