import { describe, expect, it } from 'vitest'
import { checkPriceOverride } from '@/lib/marketplaces/shopify/priceOverride'
import { money } from '@/lib/core/money'

const COSTS = { productCost: money(500, 'GBP'), supplierShipping: money(200, 'GBP'), vatRatePct: 0 }

describe('Shopify manual price override checking', () => {
  it('selecting the recommended price is not an override', () => {
    const result = checkPriceOverride({
      costs: COSTS,
      currency: 'GBP',
      recommendedPriceMinor: 2000,
      selectedPriceMinor: 2000,
      minNetMarginPct: 15,
    })
    expect(result.isOverride).toBe(false)
    expect(result.message).toBeNull()
  })

  it('selecting a different price is an override and produces a comparison message', () => {
    const result = checkPriceOverride({
      costs: COSTS,
      currency: 'GBP',
      recommendedPriceMinor: 2000,
      selectedPriceMinor: 1200,
      minNetMarginPct: 15,
    })
    expect(result.isOverride).toBe(true)
    expect(result.message).toMatch(/contribution margin/)
  })

  it('a price below the configured minimum margin is flagged as belowConfiguredMinimum', () => {
    const result = checkPriceOverride({
      costs: COSTS,
      currency: 'GBP',
      recommendedPriceMinor: 2000,
      selectedPriceMinor: 800, // barely above cost — very thin margin
      minNetMarginPct: 25,
    })
    expect(result.belowConfiguredMinimum).toBe(true)
    expect(result.message).toContain('Minimum configured margin is 25%')
  })

  it('an allowed override (still above the minimum margin) is not flagged as below the minimum', () => {
    const result = checkPriceOverride({
      costs: COSTS,
      currency: 'GBP',
      recommendedPriceMinor: 3000,
      selectedPriceMinor: 2500, // still a healthy margin
      minNetMarginPct: 10,
    })
    expect(result.belowConfiguredMinimum).toBe(false)
  })

  it('raising the price above the recommendation is still reported as an override, not silently accepted', () => {
    const result = checkPriceOverride({
      costs: COSTS,
      currency: 'GBP',
      recommendedPriceMinor: 2000,
      selectedPriceMinor: 3000,
      minNetMarginPct: 15,
    })
    expect(result.isOverride).toBe(true)
  })

  it('recommendedMarginPct and selectedMarginPct are both real, independently calculated figures from the real profitability engine', () => {
    const result = checkPriceOverride({
      costs: COSTS,
      currency: 'GBP',
      recommendedPriceMinor: 3000,
      selectedPriceMinor: 1500,
      minNetMarginPct: 15,
    })
    expect(result.recommendedMarginPct).not.toBeNull()
    expect(result.selectedMarginPct).not.toBeNull()
    expect(result.selectedMarginPct!).toBeLessThan(result.recommendedMarginPct!)
  })
})
