import { describe, expect, it } from 'vitest'
import { recommendPricing } from '@/lib/products/intelligence/pricingEngine'
import { money } from '@/lib/core/money'

describe('Product pricing engine', () => {
  it('finds a minimum viable price that genuinely clears the configured minimum margin', () => {
    const result = recommendPricing(
      { productCost: money(400, 'GBP'), supplierShipping: money(200, 'GBP'), vatRatePct: 0 },
      'GBP',
      400,
      15, // min net margin %
      35, // target net margin %
    )
    expect(result.minimumViablePriceMinor).not.toBeNull()
    expect(result.minimumViableUnreachable).toBe(false)
  })

  it('the recommended (target-margin) price is always at or above the minimum viable price', () => {
    const result = recommendPricing(
      { productCost: money(400, 'GBP'), supplierShipping: money(200, 'GBP'), vatRatePct: 0 },
      'GBP',
      400,
      15,
      35,
    )
    expect(result.recommendedPriceMinor!).toBeGreaterThanOrEqual(result.minimumViablePriceMinor!)
  })

  it('an advertising allowance raises the minimum viable price needed to still clear the margin', () => {
    const withoutAds = recommendPricing({ productCost: money(400, 'GBP'), vatRatePct: 0 }, 'GBP', 400, 15, 35)
    const withAds = recommendPricing({ productCost: money(400, 'GBP'), adSpendPerUnit: money(300, 'GBP'), vatRatePct: 0 }, 'GBP', 400, 15, 35)
    expect(withAds.minimumViablePriceMinor!).toBeGreaterThan(withoutAds.minimumViablePriceMinor!)
  })

  it('a genuinely unaffordable cost structure (fees exceed 100% of price) is reported as unreachable, never a fabricated price', () => {
    const result = recommendPricing(
      { productCost: money(100, 'GBP'), channelFeePct: 60, paymentFeePct: 50, vatRatePct: 0 },
      'GBP',
      100,
      15,
      35,
    )
    expect(result.minimumViableUnreachable).toBe(true)
    expect(result.minimumViablePriceMinor).toBeNull()
  })

  it('a zero minimum margin still returns a price above raw cost (break-even, not free)', () => {
    const result = recommendPricing({ productCost: money(500, 'GBP'), vatRatePct: 0 }, 'GBP', 500, 0, 10)
    expect(result.minimumViablePriceMinor!).toBeGreaterThan(500)
  })
})
