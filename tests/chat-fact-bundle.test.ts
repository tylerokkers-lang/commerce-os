import { describe, expect, it } from 'vitest'
import { buildFactBundle, deriveReferences, serializeFactBundle } from '@/lib/ai/factBundle'
import { buildPriorities } from '@/lib/ceo/priorities'
import { buildBusinessHealthScorecard } from '@/lib/ceo/healthScorecard'
import { resolvePeriod } from '@/lib/orders/salesAggregation'
import { emptySalesAnalytics, unavailableSalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { buildFulfilmentAnalytics } from '@/lib/analytics/fulfilmentAnalytics'
import { unavailableAdvertisingAnalytics, buildAdvertisingScorecard } from '@/lib/analytics/advertisingAnalytics'
import { unknownDataQualitySummary } from '@/lib/analytics/dataQuality'
import { buildChannelProfitRollup, type ChannelAnalytics } from '@/lib/analytics/channelAnalytics'
import type { AnalyticsDashboard, AdvertisingIntelligence } from '@/lib/analytics/repository'
import type { MonitoringStatus } from '@/lib/monitoring/repository'
import type { AutomationStatus } from '@/lib/automation/repository'
import type { ApprovalItem, ComplianceIssue, OpportunitySummary, SupplierListItem } from '@/lib/core/domain'
import type { IntelligenceSummary } from '@/lib/products/opportunities'
import type { CEOCommandCentre } from '@/lib/ceo/types'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'

/**
 * Fixtures follow the same local-per-test-file convention as
 * `tests/ceo-priorities-health.test.ts` (no shared test-utils module
 * exists in this codebase). `priorities`/`businessHealth` are computed
 * through the real `buildPriorities`/`buildBusinessHealthScorecard`
 * functions rather than hand-written, so a `FactBundle` test is exercising
 * the same facts Milestone 11 actually produces, not a parallel guess at
 * their shape.
 */

const NOW = '2026-08-24T09:00:00.000Z'
const PERIOD = resolvePeriod('last_30_days', new Date(NOW))

function baseAnalytics(overrides: Partial<AnalyticsDashboard> = {}): AnalyticsDashboard {
  return {
    isDemo: false,
    period: PERIOD,
    sales: emptySalesAnalytics(PERIOD, 'GBP'),
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
    recoveryRequired: [],
    ...overrides,
  }
}

function baseCEO(input: {
  analytics?: Partial<AnalyticsDashboard>
  monitoring?: Partial<MonitoringStatus>
  automation?: Partial<AutomationStatus>
  approvals?: readonly ApprovalItem[]
  complianceIssues?: readonly ComplianceIssue[]
  advertisingIntelligence?: AdvertisingIntelligence
  dataSourceFailures?: readonly string[]
} = {}): CEOCommandCentre {
  const analytics = baseAnalytics(input.analytics)
  const monitoring = baseMonitoring(input.monitoring)
  const automation = baseAutomation(input.automation)
  const approvals = input.approvals ?? []
  const complianceIssues = input.complianceIssues ?? []
  const advertisingIntelligence = input.advertisingIntelligence ?? {
    isDemo: false, period: resolvePeriod('last_30_days', new Date(NOW)),
    campaigns: [], scorecard: buildAdvertisingScorecard([], null, 'GBP'), demoScenarios: [],
  }

  return {
    isDemo: analytics.isDemo,
    generatedAt: NOW,
    executiveSummary: {
      isDemo: analytics.isDemo, periodLabel: 'Last 30 days',
      revenue: analytics.sales.revenue, netRevenue: analytics.sales.netRevenue, orders: analytics.sales.orders,
      averageOrderValue: analytics.sales.averageOrderValue, refundsValue: analytics.sales.refundsValue,
      refundRatePct: analytics.sales.refundRatePct, returnRatePct: analytics.sales.returnRatePct,
      knownNetMarginPct: null, profitDataComplete: false,
    },
    priorities: buildPriorities({ analytics, monitoring, automation, approvals, complianceIssues, advertisingIntelligence, now: NOW }),
    businessHealth: buildBusinessHealthScorecard({ analytics, monitoring, automation, complianceIssues, advertisingIntelligence }),
    financialPerformance: analytics,
    supplierHealth: analytics.supplierHealth,
    fulfilmentHealth: analytics.fulfilment,
    marketReadiness: monitoring.marketReadiness,
    automationHealth: automation,
    approvals,
    complianceIssues,
    advertisingIntelligence,
    dataQuality: analytics.dataQuality,
    recentActivity: [],
    demoScenarios: [],
    dataSourceFailures: input.dataSourceFailures ?? [],
  }
}

function channel(channelKey: 'shopify' | 'amazon_uk', sales = emptySalesAnalytics(PERIOD, 'GBP')): ChannelAnalytics {
  return { channel: channelKey, label: channelKey === 'shopify' ? 'Shopify' : 'Amazon UK', sales, profit: buildChannelProfitRollup('GBP', []) }
}

function complianceIssue(overrides: Partial<ComplianceIssue> = {}): ComplianceIssue {
  return { productId: 'p1', sku: 'CMO-1001', title: 'Test product', channel: 'amazon_uk', verdict: 'fail', blockingReasons: ['A real blocking reason.'], assessedAt: NOW, ...overrides }
}

function opportunity(overrides: Partial<OpportunitySummary> = {}): OpportunitySummary {
  return {
    id: 'opp-1', title: 'Test opportunity', category: 'Home', opportunityScore: 70, band: 'test', bandLabel: 'Recommended for testing',
    confidence: 0.8, confidenceLabel: 'high', recommendedAction: 'test', headline: 'A real headline.',
    estimatedContributionMarginPct: 30, estimatedSellingPrice: { minor: 1999, currency: 'GBP' }, estimatedUnitCost: { minor: 500, currency: 'GBP' },
    supplierIdentified: true, supplierName: 'Test Supplier', supplierScore: 80, amazonCompliance: 'pass', shopifyCompliance: 'pass',
    ...overrides,
  } as OpportunitySummary
}

function supplier(overrides: Partial<SupplierListItem> = {}): SupplierListItem {
  return {
    id: 's1', name: 'Test Supplier', country: 'GB', score: 40, shopifyStatus: 'approved', amazonStatus: 'blocked',
    statusReason: 'Cannot remain seller of record.', deliveryDaysMin: 3, deliveryDaysMax: 5, onTimeRatePct: 88, productCount: 3,
    band: 'acceptable', confidence: 0.7, strengths: [], weaknesses: [], platform: 'wholesaler',
    providesTracking: true, handlesReturns: false, supportsCustomInvoice: false, supportsBlindShipping: true, ordersPlaced: 20,
    ...overrides,
  }
}

describe('buildFactBundle: empty datasets', () => {
  it('an entirely empty, healthy business produces an honest empty bundle, never an error', () => {
    const bundle = buildFactBundle({ ceo: baseCEO(), orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })
    expect(bundle.priorities).toHaveLength(0)
    expect(bundle.complianceIssues).toHaveLength(0)
    expect(bundle.topOpportunities).toHaveLength(0)
    expect(bundle.supplierRisk).toHaveLength(0)
    expect(bundle.pendingApprovals).toHaveLength(0)
    expect(bundle.opportunitySummary).toBeNull()
    expect(() => serializeFactBundle(bundle)).not.toThrow()
    expect(serializeFactBundle(bundle)).toContain('empty')
  })
})

describe('buildFactBundle: currency safety', () => {
  it('an unavailable (mixed-currency) sales metric is never coerced into a number, and is named as a caution', () => {
    const unavailable = unavailableSalesAnalytics(PERIOD, 'GBP', 'Unavailable — mixed currencies cannot be safely aggregated (found GBP, USD).')
    const ceo = baseCEO({ analytics: { sales: unavailable, channels: [channel('amazon_uk', unavailable)] } })
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })

    const revenueLine = bundle.executiveSummary.find((m) => m.label.startsWith('Revenue'))!
    expect(revenueLine.value).toContain('unavailable')
    expect(revenueLine.value).not.toMatch(/£0\.00|\$0\.00/)
    expect(bundle.currencyCautions.some((c) => c.includes('mixed currencies'))).toBe(true)

    const text = serializeFactBundle(bundle)
    expect(text).toContain('CURRENCY SAFETY')
    expect(text).not.toMatch(/Revenue.*£0\.00/)
  })

  it('a genuinely empty (zero-order) period is a real fact, not a caution — never confused with unavailable', () => {
    const bundle = buildFactBundle({ ceo: baseCEO(), orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })
    expect(bundle.currencyCautions).toHaveLength(0)
    const revenueLine = bundle.executiveSummary.find((m) => m.label.startsWith('Revenue'))!
    expect(revenueLine.status).toBe('fact')
  })
})

