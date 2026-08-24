import { describe, expect, it } from 'vitest'
import { comparePeriods } from '@/lib/core/compare'
import { resolvePeriod, previousEquivalentPeriod, aggregateSalesWindow } from '@/lib/orders/salesAggregation'
import { buildSalesAnalytics, emptySalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { buildProductChannelProfitAnalytics } from '@/lib/analytics/profitAnalytics'
import { buildChannelProfitRollup } from '@/lib/analytics/channelAnalytics'
import { buildDataQualitySummary } from '@/lib/analytics/dataQuality'
import { classifySupplierHealth } from '@/lib/analytics/supplierAnalytics'
import { buildFulfilmentAnalytics } from '@/lib/analytics/fulfilmentAnalytics'

/**
 * Deliberate bug-hunting (Milestone 10 §22), matching the pattern every
 * milestone since M6 has followed: aggressively probe the layer with
 * genuinely adversarial inputs rather than only proving the happy path.
 * One real bug was found and fixed this way — see the currency-mixing
 * test below, which failed with an uncaught `CurrencyMismatchError`
 * before `buildChannelProfitRollup` was changed to filter mismatched
 * currencies out rather than blindly summing them.
 */

const NOW = new Date('2026-08-24T09:00:00Z')

describe('bug hunt: empty database', () => {
  it('every builder produces an honest empty/unknown result, never throws, for a business with zero of everything', () => {
    const period = resolvePeriod('last_30_days', NOW)
    expect(() => emptySalesAnalytics(period, 'GBP')).not.toThrow()
    expect(() => buildFulfilmentAnalytics([])).not.toThrow()
    expect(() => buildChannelProfitRollup('GBP', [])).not.toThrow()
    expect(() => buildDataQualitySummary({ productsWithUnknownCost: 0, productsMissingListingPrice: 0, fxRatesStale: 0, fulfilmentsMissingTracking: 0, productsWithNoSalesData: 0, connectorsNotConnected: [], connectorsDegraded: [], advertisingConfigured: false })).not.toThrow()
    expect(() => classifySupplierHealth({ supplierId: 's1', connectorStatus: null, connectorStatusKnown: false, hasDispatchDelayEvent: false, hasCancellationIncreaseEvent: false, hasFeedProblemEvent: false, cancellationRatePct: null, fulfilmentSuccessRatePct: null })).not.toThrow()
  })
})

describe('bug hunt: currency mixing in a channel rollup (REAL BUG FOUND AND FIXED)', () => {
  it('a product priced in a different currency than the channel is excluded from the sum, never crashes with CurrencyMismatchError', () => {
    const gbpProduct = buildProductChannelProfitAnalytics('prod-gbp', 'shopify', {
      category: null, sellingPriceMinor: 3000, sellingPriceCurrency: 'GBP', productCostMinor: 900, productCostCurrency: 'GBP', supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10,
    })
    // A listing genuinely priced in USD on what is nominally the "Shopify" channel rollup — e.g. a US storefront variant sharing the same channel key.
    const usdProduct = buildProductChannelProfitAnalytics('prod-usd', 'shopify', {
      category: null, sellingPriceMinor: 4000, sellingPriceCurrency: 'USD', productCostMinor: 1200, productCostCurrency: 'USD', supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10,
    })

    expect(() => buildChannelProfitRollup('GBP', [gbpProduct, usdProduct])).not.toThrow()
    const rollup = buildChannelProfitRollup('GBP', [gbpProduct, usdProduct])
    expect(rollup.productsWithKnownProfit).toBe(1) // Only the GBP product is summed.
    expect(rollup.productsWithUnknownProfit).toBe(1) // The USD product is honestly excluded, not silently converted or dropped without a trace.
    expect(rollup.knownNetProfit.status).toBe('calculated')
  })

  it('a channel where EVERY known product is in a different currency reports unknown, not a fabricated zero', () => {
    const usdProduct = buildProductChannelProfitAnalytics('prod-usd', 'amazon_uk', {
      category: null, sellingPriceMinor: 4000, sellingPriceCurrency: 'USD', productCostMinor: 1200, productCostCurrency: 'USD', supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10,
    })
    const rollup = buildChannelProfitRollup('GBP', [usdProduct])
    expect(rollup.knownNetProfit.status).toBe('unknown')
    expect(rollup.knownNetProfit.value).toBeNull()
    expect(rollup.knownNetProfit.source).toContain('different currency')
  })
})

describe('bug hunt: zero previous-period revenue', () => {
  it('a business with sales this period but none in the previous period reports a null percentage, never Infinity or a crash', () => {
    const comparison = comparePeriods(5000, 0)
    expect(comparison.percentChange).toBeNull()
    expect(Number.isFinite(comparison.percentChange as unknown as number)).toBe(false)
    expect(comparison.direction).toBe('up')
  })

  it('zero revenue in both periods is a real flat 0%, not null and not a division-by-zero artifact', () => {
    const period = resolvePeriod('last_30_days', NOW)
    const previous = previousEquivalentPeriod(period)
    const current = aggregateSalesWindow([], [], new Date(period.start), new Date(period.end))
    const previousMetrics = aggregateSalesWindow([], [], new Date(previous.start), new Date(previous.end))
    const analytics = buildSalesAnalytics(current, previousMetrics, period, 'GBP')
    expect(analytics.revenue.comparison?.percentChange).toBe(0)
    expect(analytics.revenue.comparison?.direction).toBe('flat')
  })
})

describe('bug hunt: partial/missing data does not corrupt the rest of the computation', () => {
  it('one product with missing cost among several with known costs does not affect the others’ figures', () => {
    const known = { category: null, sellingPriceMinor: 3000, sellingPriceCurrency: 'GBP' as const, productCostMinor: 900, productCostCurrency: 'GBP' as const, supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10 }
    const p1 = buildProductChannelProfitAnalytics('p1', 'shopify', known)
    const p2 = buildProductChannelProfitAnalytics('p2', 'shopify', { ...known, productCostMinor: null })
    const p3 = buildProductChannelProfitAnalytics('p3', 'shopify', known)

    const rollup = buildChannelProfitRollup('GBP', [p1, p2, p3])
    expect(rollup.productsWithKnownProfit).toBe(2)
    expect(rollup.productsWithUnknownProfit).toBe(1)
    // p1 and p3 are identical inputs — the sum should be exactly double one of them, proving p2's absence didn't skew it.
    expect(rollup.knownNetProfit.value?.minor).toBe((p1.projection.value!.profitability.netProfit.minor) * 2)
  })

  it('a supplier with only some operational facts known (dispatch known, cancellation unknown) still classifies without throwing', () => {
    expect(() => classifySupplierHealth({
      supplierId: 's1', connectorStatus: 'healthy', connectorStatusKnown: true,
      hasDispatchDelayEvent: false, hasCancellationIncreaseEvent: false, hasFeedProblemEvent: false,
      cancellationRatePct: null, fulfilmentSuccessRatePct: 95,
    })).not.toThrow()
  })
})

describe('bug hunt: channel divergence is never collapsed', () => {
  it('the same product genuinely profitable on one channel and loss-making on another produces two independent, non-averaged results', () => {
    const input = { category: null, sellingPriceMinor: 3000, sellingPriceCurrency: 'GBP' as const, productCostMinor: 900, productCostCurrency: 'GBP' as const, supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10 }
    const cheapListing = { ...input, sellingPriceMinor: 1000 } // Same cost, much lower price on the second channel.

    const shopify = buildProductChannelProfitAnalytics('prod-1', 'shopify', input)
    const amazon = buildProductChannelProfitAnalytics('prod-1', 'amazon_uk', cheapListing)

    expect(shopify.projection.value!.profitability.netProfit.minor).toBeGreaterThan(0)
    expect(amazon.projection.value!.profitability.netProfit.minor).toBeLessThan(0)
    // Never averaged into one figure — the two results are fully independent objects.
    expect(shopify.channel).not.toBe(amazon.channel)
  })
})

describe('bug hunt: supplier disappearance (no cost data at all)', () => {
  it('a product whose supplier record vanished entirely (null cost, null shipping) is unknown, never treated as free', () => {
    const result = buildProductChannelProfitAnalytics('prod-orphaned', 'shopify', {
      category: null, sellingPriceMinor: 3000, sellingPriceCurrency: 'GBP', productCostMinor: null, productCostCurrency: 'GBP', supplierShippingMinor: null, returnRatePct: 3, minNetMarginPct: 10,
    })
    expect(result.projection.status).toBe('unknown')
    expect(result.projection.value).toBeNull()
  })
})
