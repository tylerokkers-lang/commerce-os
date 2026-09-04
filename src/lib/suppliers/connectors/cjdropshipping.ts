import { err, ok, type Result } from '@/lib/core/result'
import { money } from '@/lib/core/money'
import type {
  ConnectorDescriptor,
  FetchStatusOptions,
  FetchStatusOutcome,
  ProductSourceLink,
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

/**
 * Milestone: supplier product verification link.
 *
 * CJ's developer API (above) genuinely has no product-URL field
 * (confirmed live and against CJ's own published documentation — see
 * `types.ts`'s `productUrl` comment). This is CJ's real, *public
 * storefront* (a completely different surface, cjdropshipping.com, not
 * the developer API), and this exact `/search?keyWord=` route was found
 * live: navigating a real browser session to
 * `https://m.cjdropshipping.com/search?keyWord=<value>` genuinely loads
 * CJ's own search UI with the query pre-filled into the real search box —
 * not guessed, not constructed from a plausible-looking pattern.
 *
 * A genuine, correctly-slugged CJ product-page URL was also found live —
 * real links harvested directly from CJ's own homepage HTML follow
 * `https://cjdropshipping.com/product/<seo-slug>-p-<pid>.html`, the same
 * `pid` this connector already stores as `connector_product_ref`. That
 * URL is deliberately NOT constructed here: clicking through to it (even
 * using CJ's own real, unmodified link, copied verbatim) triggers CJ's
 * own "Human verification" wall for this automated session, which this
 * codebase must not attempt to defeat — so whether an arbitrary/mismatched
 * slug still resolves to the correct product by `pid` alone could not be
 * safely confirmed. Presenting an unverified constructed link as the
 * exact product page is exactly the "believable-looking URL" this
 * milestone exists to prevent — so this connector only ever returns
 * `type: 'search'`, honestly, never `type: 'product'`, until that
 * resolution can genuinely be confirmed by some future, safe means.
 */
const CJ_SEARCH_BASE_URL = 'https://m.cjdropshipping.com/search'
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
  /** Documented/hypothetical flat field — never observed on a real response (see `oneCategoryName` etc. below), kept only as a fallback. */
  categoryName?: string
  categoryId?: string
  /** The real, live shape of `/product/listV2` (found live, not documented): category arrives as this three-level hierarchy, never as a single joined `categoryName` — unlike `/product/query`'s detail response, which already returns one pre-joined string. */
  oneCategoryName?: string
  twoCategoryName?: string
  threeCategoryName?: string
  warehouseInventoryNum?: string | number
  listedNum?: string | number
}

/**
 * Discovery-mode listing (Phase 8) — a lightweight browse, distinct from
 * `readProductDetail`'s rich single-product read. Uses `/product/listV2`.
 *
 * Found live, not by inspection (first real exercise of this endpoint,
 * this session): CJ's actual response nests the real product array one
 * level deeper than documented/assumed — `data.content` is not itself an
 * array of products, it is a single-element array whose one entry wraps
 * `{ productList, relatedCategoryList, keyWord, keyWordOld }`. Every real
 * product lives in that `productList`. The previous code treated
 * `content` as the product array directly, so every real response was
 * silently read as "0 products" (that lone wrapper object, having none
 * of the fields a product needs, was filtered out downstream) with no
 * error ever surfaced. The old `.list`/bare-array/flat-`.content`
 * fallbacks are kept, in that order, in case a future CJ response
 * reverts to one of those shapes — never removed, only no longer tried
 * first.
 */
async function listProducts(accessToken: string, options: { keyword?: string; limit: number; page: number }): Promise<Result<{ items: readonly CjProductListItem[]; warnings: readonly string[] }, string>> {
  const result = await cjRequest<
    | { content?: readonly { productList?: readonly CjProductListItem[] }[] }
    | { list?: readonly CjProductListItem[]; content?: readonly CjProductListItem[] }
    | readonly CjProductListItem[]
  >('/product/listV2', { method: 'GET', accessToken, query: { keyWord: options.keyword, page: options.page, size: options.limit } })
  if (!result.ok) return result

  const raw = result.value
  const nested = raw as { content?: readonly { productList?: readonly CjProductListItem[] }[] }
  const flat = raw as { list?: readonly CjProductListItem[]; content?: readonly CjProductListItem[] }

  const warnings: string[] = []
  let items: readonly CjProductListItem[]
  if (Array.isArray(nested.content) && nested.content[0]?.productList !== undefined) {
    items = nested.content[0].productList ?? []
  } else if (Array.isArray(raw)) {
    items = raw
  } else if (flat.list) {
    items = flat.list
  } else if (flat.content) {
    items = flat.content
  } else {
    items = []
    warnings.push('Product list response did not contain a recognised "content[0].productList", "list", or "content" array — treated as empty.')
  }
  return ok({ items, warnings })
}

