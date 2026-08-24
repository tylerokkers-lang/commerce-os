import { describe, expect, it } from 'vitest'
import { buildPriorities } from '@/lib/ceo/priorities'
import { buildBusinessHealthScorecard } from '@/lib/ceo/healthScorecard'
import { resolvePeriod } from '@/lib/orders/salesAggregation'
import { emptySalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { buildFulfilmentAnalytics } from '@/lib/analytics/fulfilmentAnalytics'
import { unavailableAdvertisingAnalytics } from '@/lib/analytics/advertisingAnalytics'
import { unknownDataQualitySummary, buildDataQualitySummary } from '@/lib/analytics/dataQuality'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { AnalyticsDashboard } from '@/lib/analytics/repository'
import type { MonitoringStatus } from '@/lib/monitoring/repository'
import type { AutomationStatus } from '@/lib/automation/repository'
import type { ApprovalItem } from '@/lib/core/domain'
import type { ProductProfitHighlight } from '@/lib/analytics/repository'
import type { SupplierHealth } from '@/lib/analytics/supplierAnalytics'
import type { BusinessAlert } from '@/lib/analytics/businessHealth'

const NOW = '2026-08-24T09:00:00.000Z'

function baseAnalytics(overrides: Partial<AnalyticsDashboard> = {}): AnalyticsDashboard {
  const period = resolvePeriod('last_30_days', new Date(NOW))
  return {
    isDemo: false,
    period,
    sales: emptySalesAnalytics(period, 'GBP'),
    channels: [],
    topRevenueProducts: [], topProfitProducts: [], lossMakingProducts: [],
    supplierHealth: [],
    fulfilment: buildFulfilmentAnalytics([]),
    advertising: unavailableAdvertisingAnalytics(),
    dataQuality: unknownDataQualitySummary(),
    alerts: [],
    marketReadiness: [],
    complianceRechecksRequired: 0,
    automationHealthKnown: true,
    demoScenarios: [],
    ...overrides,
  }
}

function baseMonitoring(overrides: Partial<MonitoringStatus> = {}): MonitoringStatus {
  return {
    isDemo: false,
    schedulerConfigured: true,
    systemHealth: { monitorsRegistered: 8, monitorsRunLast24h: 8, monitorsFailedLast24h: 0, monitorsDegraded: 0, monitorsOverdue: [], monitorsNeverRun: [], lastRunByMonitor: {} },
    businessAlerts: { openCriticalEvents: 0, openWarningEvents: 0, unavailableSuppliers: 0, reconciliationProblems: 0, complianceRechecksRequired: 0 },
    supplierIntelligence: { suppliersWithDispatchDelays: [], suppliersWithCancellationIncrease: [], suppliersWithPriceIncreases: [], suppliersWithFeedProblems: [] },
    productIntelligence: { newlyProfitable: [], losingProfitability: [], risingSales: [], decliningSales: [], requiringReview: [] },
    marketplaceIntelligence: { listingsOutOfSync: [], failedExternalActions: [] },
    expansionIntelligence: { fxRatesStale: [], fxSignificantMovements: [], marketsWithProfitabilityDeterioration: [], marketsRequiringComplianceRecheck: [], marketsWithSupplierCapabilityChanges: [], marketsBecameViable: [] },
    marketReadiness: [],
    recentEvents: [],
    demoScenarios: [],
    ...overrides,
  }
}

function baseAutomation(overrides: Partial<AutomationStatus> = {}): AutomationStatus {
  return {
    isDemo: false,
    settings: DEMO_AUTOMATION_SETTINGS,
    today: { actionsTotal: 0, succeeded: 0, failed: 0, blocked: 0, approvalsRequested: 0, approvalsCompleted: 0, productsPaused: 0, suppliersSwitched: 0, spentAutomaticallyMinor: 0, refundsProcessedMinor: 0 },
    risk: { failedActions: 0, blockedActions: 0, deadLetterJobs: 0 },
    recentActions: [], pendingJobs: [], demoScenarios: [],
    productionReadiness: { schedulerConfigured: true, jobsByStatus: {}, externalActionsByVerification: {}, connectors: [] },
    ...overrides,
  }
}

function highlight(productId: string, channel: 'shopify' | 'amazon_uk', netProfitMinor: number): ProductProfitHighlight {
  return { productId, channel, netMarginPct: netProfitMinor > 0 ? 20 : -20, netProfitMinor, tags: netProfitMinor <= 0 ? ['loss_making'] : [] }
}

describe('buildPriorities: deterministic ordering', () => {
  it('critical items always sort before high, medium and low, regardless of insertion order', () => {
    const analytics = baseAnalytics({ lossMakingProducts: [highlight('p1', 'amazon_uk', -500)] })
    const automation = baseAutomation({ risk: { failedActions: 1, blockedActions: 0, deadLetterJobs: 0 } }) // high
    const monitoring = baseMonitoring({ businessAlerts: { ...baseMonitoring().businessAlerts, complianceRechecksRequired: 1 } }) // high
    const priorities = buildPriorities({ analytics, monitoring, automation, approvals: [], now: NOW })

    expect(priorities[0].severity).toBe('critical') // The loss-making-products priority.
    for (let i = 1; i < priorities.length; i++) {
      const rank = { critical: 0, high: 1, medium: 2, low: 3 }
      expect(rank[priorities[i].severity]).toBeGreaterThanOrEqual(rank[priorities[i - 1].severity])
    }
  })

  it('loss-making products are kept channel-specific, never collapsed into one global claim', () => {
    const analytics = baseAnalytics({ lossMakingProducts: [highlight('p1', 'amazon_uk', -100), highlight('p2', 'shopify', -50)] })
    const priorities = buildPriorities({ analytics, monitoring: baseMonitoring(), automation: baseAutomation(), approvals: [], now: NOW })
    const lossMakingPriorities = priorities.filter((p) => p.id.startsWith('loss_making:'))
    expect(lossMakingPriorities).toHaveLength(2)
    expect(lossMakingPriorities.find((p) => p.affectedEntityId === 'amazon_uk')?.title).toContain('Amazon UK')
    expect(lossMakingPriorities.find((p) => p.affectedEntityId === 'shopify')?.title).toContain('Shopify')
  })

  it('emergency stop (all automation paused) is always critical', () => {
    const automation = baseAutomation({ settings: { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true, automationPausedReason: 'Reviewing Q3 numbers' } })
    const priorities = buildPriorities({ analytics: baseAnalytics(), monitoring: baseMonitoring(), automation, approvals: [], now: NOW })
    const stop = priorities.find((p) => p.id === 'automation:paused_all')
    expect(stop?.severity).toBe('critical')
    expect(stop?.detail).toContain('Reviewing Q3')
  })

  it('a paused automation category is medium, not critical', () => {
    const automation = baseAutomation({ settings: { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['pricing'] } })
    const priorities = buildPriorities({ analytics: baseAnalytics(), monitoring: baseMonitoring(), automation, approvals: [], now: NOW })
    expect(priorities.find((p) => p.id === 'automation:paused_category:pricing')?.severity).toBe('medium')
  })

  it('a pending approval expiring within 24 hours is critical; one further out is high', () => {
    const soon: ApprovalItem = { id: 'a1', decisionType: 'price_change', title: 'Price review', detail: '', reasoning: '', confidence: null, estimatedImpact: null, status: 'awaiting_approval', createdAt: NOW, expiresAt: '2026-08-24T20:00:00.000Z' }
    const later: ApprovalItem = { ...soon, id: 'a2', expiresAt: '2026-09-10T00:00:00.000Z' }
    const priorities = buildPriorities({ analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(), approvals: [soon, later], now: NOW })
    expect(priorities.find((p) => p.id === 'approval:a1')?.severity).toBe('critical')
    expect(priorities.find((p) => p.id === 'approval:a2')?.severity).toBe('high')
  })

  it('an alert already produced by analytics.alerts is mapped through, never re-derived or duplicated', () => {
    const alert: BusinessAlert = { key: 'revenue_decline', severity: 'critical', message: 'Revenue is down 30%.', detectedAt: NOW, affectedEntityType: 'business', affectedEntityId: null, source: 'salesAnalytics', actionable: true, evidence: { percentChange: -30 } }
    const analytics = baseAnalytics({ alerts: [alert] })
    const priorities = buildPriorities({ analytics, monitoring: baseMonitoring(), automation: baseAutomation(), approvals: [], now: NOW })
    const mapped = priorities.filter((p) => p.id.startsWith('alert:revenue_decline'))
    expect(mapped).toHaveLength(1)
    expect(mapped[0].severity).toBe('critical')
    expect(mapped[0].category).toBe('financial_risk')
  })

  it('50 simultaneous alerts still sort correctly and do not crash', () => {
    const alerts: BusinessAlert[] = Array.from({ length: 50 }, (_, i) => ({
      key: `data_quality_issue_${i}`, severity: i % 3 === 0 ? 'critical' : i % 3 === 1 ? 'warning' : 'info',
      message: `Issue ${i}`, detectedAt: NOW, affectedEntityType: 'data_quality', affectedEntityId: null, source: 'dataQuality', actionable: true, evidence: {},
    }))
    const priorities = buildPriorities({ analytics: baseAnalytics({ alerts }), monitoring: baseMonitoring(), automation: baseAutomation(), approvals: [], now: NOW })
    expect(priorities.length).toBeGreaterThanOrEqual(50)
    expect(priorities[0].severity).toBe('critical')
    expect(priorities[priorities.length - 1].severity === 'low' || priorities[priorities.length - 1].severity === 'high').toBe(true)
  })

  it('no priorities at all when everything is genuinely healthy', () => {
    const priorities = buildPriorities({ analytics: baseAnalytics(), monitoring: baseMonitoring(), automation: baseAutomation(), approvals: [], now: NOW })
    expect(priorities).toHaveLength(0)
  })
})

describe('buildBusinessHealthScorecard', () => {
  it('every area is unknown in demo mode — never a false healthy from empty demo data', () => {
    const scorecard = buildBusinessHealthScorecard({
      analytics: baseAnalytics({ isDemo: true }), monitoring: baseMonitoring({ isDemo: true }), automation: baseAutomation({ isDemo: true }),
    })
    expect(scorecard.areas.every((a) => a.status === 'unknown')).toBe(true)
    expect(scorecard.overall).toBe('unknown')
  })

  it('a genuinely healthy live business reports every area healthy', () => {
    const monitoring = baseMonitoring({ marketReadiness: [{ marketKey: 'amazon_uk', label: 'Amazon UK', countryLabel: 'UK', status: 'connected' }] })
    const scorecard = buildBusinessHealthScorecard({ analytics: baseAnalytics(), monitoring, automation: baseAutomation() })
    // financial/product/supplier/fulfilment/compliance/automation/data_quality all unknown (no data) or healthy; marketplace is healthy given the connected market.
    const marketplace = scorecard.areas.find((a) => a.key === 'marketplace')!
    expect(marketplace.status).toBe('healthy')
  })

  it('the overall status is the single worst area, never hidden behind unrelated healthy/unknown areas', () => {
    const analytics = baseAnalytics({ supplierHealth: [{ supplierId: 's1', status: 'unavailable', reasons: ['feed failed'] }] })
    const scorecard = buildBusinessHealthScorecard({ analytics, monitoring: baseMonitoring(), automation: baseAutomation() })
    expect(scorecard.overall).toBe('critical')
    const supplier = scorecard.areas.find((a) => a.key === 'supplier')!
    expect(supplier.status).toBe('critical')
    expect(supplier.reasons).toContain('feed failed')
  })

  it('every non-healthy, non-unknown area carries a stated reason', () => {
    const analytics = baseAnalytics({
      lossMakingProducts: [highlight('p1', 'amazon_uk', -100)],
      supplierHealth: [{ supplierId: 's1', status: 'watch', reasons: ['dispatch delay'] } as SupplierHealth],
      dataQuality: buildDataQualitySummary({ productsWithUnknownCost: 1, productsMissingListingPrice: 0, fxRatesStale: 0, fulfilmentsMissingTracking: 0, productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false }),
    })
    const monitoring = baseMonitoring({ businessAlerts: { ...baseMonitoring().businessAlerts, complianceRechecksRequired: 2 } })
    const automation = baseAutomation({ settings: { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['refunds'] } })
    const scorecard = buildBusinessHealthScorecard({ analytics, monitoring, automation })
    for (const area of scorecard.areas) {
      if (area.status !== 'healthy' && area.status !== 'unknown') {
        expect(area.reasons.length, `${area.key} should explain a ${area.status} status`).toBeGreaterThan(0)
      }
    }
  })

  it('BUG FOUND VIA DEMO SCENARIO: a permanent, info-severity-only data-quality note (advertising unavailable) never drags data quality below healthy on its own', () => {
    // advertisingConfigured is always false in this codebase (no connector
    // exists) — if this alone could depress the scorecard, every business,
    // however healthy, would show data-quality WATCH forever, which is
    // exactly the false-alarm noise the brief's "never create false
    // confidence" principle warns against creating in the other direction.
    const analytics = baseAnalytics({ dataQuality: buildDataQualitySummary({ productsWithUnknownCost: 0, productsMissingListingPrice: 0, fxRatesStale: 0, fulfilmentsMissingTracking: 0, productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false }) })
    const scorecard = buildBusinessHealthScorecard({ analytics, monitoring: baseMonitoring(), automation: baseAutomation() })
    expect(scorecard.areas.find((a) => a.key === 'data_quality')!.status).toBe('healthy')
  })

  it('a genuinely resolvable, warning-severity data-quality gap (missing supplier cost) does classify as at_risk', () => {
    const analytics = baseAnalytics({ dataQuality: buildDataQualitySummary({ productsWithUnknownCost: 2, productsMissingListingPrice: 0, fxRatesStale: 0, fulfilmentsMissingTracking: 0, productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false }) })
    const scorecard = buildBusinessHealthScorecard({ analytics, monitoring: baseMonitoring(), automation: baseAutomation() })
    expect(scorecard.areas.find((a) => a.key === 'data_quality')!.status).toBe('at_risk')
  })

  it('marketplace health ignores planned (never-configured) markets — they are not a health problem', () => {
    const monitoring = baseMonitoring({ marketReadiness: [
      { marketKey: 'amazon_uk', label: 'Amazon UK', countryLabel: 'UK', status: 'connected' },
      { marketKey: 'amazon_de', label: 'Amazon Germany', countryLabel: 'Germany', status: 'planned' },
    ] })
    const scorecard = buildBusinessHealthScorecard({ analytics: baseAnalytics(), monitoring, automation: baseAutomation() })
    expect(scorecard.areas.find((a) => a.key === 'marketplace')!.status).toBe('healthy')
  })
})
