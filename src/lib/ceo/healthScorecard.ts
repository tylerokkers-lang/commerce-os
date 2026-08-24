import type { AnalyticsDashboard, AdvertisingIntelligence } from '@/lib/analytics/repository'
import type { MonitoringStatus } from '@/lib/monitoring/repository'
import type { AutomationStatus } from '@/lib/automation/repository'
import type { ComplianceIssue } from '@/lib/core/domain'
import type { BusinessHealthScorecard, HealthArea, HealthStatus } from './types'

/**
 * The business health scorecard (Milestone 11 §3) — deterministic
 * classifications built entirely from facts Milestones 6/8/9/10 already
 * compute (`AnalyticsDashboard`, `MonitoringStatus`, `AutomationStatus`).
 * No new score is invented anywhere in this file: every rule below reads
 * an existing count, classification, or status and maps it onto
 * HEALTHY/WATCH/AT_RISK/CRITICAL/UNKNOWN with a stated reason — the same
 * discipline `analytics/supplierAnalytics.ts`'s `classifySupplierHealth`
 * already established for one area, extended here across all of them.
 */

const STATUS_RANK: Record<HealthStatus, number> = { healthy: 0, unknown: 1, watch: 2, at_risk: 3, critical: 4 }

export interface BuildScorecardInput {
  analytics: AnalyticsDashboard
  monitoring: MonitoringStatus
  automation: AutomationStatus
  /** Optional so every pre-existing call site (tests, demo scenarios not focused on compliance) keeps working unchanged — defaults to no known issues, never a guess. */
  complianceIssues?: readonly ComplianceIssue[]
  /** Optional for the same reason — defaults to no campaigns, never a guess (Milestone 14). */
  advertisingIntelligence?: AdvertisingIntelligence
}

function financialArea(analytics: AnalyticsDashboard): HealthArea {
  if (analytics.isDemo) return { key: 'financial', label: 'Financial', status: 'unknown', reasons: ['Demo mode has no live sales data.'], detailHref: null }

  const lossMakingByChannel = new Map<string, number>()
  for (const p of analytics.lossMakingProducts) lossMakingByChannel.set(p.channel, (lossMakingByChannel.get(p.channel) ?? 0) + 1)
  const worstChannelCount = Math.max(0, ...lossMakingByChannel.values())
  const financialAlerts = analytics.alerts.filter((a) => a.key.startsWith('revenue_decline') || a.key.startsWith('profit_decline'))
  const criticalFinancialAlert = financialAlerts.some((a) => a.severity === 'critical')

  if (worstChannelCount >= 3 || criticalFinancialAlert) {
    return { key: 'financial', label: 'Financial', status: 'critical', reasons: [worstChannelCount >= 3 ? `${worstChannelCount} products are loss-making on one channel.` : financialAlerts[0].message], detailHref: '/opportunities' }
  }
  if (analytics.lossMakingProducts.length > 0 || financialAlerts.length > 0) {
    return { key: 'financial', label: 'Financial', status: 'at_risk', reasons: [...(analytics.lossMakingProducts.length > 0 ? [`${analytics.lossMakingProducts.length} product(s) are currently loss-making.`] : []), ...financialAlerts.map((a) => a.message)], detailHref: '/opportunities' }
  }
  if (analytics.channels.some((c) => c.profit.productsWithUnknownProfit > 0)) {
    return { key: 'financial', label: 'Financial', status: 'watch', reasons: ['Some products have no known price or cost, so profit figures are incomplete.'], detailHref: null }
  }
  return { key: 'financial', label: 'Financial', status: 'healthy', reasons: [], detailHref: null }
}

function productArea(analytics: AnalyticsDashboard): HealthArea {
  if (analytics.isDemo) return { key: 'product', label: 'Product', status: 'unknown', reasons: ['Demo mode has no live product performance data.'], detailHref: null }
  if (analytics.lossMakingProducts.length >= 3) {
    return { key: 'product', label: 'Product', status: 'critical', reasons: [`${analytics.lossMakingProducts.length} products are loss-making.`], detailHref: '/opportunities' }
  }
  if (analytics.lossMakingProducts.length > 0) {
    return { key: 'product', label: 'Product', status: 'at_risk', reasons: [`${analytics.lossMakingProducts.length} product(s) are loss-making.`], detailHref: '/opportunities' }
  }
  const unknownProfitProducts = analytics.channels.reduce((sum, c) => sum + c.profit.productsWithUnknownProfit, 0)
  if (unknownProfitProducts > 0) {
    return { key: 'product', label: 'Product', status: 'watch', reasons: [`${unknownProfitProducts} product-channel combination(s) have an unknown profit projection.`], detailHref: null }
  }
  return { key: 'product', label: 'Product', status: 'healthy', reasons: [], detailHref: null }
}

