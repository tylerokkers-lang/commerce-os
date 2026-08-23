import type { Money } from '@/lib/core/money'

/**
 * The live data-assembly layer's shared types (Milestone 7 brief §3).
 *
 * Kept in their own file, with no `server-only` import — same reasoning as
 * `store.ts` in Milestone 6: a `FactsLoader` interface here is satisfied
 * twice, once for real (`facts.ts`, Supabase-backed) and once by
 * `inMemoryFactsLoader.ts` for tests, so job handlers that need live facts
 * can be driven end to end without a live database, the same way
 * `tests/automation-engine-e2e.test.ts` already proves the job queue works.
 *
 * Every fact is wrapped with when it was observed and how fresh that makes
 * it — never a bare value. A stale or missing fact is a fact in its own
 * right ("we do not currently know this"), never silently treated as
 * current, per the brief's FRESH/STALE/UNKNOWN/UNAVAILABLE states and
 * `docs/PRINCIPLES.md` §1's "empty is not the same as unknown."
 */

export type Freshness = 'fresh' | 'stale' | 'unknown' | 'unavailable'

export interface Fact<T> {
  value: T | null
  freshness: Freshness
  /** When the underlying record was last observed/verified, if ever. */
  asOf: string | null
}

export function factFrom<T>(value: T | null | undefined, asOf: string | null, maxAgeHours: number, now: Date): Fact<T> {
  if (value === null || value === undefined) return { value: null, freshness: asOf ? 'stale' : 'unavailable', asOf }
  if (!asOf) return { value, freshness: 'unknown', asOf: null }
  const ageHours = (now.getTime() - new Date(asOf).getTime()) / (1000 * 60 * 60)
  return { value, freshness: ageHours <= maxAgeHours ? 'fresh' : 'stale', asOf }
}

/** How long a fact of each kind may go unrefreshed before it is treated as stale, not current. */
export const FRESHNESS_WINDOW_HOURS = {
  supplierPricing: 24,
  supplierCompliance: 24 * 30, // Capability flags change rarely; a month is a reasonable ceiling.
  channelListing: 6,
  productCatalogue: 24 * 30,
} as const

export interface ProductFacts {
  productId: string
  title: Fact<string>
  category: Fact<string | null>
  stage: Fact<string>
}

export interface SupplierFacts {
  supplierId: string
  unitCost: Fact<Money>
  shippingCost: Fact<Money>
  stockQty: Fact<number | null>
  inStock: Fact<boolean>
  shopifyStatus: Fact<string>
  amazonStatus: Fact<string>
}

export interface ChannelProductFacts {
  channelProductId: string
  status: Fact<string>
  priceMinor: Fact<number>
  fulfilmentSupplierId: Fact<string | null>
  externalId: Fact<string | null>
}

export interface FactsLoader {
  loadProductFacts(orgId: string, productId: string): Promise<ProductFacts>
  loadSupplierFactsForProduct(orgId: string, supplierId: string, productId: string): Promise<SupplierFacts>
  loadChannelProductFacts(orgId: string, channelProductId: string): Promise<ChannelProductFacts>
}

/** True only when every given fact is fresh — the automation engine's gate before acting on a batch of facts together. */
export function allFactsFresh(...facts: readonly Fact<unknown>[]): boolean {
  return facts.every((f) => f.freshness === 'fresh')
}

export function describeFactState(label: string, fact: Fact<unknown>): string {
  if (fact.freshness === 'unavailable') return `${label}: no record on file.`
  if (fact.freshness === 'unknown') return `${label}: on file, but with no observation time to judge freshness.`
  if (fact.freshness === 'stale') return `${label}: last observed ${fact.asOf}, outside the freshness window.`
  return `${label}: fresh as of ${fact.asOf}.`
}
