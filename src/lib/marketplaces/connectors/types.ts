import type { Money } from '@/lib/core/money'
import type { ChannelKey } from '@/lib/core/domain'
import type { Enums } from '@/lib/supabase/database.types'
import type { Result } from '@/lib/core/result'

/**
 * The marketplace connector interface (Milestone 4).
 *
 * Deliberately mirrors `src/lib/suppliers/connectors/types.ts`, which itself
 * mirrors the Milestone 2 research provider interface. All three describe a
 * pluggable external source with a declared capability set, credentials, rate
 * limits and connection health, so that "this connector exists" and "we have
 * it connected and working" are never the same claim.
 *
 * A marketplace connector is read-heavy by design at this stage. Milestone 4
 * builds the foundation — connection health, listing/inventory/order reads,
 * fee reporting, and the idempotent, reconciliation-aware plumbing those need
 * — not the write side (creating live listings, submitting fulfilment,
 * processing refunds). Those actions route through the publication and
 * automation gates built alongside this interface, and are only exercised for
 * real once Milestone 5 builds order orchestration on top of it.
 */

export type MarketplaceConnectionStatus = Enums<'marketplace_connection_status'>

/** Declared limits. Honoured because they were declared, not discovered. */
export interface MarketplaceRateLimit {
  requestsPerMinute: number | null
  requestsPerDay: number | null
  minSecondsBetweenRuns: number
}

export interface MarketplaceUsagePolicy {
  termsUrl: string | null
  permittedUseNote: string
  /** True only for an official API used with our own seller/store credentials. */
  authenticatedFirstParty: boolean
}

/**
 * What this connector can actually do. Declared up front so the UI, and any
 * caller, can tell "not supported by this marketplace" apart from "not built
 * yet" apart from "failed this time" — three different facts that must never
 * be presented as the same thing.
 */
export interface MarketplaceCapabilities {
  readListings: boolean
  writeListings: boolean
  syncInventory: boolean
  ingestOrders: boolean
  updateFulfilment: boolean
  processRefunds: boolean
  readFees: boolean
  webhooks: boolean
  /**
   * Milestone 7: can this connector read back a listing/inventory value
   * after writing it, to confirm the write actually took? `writeListings:
   * true` with `verifyWrites: false` is a real, honest combination — it
   * means "this connector can submit a change but cannot itself confirm it
   * stuck," which the SUBMIT -> VERIFY -> RECONCILE pipeline in
   * `automation/priceExecution.ts` treats as `verification_status:
   * 'uncertain'`, never as success.
   */
  verifyWrites: boolean
  /**
   * Milestone: controlled Shopify publication (Phase 6). Deliberately
   * separate from `writeListings` (which gates writes to a listing that
   * *already exists* — price/inventory/status changes): creating a brand
   * new product needs no prior `externalId` at all, and in Shopify's case
   * specifically needs the `write_products` OAuth scope, which is a
   * different grant from anything this codebase's Admin connector
   * currently holds (confirmed by inspection: the app's configured scopes
   * are `read_products`/`read_orders`/`read_inventory`/`read_fulfillments`
   * only — see `docs/API.md`/`HANDOVER.md` for how that was verified).
   * `true` would mean this connector can create a new draft listing;
   * `false` means either no credentials, or credentials with a scope that
   * doesn't include product creation — never conflated.
   */
  createListings: boolean
}

export interface MarketplaceConnectorDescriptor {
  key: string
  label: string
  description: string
  channel: ChannelKey
  capabilities: MarketplaceCapabilities
  /** Environment variable names. Never values. */
  requiredCredentials: readonly string[]
  rateLimit: MarketplaceRateLimit
  usagePolicy: MarketplaceUsagePolicy
}

/** A live snapshot of whether the connection can be trusted right now. */
export interface ConnectionHealth {
  status: MarketplaceConnectionStatus
  apiVersion: string | null
  checkedAt: string
  /** Present only when status is 'error' or 'degraded'. */
  detail: string | null
  /**
   * Milestone: live infrastructure activation (Phase 10). The real,
   * comma-separated scope string the OAuth token exchange itself
   * returned on a successful connection — not a secret, an OAuth
   * permission grant, safe to display — so "does this app actually have
   * write_products" is a live-verified fact surfaced in the UI, never
   * only an assumption from how the connector was written. `null` when
   * the connector's own auth flow doesn't report a scope (not every
   * connector's OAuth grant does), or when the connection was never
   * successfully established.
   */
  grantedScope: string | null
}

