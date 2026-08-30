import type { Money } from '@/lib/core/money'
import type { Enums } from '@/lib/supabase/database.types'
import type { Result } from '@/lib/core/result'

/**
 * The supplier connector interface (Milestone 3).
 *
 * Deliberately mirrors `src/lib/research/providers/types.ts`. Both describe a
 * pluggable external source with a declared source type, credentials, rate
 * limits and usage terms, so that "this connector exists" and "we have it
 * configured and working" are never the same claim.
 *
 * The interface does not assume every supplier speaks an API. A CSV upload, a
 * manually maintained catalogue, and a real-time feed are all legitimate
 * connector implementations, and the category names below reflect the kinds
 * of sourcing ecosystems that exist in practice (DSers-compatible sourcing,
 * Syncee-type networks, EPROLO-type fulfilment, CJ-type sourcing, AutoDS-type
 * aggregation, a direct supplier API, or an approved custom integration) —
 * "-compatible" and "-type" because this system claims no partnership with
 * any of them. No connector for one of these is written until an official
 * API or a real, permitted data source backs it.
 */

export type ConnectorSourceType = Enums<'connector_source_type'>
export type ConnectorStatus = Enums<'connector_status'>

/** Same shape as the research provider's rate limit; declared, not discovered. */
export interface ConnectorRateLimit {
  requestsPerMinute: number | null
  requestsPerDay: number | null
  minSecondsBetweenRuns: number
}

export interface ConnectorUsagePolicy {
  termsUrl: string | null
  permittedUseNote: string
  /** True only when this connector uses our own credentials against an official API. */
  authenticatedFirstParty: boolean
}

/**
 * What a connector actually does, declared honestly (Milestone: supplier
 * discovery, Phase 5) — a capability is `true` only once the connector
 * genuinely implements it; nothing here is aspirational. `readStock`
 * corresponds to `fetchStatus` reporting `inStock`/`stockQty`,
 * `discoverProducts` to a connector that can find *new* candidates (as
 * opposed to only reporting status for products already known — the
 * distinction `fetchStatus`'s own `knownRefs` parameter already makes).
 * `placeOrders`/`cancelOrders` are declared `false` on every connector in
 * this codebase without exception: nothing here is permitted to spend
 * money automatically, regardless of what a real API might technically
 * support.
 */
export interface ConnectorCapabilities {
  discoverProducts: boolean
  readProducts: boolean
  readStock: boolean
  readShipping: boolean
  placeOrders: boolean
  cancelOrders: boolean
  trackingUpdates: boolean
  /**
   * Milestone: product media intelligence (Phase 7). Whether this
   * connector can report supplier-hosted image URLs for a product —
   * genuinely `true` only once a connector implements a real media read;
   * `false` on every connector today, including `manual` (a person
   * pastes a URL by hand — real, but a human action, not the connector
   * discovering media on its own). Never collapsed with "implemented":
   * the manual connector's own capture form is what actually lets
   * supplier-provided media into the system this phase, independent of
   * this flag. Satisfied via `readProductDetail`'s own `media` array —
   * there is no separate media-only network call, matching how a real
   * supplier API actually bundles images with the product payload.
   */
  readProductMedia: boolean

  // --- Milestone: real supplier connector (Phase 8) -------------------
  // The brief for this milestone names a longer capability vocabulary
  // than the flags below; several of its names describe a *view* of an
  // existing flag rather than a genuinely distinct behaviour, so they are
  // mapped here explicitly rather than duplicated as separate booleans a
  // test could never observe differing from their sibling:
  //   readInventory        -> readStock (existing)
  //   readPricing          -> readProducts (existing; cost is core to it)
  //   readShippingOptions  -> readShippingRates (below)
  //   readDeliveryEstimates -> readShippingRates (below; a delivery
  //                            estimate is one field of a shipping quote)
  //   readFulfilment       -> trackingUpdates (existing)

