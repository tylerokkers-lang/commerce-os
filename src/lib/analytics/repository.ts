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
import { emptySalesAnalytics, resolveSalesAnalyticsSafely, type SalesAnalytics } from './salesAnalytics'
import { buildProductChannelProfitAnalytics, type ProductChannelProfitAnalytics } from './profitAnalytics'
import { buildChannelAnalytics, type ChannelAnalytics } from './channelAnalytics'
import { classifyProduct, isLossMakingOnAllKnownChannels, DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS, type ProductClassificationTag } from './productAnalytics'
import { classifySupplierHealth, type SupplierHealth } from './supplierAnalytics'
import { buildFulfilmentAnalytics, type FulfilmentAnalytics } from './fulfilmentAnalytics'
import { unavailableAdvertisingAnalytics, type AdvertisingAnalytics } from './advertisingAnalytics'
import {
  buildAdvertisingScorecard, buildCampaignFact, buildRealAdvertisingAnalytics, classifyCampaign, groupCampaignRows, latestCampaignIdentity,
  resolveCampaignProfitability, sumCampaignRows, type AdvertisingCampaignFact, type AdvertisingScorecard, type CampaignClassificationResult,
} from './advertisingAnalytics'
import { demoAdvertisingScenarios, type AdvertisingDemoScenario } from '@/lib/demo/advertising'
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
  const { loadAdvertisingFacts } = await liveAdFacts()

  const [salesFacts, profitFacts, supplierHealthFacts, fulfilmentFacts, adFacts] = await Promise.all([
    loadOrgSalesFacts(session.orgId, period, previousPeriod),
    loadProductChannelProfitFacts(session.orgId),
    loadSupplierHealthFacts(session.orgId, monitoring.supplierIntelligence),
    loadFulfilmentFacts(session.orgId, period),
    loadAdvertisingFacts(session.orgId, period, previousPeriod),
  ])

  // A mixed-currency window is never silently summed (Milestone 11 §5/§8's
  // explicit currency-safety requirement) — resolved through the one pure,
  // tested gate every sales-analytics call site shares.
  const sales = resolveSalesAnalyticsSafely(salesFacts.current, salesFacts.previous, period, salesFacts.currency, salesFacts.mixedCurrencies)

  const channels: ChannelAnalytics[] = (Object.keys(salesFacts.byChannel) as ChannelKey[]).map((channel) => {
    const channelSales = salesFacts.byChannel[channel]!
    const channelSalesAnalytics = resolveSalesAnalyticsSafely(channelSales.current, channelSales.previous, period, salesFacts.currency, salesFacts.mixedCurrencies)
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

  // Milestone 14 — real advertising data now exists (the `advertising`
  // table, `buildCampaignIntelligence` below); this reuses `allProjections`
  // (already loaded above, one query) rather than a second profit-facts
  // fetch, and produces the same `AdvertisingAnalytics` shape Milestone 10
  // defined — additive, backward-compatible, no consumer of this field
  // (`/automation`'s `MetricStat` tiles) needs to change.
  const profitByProductChannel = new Map(allProjections.map((p) => [`${p.productId}:${p.channel}`, p]))
  const campaigns = buildCampaignIntelligence(adFacts.rows, profitByProductChannel, settings, period, previousPeriod, adFacts.currency)
  const adOrgRevenueMinor = salesFacts.mixedCurrencies.length === 0 && salesFacts.currency === adFacts.currency ? salesFacts.current.grossRevenueMinor : null
  const advertisingScorecard = buildAdvertisingScorecard(campaigns, adOrgRevenueMinor, adFacts.currency)
  const advertising = buildRealAdvertisingAnalytics(advertisingScorecard)

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
    advertising,
    dataQuality,
    alerts,
    marketReadiness: monitoring.marketReadiness,
    complianceRechecksRequired: monitoring.businessAlerts.complianceRechecksRequired,
    automationHealthKnown: true,
    demoScenarios: [],
  }
}

// -----------------------------------------------------------------------------
// Advertising intelligence (Milestone 14) — a separate entry point from
// getAnalyticsDashboard(), the same "getCashflow() is its own read" shape
// this module already uses, for a feature with genuinely different
// consumers (the new /advertising page, the CEO dashboard, the chat) and
// its own per-campaign detail no single Metric<T> field could carry.
// `AnalyticsDashboard.advertising` (Milestone 10's shape) is NOT a second,
// disconnected model — `getAnalyticsDashboard()` above now populates it
// with `buildRealAdvertisingAnalytics(buildAdvertisingScorecard(...))`,
// the exact same pure aggregation/classification engine this section
// builds on, computed from the exact same `loadAdvertisingFacts` read and
// the exact same per-product profitability projections
// `getAnalyticsDashboard()` already loads — never a second query, never a
// second calculation. `AdvertisingAnalytics`'s shape genuinely cannot
// carry a *list* of campaigns with individual classifications (it is one
// flat org-wide metric bag, Milestone 10's design, unchanged) — that
// per-campaign detail is what `AdvertisingIntelligence` below adds
// alongside it, not instead of it.
// -----------------------------------------------------------------------------