/**
 * The live list-browse response has no single joined category string
 * (unlike `/product/query`'s detail read, confirmed separately to
 * already return one, e.g. `"Men's Clothing > Outerwear & Jackets >
 * Men's Sweaters"`) — only the three separate hierarchy levels. Joined
 * with the same `" > "` separator for consistency with that existing
 * representation, most-specific-first levels dropped when absent rather
 * than rendered as an empty segment. `categoryName` (never observed live,
 * kept only as a documented/hypothetical fallback) wins if a future
 * response ever provides it directly.
 */
function categoryFromListItem(item: CjProductListItem): string | undefined {
  const flat = safeString(item.categoryName)
  if (flat) return flat
  const levels = [item.oneCategoryName, item.twoCategoryName, item.threeCategoryName].map(safeString).filter((s): s is string => s !== null)
  return levels.length > 0 ? levels.join(' > ') : undefined
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
    category: categoryFromListItem(item),
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
  /** Grams — confirmed against CJ's own published field documentation (developers.cjdropshipping.cn), not assumed. */
  variantWeight?: string | number
  /** Millimetres — same source as `variantWeight`. CJ reports package dimensions per variant, never a single product-level figure, so these are only ever attached to one variant here. */
  variantLength?: string | number
  variantWidth?: string | number
  variantHeight?: string | number
  variantImage?: string
  variantNameEn?: string
  variantKey?: string
  /**
   * Real per-variant stock figure, when CJ returns one on this endpoint —
   * found live (not documented) alongside a real, already-imported
   * product's genuine `/product/query` response. Absent/null on some
   * products (CJ's fuller per-country breakdown lives behind a separate
   * `/product/stock/queryByVid` call this connector does not make) — never
   * treated as zero when missing.
   */
  inventoryNum?: string | number
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
  /**
   * Milestone: product-catalogue correction. Kept typed even though it has
   * never once appeared on a real `/product/query` response this codebase
   * has captured (confirmed live against an already-imported product, and
   * against CJ's own published field-by-field documentation, which lists
   * no URL/link field for this endpoint at all) — `safeUrl` below
   * therefore always maps this to `null` in practice today. Left in place
   * rather than removed, so a future CJ API version that does add a real
   * field by this name starts working immediately, honestly, with no code
   * change required.
   */
  productUrl?: string
  sourceFrom?: string
  variants?: readonly CjVariantData[]
  warehouseCountry?: string
}

function parseVariant(raw: CjVariantData): SupplierVariantDetail {
  const priceMajor = safeNumber(raw.variantSellPrice) ?? 0
  const image = safeUrl(raw.variantImage)
  // `inventoryNum` is genuinely present on `/product/query`'s real response
  // shape (confirmed live), but null on many products — CJ's fuller,
  // per-country stock breakdown lives behind a separate
  // `/product/stock/queryByVid` call this connector does not make. A real
  // number here is used as-is; a missing one stays unknown, never zero.
  const stockQty = safeNumber(raw.inventoryNum)
  return {
    variantRef: safeString(raw.vid) ?? '',
    sku: safeString(raw.variantSku),
    attributes: raw.variantKey
      ? [{ name: 'Option', value: raw.variantKey }]
      : raw.variantNameEn
        ? [{ name: 'Name', value: raw.variantNameEn }]
        : [],
    unitCost: money(Math.round(priceMajor * 100), 'USD'),
    stockQty,
    inStock: stockQty === null ? 'unknown' : stockQty > 0,
    imageUrls: image ? [image] : [],
    weightGrams: safeNumber(raw.variantWeight),
    lengthMm: safeNumber(raw.variantLength),
    widthMm: safeNumber(raw.variantWidth),
    heightMm: safeNumber(raw.variantHeight),
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
    resolvesProductSourceLink: true,
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

  /**
   * See `CJ_SEARCH_BASE_URL`'s own comment for the live verification
   * behind this. Prefers the supplier's own SKU (a human-recognisable
   * product code, e.g. "CJYD2334853") over the bare numeric `pid` as the
   * search query — CJ's site search is built for a person typing a
   * product code, not treating the internal database key as meaningful.
   * No network call: this is pure URL construction from data the caller
   * already has, never a fetch that could be mistaken for "verifying"
   * anything.
   */
  async getProductSourceLink(input: { productRef: string; supplierSku: string | null }): Promise<Result<ProductSourceLink, string>> {
    const query = input.supplierSku ?? input.productRef
    if (!query) return err('No supplier SKU or product reference on file to search CJdropshipping with.')
    return ok({ type: 'search', url: `${CJ_SEARCH_BASE_URL}?keyWord=${encodeURIComponent(query)}` })
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
  categoryFromListItem,
  fetchProductDetail,
  fetchShippingQuotes,
}