  /**
   * Whether `readProductDetail` returns real structured detail (title,
   * description, category, brand, product URL) beyond `fetchStatus`'s
   * lightweight cost/stock status — genuinely `true` only once a
   * connector implements that richer, single-product read.
   */
  readProductDetails: boolean
  /** Whether `readProductDetail`'s `variants` array is populated with real per-variant SKU/attributes/cost/stock, not just a single product-level figure. */
  readVariants: boolean
  /**
   * Whether `readProductDetail` can return real, destination-aware
   * shipping quotes (cost/method/delivery estimate for a given country) —
   * distinct from the existing coarse `readShipping` (a supplier-level
   * dispatch/delivery day range with no destination or cost breakdown).
   */
  readShippingRates: boolean
  /**
   * Whether this connector can read back the status of an order already
   * placed with the supplier. Declared `false` on every connector in this
   * codebase without exception this phase: no connector may place a
   * supplier order at all (`placeOrders: false`), so there is never an
   * order of this connector's own creation to read back. Kept as an
   * explicit flag (rather than omitted) so the capability registry names
   * the full vocabulary this milestone's brief asks for, honestly unmet.
   */
  readOrders: boolean
}

export interface ConnectorDescriptor {
  key: string
  label: string
  description: string
  sourceType: ConnectorSourceType
  /** Environment variable names. Never values. */
  requiredCredentials: readonly string[]
  rateLimit: ConnectorRateLimit
  usagePolicy: ConnectorUsagePolicy
  capabilities: ConnectorCapabilities
}

/**
 * What a connector reports about one supplier's offer on one product.
 *
 * This is the full set of fields Milestone 3 asks a supplier relationship to
 * track. Every one is optional except the identifying fields and cost,
 * because a CSV connector may simply not carry cancellation-rate data that an
 * API connector would — an absent field means "this connector does not report
 * this," not zero.
 */
export interface SupplierProductStatus {
  supplierRef: string
  /** The product this status is for, keyed however the connector identifies it. */
  productRef: string
  supplierSku?: string

  unitCost: Money
  shippingCost: Money
  /** Set when this run observed a different cost than the one on file. */
  previousUnitCost?: Money
  priceChangedSincePrevious: boolean

  warehouseCountry?: string
  stockQty?: number
  inStock: boolean
  /** When stock was actually checked — the freshness of the figure above. */
  stockCheckedAt: string

  dispatchDaysMin?: number
  dispatchDaysMax?: number
  deliveryDaysMin?: number
  deliveryDaysMax?: number
  providesTracking?: boolean

  /** Observed, not claimed. Undefined when the connector has no history yet. */
  cancellationRatePct?: number
  fulfilmentSuccessRatePct?: number

  /** Document types this connector confirms are on file for this product. */
  documentationOnFile: readonly string[]

  /** Free-form connector payload, retained for traceability. */
  raw: Record<string, unknown>
}

export interface FetchStatusOptions {
  limit: number
  knownRefs?: ReadonlySet<string>
  /** Milestone: real supplier connector (Phase 8). A free-text search term for discovery-mode browsing (`knownRefs` absent) — ignored by a connector with no keyword-search concept. */
  keyword?: string
}

export interface FetchStatusOutcome {
  statuses: readonly SupplierProductStatus[]
  requestsMade: number
  warnings: readonly string[]
}

// ---------------------------------------------------------------------------
// Milestone: real supplier connector (Phase 8) — the richer, single-product
// read `fetchStatus` was never designed for. `fetchStatus` stays the
// lightweight, many-products "what changed" call (used for both ongoing
// price/stock monitoring and, per its own existing convention, discovery
// browsing when `knownRefs` is omitted); `readProductDetail` is the new,
// deliberately separate "tell me everything about this one candidate" call
// — variants, media, and (only when a destination is actually requested)
// shipping quotes — so a discovery browse of fifty products never triggers
// fifty freight-calculation requests against a rate-limited API. A human
// inspecting one specific candidate before importing it is what actually
// calls this.
// ---------------------------------------------------------------------------

