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

export interface MarketplaceOrderSnapshot {
  externalId: string
  placedAt: string
  status: 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded'
  totalMinor: number
  currency: string
  lineItemRefs: readonly string[]
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
