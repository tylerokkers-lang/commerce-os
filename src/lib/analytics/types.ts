import type { Period } from '@/lib/orders/salesAggregation'
import type { PeriodComparison } from '@/lib/core/compare'

/**
 * The analytics fact-status vocabulary (Milestone 10 §1, extending
 * `docs/PRINCIPLES.md` §1's five-category framework with the two
 * additional states the brief specifically asked for: STALE and
 * UNAVAILABLE, both of which already exist as `Freshness` values in
 * `automation/factsTypes.ts` — reused here by name rather than reinvented,
 * so "stale" means the same thing everywhere in this codebase).
 *
 * Every analytics figure is wrapped in a `Metric<T>` carrying one of these,
 * never a bare number: a missing cost is not a zero cost, a stale FX rate
 * is not a fresh one, and an absent advertising connector is not zero
 * spend. `docs/PRINCIPLES.md` §1's five labels map onto these seven states
 * as: FACT -> `fact`; CALCULATION -> `calculated`; a derived-but-imprecise
 * figure (e.g. a heuristic like `REFUND_REASONS_COUNTED_AS_RETURNS`) ->
 * `derived`; PREDICTION -> `estimate` (this milestone deliberately does not
 * produce any `estimate` metrics — see `docs/MILESTONES.md`, "no AI
 * prediction engine"); and the three ways a figure can be genuinely absent
 * -> `unknown` / `stale` / `unavailable`.
 */
export type FactStatus =
  | 'fact'         // Directly observed/retrieved (a real order row, a real event).
  | 'calculated'   // Deterministic arithmetic over fact inputs (e.g. calculateProfitability's output).
  | 'derived'      // A reasonable, documented heuristic over facts (e.g. which refund reasons count as a return).
  | 'estimate'     // A prediction with uncertainty — unused by Milestone 10 itself, reserved for a future layer.
  | 'unknown'      // A record exists but carries no timestamp to judge freshness by.
  | 'stale'        // A record exists, was observed, but is older than its use case's freshness window.
  | 'unavailable'  // No record exists at all.

export interface Metric<T> {
  value: T | null
  status: FactStatus
  /** Where this figure came from, or why it is missing — always shown, never left for the reader to guess. */
  source: string
  /** When the underlying fact was last observed, if ever. */
  asOf?: string | null
}

export const factMetric = <T>(value: T, source: string, asOf?: string | null): Metric<T> => ({ value, status: 'fact', source, asOf: asOf ?? null })
export const calculatedMetric = <T>(value: T, source: string, asOf?: string | null): Metric<T> => ({ value, status: 'calculated', source, asOf: asOf ?? null })
export const derivedMetric = <T>(value: T, source: string, asOf?: string | null): Metric<T> => ({ value, status: 'derived', source, asOf: asOf ?? null })
export const staleMetric = <T>(value: T, source: string, asOf: string | null): Metric<T> => ({ value, status: 'stale', source, asOf })
export const unknownMetric = <T>(source: string): Metric<T> => ({ value: null, status: 'unknown', source, asOf: null })
export const unavailableMetric = <T>(source: string): Metric<T> => ({ value: null, status: 'unavailable', source, asOf: null })

/** True only for metrics a caller may safely treat as a real number — `unknown`/`stale`/`unavailable` metrics must never silently participate in a sum as if they were zero. */
export function isKnown<T>(metric: Metric<T>): metric is Metric<T> & { value: T } {
  return metric.value !== null && (metric.status === 'fact' || metric.status === 'calculated' || metric.status === 'derived' || metric.status === 'estimate')
}

/** A period figure paired with its comparison against the previous equivalent period — the shape every analytics function returns for a trend-bearing number. */
export interface PeriodMetric<T> extends Metric<T> {
  period: Period
  /** Null when no comparable previous-period figure could be computed (e.g. the business itself did not exist yet). */
  comparison: PeriodComparison | null
}
