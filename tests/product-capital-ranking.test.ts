import { describe, expect, it } from 'vitest'
import { assessCapitalRequirement } from '@/lib/products/intelligence/capitalRanking'

describe('Capital-aware ranking', () => {
  it('reports not_configured, never a guessed figure, when capital is unset', () => {
    const result = assessCapitalRequirement({
      capitalRequirementMinor: 600,
      contributionMinor: 800,
      availableOperatingCapitalMinor: null,
      cashBufferMinor: null,
    })
    expect(result.status).toBe('not_configured')
    expect(result.maxSimultaneousOrders).toBeNull()
  })

  it('reports data_incomplete, never a guessed figure, when cost data is missing', () => {
    const result = assessCapitalRequirement({
      capitalRequirementMinor: null,
      contributionMinor: null,
      availableOperatingCapitalMinor: 50000,
      cashBufferMinor: null,
    })
    expect(result.status).toBe('data_incomplete')
    expect(result.capitalRequirementMinor).toBeNull()
  })

  it('a low-cost product (Product A) with plenty of capital is sufficient and funds many simultaneous orders', () => {
    const result = assessCapitalRequirement({
      capitalRequirementMinor: 600, // £6
      contributionMinor: 800, // £8
      availableOperatingCapitalMinor: 50000, // £500
      cashBufferMinor: 10000, // £100
    })
    expect(result.status).toBe('within_buffer')
    expect(result.maxSimultaneousOrders).toBeGreaterThan(50)
  })

  it('insufficient capital is reported honestly, with zero simultaneous orders fundable', () => {
    const result = assessCapitalRequirement({
      capitalRequirementMinor: 11500, // £115
      contributionMinor: 6000,
      availableOperatingCapitalMinor: 10000, // only £100 available
      cashBufferMinor: 0,
    })
    expect(result.status).toBe('insufficient_capital')
    expect(result.maxSimultaneousOrders).toBe(0)
  })

  it('the cash buffer is genuinely protected — spendable capital excludes it', () => {
    const result = assessCapitalRequirement({
      capitalRequirementMinor: 5000, // £50
      contributionMinor: 4000,
      availableOperatingCapitalMinor: 10000, // £100
      cashBufferMinor: 6000, // £60 reserved
    })
    // Only £40 spendable, less than the £50 required per order.
    expect(result.status).toBe('insufficient_capital')
    expect(result.spendableCapitalMinor).toBe(4000)
  })

  it('a low supplier-cost, high-margin-ratio product (A) scores more capital-efficient than a high-cost, lower-ratio one (B) — the master-prompt example', () => {
    // Product A: cost £4, shipping £2 -> capitalRequirement £6, contribution ~£8
    const productA = assessCapitalRequirement({
      capitalRequirementMinor: 600,
      contributionMinor: 800,
      availableOperatingCapitalMinor: 50000,
      cashBufferMinor: 0,
    })
    // Product B: cost £100, shipping £15 -> capitalRequirement £115, contribution ~£60 (larger absolute profit)
    const productB = assessCapitalRequirement({
      capitalRequirementMinor: 11500,
      contributionMinor: 6000,
      availableOperatingCapitalMinor: 50000,
      cashBufferMinor: 0,
    })
    expect(productA.capitalEfficiencyScore).not.toBeNull()
    expect(productB.capitalEfficiencyScore).not.toBeNull()
    expect(productA.capitalEfficiencyScore!).toBeGreaterThan(productB.capitalEfficiencyScore!)
  })

  it('warns when only a handful of simultaneous orders could be funded', () => {
    const result = assessCapitalRequirement({
      capitalRequirementMinor: 4000,
      contributionMinor: 2000,
      availableOperatingCapitalMinor: 8000, // funds exactly 2
      cashBufferMinor: 0,
    })
    expect(result.warnings.some((w) => w.includes('simultaneous order'))).toBe(true)
  })

  it('warns when no cash buffer is configured at all', () => {
    const result = assessCapitalRequirement({
      capitalRequirementMinor: 1000,
      contributionMinor: 2000,
      availableOperatingCapitalMinor: 50000,
      cashBufferMinor: null,
    })
    expect(result.warnings.some((w) => w.includes('cash buffer'))).toBe(true)
  })
})