/** One listing as the marketplace itself reports it — for reconciliation. */
export interface MarketplaceListingSnapshot {
  externalId: string
  channelProductRef: string
  title: string
  status: 'active' | 'draft' | 'archived' | 'removed'
  priceMinor: number
  currency: string
  stockQty: number | null
  reportedAt: string
  raw: Record<string, unknown>
}

export interface MarketplaceInventorySnapshot {
  externalId: string
  channelProductRef: string
  stockQty: number
  reportedAt: string
}

/**
 * One line item on a marketplace order, as reported by the marketplace
 * itself — not yet resolved against our own catalogue. `sku` is `null`
 * when the connector's read call does not return one at all (never a
 * guess); resolution against `product_variants.sku` happens downstream in
 * `orders/lineItemResolution.ts`, which is the only place a `null` here
 * becomes a real product/variant id or an honest "unresolved."
 */
export interface MarketplaceOrderLineItem {
  externalId: string
  sku: string | null
  quantity: number
  unitPriceMinor: number
}

export interface MarketplaceOrderSnapshot {
  externalId: string
  placedAt: string
  status: 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded'
  totalMinor: number
  currency: string
  lineItems: readonly MarketplaceOrderLineItem[]
  /**
   * Fraud/risk status, where the connector's API surface reports one.
   * Undefined — not 'low' — when the connector does not fetch this at all,
   * so "no risk data available" is never confused with "assessed as safe."
   * Neither read-only call built for Shopify or Amazon in Milestone 4
   * currently populates this; it exists so a connector that does call a risk
   * endpoint (Shopify's Order Risk resource, for one) has somewhere to put it.
   */
  riskLevel?: 'low' | 'medium' | 'high'
  raw: Record<string, unknown>
}

export interface MarketplaceFeeSnapshot {
  externalOrderId: string
  feeType: string
  amount: Money
  chargedAt: string
}

export interface FetchOptions {
  limit: number
  /** Only fetch records changed since this point, where the marketplace supports it. */
  sinceIso?: string
}

export interface FetchOutcome<T> {
  records: readonly T[]
  requestsMade: number
  warnings: readonly string[]
}

export interface MarketplaceConnector {
  readonly descriptor: MarketplaceConnectorDescriptor

  /**
   * Whether this connector can run right now. Must return false when
   * credentials are absent — never permitted to report itself ready without
   * them (the same rule as every other connector interface in this system).
   */
  isConfigured(): boolean

  /** Connection and authentication status, checked fresh each call. */
  getConnectionHealth(): Promise<Result<ConnectionHealth, string>>

  fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>>
  fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>>
  fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>>
  fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>>

  /**
   * Pushes tracking/fulfilment information back to the marketplace (Milestone 5)
   * — the "marketplace updated" step in the order pipeline. Declared even for
   * connectors that do not yet implement it for real, returning an honest
   * error rather than a silent no-op, so a caller can always tell "this
   * marketplace update failed" apart from "nothing happened."
   */
  submitFulfilmentUpdate(update: FulfilmentUpdateInput): Promise<Result<FulfilmentUpdateOutcome, string>>

  /**
   * Milestone 7 write capabilities (brief §7). Every one of these is gated
   * by `descriptor.capabilities.writeListings` at the call site — a
   * connector that declares `writeListings: false` (the real connectors,
   * until write scopes are actually configured) must never have these
   * called at all, not called-and-told-no. When `writeListings` is true but
   * a specific write genuinely is not supported by the provider's API for
   * this account, the method itself returns `NOT_SUPPORTED` rather than a
   * generic failure, so a caller can tell "this marketplace cannot do this"
   * apart from "this attempt failed."
   */
  updateListingPrice(input: ListingWriteInput & { priceMinor: number }): Promise<Result<WriteOutcome, WriteFailure>>
  updateInventory(input: ListingWriteInput & { stockQty: number }): Promise<Result<WriteOutcome, WriteFailure>>
  setListingStatus(input: ListingWriteInput & { status: 'active' | 'paused' }): Promise<Result<WriteOutcome, WriteFailure>>

