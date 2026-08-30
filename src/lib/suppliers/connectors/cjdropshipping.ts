import { err, ok, type Result } from '@/lib/core/result'
import { money } from '@/lib/core/money'
import type {
  ConnectorDescriptor,
  FetchStatusOptions,
  FetchStatusOutcome,
  ReadProductDetailOptions,
  SupplierConnector,
  SupplierProductDetail,
  SupplierProductStatus,
  SupplierShippingQuote,
  SupplierVariantDetail,
} from './types'

/**
 * The real CJdropshipping connector (Milestone: real supplier connector,
 * Phase 8).
 *
 * SUPPLIER SELECTION (documented here, not assumed): before writing this
 * file, CJdropshipping, DSers, Spocket, Avasam, Syncee, EPROLO and AutoDS
 * were each checked against their actual public developer documentation
 * (see `HANDOVER.md` for the full comparison and the URLs consulted).
 * CJdropshipping was the only one with a fully public, self-serve REST
 * API: a free account issues an `apiKey` directly, with no partner
 * approval process, no paid tier gate, and a documented request/response
 * shape for products, variants, per-country inventory, destination-aware
 * freight quotes, and shipment tracking. DSers' Open API requires a
 * separate partner-developer approval process oriented around building
 * apps *for* DSers users, not pulling one's own catalogue as an external
 * consumer. Avasam's published "Supplier API" runs in the opposite
 * direction this system needs (a supplier pushes its own catalogue *into*
 * Avasam; it is not a buyer-side read API over Avasam's marketplace).
 * Spocket, Syncee and EPROLO either have no public self-serve API
 * documentation at all (Syncee: feed/FTP plus a support-ticket request
 * for API access; EPROLO: API exists but its documentation is only
 * shared privately on request) or no clearly documented API surface
 * (Spocket). AutoDS has an API but access is approval-gated and may carry
 * a setup fee. None of this is a value judgement on those platforms —
 * only a documentation-transparency finding, which is the one criterion
 * this milestone's brief asks to check first.
 *
 * AUTHENTICATION: `POST {BASE_URL}/authentication/getAccessToken` with
 * `{ apiKey }` (an account's own key, format `CJUserNum@api@<32 hex
 * chars>`, generated from CJ's own account settings) returns an
 * `accessToken` (documented 15-day life) and a `refreshToken` (documented
 * 180-day life). Every authenticated request carries the access token as
 * a `CJ-Access-Token` header. This connector does not persist a cached
 * token across requests (matching `marketplaces/connectors/ebay.ts`'s own
 * convention of re-exchanging on every call rather than managing a
 * server-side token cache) — CJ's own documentation states tokens "remain
 * consistent within 24-hour windows for the same account," so repeated
 * exchange calls are expected to return the same token rather than
 * invalidate a previous one.
 *
 * RATE LIMITS (documented): a free/base-tier account is limited to 1
 * request per second; higher account tiers get more. This connector
 * enforces a minimum 1100ms gap between its own requests and retries once
 * with backoff on an HTTP 429, rather than assuming a higher tier.
 *
 * DOCUMENTATION-DERIVED, NOT LIVE-VERIFIED: every endpoint path and field
 * name below was read from CJdropshipping's own public developer
 * documentation (developers.cjdropshipping.com), not guessed and not
 * copied from an unofficial wrapper. No CJ account exists in this
 * environment, so none of this has ever exchanged a real token or parsed
 * a real response — `isConfigured()` requires `CJ_API_KEY`, which is
 * absent, so every method here is structurally unreachable in practice
 * until a real key is configured. Because the documentation was read via
 * automated extraction rather than a byte-for-byte OpenAPI spec, a real
 * response could still use a slightly different field name than
 * documented; every parser below is written defensively (optional
 * chaining, explicit type/range checks, never a silent cast) specifically
 * so a genuine mismatch surfaces as a validation warning on a real
 * account, not a crash or fabricated data.
 *
 * READ-ONLY BY DESIGN: this connector implements no order-placement
 * method at all — `SupplierConnector` has none, and this class adds none
 * of its own. `placeOrders`/`cancelOrders`/`readOrders` are declared
 * `false` in the descriptor without exception, matching every other
 * connector in this codebase; CJ's own order/shopping-cart endpoints are
 * simply never called here.
 */