describe('buildFactBundle: compliance visibility', () => {
  it('a blocked (fail) issue is included with its channel, verdict and reasons intact', () => {
    const issue = complianceIssue({ verdict: 'fail', channel: 'amazon_uk' })
    const ceo = baseCEO({ complianceIssues: [issue] })
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })

    expect(bundle.complianceIssues).toHaveLength(1)
    expect(bundle.complianceIssues[0].channel).toBe('amazon_uk')
    expect(bundle.complianceIssues[0].verdict).toBe('fail')
    const text = serializeFactBundle(bundle)
    expect(text).toContain('BLOCKED')
    expect(text).toContain('Amazon UK')
  })

  it('a product blocked on one channel is never implied to be blocked on another (channel isolation)', () => {
    const issue = complianceIssue({ verdict: 'fail', channel: 'amazon_uk', productId: 'p1', sku: 'CMO-1001' })
    const ceo = baseCEO({ complianceIssues: [issue] })
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })

    expect(bundle.complianceIssues).toHaveLength(1)
    expect(bundle.complianceIssues.some((c) => c.channel === 'shopify')).toBe(false)
  })
})

describe('buildFactBundle: priority explanations', () => {
  it('every priority carries its recommended next step and source, so an explanation is always groundable', () => {
    const issue = complianceIssue({ verdict: 'fail' })
    const ceo = baseCEO({ complianceIssues: [issue] })
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })

    expect(bundle.priorities.length).toBeGreaterThan(0)
    for (const p of bundle.priorities) {
      expect(p.recommendedNextStep.length).toBeGreaterThan(0)
      expect(p.source.length).toBeGreaterThan(0)
    }
  })
})

