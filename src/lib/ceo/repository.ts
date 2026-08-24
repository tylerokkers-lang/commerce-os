import 'server-only'

import { requireSession } from '@/lib/security/session'
import { getAnalyticsDashboard, type AnalyticsDashboard } from '@/lib/analytics/repository'
import { getMonitoringStatus, type MonitoringStatus } from '@/lib/monitoring/repository'
import { getAutomationStatus, type AutomationStatus } from '@/lib/automation/repository'
import { getPendingApprovals } from '@/lib/automation/approvals'
import { getComplianceIssues } from '@/lib/compliance/repository'
import { buildPriorities } from './priorities'
import { buildBusinessHealthScorecard } from './healthScorecard'
import { demoCEOScenarios } from '@/lib/demo/ceo'
import { resolvePeriod } from '@/lib/orders/salesAggregation'
import { emptySalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { buildFulfilmentAnalytics } from '@/lib/analytics/fulfilmentAnalytics'
import { unavailableAdvertisingAnalytics, buildAdvertisingScorecard } from '@/lib/analytics/advertisingAnalytics'
import { unknownDataQualitySummary } from '@/lib/analytics/dataQuality'
import { getAdvertisingIntelligence, type AdvertisingIntelligence } from '@/lib/analytics/repository'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { CEOCommandCentre, ExecutiveSummary, RecentActivityItem, ActivityCategory } from './types'
import type { DomainEventRow } from '@/lib/monitoring/repository'
import type { AutomationAction } from '@/lib/automation/repository'

/**
 * Safe fallbacks for each of the four underlying sources — used only when
 * that specific source's own call rejected. Each mirrors the shape that
 * source's own "genuinely no data" branch already returns elsewhere in
 * this codebase (the demo branch of `getAnalyticsDashboard`, an empty
 * `MonitoringStatus`), so a degraded dashboard renders exactly like an
 * empty one, plus the explicit `dataSourceFailures` flag the UI checks
 * before treating any of it as real.
 */
function fallbackAnalyticsDashboard(): AnalyticsDashboard {
  const period = resolvePeriod('last_30_days', new Date())
  return {
    isDemo: false, period, sales: emptySalesAnalytics(period, 'GBP'), channels: [],
    topRevenueProducts: [], topProfitProducts: [], lossMakingProducts: [], supplierHealth: [],
    fulfilment: buildFulfilmentAnalytics([]), advertising: unavailableAdvertisingAnalytics(),
    dataQuality: unknownDataQualitySummary(), alerts: [], marketReadiness: [],
    complianceRechecksRequired: 0, automationHealthKnown: false, demoScenarios: [],
  }
}

function fallbackMonitoringStatus(): MonitoringStatus {
  return {
    isDemo: false, schedulerConfigured: false,
    systemHealth: { monitorsRegistered: 0, monitorsRunLast24h: 0, monitorsFailedLast24h: 0, monitorsDegraded: 0, monitorsOverdue: [], monitorsNeverRun: [], lastRunByMonitor: {} },
    businessAlerts: { openCriticalEvents: 0, openWarningEvents: 0, unavailableSuppliers: 0, reconciliationProblems: 0, complianceRechecksRequired: 0 },
    supplierIntelligence: { suppliersWithDispatchDelays: [], suppliersWithCancellationIncrease: [], suppliersWithPriceIncreases: [], suppliersWithFeedProblems: [] },
    productIntelligence: { newlyProfitable: [], losingProfitability: [], risingSales: [], decliningSales: [], requiringReview: [] },
    marketplaceIntelligence: { listingsOutOfSync: [], failedExternalActions: [] },
    expansionIntelligence: { fxRatesStale: [], fxSignificantMovements: [], marketsWithProfitabilityDeterioration: [], marketsRequiringComplianceRecheck: [], marketsWithSupplierCapabilityChanges: [], marketsBecameViable: [] },
    marketReadiness: [], recentEvents: [], demoScenarios: [],
  }
}

function fallbackAdvertisingIntelligence(): AdvertisingIntelligence {
  const period = resolvePeriod('last_30_days', new Date())
  return { isDemo: false, period, campaigns: [], scorecard: buildAdvertisingScorecard([], null, 'GBP'), demoScenarios: [] }
}

function fallbackAutomationStatus(): AutomationStatus {
  return {
    isDemo: false, settings: DEMO_AUTOMATION_SETTINGS,
    today: { actionsTotal: 0, succeeded: 0, failed: 0, blocked: 0, approvalsRequested: 0, approvalsCompleted: 0, productsPaused: 0, suppliersSwitched: 0, spentAutomaticallyMinor: 0, refundsProcessedMinor: 0 },
    risk: { failedActions: 0, blockedActions: 0, deadLetterJobs: 0 },
    recentActions: [], pendingJobs: [], demoScenarios: [],
    productionReadiness: { schedulerConfigured: false, jobsByStatus: {}, externalActionsByVerification: {}, connectors: [] },
  }
}

/**
 * The CEO Command Centre (Milestone 11) — a composition/presentation
 * layer over Milestone 10's `getAnalyticsDashboard()` (business
 * intelligence) plus Milestone 6/8's automation and monitoring status and
 * the existing approvals queue. This function calculates nothing new
 * about the business itself: every number here already exists somewhere
 * else in this codebase, called once and re-shaped for one executive
 * view — the "Analytics & BI -> CEO Command Centre" layering the brief
 * itself draws.
 *
 * One round trip: the four underlying calls run in parallel via
 * `Promise.allSettled`, never a bare `Promise.all` — a single source
 * failing (a transient Supabase error, say) falls back to a safe
 * empty/unknown value and is recorded in `dataSourceFailures`, rather
 * than throwing and taking the whole command centre down with it
 * (Milestone 11 §22/§25's explicit "must fail safely" requirement).
 * `buildPriorities`/`buildBusinessHealthScorecard` are pure functions
 * over whatever results — real or fallback — come back.
 */
export async function getCEOCommandCentre(): Promise<CEOCommandCentre> {
  const session = await requireSession()
  const now = new Date().toISOString()

  const [analyticsResult, monitoringResult, automationResult, approvalsResult, complianceResult, advertisingResult] = await Promise.allSettled([
    getAnalyticsDashboard(),
    getMonitoringStatus(),
    getAutomationStatus(),
    getPendingApprovals(),
    getComplianceIssues(),
    getAdvertisingIntelligence(),
  ])

  const dataSourceFailures: string[] = []
  if (analyticsResult.status === 'rejected') dataSourceFailures.push('analytics')
  if (monitoringResult.status === 'rejected') dataSourceFailures.push('monitoring')
  if (automationResult.status === 'rejected') dataSourceFailures.push('automation')
  if (approvalsResult.status === 'rejected') dataSourceFailures.push('approvals')
  if (complianceResult.status === 'rejected') dataSourceFailures.push('compliance')
  if (advertisingResult.status === 'rejected') dataSourceFailures.push('advertising')

  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : fallbackAnalyticsDashboard()
  const monitoring = monitoringResult.status === 'fulfilled' ? monitoringResult.value : fallbackMonitoringStatus()
  const automation = automationResult.status === 'fulfilled' ? automationResult.value : fallbackAutomationStatus()
  const approvals = approvalsResult.status === 'fulfilled' ? approvalsResult.value : []
  const complianceIssues = complianceResult.status === 'fulfilled' ? complianceResult.value : []
  const advertisingIntelligence = advertisingResult.status === 'fulfilled' ? advertisingResult.value : fallbackAdvertisingIntelligence()

  const priorities = buildPriorities({ analytics, monitoring, automation, approvals, complianceIssues, advertisingIntelligence, now })
  const businessHealth = buildBusinessHealthScorecard({ analytics, monitoring, automation, complianceIssues, advertisingIntelligence })
  const executiveSummary = buildExecutiveSummary(analytics)
  const recentActivity = buildRecentActivity(monitoring.recentEvents, automation.recentActions)

  return {
    isDemo: session.isDemo,
    generatedAt: now,
    executiveSummary,
    priorities,
    businessHealth,
    financialPerformance: analytics,
    supplierHealth: analytics.supplierHealth,
    fulfilmentHealth: analytics.fulfilment,
    marketReadiness: monitoring.marketReadiness,
    automationHealth: automation,
    approvals,
    complianceIssues,
    advertisingIntelligence,
    dataQuality: analytics.dataQuality,
    recentActivity,
    demoScenarios: session.isDemo ? demoCEOScenarios() : [],
    dataSourceFailures,
  }
}

function buildExecutiveSummary(analytics: Awaited<ReturnType<typeof getAnalyticsDashboard>>): ExecutiveSummary {
  const knownMarginChannels = analytics.channels.filter((c) => c.profit.averageNetMarginPct.status === 'calculated' && typeof c.profit.averageNetMarginPct.value === 'number')
  const knownNetMarginPct = knownMarginChannels.length === 0
    ? null
    : Math.round((knownMarginChannels.reduce((sum, c) => sum + (c.profit.averageNetMarginPct.value as number), 0) / knownMarginChannels.length) * 100) / 100
  const profitDataComplete = analytics.channels.length > 0 && analytics.channels.every((c) => c.profit.productsWithUnknownProfit === 0) && knownNetMarginPct !== null

  return {
    isDemo: analytics.isDemo,
    periodLabel: analytics.period.label,
    revenue: analytics.sales.revenue,
    netRevenue: analytics.sales.netRevenue,
    orders: analytics.sales.orders,
    averageOrderValue: analytics.sales.averageOrderValue,
    refundsValue: analytics.sales.refundsValue,
    refundRatePct: analytics.sales.refundRatePct,
    returnRatePct: analytics.sales.returnRatePct,
    knownNetMarginPct,
    profitDataComplete,
  }
}

const EVENT_TYPE_CATEGORY: readonly { prefix: string; category: ActivityCategory }[] = [
  { prefix: 'SUPPLIER_', category: 'supplier' },
  { prefix: 'COMPLIANCE_', category: 'compliance' },
  { prefix: 'LISTING_', category: 'marketplace' },
  { prefix: 'INVENTORY_', category: 'marketplace' },
  { prefix: 'EXTERNAL_ACTION_', category: 'marketplace' },
  { prefix: 'FX_', category: 'marketplace' },
  { prefix: 'MARKET_', category: 'marketplace' },
  { prefix: 'PRODUCT_', category: 'product' },
  { prefix: 'REVENUE_', category: 'product' },
  { prefix: 'AD_SPEND_', category: 'product' },
]

function categoryForEventType(eventType: string): ActivityCategory {
  return EVENT_TYPE_CATEGORY.find((e) => eventType.startsWith(e.prefix))?.category ?? 'automation'
}

const ACTION_TYPE_CATEGORY: readonly { match: string; category: ActivityCategory }[] = [
  { match: 'refund', category: 'financial' },
  { match: 'supplier', category: 'supplier' },
  { match: 'price', category: 'product' },
  { match: 'publish', category: 'product' },
  { match: 'pause_product', category: 'product' },
  { match: 'compliance', category: 'compliance' },
  { match: 'marketplace', category: 'marketplace' },
  { match: 'reconcil', category: 'marketplace' },
]

function categoryForActionType(actionType: string): ActivityCategory {
  return ACTION_TYPE_CATEGORY.find((e) => actionType.includes(e.match))?.category ?? 'automation'
}

const RECENT_ACTIVITY_LIMIT = 20

/** Combines the two existing authoritative activity sources (`domain_events`, `automation_actions`) into one feed — never a second audit log, never re-derived facts. */
function buildRecentActivity(events: readonly DomainEventRow[], actions: readonly AutomationAction[]): readonly RecentActivityItem[] {
  const fromEvents: RecentActivityItem[] = events.map((e) => ({
    id: `event:${e.id}`,
    category: categoryForEventType(e.event_type),
    title: e.event_type.replace(/_/g, ' '),
    detail: `${e.subject_type}${e.subject_id ? ` ${e.subject_id}` : ''} · ${e.status}`,
    occurredAt: e.detected_at,
    source: `monitoring: ${e.source}`,
  }))
  const fromActions: RecentActivityItem[] = actions.map((a) => ({
    id: `action:${a.id}`,
    category: categoryForActionType(a.action_type),
    title: a.action_type.replace(/_/g, ' '),
    detail: `${a.entity_type}${a.entity_id ? ` ${a.entity_id}` : ''} · ${a.status}`,
    occurredAt: a.created_at,
    source: 'automation: automation_actions',
  }))

  return [...fromEvents, ...fromActions]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT)
}