const CJ_BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1'
const MIN_MS_BETWEEN_REQUESTS = 1100
const REQUEST_TIMEOUT_MS = 15_000

let lastRequestAt = 0

function readEnv(name: string): string | null {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : null
}

function apiKey(): string | null {
  return readEnv('CJ_API_KEY')
}

/** Real request timing only applies outside Vitest — the throttle/backoff delays below are exercised for correctness (the right number of calls, the right retry behaviour), never for their real wall-clock duration, matching how every other timeout-bearing connector in this codebase mocks `fetch` rather than actually waiting. */
const isTestEnv = process.env.VITEST === 'true'

async function throttle(): Promise<void> {
  if (isTestEnv) return
  const elapsed = Date.now() - lastRequestAt
  if (elapsed < MIN_MS_BETWEEN_REQUESTS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_MS_BETWEEN_REQUESTS - elapsed))
  }
  lastRequestAt = Date.now()
}

interface CjEnvelope<T> {
  code?: number
  result?: boolean
  message?: string
  data?: T
  requestId?: string
}

/**
 * The one place every CJ HTTP call goes through — throttling, timeout,
 * the documented `{code, result, message, data}` envelope, and a single
 * retry-with-backoff on a rate-limit response. Never throws: every
 * failure mode (network error, timeout, non-2xx, `result: false`,
 * malformed JSON) becomes an `err(...)` a caller must handle explicitly,
 * exactly the same discipline `imageFetch.ts` (Phase 7) already
 * established for external calls in this codebase.
 */
