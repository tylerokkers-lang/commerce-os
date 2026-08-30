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
   * this flag.
   */
  readProductMedia: boolean
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
}

export interface FetchStatusOutcome {
  statuses: readonly SupplierProductStatus[]
  requestsMade: number
  warnings: readonly string[]
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
