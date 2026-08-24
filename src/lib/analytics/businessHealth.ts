import type { PeriodComparison } from '@/lib/core/compare'
import type { SupplierHealth } from './supplierAnalytics'
import type { DataQualityIssue } from './dataQuality'

/**
 * The business health engine (Milestone 10 §10) — turns already-computed
 * facts (period comparisons, supplier health, data quality issues, market
 * blockers) into the CEO-legible alert feed. Every alert traces back to a
 * concrete input, never a generated narrative: `evidence` carries the
 * actual numbers that produced it, so "revenue down 18%" is always
 * checkable against the comparison that made the claim.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface BusinessAlert {
  key: string
  severity: AlertSeverity
  message: string
  detectedAt: string
  affectedEntityType: string
  affectedEntityId: string | null
  source: string
  /** False for a purely informational fact (e.g. "advertising data unavailable") that no action follows from directly. */
  actionable: boolean
  evidence: Record<string, unknown>
}

export interface BusinessHealthThresholds {
  revenueDeclinePct: number
  profitDeclinePct: number
}

export const DEFAULT_BUSINESS_HEALTH_THRESHOLDS: BusinessHealthThresholds = { revenueDeclinePct: -15, profitDeclinePct: -15 }

/** "Last 30 days" -> "the previous 30 days", not the doubled-up "the previous last 30 days". */
function previousPhrase(periodLabel: string): string {
  return `the previous ${periodLabel.replace(/^Last /i, '').toLowerCase()}`
}

export function revenueDeclineAlert(comparison: PeriodComparison | null, periodLabel: string, now: string, thresholds: BusinessHealthThresholds = DEFAULT_BUSINESS_HEALTH_THRESHOLDS): BusinessAlert | null {
  if (!comparison || comparison.percentChange === null || comparison.percentChange > thresholds.revenueDeclinePct) return null
  return {
    key: 'revenue_decline', severity: 'critical', detectedAt: now, affectedEntityType: 'business', affectedEntityId: null,
    source: 'salesAnalytics: gross revenue vs previous equivalent period',
    message: `Revenue is down ${Math.abs(comparison.percentChange)}% vs ${previousPhrase(periodLabel)}.`,
    actionable: true, evidence: { ...comparison },
  }
}

export function profitDeclineAlert(comparison: PeriodComparison | null, periodLabel: string, now: string, thresholds: BusinessHealthThresholds = DEFAULT_BUSINESS_HEALTH_THRESHOLDS): BusinessAlert | null {
  if (!comparison || comparison.percentChange === null || comparison.percentChange > thresholds.profitDeclinePct) return null
  return {
    key: 'profit_decline', severity: 'critical', detectedAt: now, affectedEntityType: 'business', affectedEntityId: null,
    source: 'profitAnalytics: known net profit vs previous equivalent period',
    message: `Known net profit is down ${Math.abs(comparison.percentChange)}% vs ${previousPhrase(periodLabel)}.`,
    actionable: true, evidence: { ...comparison },
  }
}

/** Revenue growing while known profit falls — the specific "growth masking a margin problem" case the brief calls out by name. */
export function profitDeclineDespiteRevenueGrowthAlert(revenue: PeriodComparison | null, profit: PeriodComparison | null, now: string): BusinessAlert | null {
  if (!revenue || !profit || revenue.percentChange === null || profit.percentChange === null) return null
  if (revenue.percentChange <= 0 || profit.percentChange >= 0) return null
  return {
    key: 'profit_decline_despite_revenue_growth', severity: 'warning', detectedAt: now, affectedEntityType: 'business', affectedEntityId: null,
    source: 'salesAnalytics + profitAnalytics, same period comparison',
    message: `Revenue is up ${revenue.percentChange}% but known net profit is down ${Math.abs(profit.percentChange)}% over the same period — costs or fees are eroding the extra sales.`,
    actionable: true, evidence: { revenue, profit },
  }
}

export function supplierHealthAlerts(suppliers: readonly SupplierHealth[], now: string): readonly BusinessAlert[] {
  return suppliers
    .filter((s) => s.status === 'at_risk' || s.status === 'unavailable')
    .map((s) => ({
      key: `supplier_${s.status}`, severity: s.status === 'unavailable' ? 'critical' as const : 'warning' as const,
      detectedAt: now, affectedEntityType: 'supplier', affectedEntityId: s.supplierId,
      source: 'supplierAnalytics: classifySupplierHealth',
      message: `Supplier ${s.supplierId} is ${s.status === 'unavailable' ? 'unavailable' : 'at risk'}: ${s.reasons.join(' ')}`,
      actionable: true, evidence: { reasons: s.reasons },
    }))
}

export function dataQualityAlerts(issues: readonly DataQualityIssue[], now: string): readonly BusinessAlert[] {
  return issues.map((issue) => ({
    key: `data_quality_${issue.key}`, severity: issue.severity, detectedAt: now,
    affectedEntityType: 'data_quality', affectedEntityId: null, source: 'dataQuality: buildDataQualitySummary',
    message: issue.message, actionable: issue.severity !== 'info', evidence: { affectedCount: issue.affectedCount },
  }))
}

export interface MarketBlockedInput {
  marketKey: string
  reason: string
}

export function marketBlockedAlerts(blocked: readonly MarketBlockedInput[], now: string): readonly BusinessAlert[] {
  return blocked.map((b) => ({
    key: 'market_expansion_blocked', severity: 'info' as const, detectedAt: now, affectedEntityType: 'market', affectedEntityId: b.marketKey,
    source: 'markets/expansion.ts: evaluateMarketExpansion', message: `${b.marketKey} expansion is blocked: ${b.reason}`,
    actionable: false, evidence: { reason: b.reason },
  }))
}