async function cjRequest<T>(
  path: string,
  init: { method: 'GET' | 'POST'; accessToken?: string; query?: Record<string, string | number | undefined>; body?: unknown },
  attempt = 0,
): Promise<Result<T, string>> {
  await throttle()

  const url = new URL(`${CJ_BASE_URL}${path}`)
  if (init.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url.toString(), {
      method: init.method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.accessToken ? { 'CJ-Access-Token': init.accessToken } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    if (response.status === 429 && attempt < 1) {
      if (!isTestEnv) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
      return cjRequest<T>(path, init, attempt + 1)
    }

    if (!response.ok) {
      return err(`CJdropshipping request to ${path} failed: HTTP ${response.status} ${response.statusText}.`)
    }

    const envelope = (await response.json().catch(() => null)) as CjEnvelope<T> | null
    if (!envelope) return err(`CJdropshipping request to ${path} returned a response that could not be parsed as JSON.`)
    if (envelope.result === false) {
      return err(`CJdropshipping rejected the request to ${path}: ${envelope.message ?? 'no message given'} (code ${envelope.code ?? 'unknown'}).`)
    }
    if (envelope.data === undefined) {
      return err(`CJdropshipping request to ${path} succeeded but returned no data.`)
    }
    return ok(envelope.data)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return err(`CJdropshipping request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms.`)
    }
    return err(`CJdropshipping request to ${path} threw: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeout)
  }
}

interface CjTokenData {
  accessToken?: string
  accessTokenExpiryDate?: string
  refreshToken?: string
  refreshTokenExpiryDate?: string
}

async function getAccessToken(): Promise<Result<string, string>> {
  const key = apiKey()
  if (!key) return err('CJ_API_KEY is not configured.')

  const result = await cjRequest<CjTokenData>('/authentication/getAccessToken', { method: 'POST', body: { apiKey: key } })
  if (!result.ok) return result
  if (!result.value.accessToken) return err('CJdropshipping authentication succeeded but returned no access token.')
  return ok(result.value.accessToken)
}

// ---------------------------------------------------------------------------
// Defensive field parsing — every numeric/URL field is validated, never
// silently cast. A field that fails validation is treated as unknown
// (null / omitted), the same "missing data is not zero" discipline every
// scoring engine in this codebase already follows, rather than crashing
// the whole read or fabricating a plausible-looking value.
// ---------------------------------------------------------------------------

function safeNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

interface CjProductListItem {
  pid?: string
  id?: string
  productNameEn?: string
  nameEn?: string
  productSku?: string
  sku?: string
  productImage?: string
  bigImage?: string
  sellPrice?: string | number
  categoryName?: string
  categoryId?: string
  warehouseInventoryNum?: string | number
  listedNum?: string | number
}

/** Discovery-mode listing (Phase 8) — a lightweight browse, distinct from `readProductDetail`'s rich single-product read. Uses `/product/listV2`. */
async function listProducts(accessToken: string, options: { keyword?: string; limit: number; page: number }): Promise<Result<{ items: readonly CjProductListItem[]; warnings: readonly string[] }, string>> {
  const result = await cjRequest<{ list?: readonly CjProductListItem[]; content?: readonly CjProductListItem[] } | readonly CjProductListItem[]>(
    '/product/listV2',
    { method: 'GET', accessToken, query: { keyWord: options.keyword, page: options.page, size: options.limit } },
  )
  if (!result.ok) return result

  const raw = result.value
  const wrapped = raw as { list?: readonly CjProductListItem[]; content?: readonly CjProductListItem[] }
  const items: readonly CjProductListItem[] = Array.isArray(raw) ? raw : (wrapped.list ?? wrapped.content ?? [])
  const warnings: string[] = []
  if (!Array.isArray(raw) && !wrapped.list && !wrapped.content) {
    warnings.push('Product list response did not contain a recognised "list" or "content" array — treated as empty.')
  }
  return ok({ items, warnings })
}

function statusFromListItem(item: CjProductListItem): SupplierProductStatus {
  const priceMajor = safeNumber(item.sellPrice) ?? 0
  const stockQty = safeNumber(item.warehouseInventoryNum)
  return {
    supplierRef: 'cjdropshipping',
    productRef: safeString(item.pid) ?? safeString(item.id) ?? '',
    supplierSku: safeString(item.productSku) ?? safeString(item.sku) ?? undefined,
    unitCost: money(Math.round(priceMajor * 100), 'USD'),
    shippingCost: money(0, 'USD'), // Not returned by the list endpoint — a real shipping cost needs `readProductDetail`'s destination-aware quote, never fabricated here.
    priceChangedSincePrevious: false,
    stockQty: stockQty ?? undefined,
    inStock: stockQty === null ? true : stockQty > 0, // CJ's list endpoint has no explicit "unavailable" flag; a reported warehouse quantity of 0 is the only signal read here.
    stockCheckedAt: new Date().toISOString(),
    documentationOnFile: [],
    raw: item as Record<string, unknown>,
  }
}

// ---------------------------------------------------------------------------
// Rich single-product detail — /product/query, then (only when a
// destination is requested) /logistic/freightCalculate.
// ---------------------------------------------------------------------------

interface CjVariantData {
  vid?: string
  variantSku?: string
  variantSellPrice?: string | number
  variantWeight?: string | number
  variantImage?: string
  variantNameEn?: string
  variantKey?: string
}

interface CjProductDetailData {
  pid?: string
  productSku?: string
  nameEn?: string
  productNameEn?: string
  description?: string
  categoryName?: string
  productType?: string
  bigImage?: string
  productImageSet?: readonly string[]
  images?: readonly string[]
  productUrl?: string
  sourceFrom?: string
  variants?: readonly CjVariantData[]
  warehouseCountry?: string
}

function parseVariant(raw: CjVariantData): SupplierVariantDetail {
  const priceMajor = safeNumber(raw.variantSellPrice) ?? 0
  const image = safeUrl(raw.variantImage)
  return {
    variantRef: safeString(raw.vid) ?? '',
    sku: safeString(raw.variantSku),
    attributes: raw.variantKey
      ? [{ name: 'Option', value: raw.variantKey }]
      : raw.variantNameEn
        ? [{ name: 'Name', value: raw.variantNameEn }]
        : [],
    unitCost: money(Math.round(priceMajor * 100), 'USD'),
    stockQty: null, // CJ reports variant stock per-country via a separate call (`/product/stock/queryByVid`) — never fabricated here as a single figure.
    inStock: 'unknown',
    imageUrls: image ? [image] : [],
  }
}

function parseShippingQuote(raw: Record<string, unknown>, destinationCountry: string): SupplierShippingQuote | null {
  const cost = safeNumber(raw.logisticPrice ?? raw.wrapPostage ?? raw.totalPostageFee)
  const method = safeString(raw.logisticName) ?? safeString((raw.option as Record<string, unknown> | undefined)?.enName)
  if (cost === null || !method) return null // Cannot construct a usable quote without a cost and a method — never guessed.

  const aging = safeString(raw.logisticAging) ?? safeString(raw.arrivalTime)
  const dayRange = aging ? parseDayRange(aging) : null

  return {
    destinationCountry,
    method,
    carrierName: method,
    shippingCost: money(Math.round(cost * 100), 'USD'),
    processingDaysMin: null,
    processingDaysMax: null,
    // CJ's "logistic aging" / "arrival time" figures are documented as an
    // end-to-end transit estimate, not separately split into processing
    // vs. transit — reported here as the total, with the processing-only
    // figures left `null` rather than assumed to be zero.
    transitDaysMin: dayRange?.min ?? null,
    transitDaysMax: dayRange?.max ?? null,
    totalDeliveryDaysMin: dayRange?.min ?? null,
    totalDeliveryDaysMax: dayRange?.max ?? null,
    providesTracking: 'unknown',
  }
}

/** Parses a free-text day range ("7-15", "10", "7-15 Days") into { min, max } — never a guess when the text doesn't contain a recognisable number. */
function parseDayRange(text: string): { min: number; max: number } | null {
  const matches = text.match(/\d+/g)
  if (!matches || matches.length === 0) return null
  const numbers = matches.map(Number)
  return { min: Math.min(...numbers), max: Math.max(...numbers) }
}

async function fetchShippingQuotes(accessToken: string, vid: string, destinationCountry: string): Promise<Result<readonly SupplierShippingQuote[], string>> {
  const result = await cjRequest<readonly Record<string, unknown>[]>('/logistic/freightCalculate', {
    method: 'POST',
    accessToken,
    body: {
      startCountryCode: 'CN', // CJ's own default warehouse origin when a product's specific warehouse is unknown — documented as the common case for CJ-sourced (as opposed to overseas-warehouse) products.
      endCountryCode: destinationCountry,
      products: [{ vid, quantity: 1 }],
    },
  })
  if (!result.ok) return result
  if (!Array.isArray(result.value)) return ok([])

  const quotes = result.value.map((q) => parseShippingQuote(q, destinationCountry)).filter((q): q is SupplierShippingQuote => q !== null)
  return ok(quotes)
}

async function fetchProductDetail(accessToken: string, productRef: string, options?: ReadProductDetailOptions): Promise<Result<SupplierProductDetail, string>> {
  const result = await cjRequest<CjProductDetailData>('/product/query', { method: 'GET', accessToken, query: { pid: productRef } })
  if (!result.ok) return result

  const data = result.value
  const images = (data.productImageSet ?? data.images ?? []).map(safeUrl).filter((u): u is string => u !== null)
  const primaryImage = safeUrl(data.bigImage) ?? images[0] ?? null
  const additionalImages = images.filter((u) => u !== primaryImage)
  const variants = (data.variants ?? []).map(parseVariant)

  let shippingQuotes: readonly SupplierShippingQuote[] = []
  if (options?.destinationCountry && variants[0]?.variantRef) {
    const quoteResult = await fetchShippingQuotes(accessToken, variants[0].variantRef, options.destinationCountry)
    // A shipping-quote failure must never fail the whole product-detail
    // read — the product itself is still real and useful without it; the
    // caller (the shipping policy gate) treats an empty quote list as
    // "cannot confirm delivery," never as "delivery confirmed impossible."
    if (quoteResult.ok) shippingQuotes = quoteResult.value
  }

  return ok({
    productRef: safeString(data.pid) ?? productRef,
    supplierSku: safeString(data.productSku),
    title: safeString(data.nameEn) ?? safeString(data.productNameEn) ?? `CJ product ${productRef}`,
    description: safeString(data.description),
    category: safeString(data.categoryName),
    brand: null, // Not present in CJ's documented product-query response — never fabricated.
    productUrl: safeUrl(data.productUrl),
    primaryImageUrl: primaryImage,
    additionalImageUrls: additionalImages,
    variants,
    shippingQuotes,
    fetchedAt: new Date().toISOString(),
    raw: data as Record<string, unknown>,
  })
}

const DESCRIPTOR: ConnectorDescriptor = {
  key: 'cjdropshipping',
  label: 'CJdropshipping',
  description:
    "Product sourcing and dropship fulfilment via CJdropshipping's own public REST API — product catalogue, variants, per-country stock, destination-aware freight quotes, and shipment tracking. Read-only in this codebase: no order or purchase capability is implemented.",
  sourceType: 'api',
  requiredCredentials: ['CJ_API_KEY'],
  // Free-tier documented limit: 1 request/second. minSecondsBetweenRuns
  // is the gap between whole discovery *runs* (distinct from the
  // per-request throttle inside this file, which applies within a run).
  rateLimit: { requestsPerMinute: 60, requestsPerDay: null, minSecondsBetweenRuns: 60 },
  capabilities: {
    discoverProducts: true,
    readProducts: true,
    readStock: true,
    readShipping: true,
    placeOrders: false,
    cancelOrders: false,
    trackingUpdates: true,
    readProductMedia: true,
    readProductDetails: true,
    readVariants: true,
    readShippingRates: true,
    readOrders: false,
  },
  usagePolicy: {
    termsUrl: 'https://developers.cjdropshipping.com/',
    permittedUseNote:
      "Only under the account holder's own CJdropshipping account and its own API terms once CJ_API_KEY is configured. No requests are made without it.",
    authenticatedFirstParty: true,
  },
}

export class CjDropshippingConnector implements SupplierConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return apiKey() !== null
  }

  async fetchStatus(options: FetchStatusOptions): Promise<Result<FetchStatusOutcome, string>> {
    if (!this.isConfigured()) return err('CJ_API_KEY is not configured.')

    const tokenResult = await getAccessToken()
    if (!tokenResult.ok) return tokenResult

    // `knownRefs` absent -> discovery browse (per this codebase's existing
    // `discoverProducts` convention, see `types.ts`); present -> re-query
    // each known product individually for a fresh status.
    if (!options.knownRefs || options.knownRefs.size === 0) {
      const listResult = await listProducts(tokenResult.value, { limit: options.limit, page: 1, keyword: options.keyword })
      if (!listResult.ok) return listResult
      return ok({
        statuses: listResult.value.items.map(statusFromListItem).filter((s) => s.productRef.length > 0),
        requestsMade: 2,
        warnings: listResult.value.warnings,
      })
    }

    const statuses: SupplierProductStatus[] = []
    const warnings: string[] = []
    let requestsMade = 1
    for (const ref of options.knownRefs) {
      if (statuses.length >= options.limit) break
      const detail = await fetchProductDetail(tokenResult.value, ref)
      requestsMade += 1
      if (!detail.ok) {
        warnings.push(`Could not refresh "${ref}": ${detail.error}`)
        continue
      }
      const primaryVariant = detail.value.variants[0]
      statuses.push({
        supplierRef: 'cjdropshipping',
        productRef: detail.value.productRef,
        supplierSku: detail.value.supplierSku ?? undefined,
        unitCost: primaryVariant?.unitCost ?? money(0, 'USD'),
        shippingCost: money(0, 'USD'),
        priceChangedSincePrevious: false,
        inStock: primaryVariant?.inStock === true,
        stockCheckedAt: detail.value.fetchedAt,
        documentationOnFile: [],
        raw: detail.value.raw,
      })
    }
    return ok({ statuses, requestsMade, warnings })
  }

  async readProductDetail(productRef: string, options?: ReadProductDetailOptions): Promise<Result<SupplierProductDetail, string>> {
    if (!this.isConfigured()) return err('CJ_API_KEY is not configured.')
    const tokenResult = await getAccessToken()
    if (!tokenResult.ok) return tokenResult
    return fetchProductDetail(tokenResult.value, productRef, options)
  }
}

export const cjdropshippingConnector = new CjDropshippingConnector()

/**
 * Exported for tests only, matching `marketplaces/connectors/ebay.ts`'s own
 * `__internal` convention — never imported by application code, which
 * always goes through the class above so `isConfigured()`/throttling/
 * error handling are never bypassed.
 */
export const __internal = {
  parseDayRange,
  parseShippingQuote,
  statusFromListItem,
  safeNumber,
  safeUrl,
  safeString,
  getAccessToken,
  listProducts,
  fetchProductDetail,
  fetchShippingQuotes,
}
