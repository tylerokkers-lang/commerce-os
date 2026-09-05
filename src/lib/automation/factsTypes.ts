import type { Money } from '@/lib/core/money'
import { MAX_ASSESSMENT_AGE_DAYS as MAX_COMPLIANCE_ASSESSMENT_AGE_DAYS } from '@/lib/orders/complianceRecheck'

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
  supplierOperations: 48, // Connector syncs run on a longer cadence than stock/price checks; two days is a reasonable ceiling before "no news" becomes "no data".
  // Milestone: autonomous decision & capability layer — a pre-launch
  // candidate's score/recommendation is only ever recomputed today by a
  // human importing it or clicking "recalculate" (`products/actions.ts`),
  // so two weeks is a deliberately generous ceiling before "no news" here
  // becomes "no data" — shorter than that would flag every candidate as
  // stale on day one of this monitor existing.
  candidateIntelligence: 24 * 14,
  // Milestone: continuous candidate lifecycle. Neither number is new:
  // compliance reuses `decideComplianceRecheck`'s own long-established
  // 90-day `MAX_ASSESSMENT_AGE_DAYS` (`orders/complianceRecheck.ts`), so
  // there is exactly one compliance-staleness rule in the codebase rather
  // than two that can drift apart. Profitability is deliberately pinned to
  // `supplierPricing` above: a profitability verdict is only ever as fresh
  // as the most volatile input it was computed from, and that is the
  // supplier's unit cost — treating the verdict as fresher than its own
  // inputs would be exactly the kind of quiet fabrication this model exists
  // to prevent.
  complianceVerdict: 24 * MAX_COMPLIANCE_ASSESSMENT_AGE_DAYS,
  profitabilityVerdict: 24,
} as const

export interface ProductFacts {
  productId: string
  title: Fact<string>
  category: Fact<string | null>
  stage: Fact<string>
  /** The operator's Commerce-OS decision (`products/decisionGate.ts` is the single source of truth for what it permits) — never defaulted to a permissive value when missing. */
  decision: Fact<string>
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

/**
 * Supplier operational facts (Milestone 8.5 §5) — dispatch time, delivery
 * performance, cancellation rate, and connector feed health. Dispatch and
 * cancellation figures come from `supplier_products` columns the connector
 * sync already populates (Milestone 3); delivery days come from actual
 * `shipments` rows (genuinely observed, not the supplier's own quote); feed
 * status comes from the supplier's own `supplier_connectors` row. None of
 * these are computed here — this type only carries them, with freshness,
 * to the monitor that decides whether a change is meaningful.
 */
export interface SupplierOperationalFacts {
  supplierId: string
  dispatchDaysMin: Fact<number | null>
  dispatchDaysMax: Fact<number | null>
  cancellationRatePct: Fact<number | null>
  fulfilmentSuccessRatePct: Fact<number | null>
  /** Average days from a shipment's own `shipped_at` to `delivered_at`, across the supplier's most recent deliveries. Distinct from the supplier's quoted dispatch/delivery days — this is what actually happened. */
  observedDeliveryDays: Fact<number | null>
  /** The supplier's connector health (`connector_status`), carrying its own freshness so a connector that has never run reads as `unknown`, never `healthy`. */
  connectorStatus: Fact<string | null>
}

/**
 * A pre-launch candidate's last-computed product intelligence (Milestone:
 * autonomous decision & capability layer). Deliberately just the
 * deterministic verdict already produced by `recommendProduct()`
 * (`products/intelligence/recommendation.ts`) — never a new scoring rule —
 * carried with its own freshness so "never computed" (`unavailable`),
 * "computed too long ago" (`stale`) and "computed recently" (`fresh`) are
 * never conflated, per this file's own fact-first discipline.
 */
export interface ProductIntelligenceFacts {
  productId: string
  recommendation: Fact<string>
  recommendationReason: Fact<string>
}

/**
 * The persisted compliance and profitability verdicts for one
 * (product, channel), as current facts (Milestone: continuous candidate
 * lifecycle).
 *
 * Both are genuinely three-state, and the three states are never collapsed:
 * a `value` of `'pass'`/`'fail'` is what the real engine returned, while
 * `'not_assessed'` — or a `freshness` of `unavailable`/`stale` — means the
 * lifecycle gate does not know, which is never the same thing as a failure
 * and absolutely never the same thing as a pass.
 */
export interface LifecycleVerdictFacts {
  productId: string
  channel: string
  /** `'pass' | 'fail' | 'review_required' | 'not_assessed'` — `compliance_records.verdict`. */
  compliance: Fact<string>
  /** `'pass' | 'fail' | 'not_assessed'` — `profitability_records.verdict`. */
  profitability: Fact<string>
  /** Why the stored verdict is what it is, for the operator-facing reason string. Empty when it passed. */
  complianceBlockingReasons: readonly string[]
  profitabilityFailureReasons: readonly string[]
}

export interface FactsLoader {
  loadProductFacts(orgId: string, productId: string): Promise<ProductFacts>
  loadSupplierFactsForProduct(orgId: string, supplierId: string, productId: string): Promise<SupplierFacts>
  loadChannelProductFacts(orgId: string, channelProductId: string): Promise<ChannelProductFacts>
  loadSupplierOperationalFacts(orgId: string, supplierId: string): Promise<SupplierOperationalFacts>
  loadProductIntelligenceFacts(orgId: string, productId: string): Promise<ProductIntelligenceFacts>
  loadLifecycleVerdictFacts(orgId: string, productId: string, channel: string): Promise<LifecycleVerdictFacts>
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
