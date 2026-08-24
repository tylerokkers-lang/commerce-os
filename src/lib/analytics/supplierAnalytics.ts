/**
 * Supplier analytics (Milestone 10 §7) — a deterministic health
 * classification built entirely from facts the Milestone 3/8.5 supplier
 * infrastructure already produces (`SupplierOperationalFacts`, and the
 * `/automation` page's own supplier-intelligence open-event drill-downs).
 * No new supplier scoring engine: `suppliers/scoring.ts`'s `scoreSupplier`
 * already answers "should we use this supplier"; this answers the
 * genuinely different question "is this supplier's *service* currently
 * degrading" — the same distinction `HANDOVER.md` §22 already draws when
 * it explains why operational facts were kept out of `scoreSupplier`'s
 * weighted total.
 */

export type SupplierHealthStatus = 'healthy' | 'watch' | 'at_risk' | 'unavailable' | 'unknown'

export interface SupplierHealthInput {
  supplierId: string
  connectorStatus: string | null
  connectorStatusKnown: boolean
  hasDispatchDelayEvent: boolean
  hasCancellationIncreaseEvent: boolean
  hasFeedProblemEvent: boolean
  cancellationRatePct: number | null
  fulfilmentSuccessRatePct: number | null
}

export interface SupplierHealth {
  supplierId: string
  status: SupplierHealthStatus
  /** Always non-empty for `watch`/`at_risk`/`unavailable` — a classification with no stated reason is not allowed, per the brief's "must be explainable." */
  reasons: readonly string[]
}

export interface SupplierHealthThresholds {
  atRiskFulfilmentSuccessRatePct: number
  atRiskCancellationRatePct: number
}

export const DEFAULT_SUPPLIER_HEALTH_THRESHOLDS: SupplierHealthThresholds = {
  atRiskFulfilmentSuccessRatePct: 80, atRiskCancellationRatePct: 10,
}

export function classifySupplierHealth(input: SupplierHealthInput, thresholds: SupplierHealthThresholds = DEFAULT_SUPPLIER_HEALTH_THRESHOLDS): SupplierHealth {
  const reasons: string[] = []

  const hasAnyFact = input.connectorStatusKnown || input.cancellationRatePct !== null || input.fulfilmentSuccessRatePct !== null

  if (input.hasFeedProblemEvent || input.connectorStatus === 'failing') {
    reasons.push(input.hasFeedProblemEvent ? 'Supplier feed is failed or stale — no fresh operational data is coming in.' : 'Supplier connector is reporting a failing state.')
    return { supplierId: input.supplierId, status: 'unavailable', reasons }
  }

  if (!hasAnyFact) {
    return { supplierId: input.supplierId, status: 'unknown', reasons: ['No operational facts have ever been observed for this supplier.'] }
  }

  if (input.fulfilmentSuccessRatePct !== null && input.fulfilmentSuccessRatePct < thresholds.atRiskFulfilmentSuccessRatePct) {
    reasons.push(`Fulfilment success rate is ${input.fulfilmentSuccessRatePct}%, below the ${thresholds.atRiskFulfilmentSuccessRatePct}% threshold.`)
  }
  if (input.hasCancellationIncreaseEvent || (input.cancellationRatePct !== null && input.cancellationRatePct > thresholds.atRiskCancellationRatePct)) {
    reasons.push(
      input.cancellationRatePct !== null
        ? `Cancellation rate is ${input.cancellationRatePct}%, above the ${thresholds.atRiskCancellationRatePct}% threshold.`
        : 'An open cancellation-rate-increase event exists for this supplier.',
    )
  }
  if (reasons.length > 0) return { supplierId: input.supplierId, status: 'at_risk', reasons }

  if (input.hasDispatchDelayEvent || input.connectorStatus === 'degraded') {
    return {
      supplierId: input.supplierId, status: 'watch',
      reasons: [input.hasDispatchDelayEvent ? 'An open dispatch-delay event exists for this supplier.' : 'Supplier connector is reporting a degraded state.'],
    }
  }

  return { supplierId: input.supplierId, status: 'healthy', reasons: [] }
}