function supplierArea(analytics: AnalyticsDashboard): HealthArea {
  if (analytics.isDemo || analytics.supplierHealth.length === 0) {
    return { key: 'supplier', label: 'Supplier', status: 'unknown', reasons: ['No live supplier data yet.'], detailHref: null }
  }
  const unavailable = analytics.supplierHealth.filter((s) => s.status === 'unavailable')
  const atRisk = analytics.supplierHealth.filter((s) => s.status === 'at_risk')
  const watch = analytics.supplierHealth.filter((s) => s.status === 'watch')
  if (unavailable.length > 0) return { key: 'supplier', label: 'Supplier', status: 'critical', reasons: unavailable.flatMap((s) => s.reasons), detailHref: '/suppliers' }
  if (atRisk.length > 0) return { key: 'supplier', label: 'Supplier', status: 'at_risk', reasons: atRisk.flatMap((s) => s.reasons), detailHref: '/suppliers' }
  if (watch.length > 0) return { key: 'supplier', label: 'Supplier', status: 'watch', reasons: watch.flatMap((s) => s.reasons), detailHref: '/suppliers' }
  return { key: 'supplier', label: 'Supplier', status: 'healthy', reasons: [], detailHref: null }
}

function marketplaceArea(monitoring: MonitoringStatus): HealthArea {
  // Only markets with a real connector configured today (never 'planned') count toward this area — a market this business has never operated on is not a health problem.
  const configured = monitoring.marketReadiness.filter((m) => m.status !== 'planned')
  if (monitoring.isDemo || configured.length === 0) return { key: 'marketplace', label: 'Marketplace', status: 'unknown', reasons: ['No configured marketplace connector to assess yet.'], detailHref: null }

  const errored = configured.filter((m) => m.status === 'error')
  const degraded = configured.filter((m) => m.status === 'degraded')
  const notConfigured = configured.filter((m) => m.status === 'not_configured')
  if (errored.length > 0) return { key: 'marketplace', label: 'Marketplace', status: 'critical', reasons: errored.map((m) => `${m.label} is reporting an error.`), detailHref: '/marketplaces' }
  if (degraded.length > 0) return { key: 'marketplace', label: 'Marketplace', status: 'at_risk', reasons: degraded.map((m) => `${m.label} is degraded.`), detailHref: '/marketplaces' }
  if (notConfigured.length > 0) return { key: 'marketplace', label: 'Marketplace', status: 'watch', reasons: notConfigured.map((m) => `${m.label} has no live credentials configured.`), detailHref: '/marketplaces' }
  return { key: 'marketplace', label: 'Marketplace', status: 'healthy', reasons: [], detailHref: '/marketplaces' }
}

const FULFILMENT_CRITICAL_CANCELLATION_PCT = 20
const FULFILMENT_AT_RISK_CANCELLATION_PCT = 10
const FULFILMENT_CRITICAL_ON_TIME_PCT = 50
const FULFILMENT_AT_RISK_ON_TIME_PCT = 80