describe('buildFactBundle: channel-specific responses', () => {
  it('channel figures are never blended into one global number', () => {
    const ceo = baseCEO({ analytics: { channels: [channel('shopify'), channel('amazon_uk')] } })
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })

    expect(bundle.channels).toHaveLength(2)
    expect(bundle.channels.map((c) => c.label).sort()).toEqual(['Amazon UK', 'Shopify'])
  })
})

describe('buildFactBundle: opportunities and suppliers', () => {
  it('includes opportunity and supplier intelligence, unmodified from what the real repositories already computed', () => {
    const opp = opportunity({ title: 'Magnetic Knife Rail' })
    const sup = supplier({ name: 'Northwind Supply Co', score: 70 })
    const summary: IntelligenceSummary = { total: 6, recommendedForTesting: 1, needsReview: 2, awaitingSupplier: 0, watching: 0, rejected: 0, topScore: 77, channelDivergent: 3, highIpRisk: 0 }
    const bundle = buildFactBundle({ ceo: baseCEO(), orgName: 'Test Co', opportunities: [opp], opportunitySummary: summary, suppliers: [sup], now: NOW })

    expect(bundle.topOpportunities[0].title).toBe('Magnetic Knife Rail')
    expect(bundle.opportunitySummary?.total).toBe(6)
    expect(bundle.supplierRisk[0].name).toBe('Northwind Supply Co')
  })

  it('sorts suppliers lowest-score (highest risk) first', () => {
    const bundle = buildFactBundle({
      ceo: baseCEO(), orgName: 'Test Co', opportunities: [], opportunitySummary: null,
      suppliers: [supplier({ id: 'good', score: 90 }), supplier({ id: 'bad', score: 20 })], now: NOW,
    })
    expect(bundle.supplierRisk[0].id).toBe('bad')
  })
})

describe('buildFactBundle: data-source failures stay visible', () => {
  it('a failed source is named, never silently dropped', () => {
    const ceo = baseCEO({ dataSourceFailures: ['monitoring'] })
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })
    expect(bundle.dataSourceFailures).toContain('monitoring')
    expect(serializeFactBundle(bundle)).toContain('monitoring')
  })
})

describe('deriveReferences', () => {
  it('every reference is derived from the bundle itself, never from model output', () => {
    const issue = complianceIssue()
    const ceo = baseCEO({ complianceIssues: [issue] })
    const bundle = buildFactBundle({
      ceo, orgName: 'Test Co', opportunities: [opportunity()], opportunitySummary: null,
      suppliers: [supplier()], now: NOW,
    })
    const refs = deriveReferences(bundle)

    expect(refs.some((r) => r.type === 'compliance' && r.id === issue.productId)).toBe(true)
    expect(refs.some((r) => r.type === 'opportunity' && r.href === '/opportunities/opp-1')).toBe(true)
    expect(refs.some((r) => r.type === 'supplier' && r.href === '/suppliers/s1')).toBe(true)
    for (const r of refs) expect(r.id.length).toBeGreaterThan(0)
  })
})
