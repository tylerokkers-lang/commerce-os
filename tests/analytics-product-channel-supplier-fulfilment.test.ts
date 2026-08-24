import { describe, expect, it } from 'vitest'
import { classifyProduct, isLossMakingOnAllKnownChannels, DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS } from '@/lib/analytics/productAnalytics'
import { buildChannelProfitRollup } from '@/lib/analytics/channelAnalytics'
import { classifySupplierHealth } from '@/lib/analytics/supplierAnalytics'
import { buildFulfilmentAnalytics } from '@/lib/analytics/fulfilmentAnalytics'
import { buildDataQualitySummary, unknownDataQualitySummary } from '@/lib/analytics/dataQuality'
import { unavailableAdvertisingAnalytics } from '@/lib/analytics/advertisingAnalytics'
import { buildProductChannelProfitAnalytics } from '@/lib/analytics/profitAnalytics'
import { revenueDeclineAlert, profitDeclineDespiteRevenueGrowthAlert, supplierHealthAlerts } from '@/lib/analytics/businessHealth'

const baseInput = {
  bestKnownNetMarginPct: null as number | null,
  lossMakingOnAllKnownChannels: false,
  revenueChangePct: null as number | null,
  refundRatePct: null as number | null,
  hasSupplierRiskEvent: false, hasStockRiskEvent: false, hasComplianceRiskEvent: false,
  hasUnexploitedProfitableChannel: false,
}

describe('classifyProduct', () => {
  it('tags a top-ranked, high-margin, growing product correctly', () => {
    const tags = classifyProduct({ productId: 'p1', ...baseInput, revenueRank: 2, profitRank: 1, bestKnownNetMarginPct: 40, revenueChangePct: 30 })
    expect(tags).toContain('top_revenue')
    expect(tags).toContain('top_profit')
    expect(tags).toContain('high_margin')
    expect(tags).toContain('growing_sales')
  })

  it('tags a declining, low-margin product with a high refund rate', () => {
    const tags = classifyProduct({ productId: 'p2', ...baseInput, bestKnownNetMarginPct: 5, revenueChangePct: -40, refundRatePct: 12 })
    expect(tags).toEqual(expect.arrayContaining(['low_margin', 'declining_sales', 'high_refund_rate']))
    expect(tags).not.toContain('high_margin')
  })

  it('never tags high_margin or low_margin when margin is unknown', () => {
    const tags = classifyProduct({ productId: 'p3', ...baseInput })
    expect(tags).not.toContain('high_margin')
    expect(tags).not.toContain('low_margin')
  })

  it('a product ranked outside the top count is not tagged top_revenue', () => {
    const tags = classifyProduct({ productId: 'p4', ...baseInput, revenueRank: DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS.topRankCount + 1 })
    expect(tags).not.toContain('top_revenue')
  })

  it('risk/opportunity tags pass through real open-event flags verbatim', () => {
    const tags = classifyProduct({ productId: 'p5', ...baseInput, hasSupplierRiskEvent: true, hasStockRiskEvent: true, hasComplianceRiskEvent: true, hasUnexploitedProfitableChannel: true })
    expect(tags).toEqual(expect.arrayContaining(['supplier_risk', 'stock_risk', 'compliance_risk', 'channel_opportunity']))
  })
})

describe('isLossMakingOnAllKnownChannels', () => {
  it('is false when the list is empty (nothing known, never a guess)', () => {
    expect(isLossMakingOnAllKnownChannels([])).toBe(false)
  })

  it('is false when at least one known channel is profitable', () => {
    expect(isLossMakingOnAllKnownChannels([{ channel: 'shopify', knownNetProfitMinor: -100 }, { channel: 'amazon_uk', knownNetProfitMinor: 50 }])).toBe(false)
  })

  it('is true only when every known channel is at or below zero', () => {
    expect(isLossMakingOnAllKnownChannels([{ channel: 'shopify', knownNetProfitMinor: -100 }, { channel: 'amazon_uk', knownNetProfitMinor: -50 }])).toBe(true)
  })

  it('ignores unknown channels — a null entry never counts against the product', () => {
    expect(isLossMakingOnAllKnownChannels([{ channel: 'shopify', knownNetProfitMinor: null }])).toBe(false)
  })
})

