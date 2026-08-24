import { describe, expect, it } from 'vitest'
import { buildProductChannelProfitAnalytics } from '@/lib/analytics/profitAnalytics'

describe('buildProductChannelProfitAnalytics', () => {
  const healthyInput = {
    category: null, sellingPriceMinor: 3000, sellingPriceCurrency: 'GBP' as const,
    productCostMinor: 900, productCostCurrency: 'GBP' as const, supplierShippingMinor: 200, returnRatePct: 3, minNetMarginPct: 10,
  }

  it('projects real profitability via the one engine when price and cost are both known', () => {
    const result = buildProductChannelProfitAnalytics('prod-1', 'shopify', healthyInput)
    expect(result.sellingPrice.status).toBe('fact')
    expect(result.productCost.status).toBe('fact')
    expect(result.projection.status).toBe('calculated')
    expect(result.projection.value?.profitability.netProfit.minor).toBeGreaterThan(0)
    expect(result.projection.value?.channel).toBe('shopify')
  })

  it('a missing selling price makes the whole projection unavailable, never a guessed number', () => {
    const result = buildProductChannelProfitAnalytics('prod-1', 'shopify', { ...healthyInput, sellingPriceMinor: null })
    expect(result.sellingPrice.status).toBe('unavailable')
    expect(result.projection.status).toBe('unavailable')
    expect(result.projection.value).toBeNull()
  })

  it('a missing supplier cost makes the projection unknown, not zero-cost', () => {
    const result = buildProductChannelProfitAnalytics('prod-1', 'shopify', { ...healthyInput, productCostMinor: null })
    expect(result.sellingPrice.status).toBe('fact') // Price is still genuinely known.
    expect(result.productCost.status).toBe('unavailable')
    expect(result.projection.status).toBe('unknown')
    expect(result.projection.value).toBeNull()
  })

  it('no input at all reports both price and cost as unavailable', () => {
    const result = buildProductChannelProfitAnalytics('prod-1', 'amazon_uk', null)
    expect(result.sellingPrice.status).toBe('unavailable')
    expect(result.productCost.status).toBe('unavailable')
    expect(result.projection.status).toBe('unavailable')
  })

  it('the same product genuinely differs across channels — Amazon and Shopify never collapse to one figure', () => {
    const shopify = buildProductChannelProfitAnalytics('prod-1', 'shopify', healthyInput)
    const amazon = buildProductChannelProfitAnalytics('prod-1', 'amazon_uk', healthyInput)
    expect(shopify.projection.value?.profitability.netProfit.minor).not.toBe(amazon.projection.value?.profitability.netProfit.minor)
  })

  it('a supplier cost quoted in a different currency than the channel listing is never silently combined', () => {
    const result = buildProductChannelProfitAnalytics('prod-1', 'shopify', { ...healthyInput, productCostCurrency: 'USD' })
    expect(result.sellingPrice.status).toBe('fact')
    expect(result.productCost.status).toBe('fact') // The cost itself is still a known fact — just not combinable with the price as-is.
    expect(result.productCost.value).toEqual({ minor: 900, currency: 'USD' })
    expect(result.projection.status).toBe('unavailable')
    expect(result.projection.source).toContain('USD')
    expect(result.projection.source).toContain('GBP')
  })
})