export interface SupplierVariantDetail {
  /** However the connector identifies this variant — never fabricated when the supplier has no variant concept. */
  variantRef: string
  sku: string | null
  /** e.g. [{ name: 'Colour', value: 'Black' }]. Empty when the supplier reports no options for this variant. */
  attributes: readonly { name: string; value: string }[]
  unitCost: Money
  stockQty: number | null
  /** `'unknown'` when the supplier's response did not include a stock figure for this variant — never assumed in-stock or zero. */
  inStock: boolean | 'unknown'
  imageUrls: readonly string[]
}

export interface SupplierShippingQuote {
  /** ISO 3166-1 alpha-2, e.g. 'GB'. */
  destinationCountry: string
  method: string
  carrierName: string | null
  shippingCost: Money
  /** Time the supplier needs to prepare the order before it ships — distinct from transit time. */
  processingDaysMin: number | null
  processingDaysMax: number | null
  /** Time in transit once shipped — distinct from processing time. */
  transitDaysMin: number | null
  transitDaysMax: number | null
  /** Processing + transit, when the connector can compute both; never fabricated by summing an unknown side as zero — `null` unless both components (or a single supplier-reported total) are actually known. */
  totalDeliveryDaysMin: number | null
  totalDeliveryDaysMax: number | null
  providesTracking: boolean | 'unknown'
}

export interface ReadProductDetailOptions {
  /** ISO 3166-1 alpha-2. Omit to skip shipping quotes entirely (no freight-calculation request is made without one). */
  destinationCountry?: string
}

export interface SupplierProductDetail {
  productRef: string
  supplierSku: string | null
  title: string
  description: string | null
  category: string | null
  brand: string | null
  productUrl: string | null
  primaryImageUrl: string | null
  additionalImageUrls: readonly string[]
  variants: readonly SupplierVariantDetail[]
  /** Empty unless `ReadProductDetailOptions.destinationCountry` was supplied and the connector genuinely returned quotes for it. */
  shippingQuotes: readonly SupplierShippingQuote[]
  fetchedAt: string
  /** Free-form connector payload, retained for traceability — same convention as `SupplierProductStatus.raw`. */
  raw: Record<string, unknown>
}

export interface SupplierConnector {
  readonly descriptor: ConnectorDescriptor

  /**
   * Whether this connector can run right now. Must return false when
   * credentials are absent — a connector is never permitted to report itself
   * ready without them (mirrors the research provider rule exactly).
   */
  isConfigured(): boolean

  /**
   * Fetches current status for every product this connector covers.
   *
   * Returns a `Result` so one failing connector degrades its own status
   * rather than failing whatever run invoked it.
   */
  fetchStatus(options: FetchStatusOptions): Promise<Result<FetchStatusOutcome, string>>

  /**
   * The rich, single-product read (Phase 8) — title/description/category/
   * brand/variants/media, and destination-aware shipping quotes when asked
   * for. Gated by `descriptor.capabilities.readProductDetails` at the call
   * site exactly like every other capability-gated method in this
   * codebase: a connector declaring it `false` must never have this
   * called at all, and every connector must still implement the method
   * (returning an explicit `err` when unsupported) so the interface stays
   * a single, honest contract rather than an optional method callers must
   * guess about.
   */
  readProductDetail(productRef: string, options?: ReadProductDetailOptions): Promise<Result<SupplierProductDetail, string>>
}

/** Runtime health, combining the descriptor with what has actually happened. */
export interface ConnectorHealth {
  key: string
  label: string
  description: string
  sourceType: ConnectorSourceType
  status: ConnectorStatus
  isEnabled: boolean
  isConfigured: boolean
  missingCredentials: readonly string[]
  rateLimit: ConnectorRateLimit
  usagePolicy: ConnectorUsagePolicy
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  nextAllowedAt: string | null
  consecutiveFailures: number
}
