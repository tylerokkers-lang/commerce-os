import 'server-only'

import { zero } from '@/lib/core/money'
import type {
  BusinessSummary,
  CashflowProjection,
  ChannelSummary,
  DailyReport,
} from '@/lib/core/domain'
import {
  demoBusinessSummary,
  demoCashflow,
  demoChannels,
  demoDailyReport,
} from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'

/**
 * Reporting reads.
 *
 * Demo and live both return the same shapes. In live mode a business with no
 * trading history returns genuine zeros rather than borrowing demo figures:
 * an empty dashboard on day one is the truthful answer.
 */

const EMPTY_SUMMARY: BusinessSummary = {
  isDemo: false,
  periodLabel: 'Last 30 days',
  revenue: zero('GBP'),
  contribution: zero('GBP'),
  estimatedNetProfit: zero('GBP'),
  orders: 0,
  units: 0,
  averageOrderValue: zero('GBP'),
  contributionMarginPct: null,
  adSpend: zero('GBP'),
  roas: null,
  refundRatePct: 0,
  returnRatePct: 0,
  cashAvailable: zero('GBP'),
  revenueChangePct: null,
  contributionChangePct: null,
}

export async function getBusinessSummary(): Promise<BusinessSummary> {
  const session = await requireSession()
  if (session.isDemo) return demoBusinessSummary()

  // Live aggregation lands in Milestone 3 alongside the Shopify order sync.
  // Until orders exist there is nothing to aggregate, and inventing a figure
  // here would be exactly the failure mode this system is meant to avoid.
  return EMPTY_SUMMARY
}

export async function getChannelSummaries(): Promise<readonly ChannelSummary[]> {
  const session = await requireSession()
  if (session.isDemo) return demoChannels()

  return [
    { channel: 'shopify', label: 'Shopify', isConnected: false, connectionMode: 'live', revenue: zero('GBP'), contribution: zero('GBP'), orders: 0, liveListings: 0, blockedListings: 0, reviewRequiredListings: 0 },
    { channel: 'amazon_uk', label: 'Amazon UK', isConnected: false, connectionMode: 'live', revenue: zero('GBP'), contribution: zero('GBP'), orders: 0, liveListings: 0, blockedListings: 0, reviewRequiredListings: 0 },
  ]
}

export async function getCashflow(): Promise<CashflowProjection> {
  const session = await requireSession()
  if (session.isDemo) return demoCashflow()

  return {
    cashAvailable: zero('GBP'),
    expectedPayouts: [],
    upcomingCommitments: [],
    projectedLowPoint: zero('GBP'),
    projectedLowPointOn: new Date().toISOString(),
    warning: null,
  }
}

// =============================================================================
// Milestone 10 — analytics & business intelligence.
//
// Everything below is new; everything above (the Milestone 1 reporting
// reads `/report` uses) is untouched. This is the one repository the
// `/automation` dashboard, and eventually a CEO AI assistant, calls for
// business-intelligence facts — every function composes the pure
// `analytics/*.ts` builders and the Milestone 8/9 live loaders
// (`monitoring/repository.ts`'s `getMonitoringStatus`,
// `analytics/liveAnalyticsFacts.ts`) rather than querying Supabase a
// second, possibly-diverging way.
// =============================================================================

import { getMonitoringStatus } from '@/lib/monitoring/repository'
import { getAutomationSettings } from '@/lib/automation/settings'
import { resolvePeriod, previousEquivalentPeriod, type Period, type PeriodKey } from '@/lib/orders/salesAggregation'
import { buildSalesAnalytics, emptySalesAnalytics, type SalesAnalytics } from './salesAnalytics'
import { buildProductChannelProfitAnalytics, type ProductChannelProfitAnalytics } from './profitAnalytics'
import { buildChannelAnalytics, type ChannelAnalytics } from './channelAnalytics'
import { classifyProduct, isLossMakingOnAllKnownChannels, DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS, type ProductClassificationTag } from './productAnalytics'
import { classifySupplierHealth, type SupplierHealth } from './supplierAnalytics'
import { buildFulfilmentAnalytics, type FulfilmentAnalytics } from './fulfilmentAnalytics'
import { unavailableAdvertisingAnalytics, type AdvertisingAnalytics } from './advertisingAnalytics'
import { buildDataQualitySummary, unknownDataQualitySummary, type DataQualitySummary } from './dataQuality'
import { revenueDeclineAlert, dataQualityAlerts, supplierHealthAlerts, type BusinessAlert } from './businessHealth'
import { demoAnalyticsScenarios, type AnalyticsDemoScenario } from '@/lib/demo/analytics'
import type { ChannelKey } from '@/lib/core/domain'
import type { MonitoringStatus } from '@/lib/monitoring/repository'

