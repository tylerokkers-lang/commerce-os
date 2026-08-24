import type { AnalyticsDashboard, AdvertisingIntelligence } from '@/lib/analytics/repository'
import type { MonitoringStatus } from '@/lib/monitoring/repository'
import type { AutomationStatus } from '@/lib/automation/repository'
import type { ApprovalItem, ComplianceIssue } from '@/lib/core/domain'

/**
 * The CEO Command Centre (Milestone 11) — a composition/presentation layer
 * over the authoritative engines, never a second one:
 *
 *   Operational systems -> Authoritative engines -> Analytics & BI
 *   (Milestone 10) -> CEO Command Centre (Milestone 11) -> CEO
 *
 * Every type here is assembled from Milestone 6/8/9/10's own return
 * shapes — `AnalyticsDashboard`, `MonitoringStatus`, `AutomationStatus`,
 * `ApprovalItem` — and adds only genuinely new composition/ranking logic
 * (which alert outranks which, which classification an area's health
 * boils down to), never a recalculated metric.
 */

export type PrioritySeverity = 'critical' | 'high' | 'medium' | 'low'

export type PriorityCategory =
  | 'financial_risk' | 'compliance_risk' | 'customer_risk' | 'supplier_failure'
  | 'automation_failure' | 'pending_approval' | 'data_quality' | 'opportunity' | 'advertising_risk'

/** One entry in the executive priority queue — "what needs my attention" / "your priorities today" are the same underlying list. */
export interface Priority {
  id: string
  severity: PrioritySeverity
  category: PriorityCategory
  title: string
  detail: string
  affectedEntityType: string
  affectedEntityId: string | null
  occurredAt: string
  /** Where this fact came from — a real module/function name, never "the system." */
  source: string
  evidence: Record<string, unknown>
  recommendedNextStep: string
  actionRequired: boolean
  /** A real route in this application, or null when there is nowhere specific to drill into. */
  actionHref: string | null
}

export type HealthStatus = 'healthy' | 'watch' | 'at_risk' | 'critical' | 'unknown'

export interface HealthArea {
  key: string
  label: string
  status: HealthStatus
  /** Always non-empty for any status other than `healthy` — an unexplained classification is not allowed. */
  reasons: readonly string[]
  detailHref: string | null
}

export interface BusinessHealthScorecard {
  areas: readonly HealthArea[]
  /** The single worst area's status — never a separately-invented blended score. */
  overall: HealthStatus
}

export interface ExecutiveSummary {
  isDemo: boolean
  periodLabel: string
  revenue: AnalyticsDashboard['sales']['revenue']
  netRevenue: AnalyticsDashboard['sales']['netRevenue']
  orders: AnalyticsDashboard['sales']['orders']
  averageOrderValue: AnalyticsDashboard['sales']['averageOrderValue']
  refundsValue: AnalyticsDashboard['sales']['refundsValue']
  refundRatePct: AnalyticsDashboard['sales']['refundRatePct']
  returnRatePct: AnalyticsDashboard['sales']['returnRatePct']
  /** The best-known net margin across every channel with a calculated projection — null when nothing is known. */
  knownNetMarginPct: number | null
  /** True only when at least one channel's profit projection is fully known — otherwise net profit is necessarily incomplete. */
  profitDataComplete: boolean
}

export interface CEOCommandCentre {
  isDemo: boolean
  generatedAt: string
  executiveSummary: ExecutiveSummary
  priorities: readonly Priority[]
  businessHealth: BusinessHealthScorecard
  financialPerformance: AnalyticsDashboard
  supplierHealth: AnalyticsDashboard['supplierHealth']
  fulfilmentHealth: AnalyticsDashboard['fulfilment']
  marketReadiness: MonitoringStatus['marketReadiness']
  automationHealth: AutomationStatus
  approvals: readonly ApprovalItem[]
  /** Every product-channel listing currently `fail` (blocked) or `review_required` — the same real, org-scoped `compliance_records` read `/compliance` already uses (Milestone 1/2), never a second compliance engine. */
  complianceIssues: readonly ComplianceIssue[]
  /** Milestone 14 — real per-campaign classification and the org-wide scorecard, from `analytics/repository.ts`'s `getAdvertisingIntelligence()`, never a second analysis engine. */
  advertisingIntelligence: AdvertisingIntelligence
  dataQuality: AnalyticsDashboard['dataQuality']
  recentActivity: readonly RecentActivityItem[]
  demoScenarios: readonly CEODemoScenario[]
  /**
   * Non-empty only when one of the four underlying sources
   * (`analytics`/`monitoring`/`automation`/`approvals`) genuinely failed to
   * load — Milestone 11 §22/§25's explicit "one broken data source must
   * never crash the entire dashboard" requirement. When a source is
   * listed here, every field this page derives from it falls back to a
   * safe empty/unknown value rather than throwing, and the UI must say so
   * rather than silently rendering the fallback as if it were real.
   */
  dataSourceFailures: readonly string[]
}

/** Defined here (not in `demo/ceo.ts`) so `CEOCommandCentre` can reference it without a circular import — `demo/ceo.ts` imports this type, never the reverse. */
export interface CEODemoScenario {
  key: string
  label: string
  description: string
  narrative: readonly string[]
}

export type ActivityCategory = 'financial' | 'supplier' | 'product' | 'marketplace' | 'automation' | 'compliance'

export interface RecentActivityItem {
  id: string
  category: ActivityCategory
  title: string
  detail: string
  occurredAt: string
  source: string
}