export interface CampaignIntelligence {
  fact: AdvertisingCampaignFact
  classification: CampaignClassificationResult
}

export interface AdvertisingIntelligence {
  isDemo: boolean
  period: Period
  campaigns: readonly CampaignIntelligence[]
  scorecard: AdvertisingScorecard
  demoScenarios: readonly AdvertisingDemoScenario[]
}

async function liveAdFacts() {
  return import('./liveAdvertisingFacts')
}

function rowsInWindow<T extends { periodDate: string }>(rows: readonly T[], start: string, end: string): T[] {
  const startDate = start.slice(0, 10)
  const endDate = end.slice(0, 10)
  return rows.filter((r) => r.periodDate >= startDate && r.periodDate <= endDate)
}

export async function getAdvertisingIntelligence(periodKey: PeriodKey = 'last_30_days'): Promise<AdvertisingIntelligence> {
  const session = await requireSession()
  const period = resolvePeriod(periodKey, new Date())
  const previousPeriod = previousEquivalentPeriod(period)

  if (session.isDemo) {
    // Demo mode has no database — `campaigns`/`scorecard` are genuinely
    // empty (the same "empty is a fact, not a fallback" rule
    // `getAnalyticsDashboard()`'s own demo branch already follows), and
    // `demoScenarios` illustrates the real classification engine working
    // against fixed, self-contained fixture data instead — the same
    // "narrative scenarios, computed through the real builder functions,
    // never a hardcoded string" pattern `demo/analytics.ts`/`demo/ceo.ts`
    // already established.
    return { isDemo: true, period, campaigns: [], scorecard: buildAdvertisingScorecard([], null, 'GBP'), demoScenarios: demoAdvertisingScenarios() }
  }

  const settings = await getAutomationSettings(session)
  const { loadAdvertisingFacts } = await liveAdFacts()
  const { loadProductChannelProfitFacts, toPriceCostInput, loadOrgSalesFacts } = await liveFacts()

  const [adFacts, profitFacts, salesFacts] = await Promise.all([
    loadAdvertisingFacts(session.orgId, period, previousPeriod),
    loadProductChannelProfitFacts(session.orgId),
    loadOrgSalesFacts(session.orgId, period, previousPeriod),
  ])

  const profitByProductChannel = new Map(
    profitFacts.rows.map((r) => [`${r.productId}:${r.channel}`, buildProductChannelProfitAnalytics(r.productId, r.channel, toPriceCostInput(r, settings.minNetMarginPct))]),
  )

  const campaigns = buildCampaignIntelligence(adFacts.rows, profitByProductChannel, settings, period, previousPeriod, adFacts.currency)

  // TACOS needs the org's total sales revenue for the same window — never used if sales itself is currency-unsafe (Milestone 11 §5/§8's rule extended here).
  const orgRevenueMinor = salesFacts.mixedCurrencies.length === 0 && salesFacts.currency === adFacts.currency ? salesFacts.current.grossRevenueMinor : null
  const scorecard = buildAdvertisingScorecard(campaigns, orgRevenueMinor, adFacts.currency)

  return { isDemo: false, period, campaigns, scorecard, demoScenarios: [] }
}

function buildCampaignIntelligence(
  rows: Parameters<typeof groupCampaignRows>[0],
  profitByProductChannel: Map<string, ProductChannelProfitAnalytics> | null,
  settings: Awaited<ReturnType<typeof getAutomationSettings>>,
  period: Period,
  previousPeriod: Period,
  currency: AdvertisingCampaignFact['currency'],
): readonly CampaignIntelligence[] {
  const groups = groupCampaignRows(rows)
  const results: CampaignIntelligence[] = []

  for (const [key, groupRows] of groups) {
    const identity = latestCampaignIdentity(key, groupRows)
    const currentRows = rowsInWindow(groupRows, period.start, period.end)
    const previousRows = rowsInWindow(groupRows, previousPeriod.start, previousPeriod.end)
    if (currentRows.length === 0) continue // Nothing in the requested window for this campaign — not a real fact for this period.

    let fact = buildCampaignFact(identity, sumCampaignRows(currentRows), currency, period.start, period.end)
    const previousFact = previousRows.length > 0 ? buildCampaignFact(identity, sumCampaignRows(previousRows), currency, previousPeriod.start, previousPeriod.end) : null

    if (profitByProductChannel && identity.productId) {
      const channelProfit = profitByProductChannel.get(`${identity.productId}:${identity.channel}`) ?? null
      fact = { ...fact, profitability: resolveCampaignProfitability(fact, channelProfit) }
    }

    const classification = classifyCampaign(fact, settings, previousFact)
    results.push({ fact, classification })
  }

  return results
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