async function liveFacts() {
  // Imported dynamically-by-module (not dynamic import()) — a plain
  // top-level import would be fine too, but is kept in its own function so
  // every live-mode entry point below goes through one place, matching
  // `automation/repository.ts`'s own shape.
  return import('./liveAnalyticsFacts')
}

export interface ProductProfitHighlight {
  productId: string
  channel: ChannelKey
  netMarginPct: number | null
  netProfitMinor: number | null
  tags: readonly ProductClassificationTag[]
}

export interface AnalyticsDashboard {
  isDemo: boolean
  period: Period
  sales: SalesAnalytics
  channels: readonly ChannelAnalytics[]
  topRevenueProducts: readonly ProductProfitHighlight[]
  topProfitProducts: readonly ProductProfitHighlight[]
  lossMakingProducts: readonly ProductProfitHighlight[]
  supplierHealth: readonly SupplierHealth[]
  fulfilment: FulfilmentAnalytics
  advertising: AdvertisingAnalytics
  dataQuality: DataQualitySummary
  alerts: readonly BusinessAlert[]
  marketReadiness: MonitoringStatus['marketReadiness']
  complianceRechecksRequired: number
  automationHealthKnown: boolean
  demoScenarios: readonly AnalyticsDemoScenario[]
}

const CHANNEL_LABELS: Record<ChannelKey, string> = { shopify: 'Shopify', amazon_uk: 'Amazon UK' }

function toHighlight(p: ProductChannelProfitAnalytics, rank: { revenueRank?: number; profitRank?: number }, revenueChangePct: number | null): ProductProfitHighlight {
  const known = p.projection.status === 'calculated' ? p.projection.value : null
  const tags = classifyProduct({
    productId: p.productId,
    revenueRank: rank.revenueRank, profitRank: rank.profitRank,
    bestKnownNetMarginPct: known?.profitability.netMarginPct ?? null,
    lossMakingOnAllKnownChannels: isLossMakingOnAllKnownChannels([{ channel: p.channel, knownNetProfitMinor: known?.profitability.netProfit.minor ?? null }]),
    revenueChangePct, refundRatePct: null,
    hasSupplierRiskEvent: false, hasStockRiskEvent: false, hasComplianceRiskEvent: false, hasUnexploitedProfitableChannel: false,
  }, DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS)

  return { productId: p.productId, channel: p.channel, netMarginPct: known?.profitability.netMarginPct ?? null, netProfitMinor: known?.profitability.netProfit.minor ?? null, tags }
}

/**
 * The single call `/automation` makes for every Milestone 10 section — one
 * round trip through the live loaders, not one repository call per card.
 * Demo mode returns real zeros for the always-present KPIs (the same
 * "empty is a fact, not a fallback" convention `automation/repository.ts`
 * and `monitoring/repository.ts` already established) plus the 10 real
 * demo scenarios as the actual illustrative content.
 */
