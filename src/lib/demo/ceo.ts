import { resolvePeriod, previousEquivalentPeriod, aggregateSalesWindow, type OrderLineFact } from '@/lib/orders/salesAggregation'
import { emptySalesAnalytics, buildSalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { buildFulfilmentAnalytics } from '@/lib/analytics/fulfilmentAnalytics'
import { unavailableAdvertisingAnalytics } from '@/lib/analytics/advertisingAnalytics'
import { unknownDataQualitySummary, buildDataQualitySummary } from '@/lib/analytics/dataQuality'
import { buildProductChannelProfitAnalytics } from '@/lib/analytics/profitAnalytics'
import { buildChannelAnalytics } from '@/lib/analytics/channelAnalytics'
import { profitDeclineDespiteRevenueGrowthAlert, supplierHealthAlerts } from '@/lib/analytics/businessHealth'
import { classifySupplierHealth } from '@/lib/analytics/supplierAnalytics'
import { buildPriorities } from '@/lib/ceo/priorities'
import { buildBusinessHealthScorecard } from '@/lib/ceo/healthScorecard'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { AnalyticsDashboard } from '@/lib/analytics/repository'
import type { MonitoringStatus } from '@/lib/monitoring/repository'
import type { AutomationStatus } from '@/lib/automation/repository'
import type { ApprovalItem } from '@/lib/core/domain'
import type { CEODemoScenario } from '@/lib/ceo/types'

/**
 * Milestone 11's 10 required demo scenarios (§19), each run through the
 * real `buildPriorities`/`buildBusinessHealthScorecard` composition
 * functions against deliberately chosen fixture facts — never a hardcoded
 * UI string standing in for a computed result, the same discipline
 * `demo/analytics.ts` (Milestone 10) and `demo/marketExpansion.ts`
 * (Milestone 9) already established. Demo mode has no database, so this
 * is the only way to show the CEO Command Centre working end to end.
 */

const NOW = '2026-08-24T09:00:00.000Z'
const PERIOD = resolvePeriod('last_30_days', new Date(NOW))

function line(orderId: string, placedAt: string, quantity: number, lineTotalMinor: number): OrderLineFact {
  return { orderId, orderStatus: 'fulfilled', orderSubtotalMinor: lineTotalMinor, placedAt, quantity, lineTotalMinor }
}

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

function narrate(analytics: AnalyticsDashboard, monitoring: MonitoringStatus, automation: AutomationStatus, approvals: readonly ApprovalItem[]): { lines: string[]; priorities: ReturnType<typeof buildPriorities>; scorecard: ReturnType<typeof buildBusinessHealthScorecard> } {
  const priorities = buildPriorities({ analytics, monitoring, automation, approvals, now: NOW })
  const scorecard = buildBusinessHealthScorecard({ analytics, monitoring, automation })
  const lines = [
    `Overall business health: ${scorecard.overall.toUpperCase()}.`,
    `${priorities.length} item(s) in the executive priority queue${priorities.length > 0 ? `, top: [${priorities[0].severity.toUpperCase()}] ${priorities[0].title}` : ''}.`,
  ]
  return { lines, priorities, scorecard }
}

export function demoCEOScenarios(): readonly CEODemoScenario[] {
  return [
    scenarioHealthyGrowing(),
    scenarioRevenueGrowthProfitDecline(),
    scenarioCriticalSupplierFailure(),
    scenarioMultipleLossMakingProducts(),
    scenarioMarketplaceUnderperformance(),
    scenarioInternationalOpportunity(),
    scenarioStaleFx(),
    scenarioAutomationEmergencyStop(),
    scenarioPendingCriticalApproval(),
    scenarioMultipleIssuesPrioritised(),
  ]
}

function scenarioHealthyGrowing(): CEODemoScenario {
  const previousLines = [line('o1', '2026-07-10T00:00:00Z', 50, 50 * 3200)]
  const currentLines = [line('o2', '2026-08-10T00:00:00Z', 80, 80 * 3200)]
  const period = PERIOD
  const previousPeriod = previousEquivalentPeriod(period)
  const current = aggregateSalesWindow(currentLines, [], new Date(period.start), new Date(period.end))
  const previous = aggregateSalesWindow(previousLines, [], new Date(previousPeriod.start), new Date(previousPeriod.end))
  const sales = buildSalesAnalytics(current, previous, period, 'GBP')

  const input = { category: null, sellingPriceMinor: 3200, sellingPriceCurrency: 'GBP' as const, productCostMinor: 900, productCostCurrency: 'GBP' as const, supplierShippingMinor: 200, returnRatePct: 2, minNetMarginPct: 10 }
  const projection = buildProductChannelProfitAnalytics('prod-healthy', 'shopify', input)
  const channel = buildChannelAnalytics('shopify', 'Shopify', sales, [projection])

  const analytics = baseAnalytics({ sales, channels: [channel], supplierHealth: [classifySupplierHealth({ supplierId: 'sup-1', connectorStatus: 'healthy', connectorStatusKnown: true, hasDispatchDelayEvent: false, hasCancellationIncreaseEvent: false, hasFeedProblemEvent: false, cancellationRatePct: 1, fulfilmentSuccessRatePct: 98 })], dataQuality: buildDataQualitySummary({ productsWithUnknownCost: 0, productsMissingListingPrice: 0, fxRatesStale: 0, fulfilmentsMissingTracking: 0, productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false }) })
  const monitoring = baseMonitoring({ marketReadiness: [{ marketKey: 'shopify_uk', label: 'Shopify (UK store)', countryLabel: 'United Kingdom', status: 'connected' }] })
  const { lines } = narrate(analytics, monitoring, baseAutomation(), [])

  return {
    key: 'healthy_growing', label: 'Healthy and growing business',
    description: 'Revenue is up, the one trading channel is profitable, the supplier is healthy — every scorecard area reports healthy and the priority queue is empty.',
    narrative: [`Revenue: ${sales.revenue.comparison?.percentChange}% vs the previous period.`, ...lines],
  }
}

function scenarioRevenueGrowthProfitDecline(): CEODemoScenario {
  const previousLines = [line('o1', '2026-07-10T00:00:00Z', 50, 50 * 3200)]
  const currentLines = [line('o2', '2026-08-10T00:00:00Z', 65, 65 * 3200)]
  const previousPeriod = previousEquivalentPeriod(PERIOD)
  const current = aggregateSalesWindow(currentLines, [], new Date(PERIOD.start), new Date(PERIOD.end))
  const previous = aggregateSalesWindow(previousLines, [], new Date(previousPeriod.start), new Date(previousPeriod.end))
  const sales = buildSalesAnalytics(current, previous, PERIOD, 'GBP')

  const healthy = { category: null, sellingPriceMinor: 3200, sellingPriceCurrency: 'GBP' as const, productCostMinor: 900, productCostCurrency: 'GBP' as const, supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10 }
  const costRisen = { ...healthy, productCostMinor: 2100 }
  const before = buildProductChannelProfitAnalytics('prod-1', 'shopify', healthy)
  const after = buildProductChannelProfitAnalytics('prod-1', 'shopify', costRisen)
  const profitComparison = {
    current: after.projection.value!.profitability.netProfit.minor, previous: before.projection.value!.profitability.netProfit.minor,
    absoluteChange: after.projection.value!.profitability.netProfit.minor - before.projection.value!.profitability.netProfit.minor,
    percentChange: Math.round(((after.projection.value!.profitability.netProfit.minor - before.projection.value!.profitability.netProfit.minor) / before.projection.value!.profitability.netProfit.minor) * 10000) / 100,
    direction: 'down' as const,
  }
  const alert = profitDeclineDespiteRevenueGrowthAlert(sales.revenue.comparison, profitComparison, NOW)
  const analytics = baseAnalytics({ sales, alerts: alert ? [alert] : [], channels: [buildChannelAnalytics('shopify', 'Shopify', sales, [after])] })
  const { lines } = narrate(analytics, baseMonitoring(), baseAutomation(), [])

  return {
    key: 'revenue_growth_profit_decline', label: 'Revenue growth but declining profit',
    description: 'Revenue genuinely grew, but a real supplier cost rise erodes net profit over the same period — the exact case Milestone 10\'s profitDeclineDespiteRevenueGrowthAlert exists to catch, surfaced here in the priority queue.',
    narrative: [`Revenue: +${sales.revenue.comparison?.percentChange}%. Net profit: £${(before.projection.value!.profitability.netProfit.minor / 100).toFixed(2)} -> £${(after.projection.value!.profitability.netProfit.minor / 100).toFixed(2)}.`, ...lines],
  }
}

function scenarioCriticalSupplierFailure(): CEODemoScenario {
  const supplier = classifySupplierHealth({ supplierId: 'sup-northwind', connectorStatus: 'failing', connectorStatusKnown: true, hasDispatchDelayEvent: true, hasCancellationIncreaseEvent: true, hasFeedProblemEvent: true, cancellationRatePct: 22, fulfilmentSuccessRatePct: 61 })
  const alerts = supplierHealthAlerts([supplier], NOW)
  const analytics = baseAnalytics({ supplierHealth: [supplier], alerts })
  const { lines } = narrate(analytics, baseMonitoring(), baseAutomation(), [])

  return {
    key: 'critical_supplier_failure', label: 'Critical supplier failure',
    description: 'A supplier\'s feed has failed entirely, alongside a real spike in cancellations and dispatch delays — classifySupplierHealth (the same engine automation/monitoring already use) reports it unavailable, and it drives both the supplier health area and the priority queue to critical.',
    narrative: [`Supplier sup-northwind: ${supplier.status.toUpperCase()} — ${supplier.reasons.join(' ')}`, ...lines],
  }
}

function scenarioMultipleLossMakingProducts(): CEODemoScenario {
  const lossInput = { category: null, sellingPriceMinor: 1500, sellingPriceCurrency: 'GBP' as const, productCostMinor: 1400, productCostCurrency: 'GBP' as const, supplierShippingMinor: 300, returnRatePct: 5, minNetMarginPct: 10 }
  const products = ['prod-a', 'prod-b', 'prod-c', 'prod-d'].map((id) => buildProductChannelProfitAnalytics(id, 'amazon_uk', lossInput))
  const lossMakingProducts = products.map((p) => ({ productId: p.productId, channel: p.channel, netMarginPct: p.projection.value!.profitability.netMarginPct, netProfitMinor: p.projection.value!.profitability.netProfit.minor, tags: ['loss_making' as const] }))
  const analytics = baseAnalytics({ lossMakingProducts, channels: [buildChannelAnalytics('amazon_uk', 'Amazon UK', emptySalesAnalytics(PERIOD, 'GBP'), products)] })
  const { lines, priorities } = narrate(analytics, baseMonitoring(), baseAutomation(), [])

  return {
    key: 'multiple_loss_making_products', label: 'Multiple loss-making products',
    description: '4 products are genuinely loss-making on Amazon UK at their current price and cost — kept channel-specific throughout, never collapsed into "products are unprofitable." Financial and product health both report critical.',
    narrative: [`Loss-making priority: "${priorities.find((p) => p.id.startsWith('loss_making:'))?.title}"`, ...lines],
  }
}

function scenarioMarketplaceUnderperformance(): CEODemoScenario {
  const monitoring = baseMonitoring({ marketReadiness: [
    { marketKey: 'amazon_uk', label: 'Amazon UK', countryLabel: 'United Kingdom', status: 'degraded' },
    { marketKey: 'shopify_uk', label: 'Shopify (UK store)', countryLabel: 'United Kingdom', status: 'connected' },
  ] })
  const { lines } = narrate(baseAnalytics(), monitoring, baseAutomation(), [])

  return {
    key: 'marketplace_underperformance', label: 'Marketplace underperformance',
    description: 'Amazon UK\'s connector is reporting a degraded state while Shopify remains healthy — the marketplace health area reflects the real, per-connector status, never one blended "marketplaces are fine" figure.',
    narrative: [`Amazon UK: degraded. Shopify: connected.`, ...lines],
  }
}

function scenarioInternationalOpportunity(): CEODemoScenario {
  const monitoring = baseMonitoring({ marketReadiness: [
    { marketKey: 'amazon_uk', label: 'Amazon UK', countryLabel: 'United Kingdom', status: 'connected' },
    { marketKey: 'amazon_us', label: 'Amazon US', countryLabel: 'United States', status: 'planned' },
  ], expansionIntelligence: { ...baseMonitoring().expansionIntelligence, marketsBecameViable: ['amazon_us'] } })
  const { lines } = narrate(baseAnalytics(), monitoring, baseAutomation(), [])

  return {
    key: 'international_opportunity', label: 'International expansion opportunity',
    description: 'Amazon US is not yet configured (a real, honest "planned" status, never claimed live) but Milestone 9\'s expansion intelligence has flagged it as having become viable on the numbers — a genuine, evidence-backed opportunity, not a guess.',
    narrative: ['Amazon US: planned, but real expansion intelligence reports it became viable.', ...lines],
  }
}

function scenarioStaleFx(): CEODemoScenario {
  const monitoring = baseMonitoring({ expansionIntelligence: { ...baseMonitoring().expansionIntelligence, fxRatesStale: ['USD:GBP'] } })
  const analytics = baseAnalytics({ dataQuality: buildDataQualitySummary({ productsWithUnknownCost: 0, productsMissingListingPrice: 0, fxRatesStale: 1, fulfilmentsMissingTracking: 0, productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false }) })
  const { lines } = narrate(analytics, monitoring, baseAutomation(), [])

  return {
    key: 'stale_fx', label: 'Stale FX / data-quality warning',
    description: 'The USD->GBP exchange rate has gone stale — surfaced honestly in the data-quality rollup rather than silently used, per Milestone 9\'s FX freshness rules.',
    narrative: [`Data quality: ${analytics.dataQuality.overallStatus} — ${analytics.dataQuality.issues[0]?.message}`, ...lines],
  }
}

function scenarioAutomationEmergencyStop(): CEODemoScenario {
  const automation = baseAutomation({ settings: { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true, automationPausedReason: 'Reviewing a pricing anomaly before letting automation run again.', automationPausedAt: NOW } })
  const { lines } = narrate(baseAnalytics(), baseMonitoring(), automation, [])

  return {
    key: 'automation_emergency_stop', label: 'Automation emergency stop active',
    description: 'The owner has paused all automation — this is always the single highest-visibility fact on the command centre, never buried under charts.',
    narrative: ['EMERGENCY STOP ACTIVE: Reviewing a pricing anomaly before letting automation run again.', ...lines],
  }
}

function scenarioPendingCriticalApproval(): CEODemoScenario {
  const approval: ApprovalItem = {
    id: 'appr-critical-1', decisionType: 'supplier_switch', title: 'Approve emergency supplier switch for Magnetic Knife Rail',
    detail: 'The approved supplier is out of stock; the only alternative costs 18% more per unit.', reasoning: 'No compliant alternative preserves the current margin without owner sign-off.',
    confidence: 0.72, estimatedImpact: { minor: -45000, currency: 'GBP' }, status: 'awaiting_approval', createdAt: '2026-08-24T02:00:00.000Z', expiresAt: '2026-08-24T20:00:00.000Z',
  }
  const { lines } = narrate(baseAnalytics(), baseMonitoring(), baseAutomation(), [approval])

  return {
    key: 'pending_critical_approval', label: 'Pending critical CEO approval',
    description: 'A supplier-switch decision expires within 24 hours — the priority queue escalates it to critical on that real fact, not a guess, and the command centre links straight to /approvals.',
    narrative: [`Approval: "${approval.title}" expires ${approval.expiresAt}.`, ...lines],
  }
}

function scenarioMultipleIssuesPrioritised(): CEODemoScenario {
  const supplier = classifySupplierHealth({ supplierId: 'sup-multi', connectorStatus: 'degraded', connectorStatusKnown: true, hasDispatchDelayEvent: true, hasCancellationIncreaseEvent: false, hasFeedProblemEvent: false, cancellationRatePct: 4, fulfilmentSuccessRatePct: 90 })
  const lossInput = { category: null, sellingPriceMinor: 1500, sellingPriceCurrency: 'GBP' as const, productCostMinor: 1400, productCostCurrency: 'GBP' as const, supplierShippingMinor: 300, returnRatePct: 5, minNetMarginPct: 10 }
  const lossProduct = buildProductChannelProfitAnalytics('prod-multi', 'amazon_uk', lossInput)
  const analytics = baseAnalytics({
    supplierHealth: [supplier],
    lossMakingProducts: [{ productId: 'prod-multi', channel: 'amazon_uk', netMarginPct: lossProduct.projection.value!.profitability.netMarginPct, netProfitMinor: lossProduct.projection.value!.profitability.netProfit.minor, tags: ['loss_making'] }],
    fulfilment: buildFulfilmentAnalytics([{ status: 'shipped', submittedAt: NOW, shippedAt: NOW, deliveredAt: null, promisedBy: null, trackingNumber: null }]),
  })
  const monitoring = baseMonitoring({ businessAlerts: { ...baseMonitoring().businessAlerts, complianceRechecksRequired: 2 } })
  const automation = baseAutomation({ risk: { failedActions: 1, blockedActions: 0, deadLetterJobs: 1 } })
  const approval: ApprovalItem = { id: 'appr-multi-1', decisionType: 'price_review', title: 'Review price for prod-multi', detail: '', reasoning: '', confidence: null, estimatedImpact: null, status: 'awaiting_approval', createdAt: NOW, expiresAt: null }

  const { lines, priorities } = narrate(analytics, monitoring, automation, [approval])

  return {
    key: 'multiple_issues_prioritised', label: 'Multiple issues requiring deterministic prioritisation',
    description: `${priorities.length} genuinely different problems (a loss-making product, a watch-status supplier, a compliance recheck, failed/dead-lettered automation jobs, a pending approval, and a missing-tracking shipment) all present at once — every one ranked by the same fixed severity rule, critical first, never by insertion order.`,
    narrative: [`Priority order: ${priorities.map((p) => `[${p.severity}] ${p.category}`).join(' -> ')}`, ...lines],
  }
}
