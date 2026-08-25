import { describe, expect, it } from 'vitest'
import { buildPriorities } from '@/lib/ceo/priorities'
import { buildBusinessHealthScorecard } from '@/lib/ceo/healthScorecard'
import { resolvePeriod } from '@/lib/orders/salesAggregation'
import { emptySalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { buildFulfilmentAnalytics } from '@/lib/analytics/fulfilmentAnalytics'
import { unavailableAdvertisingAnalytics } from '@/lib/analytics/advertisingAnalytics'
import { unknownDataQualitySummary } from '@/lib/analytics/dataQuality'
import {
  buildAdvertisingScorecard, buildCampaignFact, classifyCampaign, groupCampaignRows, latestCampaignIdentity, sumCampaignRows,
} from '@/lib/analytics/advertisingAnalytics'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { AnalyticsDashboard, AdvertisingIntelligence, CampaignIntelligence } from '@/lib/analytics/repository'
import type { MonitoringStatus } from '@/lib/monitoring/repository'
import type { AutomationStatus } from '@/lib/automation/repository'
import type { ComplianceIssue } from '@/lib/core/domain'
import type { AdvertisingRow } from '@/lib/analytics/liveAdvertisingFacts'

/**
 * Milestone 14's CEO integration: real per-campaign classifications
 * (already fully unit-tested in `tests/advertising-analytics.test.ts`)
 * become real priorities/health-area status — this file proves the
 * *composition*, especially the one genuinely new rule Milestone 14 adds
 * on top of Milestone 11's compliance-visibility work: a scale-opportunity
 * campaign for a compliance-BLOCKED product must never appear as an
 * unrestricted scaling recommendation.
 */

const NOW = '2026-08-24T09:00:00.000Z'
const PERIOD = resolvePeriod('last_30_days', new Date(NOW))

function baseAnalytics(overrides: Partial<AnalyticsDashboard> = {}): AnalyticsDashboard {
  return {
    isDemo: false, period: PERIOD, sales: emptySalesAnalytics(PERIOD, 'GBP'), channels: [],
    topRevenueProducts: [], topProfitProducts: [], lossMakingProducts: [], supplierHealth: [],
    fulfilment: buildFulfilmentAnalytics([]), advertising: unavailableAdvertisingAnalytics(),
    dataQuality: unknownDataQualitySummary(), alerts: [], marketReadiness: [],
    complianceRechecksRequired: 0, automationHealthKnown: true, demoScenarios: [],
    ...overrides,
  }
}

function baseMonitoring(overrides: Partial<MonitoringStatus> = {}): MonitoringStatus {
  return {
    isDemo: false, schedulerConfigured: true,
    systemHealth: { monitorsRegistered: 8, monitorsRunLast24h: 8, monitorsFailedLast24h: 0, monitorsDegraded: 0, monitorsOverdue: [], monitorsNeverRun: [], lastRunByMonitor: {} },
    businessAlerts: { openCriticalEvents: 0, openWarningEvents: 0, unavailableSuppliers: 0, reconciliationProblems: 0, complianceRechecksRequired: 0 },
    supplierIntelligence: { suppliersWithDispatchDelays: [], suppliersWithCancellationIncrease: [], suppliersWithPriceIncreases: [], suppliersWithFeedProblems: [] },
    productIntelligence: { newlyProfitable: [], losingProfitability: [], risingSales: [], decliningSales: [], requiringReview: [] },
    marketplaceIntelligence: { listingsOutOfSync: [], failedExternalActions: [] },
    expansionIntelligence: { fxRatesStale: [], fxSignificantMovements: [], marketsWithProfitabilityDeterioration: [], marketsRequiringComplianceRecheck: [], marketsWithSupplierCapabilityChanges: [], marketsBecameViable: [] },
    marketReadiness: [], recentEvents: [], demoScenarios: [],
    ...overrides,
  }
}

function baseAutomation(overrides: Partial<AutomationStatus> = {}): AutomationStatus {
  return {
    isDemo: false, settings: DEMO_AUTOMATION_SETTINGS,
    today: { actionsTotal: 0, succeeded: 0, failed: 0, blocked: 0, approvalsRequested: 0, approvalsCompleted: 0, productsPaused: 0, suppliersSwitched: 0, spentAutomaticallyMinor: 0, refundsProcessedMinor: 0 },
    risk: { failedActions: 0, blockedActions: 0, deadLetterJobs: 0 },
    recentActions: [], pendingJobs: [], demoScenarios: [],
    productionReadiness: { schedulerConfigured: true, jobsByStatus: {}, externalActionsByVerification: {}, connectors: [] },
    ...overrides,
  }
}

function row(overrides: Partial<AdvertisingRow> = {}): AdvertisingRow {
  return {
    channel: 'amazon_uk', productId: 'p1', campaignName: 'Test Campaign', externalId: 'camp-1',
    periodDate: '2026-08-20', spendMinor: 0, revenueMinor: 0, clicks: 0, impressions: 0, conversions: 0,
    dailyBudgetMinor: null, isPaused: false, provider: 'amazon_ads', externalAccountId: 'acct-1',
    ...overrides,
  }
}

function campaignIntelligence(rows: readonly AdvertisingRow[]): CampaignIntelligence {
  const groups = groupCampaignRows(rows)
  const [key, groupRows] = [...groups.entries()][0]
  const identity = latestCampaignIdentity(key, groupRows)
  const fact = buildCampaignFact(identity, sumCampaignRows(groupRows), 'GBP', PERIOD.start, PERIOD.end)
  const classification = classifyCampaign(fact, DEMO_AUTOMATION_SETTINGS, null)
  return { fact, classification }
}

function adIntelligence(campaigns: readonly CampaignIntelligence[]): AdvertisingIntelligence {
  return {
    isDemo: false, period: PERIOD, campaigns,
    scorecard: buildAdvertisingScorecard(campaigns, null, 'GBP'),
    demoScenarios: [],
  }
}

describe('buildPriorities: advertising priorities (Milestone 14)', () => {
  it('a wasted-spend campaign becomes a CRITICAL advertising_risk priority', () => {
    const wasted = campaignIntelligence(
      Array.from({ length: 14 }, (_, i) => row({ periodDate: `2026-08-${10 + i}`, impressions: 900, clicks: 30, spendMinor: 20000, revenueMinor: 0, conversions: 0 })),
    )
    const priorities = buildPriorities({
      analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(),
      approvals: [], advertisingIntelligence: adIntelligence([wasted]), now: NOW,
    })
    const p = priorities.find((p) => p.id.startsWith('advertising:wasted_spend:'))
    expect(p).toBeDefined()
    expect(p!.severity).toBe('critical')
    expect(p!.category).toBe('advertising_risk')
  })

  it('a below-minimum-ROAS campaign becomes a HIGH severity advertising_risk priority', () => {
    const lowRoas = campaignIntelligence([row({ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 15000, conversions: 20 })]) // ROAS 1.5, below DEMO_AUTOMATION_SETTINGS.minRoas of 3
    const priorities = buildPriorities({
      analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(),
      approvals: [], advertisingIntelligence: adIntelligence([lowRoas]), now: NOW,
    })
    const p = priorities.find((p) => p.id.startsWith('advertising:high_acos_low_roas:'))
    expect(p).toBeDefined()
    expect(p!.severity).toBe('high')
    expect(p!.category).toBe('advertising_risk')
    expect(p!.actionHref).toBe('/advertising')
  })

  it('a genuine scale-opportunity campaign for an unblocked product becomes a low-severity opportunity priority', () => {
    const dailyBudget = 2000
    const rows = Array.from({ length: 30 }, (_, i) => row({
      periodDate: `2026-07-${(26 + i) % 30 || 30}`, impressions: 6000, clicks: 300,
      spendMinor: Math.round(dailyBudget * 0.95), revenueMinor: Math.round(dailyBudget * 0.95 * 10), conversions: 25, dailyBudgetMinor: dailyBudget,
    }))
    const scale = campaignIntelligence(rows)
    const priorities = buildPriorities({
      analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(),
      approvals: [], advertisingIntelligence: adIntelligence([scale]), now: NOW,
    })
    const p = priorities.find((p) => p.id.startsWith('advertising:scale:'))
    expect(p).toBeDefined()
    expect(p!.category).toBe('opportunity')
    expect(p!.severity).toBe('low')
  })

  it('COMPLIANCE OVERRIDE: the same scale-opportunity campaign for a compliance-BLOCKED product never becomes an unrestricted scaling recommendation', () => {
    const dailyBudget = 2000
    const rows = Array.from({ length: 30 }, (_, i) => row({
      periodDate: `2026-07-${(26 + i) % 30 || 30}`, impressions: 6000, clicks: 300,
      spendMinor: Math.round(dailyBudget * 0.95), revenueMinor: Math.round(dailyBudget * 0.95 * 10), conversions: 25, dailyBudgetMinor: dailyBudget,
    }))
    const scale = campaignIntelligence(rows)
    const complianceIssues: ComplianceIssue[] = [{ productId: 'p1', sku: 'CMO-1001', title: 'Test product', channel: 'amazon_uk', verdict: 'fail', blockingReasons: ['x'], assessedAt: NOW }]

    const priorities = buildPriorities({
      analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(),
      approvals: [], complianceIssues, advertisingIntelligence: adIntelligence([scale]), now: NOW,
    })

    // No unrestricted "opportunity" priority for this campaign.
    expect(priorities.find((p) => p.id === 'advertising:scale:amazon_uk:camp-1')).toBeUndefined()
    // Instead, an explicit, compliance-aware caution exists.
    const blocked = priorities.find((p) => p.id.startsWith('advertising:scale_blocked:'))
    expect(blocked).toBeDefined()
    expect(blocked!.severity).toBe('high')
    expect(blocked!.category).toBe('advertising_risk')
    expect(blocked!.detail).toContain('compliance')
  })

  it('no advertising priorities are generated when there is no advertising intelligence supplied', () => {
    const priorities = buildPriorities({ analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(), approvals: [], now: NOW })
    expect(priorities.some((p) => p.category === 'advertising_risk' || p.id.startsWith('advertising:'))).toBe(false)
  })
})

describe('buildBusinessHealthScorecard: advertising area (Milestone 14)', () => {
  it('is UNKNOWN when no advertising intelligence is supplied — never healthy by default', () => {
    const scorecard = buildBusinessHealthScorecard({ analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation() })
    const area = scorecard.areas.find((a) => a.key === 'advertising')!
    expect(area.status).toBe('unknown')
  })

  it('is CRITICAL when a campaign is wasting spend, and drives the overall status', () => {
    const wasted = campaignIntelligence(
      Array.from({ length: 14 }, (_, i) => row({ periodDate: `2026-08-${10 + i}`, impressions: 900, clicks: 30, spendMinor: 20000, revenueMinor: 0, conversions: 0 })),
    )
    const scorecard = buildBusinessHealthScorecard({
      analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(), advertisingIntelligence: adIntelligence([wasted]),
    })
    const area = scorecard.areas.find((a) => a.key === 'advertising')!
    expect(area.status).toBe('critical')
    expect(area.reasons.length).toBeGreaterThan(0)
    expect(scorecard.overall).toBe('critical')
  })

  it('is HEALTHY when every campaign is healthy', () => {
    const healthy = campaignIntelligence(
      Array.from({ length: 20 }, (_, i) => row({ periodDate: `2026-08-${1 + (i % 20)}`, impressions: 5000, clicks: 220, spendMinor: 3000, revenueMinor: 13500, conversions: 24 })),
    )
    const scorecard = buildBusinessHealthScorecard({
      analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(), advertisingIntelligence: adIntelligence([healthy]),
    })
    expect(scorecard.areas.find((a) => a.key === 'advertising')!.status).toBe('healthy')
  })
})