export async function getAnalyticsDashboard(periodKey: PeriodKey = 'last_30_days'): Promise<AnalyticsDashboard> {
  const session = await requireSession()
  const period = resolvePeriod(periodKey, new Date())
  const previousPeriod = previousEquivalentPeriod(period)
  const monitoring = await getMonitoringStatus()

  if (session.isDemo) {
    return {
      isDemo: true,
      period,
      sales: emptySalesAnalytics(period, 'GBP'),
      channels: [],
      topRevenueProducts: [], topProfitProducts: [], lossMakingProducts: [],
      supplierHealth: [],
      fulfilment: buildFulfilmentAnalytics([]),
      advertising: unavailableAdvertisingAnalytics(),
      dataQuality: unknownDataQualitySummary(),
      alerts: [],
      marketReadiness: monitoring.marketReadiness,
      complianceRechecksRequired: 0,
      automationHealthKnown: false,
      demoScenarios: demoAnalyticsScenarios(),
    }
  }

  const settings = await getAutomationSettings(session)
  const { loadOrgSalesFacts, loadProductChannelProfitFacts, toPriceCostInput, loadSupplierHealthFacts, loadFulfilmentFacts } = await liveFacts()

  const [salesFacts, profitFacts, supplierHealthFacts, fulfilmentFacts] = await Promise.all([
    loadOrgSalesFacts(session.orgId, period, previousPeriod),
    loadProductChannelProfitFacts(session.orgId),
    loadSupplierHealthFacts(session.orgId, monitoring.supplierIntelligence),
    loadFulfilmentFacts(session.orgId, period),
  ])

  const sales = buildSalesAnalytics(salesFacts.current, salesFacts.previous, period, salesFacts.currency)

  const channels: ChannelAnalytics[] = (Object.keys(salesFacts.byChannel) as ChannelKey[]).map((channel) => {
    const channelSales = salesFacts.byChannel[channel]!
    const channelSalesAnalytics = buildSalesAnalytics(channelSales.current, channelSales.previous, period, salesFacts.currency)
    const productsForChannel = profitFacts.rows.filter((r) => r.channel === channel).map((r) => buildProductChannelProfitAnalytics(r.productId, r.channel, toPriceCostInput(r, settings.minNetMarginPct)))
    return buildChannelAnalytics(channel, CHANNEL_LABELS[channel], channelSalesAnalytics, productsForChannel)
  })

  const allProjections = profitFacts.rows.map((r) => buildProductChannelProfitAnalytics(r.productId, r.channel, toPriceCostInput(r, settings.minNetMarginPct)))
  const known = allProjections.filter((p) => p.projection.status === 'calculated' && p.projection.value)
  const byRevenue = [...known].sort((a, b) => (b.projection.value!.profitability.netRevenue.minor) - (a.projection.value!.profitability.netRevenue.minor))
  const byProfit = [...known].sort((a, b) => b.projection.value!.profitability.netProfit.minor - a.projection.value!.profitability.netProfit.minor)
  const revenueRankByProduct = new Map(byRevenue.map((p, i) => [`${p.productId}:${p.channel}`, i + 1]))
  const profitRankByProduct = new Map(byProfit.map((p, i) => [`${p.productId}:${p.channel}`, i + 1]))

  const topRevenueProducts = byRevenue.slice(0, DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS.topRankCount).map((p) =>
    toHighlight(p, { revenueRank: revenueRankByProduct.get(`${p.productId}:${p.channel}`), profitRank: profitRankByProduct.get(`${p.productId}:${p.channel}`) }, null),
  )
  const topProfitProducts = byProfit.slice(0, DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS.topRankCount).map((p) =>
    toHighlight(p, { revenueRank: revenueRankByProduct.get(`${p.productId}:${p.channel}`), profitRank: profitRankByProduct.get(`${p.productId}:${p.channel}`) }, null),
  )
  const lossMakingProducts = known
    .filter((p) => p.projection.value!.profitability.netProfit.minor <= 0)
    .map((p) => toHighlight(p, { revenueRank: revenueRankByProduct.get(`${p.productId}:${p.channel}`), profitRank: profitRankByProduct.get(`${p.productId}:${p.channel}`) }, null))

  const supplierHealth = supplierHealthFacts.map((f) => classifySupplierHealth(f))
  const fulfilment = buildFulfilmentAnalytics(fulfilmentFacts)

  const productsWithUnknownCost = allProjections.filter((p) => p.projection.status === 'unknown').length
  const productsMissingListingPrice = allProjections.filter((p) => p.sellingPrice.status === 'unavailable').length
  const dataQuality = buildDataQualitySummary({
    productsWithUnknownCost, productsMissingListingPrice,
    fxRatesStale: monitoring.expansionIntelligence.fxRatesStale.length,
    fulfilmentsMissingTracking: fulfilment.missingTracking.value ?? 0,
    productsWithNoSalesData: salesFacts.hasAnyOrdersEver ? 0 : allProjections.length,
    connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false,
  })

  const now = new Date().toISOString()
  const alerts: BusinessAlert[] = [
    revenueDeclineAlert(sales.revenue.comparison, period.label, now),
    ...dataQualityAlerts(dataQuality.issues, now),
    ...supplierHealthAlerts(supplierHealth, now),
  ].filter((a): a is BusinessAlert => a !== null)

  return {
    isDemo: false,
    period,
    sales,
    channels,
    topRevenueProducts, topProfitProducts, lossMakingProducts,
    supplierHealth,
    fulfilment,
    advertising: unavailableAdvertisingAnalytics(),
    dataQuality,
    alerts,
    marketReadiness: monitoring.marketReadiness,
    complianceRechecksRequired: monitoring.businessAlerts.complianceRechecksRequired,
    automationHealthKnown: true,
    demoScenarios: [],
  }
}