function fulfilmentArea(analytics: AnalyticsDashboard): HealthArea {
  if (analytics.isDemo) return { key: 'fulfilment', label: 'Fulfilment', status: 'unknown', reasons: ['Demo mode has no live fulfilment data.'], detailHref: null }
  const cancellation = analytics.fulfilment.cancellationRatePct
  const onTime = analytics.fulfilment.onTimeDeliveryRatePct
  const cancellationKnown = cancellation.status === 'calculated' && typeof cancellation.value === 'number'
  const onTimeKnown = onTime.status === 'calculated' && typeof onTime.value === 'number'

  if (!cancellationKnown && !onTimeKnown) return { key: 'fulfilment', label: 'Fulfilment', status: 'unknown', reasons: ['No fulfilments recorded yet to assess.'], detailHref: null }

  const cancellationPct = cancellationKnown ? (cancellation.value as number) : 0
  const onTimePct = onTimeKnown ? (onTime.value as number) : 100

  if (cancellationPct > FULFILMENT_CRITICAL_CANCELLATION_PCT || onTimePct < FULFILMENT_CRITICAL_ON_TIME_PCT) {
    return { key: 'fulfilment', label: 'Fulfilment', status: 'critical', reasons: [`Cancellation rate ${cancellationPct}%, on-time delivery ${onTimePct}%.`], detailHref: '/orders' }
  }
  if (cancellationPct > FULFILMENT_AT_RISK_CANCELLATION_PCT || onTimePct < FULFILMENT_AT_RISK_ON_TIME_PCT) {
    return { key: 'fulfilment', label: 'Fulfilment', status: 'at_risk', reasons: [`Cancellation rate ${cancellationPct}%, on-time delivery ${onTimePct}%.`], detailHref: '/orders' }
  }
  const missingTracking = analytics.fulfilment.missingTracking
  if (missingTracking.status === 'fact' && (missingTracking.value as number) > 0) {
    return { key: 'fulfilment', label: 'Fulfilment', status: 'watch', reasons: [`${missingTracking.value} shipment(s) have no tracking number.`], detailHref: '/orders' }
  }
  return { key: 'fulfilment', label: 'Fulfilment', status: 'healthy', reasons: [], detailHref: '/orders' }
}

function complianceArea(monitoring: MonitoringStatus, complianceIssues: readonly ComplianceIssue[]): HealthArea {
  if (monitoring.isDemo) return { key: 'compliance', label: 'Compliance', status: 'unknown', reasons: ['Demo mode has no live compliance data.'], detailHref: null }

  // A `fail` verdict is a fatal decision already made — never a mere
  // "needs review" — so it is the one condition that makes this area
  // CRITICAL, distinct from `review_required`/rechecks, which are AT_RISK.
  const blocked = complianceIssues.filter((i) => i.verdict === 'fail')
  if (blocked.length > 0) {
    return {
      key: 'compliance', label: 'Compliance', status: 'critical',
      reasons: [`${blocked.length} product(s) are blocked by compliance (never bypassed automatically).`],
      detailHref: '/compliance',
    }
  }

  const reviewRequired = complianceIssues.filter((i) => i.verdict === 'review_required')
  const required = monitoring.businessAlerts.complianceRechecksRequired
  if (reviewRequired.length > 0 || required > 0) {
    const reasons: string[] = []
    if (reviewRequired.length > 0) reasons.push(`${reviewRequired.length} product(s) need compliance review.`)
    if (required > 0) reasons.push(`${required} listing(s) require a compliance recheck.`)
    return { key: 'compliance', label: 'Compliance', status: 'at_risk', reasons, detailHref: '/compliance' }
  }
  return { key: 'compliance', label: 'Compliance', status: 'healthy', reasons: [], detailHref: '/compliance' }
}

/**
 * Milestone 14 — reads `AdvertisingIntelligence.scorecard`, already built
 * by the real classification engine (`analytics/advertisingAnalytics.ts`'s
 * `buildAdvertisingScorecard`); this function only maps that scorecard's
 * own `AdvertisingHealthStatus` onto the CEO scorecard's shared
 * `HealthStatus` vocabulary — never a second classification of anything.
 */
function advertisingArea(advertising: AdvertisingIntelligence | undefined): HealthArea {
  if (!advertising || advertising.isDemo) return { key: 'advertising', label: 'Advertising', status: 'unknown', reasons: ['Demo mode has no live advertising data.'], detailHref: null }
  if (advertising.scorecard.totalCampaigns === 0) return { key: 'advertising', label: 'Advertising', status: 'unknown', reasons: ['No advertising campaigns recorded for this period.'], detailHref: null }

  const { byClassification } = advertising.scorecard
  const reasons: string[] = []
  if (byClassification.wasted_spend > 0) reasons.push(`${byClassification.wasted_spend} campaign(s) are wasting spend.`)
  if (byClassification.poor_profitability > 0) reasons.push(`${byClassification.poor_profitability} campaign(s) exceed their break-even advertising cost.`)
  if (byClassification.high_acos_low_roas > 0) reasons.push(`${byClassification.high_acos_low_roas} campaign(s) are below the configured minimum ROAS.`)
  if (byClassification.declining_performance > 0) reasons.push(`${byClassification.declining_performance} campaign(s) have declined against the prior period.`)

  const ADVERTISING_STATUS_MAP: Record<string, HealthStatus> = { critical: 'critical', at_risk: 'at_risk', review: 'watch', scale_opportunity: 'healthy', healthy: 'healthy', insufficient_data: 'unknown' }
  const status = ADVERTISING_STATUS_MAP[advertising.scorecard.overall] ?? 'unknown'

  return { key: 'advertising', label: 'Advertising', status, reasons, detailHref: '/advertising' }
}