  /**
   * VERIFY: reads the listing back from the marketplace itself, so a write
   * can be confirmed against the provider's own state rather than assumed
   * from the write call's own response. Only meaningful when
   * `capabilities.verifyWrites` is true.
   */
  verifyListingState(externalId: string): Promise<Result<MarketplaceListingSnapshot, string>>

  /**
   * Milestone: controlled Shopify publication (Phase 6). Creates a brand
   * new listing — no `externalId` exists yet, which is exactly why this
   * is a separate method from `updateListingPrice`/etc rather than an
   * overload of them. Gated by `descriptor.capabilities.createListings`
   * at the call site, identically to every other write method in this
   * interface: a connector declaring `createListings: false` must never
   * have this called at all.
   */
  createListing(input: CreateListingInput): Promise<Result<CreateListingOutcome, WriteFailure>>
}

export interface CreateListingImage {
  url: string
  altText: string | null
}

export interface CreateListingVariant {
  /** Our own SKU, when one is assigned — never fabricated if absent. */
  sku: string | null
  priceMinor: number
  /** e.g. [{ name: 'Size', value: 'M' }]. Empty for a single-variant product — Shopify's own "Default Title" convention, not a fake option. */
  options: readonly { name: string; value: string }[]
  weightGrams: number | null
}

export interface CreateListingInput {
  /** Our internal product id — carried through for traceability/audit only, never sent to the marketplace itself. */
  productId: string
  /** Idempotency: resubmitting the same create must never create a duplicate listing. */
  idempotencyKey: string
  title: string
  descriptionHtml: string
  productType: string | null
  vendor: string | null
  tags: readonly string[]
  currency: string
  compareAtPriceMinor: number | null
  images: readonly CreateListingImage[]
  variants: readonly CreateListingVariant[]
  seoTitle: string | null
  seoDescription: string | null
  /** Every write this codebase performs creates a draft, never a live listing directly — this is not a caller-chosen option. */
  status: 'draft'
}

export interface CreateListingOutcome {
  accepted: boolean
  externalId: string | null
  externalHandle: string | null
  /** A human-viewable admin URL, when the provider's response includes enough to build one. */
  adminUrl: string | null
}

export interface FulfilmentUpdateInput {
  externalOrderId: string
  carrier: string
  trackingNumber: string
  /** Idempotency: resubmitting the same update must not create a duplicate marketplace-side record. */
  idempotencyKey: string
}

export interface FulfilmentUpdateOutcome {
  accepted: boolean
  marketplaceReference: string | null
}

export interface ListingWriteInput {
  externalId: string
  /** Idempotency: resubmitting the same write must never create a duplicate marketplace-side change. */
  idempotencyKey: string
}

export interface WriteOutcome {
  accepted: boolean
  /** The provider's own reference for this specific write, when it gives one distinct from the listing id. */
  externalRef: string | null
}

/**
 * A closed set, not a bare string — so "this marketplace does not support
 * this action at all," "we have not configured write access," "this needs
 * a human to approve," and "the provider rejected this specific attempt"
 * are never collapsed into one generic failure (brief §7).
 */
export type WriteFailureReason = 'not_supported' | 'not_configured' | 'requires_approval' | 'rejected'

export interface WriteFailure {
  reason: WriteFailureReason
  detail: string
}

/** Runtime health, combining the descriptor with what has actually happened. */
export interface MarketplaceConnectorSummary {
  key: string
  label: string
  description: string
  channel: ChannelKey
  capabilities: MarketplaceCapabilities
  status: MarketplaceConnectionStatus
  isConfigured: boolean
  missingCredentials: readonly string[]
  rateLimit: MarketplaceRateLimit
  usagePolicy: MarketplaceUsagePolicy
  apiVersion: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  consecutiveFailures: number
  listingCount: number
  orderCount: number
}