export async function getDailyReport(): Promise<DailyReport> {
  const session = await requireSession()
  if (session.isDemo) return demoDailyReport()

  const [business, cashflow] = await Promise.all([getBusinessSummary(), getCashflow()])
  return {
    generatedAt: new Date().toISOString(),
    isDemo: false,
    business,
    winners: [],
    losers: [],
    opportunities: [],
    stockAlerts: [],
    complianceIssues: [],
    finance: {
      invoicesGenerated: 0, invoicesSent: 0, invoicesFailed: 0, creditNotesIssued: 0,
      vatRegistered: false, outputVat: zero('GBP'), inputVat: zero('GBP'),
      estimatedVatDue: zero('GBP'), vatTransactionsNeedingReview: 0,
      rollingTurnover: zero('GBP'), vatThreshold: zero('GBP'),
      vatThresholdStatus: 'safe', accountingSyncStatus: 'not_connected', accountingPending: 0,
    },
    cashflow,
    approvals: [],
  }
}

// -----------------------------------------------------------------------------
// Named entry points (Milestone 10 §21) — the shape a future CEO AI
// assistant queries facts through, rather than inventing answers. Each one
// currently reads its slice off `getAnalyticsDashboard()` rather than
// running a second live query — correct today, and the same "one real
// query path" discipline this module holds everywhere else. If a future
// caller needs one slice at high frequency without the rest, the fetch can
// be split apart then; nothing about these signatures would need to change.
// -----------------------------------------------------------------------------

export async function getBusinessOverview(periodKey: PeriodKey = 'last_30_days') {
  const d = await getAnalyticsDashboard(periodKey)
  return {
    isDemo: d.isDemo, period: d.period, revenue: d.sales.revenue, orders: d.sales.orders, units: d.sales.units,
    averageOrderValue: d.sales.averageOrderValue, refunds: d.sales.refundsValue, returns: d.sales.returnsCount,
    fulfilment: d.fulfilment, supplierHealth: d.supplierHealth, complianceRechecksRequired: d.complianceRechecksRequired,
    automationHealthKnown: d.automationHealthKnown, dataQuality: d.dataQuality, alerts: d.alerts,
  }
}

export async function getRevenueAnalytics(periodKey: PeriodKey = 'last_30_days'): Promise<SalesAnalytics> {
  return (await getAnalyticsDashboard(periodKey)).sales
}

export async function getProfitAnalytics(periodKey: PeriodKey = 'last_30_days') {
  const d = await getAnalyticsDashboard(periodKey)
  return { channels: d.channels, topProfitProducts: d.topProfitProducts, lossMakingProducts: d.lossMakingProducts }
}

export async function getProductAnalytics(periodKey: PeriodKey = 'last_30_days') {
  const d = await getAnalyticsDashboard(periodKey)
  return { topRevenueProducts: d.topRevenueProducts, topProfitProducts: d.topProfitProducts, lossMakingProducts: d.lossMakingProducts }
}

export async function getSupplierAnalytics(periodKey: PeriodKey = 'last_30_days'): Promise<readonly SupplierHealth[]> {
  return (await getAnalyticsDashboard(periodKey)).supplierHealth
}

export async function getMarketplaceAnalytics(periodKey: PeriodKey = 'last_30_days'): Promise<readonly ChannelAnalytics[]> {
  return (await getAnalyticsDashboard(periodKey)).channels
}

export async function getMarketAnalytics(periodKey: PeriodKey = 'last_30_days') {
  const d = await getAnalyticsDashboard(periodKey)
  return { marketReadiness: d.marketReadiness, fxRatesStale: d.dataQuality.issues.find((i) => i.key === 'stale_fx')?.affectedCount ?? 0 }
}

export async function getDataQuality(periodKey: PeriodKey = 'last_30_days'): Promise<DataQualitySummary> {
  return (await getAnalyticsDashboard(periodKey)).dataQuality
}