function automationArea(automation: AutomationStatus): HealthArea {
  if (automation.isDemo) return { key: 'automation', label: 'Automation', status: 'unknown', reasons: ['Demo mode has no live job queue.'], detailHref: null }
  if (automation.settings.automationPaused) {
    return { key: 'automation', label: 'Automation', status: 'critical', reasons: [automation.settings.automationPausedReason ?? 'All automation is paused.'], detailHref: '/automation' }
  }
  if (automation.risk.deadLetterJobs > 0 || automation.risk.failedActions > 0) {
    return { key: 'automation', label: 'Automation', status: 'at_risk', reasons: [`${automation.risk.failedActions} failed action(s), ${automation.risk.deadLetterJobs} dead-lettered job(s).`], detailHref: '/automation' }
  }
  if (automation.settings.automationPausedCategories.length > 0) {
    return { key: 'automation', label: 'Automation', status: 'watch', reasons: [`Paused categories: ${automation.settings.automationPausedCategories.join(', ')}.`], detailHref: '/automation' }
  }
  return { key: 'automation', label: 'Automation', status: 'healthy', reasons: [], detailHref: '/automation' }
}

function dataQualityArea(analytics: AnalyticsDashboard): HealthArea {
  if (analytics.dataQuality.overallStatus === 'unknown') return { key: 'data_quality', label: 'Data quality', status: 'unknown', reasons: ['No live data to check yet.'], detailHref: null }
  if (analytics.dataQuality.overallStatus === 'complete') return { key: 'data_quality', label: 'Data quality', status: 'healthy', reasons: [], detailHref: null }

  const warnings = analytics.dataQuality.issues.filter((i) => i.severity === 'warning' || i.severity === 'critical')
  // Info-severity issues (today, only "no advertising connector configured" — a
  // permanent, structural fact of this codebase, not a resolvable gap) never
  // pull this area below healthy on their own: they are surfaced prominently
  // in the dedicated "Can I trust these numbers?" section instead. Without
  // this, "advertising unavailable" would classify every business, however
  // healthy, as data-quality WATCH forever, which is exactly the noise
  // `docs/PRINCIPLES.md`'s fact-first rule and the brief's "never create
  // false confidence" both warn against creating in the other direction.
  if (warnings.length === 0) return { key: 'data_quality', label: 'Data quality', status: 'healthy', reasons: [], detailHref: null }
  return {
    key: 'data_quality', label: 'Data quality',
    status: 'at_risk',
    reasons: warnings.map((i) => i.message),
    detailHref: null,
  }
}

export function buildBusinessHealthScorecard(input: BuildScorecardInput): BusinessHealthScorecard {
  const areas: HealthArea[] = [
    financialArea(input.analytics),
    productArea(input.analytics),
    supplierArea(input.analytics),
    marketplaceArea(input.monitoring),
    fulfilmentArea(input.analytics),
    complianceArea(input.monitoring, input.complianceIssues ?? []),
    advertisingArea(input.advertisingIntelligence),
    automationArea(input.automation),
    dataQualityArea(input.analytics),
  ]

  // The overall status is the single worst area, never a separately-invented blended score — `unknown` only wins when nothing worse exists, so one real problem is never hidden behind a sea of "no live data yet" areas in a partially-connected business.
  const overall = areas.reduce<HealthStatus>((worst, area) => (STATUS_RANK[area.status] > STATUS_RANK[worst] ? area.status : worst), 'healthy')

  return { areas, overall }
}