describe('buildChannelProfitRollup', () => {
  const healthyInput = { category: null, sellingPriceMinor: 3000, sellingPriceCurrency: 'GBP' as const, productCostMinor: 900, productCostCurrency: 'GBP' as const, supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10 }

  it('sums only products with a known projection and reports how many were excluded', () => {
    const p1 = buildProductChannelProfitAnalytics('p1', 'shopify', healthyInput)
    const p2 = buildProductChannelProfitAnalytics('p2', 'shopify', { ...healthyInput, productCostMinor: null })
    const rollup = buildChannelProfitRollup('GBP', [p1, p2])
    expect(rollup.productsWithKnownProfit).toBe(1)
    expect(rollup.productsWithUnknownProfit).toBe(1)
    expect(rollup.knownNetProfit.status).toBe('calculated')
  })

  it('an empty product list reports unknown, never a fabricated zero', () => {
    const rollup = buildChannelProfitRollup('GBP', [])
    expect(rollup.knownNetProfit.status).toBe('unknown')
    expect(rollup.knownNetProfit.value).toBeNull()
  })
})

describe('classifySupplierHealth', () => {
  const cleanInput = { supplierId: 's1', connectorStatus: 'ok', connectorStatusKnown: true, hasDispatchDelayEvent: false, hasCancellationIncreaseEvent: false, hasFeedProblemEvent: false, cancellationRatePct: 2, fulfilmentSuccessRatePct: 98 }

  it('is healthy when every fact is clean', () => {
    expect(classifySupplierHealth(cleanInput).status).toBe('healthy')
  })

  it('is unavailable when the feed has failed, regardless of other facts', () => {
    const result = classifySupplierHealth({ ...cleanInput, hasFeedProblemEvent: true, fulfilmentSuccessRatePct: 99 })
    expect(result.status).toBe('unavailable')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('is unknown only when no operational fact has ever been observed', () => {
    const result = classifySupplierHealth({ supplierId: 's1', connectorStatus: null, connectorStatusKnown: false, hasDispatchDelayEvent: false, hasCancellationIncreaseEvent: false, hasFeedProblemEvent: false, cancellationRatePct: null, fulfilmentSuccessRatePct: null })
    expect(result.status).toBe('unknown')
  })

  it('is at_risk on a low fulfilment success rate, with an explaining reason', () => {
    const result = classifySupplierHealth({ ...cleanInput, fulfilmentSuccessRatePct: 60 })
    expect(result.status).toBe('at_risk')
    expect(result.reasons[0]).toContain('60')
  })

  it('is watch (not at_risk) on a dispatch delay alone', () => {
    const result = classifySupplierHealth({ ...cleanInput, hasDispatchDelayEvent: true })
    expect(result.status).toBe('watch')
  })
})

describe('buildFulfilmentAnalytics', () => {
  it('an empty record set reports honest zeros/unknowns, no division by zero', () => {
    const result = buildFulfilmentAnalytics([])
    expect(result.totalFulfilments.value).toBe(0)
    expect(result.cancellationRatePct.status).toBe('unknown')
    expect(result.averageDispatchDays.status).toBe('unknown')
  })

  it('computes dispatch time, on-time rate and unknown-outcome count correctly', () => {
    const records = [
      { status: 'delivered', submittedAt: '2026-08-01T00:00:00Z', shippedAt: '2026-08-02T00:00:00Z', deliveredAt: '2026-08-04T00:00:00Z', promisedBy: '2026-08-05', trackingNumber: 'TRK1' },
      { status: 'delivered', submittedAt: '2026-08-01T00:00:00Z', shippedAt: '2026-08-03T00:00:00Z', deliveredAt: '2026-08-10T00:00:00Z', promisedBy: '2026-08-05', trackingNumber: 'TRK2' }, // late
      { status: 'shipped', submittedAt: '2026-08-01T00:00:00Z', shippedAt: '2026-08-02T00:00:00Z', deliveredAt: null, promisedBy: null, trackingNumber: null }, // unknown outcome
      { status: 'cancelled', submittedAt: null, shippedAt: null, deliveredAt: null, promisedBy: null, trackingNumber: null },
    ]
    const result = buildFulfilmentAnalytics(records)
    expect(result.delivered.value).toBe(2)
    expect(result.cancelled.value).toBe(1)
    expect(result.cancellationRatePct.value).toBe(25)
    expect(result.averageDispatchDays.value).toBe(1.33) // (1 + 2 + 1) days across all three dispatched fulfilments / 3
    expect(result.onTimeDeliveryRatePct.value).toBe(50) // 1 of 2 delivered-with-promise on time
    expect(result.lateDeliveries.value).toBe(1)
    expect(result.unknownDeliveryOutcome.value).toBe(1)
    expect(result.missingTracking.value).toBe(1) // the unknown-outcome shipment
  })
})

describe('buildDataQualitySummary', () => {
  it('reports complete when every input is clean', () => {
    const summary = buildDataQualitySummary({
      productsWithUnknownCost: 0, productsMissingListingPrice: 0, fxRatesStale: 0, fulfilmentsMissingTracking: 0,
      productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: true,
    })
    expect(summary.overallStatus).toBe('complete')
    expect(summary.issues).toHaveLength(0)
  })

  it('surfaces one issue per genuine gap, each with an affected count', () => {
    const summary = buildDataQualitySummary({
      productsWithUnknownCost: 3, productsMissingListingPrice: 0, fxRatesStale: 2, fulfilmentsMissingTracking: 0,
      productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false,
    })
    expect(summary.overallStatus).toBe('incomplete')
    expect(summary.issues.find((i) => i.key === 'missing_supplier_cost')?.affectedCount).toBe(3)
    expect(summary.issues.find((i) => i.key === 'stale_fx')?.affectedCount).toBe(2)
    expect(summary.issues.some((i) => i.key === 'missing_advertising_data')).toBe(true)
  })

  it('demo mode reports unknown, never complete or incomplete', () => {
    expect(unknownDataQualitySummary().overallStatus).toBe('unknown')
  })
})

describe('advertising analytics architecture', () => {
  it('every metric is unavailable, never a fabricated zero, until a real connector exists', () => {
    const result = unavailableAdvertisingAnalytics()
    expect(result.spend.status).toBe('unavailable')
    expect(result.roas.status).toBe('unavailable')
    expect(result.spend.value).toBeNull()
  })
})

describe('business health alerts', () => {
  it('no alert when revenue is flat or growing', () => {
    expect(revenueDeclineAlert({ current: 110, previous: 100, absoluteChange: 10, percentChange: 10, direction: 'up' }, 'month', '2026-08-24')).toBeNull()
  })

  it('a genuine revenue decline beyond the threshold produces a critical alert carrying the real comparison as evidence', () => {
    const alert = revenueDeclineAlert({ current: 80, previous: 100, absoluteChange: -20, percentChange: -20, direction: 'down' }, '30 days', '2026-08-24')
    expect(alert?.severity).toBe('critical')
    expect(alert?.evidence).toMatchObject({ percentChange: -20 })
  })

  it('flags profit decline despite revenue growth — the specific case the brief calls out', () => {
    const alert = profitDeclineDespiteRevenueGrowthAlert(
      { current: 120, previous: 100, absoluteChange: 20, percentChange: 20, direction: 'up' },
      { current: 80, previous: 100, absoluteChange: -20, percentChange: -20, direction: 'down' },
      '2026-08-24',
    )
    expect(alert).not.toBeNull()
    expect(alert?.message).toContain('Revenue is up')
    expect(alert?.message).toContain('net profit is down')
  })

  it('does not flag profit-decline-despite-growth when both move in the same direction', () => {
    const alert = profitDeclineDespiteRevenueGrowthAlert(
      { current: 80, previous: 100, absoluteChange: -20, percentChange: -20, direction: 'down' },
      { current: 80, previous: 100, absoluteChange: -20, percentChange: -20, direction: 'down' },
      '2026-08-24',
    )
    expect(alert).toBeNull()
  })

  it('supplier health alerts only fire for at_risk/unavailable, never for healthy or watch', () => {
    const alerts = supplierHealthAlerts([
      { supplierId: 's1', status: 'healthy', reasons: [] },
      { supplierId: 's2', status: 'watch', reasons: ['dispatch delay'] },
      { supplierId: 's3', status: 'at_risk', reasons: ['cancellation rate 15%'] },
      { supplierId: 's4', status: 'unavailable', reasons: ['feed failed'] },
    ], '2026-08-24')
    expect(alerts.map((a) => a.affectedEntityId)).toEqual(['s3', 's4'])
  })
})
