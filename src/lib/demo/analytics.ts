import { aggregateSalesWindow, resolvePeriod, previousEquivalentPeriod, type OrderLineFact, type RefundFact } from '@/lib/orders/salesAggregation'
import { buildSalesAnalytics, type SalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { buildProductChannelProfitAnalytics, type PriceCostInput } from '@/lib/analytics/profitAnalytics'
import { classifyProduct, isLossMakingOnAllKnownChannels } from '@/lib/analytics/productAnalytics'
import { buildChannelAnalytics } from '@/lib/analytics/channelAnalytics'
import { classifySupplierHealth, type SupplierHealth } from '@/lib/analytics/supplierAnalytics'
import { buildFulfilmentAnalytics, type FulfilmentAnalytics, type FulfilmentRecordFact } from '@/lib/analytics/fulfilmentAnalytics'
import { buildDataQualitySummary, type DataQualitySummary } from '@/lib/analytics/dataQuality'
import { unavailableAdvertisingAnalytics, type AdvertisingAnalytics } from '@/lib/analytics/advertisingAnalytics'
import { revenueDeclineAlert, profitDeclineDespiteRevenueGrowthAlert, supplierHealthAlerts, type BusinessAlert } from '@/lib/analytics/businessHealth'
import { demoMarketExpansionScenarios } from './marketExpansion'

/**
 * Milestone 10's 10 required demo scenarios (§16), each computed through
 * the real analytics builder functions against deliberately chosen fixture
 * facts — never a hardcoded UI string standing in for a computed result,
 * the same discipline `demo/monitoring.ts` and `demo/marketExpansion.ts`
 * already established. Demo mode has no database, so this is the only way
 * to show the Milestone 10 analytics layer working end to end.
 */

const NOW = new Date('2026-08-24T09:00:00Z')

export interface AnalyticsDemoScenario {
  key: string
  label: string
  description: string
  narrative: readonly string[]
}

export function demoAnalyticsScenarios(): readonly AnalyticsDemoScenario[] {
  return [
    scenarioStrongGrowth(),
    scenarioRevenueDecline(),
    scenarioProfitDeclineDespiteGrowth(),
    scenarioProductBecomesLossMaking(),
    scenarioSupplierDeterioration(),
    scenarioMarketplaceUnderperformance(),
    scenarioInternationalMarketPerformingWell(),
    scenarioIncompleteProfitData(),
    scenarioAdvertisingUnavailable(),
    scenarioFulfilmentDeterioration(),
  ]
}

function line(orderId: string, placedAt: string, quantity: number, lineTotalMinor: number): OrderLineFact {
  return { orderId, orderStatus: 'fulfilled', orderSubtotalMinor: lineTotalMinor, placedAt, quantity, lineTotalMinor }
}

function buildSales(currentLines: OrderLineFact[], currentRefunds: RefundFact[], previousLines: OrderLineFact[], previousRefunds: RefundFact[]): SalesAnalytics {
  const period = resolvePeriod('last_30_days', NOW)
  const previousPeriod = previousEquivalentPeriod(period)
  const current = aggregateSalesWindow(currentLines, currentRefunds, new Date(period.start), new Date(period.end))
  const previous = aggregateSalesWindow(previousLines, previousRefunds, new Date(previousPeriod.start), new Date(previousPeriod.end))
  return buildSalesAnalytics(current, previous, period, 'GBP')
}

function scenarioStrongGrowth(): AnalyticsDemoScenario {
  const previousLines = [line('o1', '2026-07-10T00:00:00Z', 40, 40 * 3200)]
  const currentLines = [line('o2', '2026-08-10T00:00:00Z', 90, 90 * 3200)]
  const sales = buildSales(currentLines, [], previousLines, [])
  const decline = revenueDeclineAlert(sales.revenue.comparison, sales.period.label, NOW.toISOString())

  return {
    key: 'strong_growth', label: 'Strong growth',
    description: 'Revenue and units both climb well past the growth threshold — the same buildSalesAnalytics + comparePeriods chain every other scenario uses, just with genuinely better numbers.',
    narrative: [
      `Revenue: ${sales.revenue.comparison?.percentChange}% vs the previous 30 days, from real order/order_items facts.`,
      `Units: ${sales.units.comparison?.current} vs ${sales.units.comparison?.previous}.`,
      decline ? `Unexpected: a decline alert fired (${decline.message}) — this would be a real bug.` : 'No revenue-decline alert fires, correctly — growth never triggers a decline alert.',
    ],
  }
}

function scenarioRevenueDecline(): AnalyticsDemoScenario {
  const previousLines = [line('o1', '2026-07-10T00:00:00Z', 100, 100 * 3200)]
  const currentLines = [line('o2', '2026-08-10T00:00:00Z', 55, 55 * 3200)]
  const sales = buildSales(currentLines, [], previousLines, [])
  const alert = revenueDeclineAlert(sales.revenue.comparison, sales.period.label, NOW.toISOString())

  return {
    key: 'revenue_decline', label: 'Revenue decline',
    description: 'A genuine period-over-period fall beyond the configured threshold produces a real, evidence-carrying business alert — never a narrated guess.',
    narrative: [
      `Revenue: ${sales.revenue.comparison?.percentChange}% vs the previous 30 days.`,
      alert ? `Alert raised: "${alert.message}" (severity ${alert.severity}), evidence: ${JSON.stringify(alert.evidence)}.` : 'No alert fired — this would be a bug given the threshold.',
    ],
  }
}

function scenarioProfitDeclineDespiteGrowth(): AnalyticsDemoScenario {
  const previousLines = [line('o1', '2026-07-10T00:00:00Z', 50, 50 * 3200)]
  const currentLines = [line('o2', '2026-08-10T00:00:00Z', 65, 65 * 3200)] // Revenue up.
  const sales = buildSales(currentLines, [], previousLines, [])

  const healthy: PriceCostInput = { category: null, sellingPriceMinor: 3200, sellingPriceCurrency: 'GBP', productCostMinor: 900, productCostCurrency: 'GBP', supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10 }
  const costRisen: PriceCostInput = { ...healthy, productCostMinor: 2100 } // Supplier cost rose sharply — profit compresses even though sales grew.
  const before = buildProductChannelProfitAnalytics('prod-demo-1', 'shopify', healthy)
  const after = buildProductChannelProfitAnalytics('prod-demo-1', 'shopify', costRisen)

  const profitComparison = {
    current: after.projection.value!.profitability.netProfit.minor, previous: before.projection.value!.profitability.netProfit.minor,
    absoluteChange: after.projection.value!.profitability.netProfit.minor - before.projection.value!.profitability.netProfit.minor,
    percentChange: Math.round(((after.projection.value!.profitability.netProfit.minor - before.projection.value!.profitability.netProfit.minor) / before.projection.value!.profitability.netProfit.minor) * 10000) / 100,
    direction: 'down' as const,
  }
  const alert = profitDeclineDespiteRevenueGrowthAlert(sales.revenue.comparison, profitComparison, NOW.toISOString())

  return {
    key: 'profit_decline_despite_growth', label: 'Profit decline despite revenue growth',
    description: 'Revenue genuinely grew, but a real cost increase erodes net profit over the same period — the specific case the brief names, proven through the real profitability engine, not two unrelated numbers glued together.',
    narrative: [
      `Revenue: +${sales.revenue.comparison?.percentChange}% vs the previous 30 days.`,
      `Net profit per unit: £${(before.projection.value!.profitability.netProfit.minor / 100).toFixed(2)} -> £${(after.projection.value!.profitability.netProfit.minor / 100).toFixed(2)} after the supplier cost rise.`,
      alert ? `Alert raised: "${alert.message}"` : 'No alert fired — this would be a bug.',
    ],
  }
}

function scenarioProductBecomesLossMaking(): AnalyticsDemoScenario {
  const input: PriceCostInput = { category: null, sellingPriceMinor: 2500, sellingPriceCurrency: 'GBP', productCostMinor: 900, productCostCurrency: 'GBP', supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10 }
  const before = buildProductChannelProfitAnalytics('prod-demo-2', 'amazon_uk', input)
  const after = buildProductChannelProfitAnalytics('prod-demo-2', 'amazon_uk', { ...input, productCostMinor: 1900 })
  const lossMaking = isLossMakingOnAllKnownChannels([{ channel: 'amazon_uk', knownNetProfitMinor: after.projection.value!.profitability.netProfit.minor }])
  const tags = classifyProduct({
    productId: 'prod-demo-2', bestKnownNetMarginPct: after.projection.value!.profitability.netMarginPct, lossMakingOnAllKnownChannels: lossMaking,
    revenueChangePct: null, refundRatePct: null, hasSupplierRiskEvent: false, hasStockRiskEvent: false, hasComplianceRiskEvent: false, hasUnexploitedProfitableChannel: false,
  })

  return {
    key: 'product_becomes_loss_making', label: 'Product becoming loss-making',
    description: 'A supplier cost rise pushes a previously profitable product\'s net profit below zero on its only known channel — the real profitability engine crosses the boundary, and the product classifier reflects it.',
    narrative: [
      `Before: net profit £${(before.projection.value!.profitability.netProfit.minor / 100).toFixed(2)} per unit (${before.projection.value!.profitability.netMarginPct}% margin).`,
      `After: net profit £${(after.projection.value!.profitability.netProfit.minor / 100).toFixed(2)} per unit — a genuine loss.`,
      `Classification tags: ${tags.join(', ') || '(none)'}.`,
    ],
  }
}

function scenarioSupplierDeterioration(): AnalyticsDemoScenario {
  const healthy: SupplierHealth = classifySupplierHealth({ supplierId: 'sup-demo-1', connectorStatus: 'healthy', connectorStatusKnown: true, hasDispatchDelayEvent: false, hasCancellationIncreaseEvent: false, hasFeedProblemEvent: false, cancellationRatePct: 1, fulfilmentSuccessRatePct: 98 })
  const deteriorated: SupplierHealth = classifySupplierHealth({ supplierId: 'sup-demo-1', connectorStatus: 'healthy', connectorStatusKnown: true, hasDispatchDelayEvent: true, hasCancellationIncreaseEvent: true, hasFeedProblemEvent: false, cancellationRatePct: 14, fulfilmentSuccessRatePct: 71 })
  const alerts: readonly BusinessAlert[] = supplierHealthAlerts([deteriorated], NOW.toISOString())

  return {
    key: 'supplier_deterioration', label: 'Supplier deterioration',
    description: 'The exact same deterministic classifySupplierHealth engine automation/monitoring already uses — genuine dispatch/cancellation/fulfilment-success facts crossing real thresholds, not an invented score.',
    narrative: [
      `Before: ${healthy.status} (no reasons — everything within threshold).`,
      `After: ${deteriorated.status} — ${deteriorated.reasons.join(' ')}`,
      `Business alert: "${alerts[0]?.message ?? '(none)'}"`,
    ],
  }
}

function scenarioMarketplaceUnderperformance(): AnalyticsDemoScenario {
  const shopifyInput: PriceCostInput = { category: null, sellingPriceMinor: 3200, sellingPriceCurrency: 'GBP', productCostMinor: 900, productCostCurrency: 'GBP', supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10 }
  const amazonInput: PriceCostInput = { ...shopifyInput, sellingPriceMinor: 2400 } // A much thinner price against the same real Amazon fee structure.

  const shopify = buildProductChannelProfitAnalytics('prod-demo-3', 'shopify', shopifyInput)
  const amazon = buildProductChannelProfitAnalytics('prod-demo-3', 'amazon_uk', amazonInput)

  const shopifySales = buildSales([line('o1', '2026-08-10T00:00:00Z', 40, 40 * 3200)], [], [line('o0', '2026-07-10T00:00:00Z', 38, 38 * 3200)], [])
  const amazonSales = buildSales([line('o2', '2026-08-10T00:00:00Z', 15, 15 * 2400)], [], [line('o3', '2026-07-10T00:00:00Z', 14, 14 * 2400)], [])
  const shopifyChannel = buildChannelAnalytics('shopify', 'Shopify', shopifySales, [shopify])
  const amazonChannel = buildChannelAnalytics('amazon_uk', 'Amazon UK', amazonSales, [amazon])

  return {
    key: 'marketplace_underperformance', label: 'Marketplace underperformance',
    description: 'The same product, two channels, two genuinely different profitability outcomes — channel analytics never collapses them into one blended figure.',
    narrative: [
      `Shopify: net margin ${shopify.projection.value?.profitability.netMarginPct}%, ${shopifyChannel.sales.units.value} units this period.`,
      `Amazon UK: net margin ${amazon.projection.value?.profitability.netMarginPct}%, ${amazonChannel.sales.units.value} units this period.`,
      (amazon.projection.value?.profitability.netMarginPct ?? 0) < (shopify.projection.value?.profitability.netMarginPct ?? 0)
        ? 'Amazon is the underperforming channel here — real fee/price assumptions, not a guess.'
        : 'Unexpected ranking — this would be a bug in the fixture.',
    ],
  }
}

function scenarioInternationalMarketPerformingWell(): AnalyticsDemoScenario {
  // Reuses Milestone 9's own real expansion-engine demo scenario rather
  // than re-deriving country/FX/compliance facts a second time.
  const [readyScenario] = demoMarketExpansionScenarios()
  const uk = readyScenario.results[0]

  return {
    key: 'international_market_performing_well', label: 'International market performing well',
    description: 'Amazon UK clears compliance, profitability and supplier capability — evaluated by Milestone 9\'s real evaluateMarketExpansion engine, surfaced here as an analytics fact, not recomputed.',
    narrative: [
      `${uk.marketKey}: ${uk.recommendation} (score ${uk.score}/100).`,
      `Compliance: ${uk.compliance.verdict}. Profitability: ${uk.profitability?.gate.passes ? 'passes the gate' : 'does not pass the gate'}.`,
    ],
  }
}

function scenarioIncompleteProfitData(): AnalyticsDemoScenario {
  const known: PriceCostInput = { category: null, sellingPriceMinor: 2200, sellingPriceCurrency: 'GBP', productCostMinor: 700, productCostCurrency: 'GBP', supplierShippingMinor: 150, returnRatePct: 2, minNetMarginPct: 10 }
  const missingCost = buildProductChannelProfitAnalytics('prod-demo-4', 'shopify', { ...known, productCostMinor: null })
  const dataQuality: DataQualitySummary = buildDataQualitySummary({
    productsWithUnknownCost: 1, productsMissingListingPrice: 0, fxRatesStale: 0, fulfilmentsMissingTracking: 0,
    productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false,
  })

  return {
    key: 'incomplete_profit_data', label: 'Data-quality / incomplete-profit scenario',
    description: 'A product with no live supplier cost on file gets an honest UNKNOWN projection, never a guessed number — and the gap is surfaced in the data-quality summary the CEO dashboard reads.',
    narrative: [
      `Projection status: ${missingCost.projection.status} — "${missingCost.projection.source}"`,
      `Data quality: ${dataQuality.overallStatus}, ${dataQuality.issues.length} issue(s) — including "${dataQuality.issues.find((i) => i.key === 'missing_supplier_cost')?.message}"`,
    ],
  }
}

function scenarioAdvertisingUnavailable(): AnalyticsDemoScenario {
  const ads: AdvertisingAnalytics = unavailableAdvertisingAnalytics()
  return {
    key: 'advertising_unavailable', label: 'Advertising data unavailable',
    description: 'No advertising connector exists in this codebase — every figure reports honestly as unavailable, never a fabricated £0 spend or a fictitious ROAS.',
    narrative: [
      `Spend: ${ads.spend.status} — "${ads.spend.source}"`,
      `ROAS: ${ads.roas.status}. ACOS: ${ads.acosPct.status}. Profit impact: ${ads.profitImpact.status}.`,
    ],
  }
}

function scenarioFulfilmentDeterioration(): AnalyticsDemoScenario {
  const healthyRecords: FulfilmentRecordFact[] = [
    { status: 'delivered', submittedAt: '2026-08-01T00:00:00Z', shippedAt: '2026-08-02T00:00:00Z', deliveredAt: '2026-08-04T00:00:00Z', promisedBy: '2026-08-05', trackingNumber: 'TRK-A' },
    { status: 'delivered', submittedAt: '2026-08-02T00:00:00Z', shippedAt: '2026-08-03T00:00:00Z', deliveredAt: '2026-08-05T00:00:00Z', promisedBy: '2026-08-06', trackingNumber: 'TRK-B' },
  ]
  const deterioratedRecords: FulfilmentRecordFact[] = [
    { status: 'delivered', submittedAt: '2026-08-15T00:00:00Z', shippedAt: '2026-08-20T00:00:00Z', deliveredAt: '2026-08-28T00:00:00Z', promisedBy: '2026-08-22', trackingNumber: 'TRK-C' },
    { status: 'shipped', submittedAt: '2026-08-16T00:00:00Z', shippedAt: '2026-08-21T00:00:00Z', deliveredAt: null, promisedBy: null, trackingNumber: null },
    { status: 'cancelled', submittedAt: null, shippedAt: null, deliveredAt: null, promisedBy: null, trackingNumber: null },
  ]
  const before: FulfilmentAnalytics = buildFulfilmentAnalytics(healthyRecords)
  const after: FulfilmentAnalytics = buildFulfilmentAnalytics(deterioratedRecords)

  return {
    key: 'fulfilment_deterioration', label: 'Fulfilment deterioration',
    description: 'Dispatch time lengthens, a delivery misses its promise, and one shipment has no tracking at all — an honest UNKNOWN delivery outcome, never assumed successful just because it shipped.',
    narrative: [
      `Before: average dispatch ${before.averageDispatchDays.value} day(s), on-time rate ${before.onTimeDeliveryRatePct.value}%.`,
      `After: average dispatch ${after.averageDispatchDays.value} day(s), cancellation rate ${after.cancellationRatePct.value}%, ${after.unknownDeliveryOutcome.value} shipment(s) with an unknown outcome.`,
    ],
  }
}
