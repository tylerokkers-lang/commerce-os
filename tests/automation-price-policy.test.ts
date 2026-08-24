import { describe, expect, it } from 'vitest'
import { calculateProfitability } from '@/lib/profitability'
import { fromMajor } from '@/lib/core/money'
import { assessPriceChange, assessPriceChangePolicy } from '@/lib/automation/priceAutomation'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'

/**
 * `assessPriceChangePolicy` was extracted from `assessPriceChange`
 * (Milestone 13) so `ai/actions/validate.ts` can reuse the same margin/
 * policy decision against `Profitability` it already resolved through
 * `analytics/profitAnalytics.ts`'s `buildProductChannelProfitAnalytics`,
 * without reconstructing `CostInputs` by hand. These tests prove the
 * extraction is behaviour-preserving (mirroring `tests/automation-price.test.ts`'s
 * existing coverage of `assessPriceChange`) and that the new entry point
 * itself is correct when called directly with pre-computed `Profitability`.
 */

const BASE_COST_INPUTS = { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 }

describe('assessPriceChangePolicy: direct use with pre-computed Profitability', () => {
  it('produces the same outcome as assessPriceChange for the identical inputs', () => {
    const before = calculateProfitability(BASE_COST_INPUTS)
    const after = calculateProfitability({ ...BASE_COST_INPUTS, sellingPrice: fromMajor(30.5) })

    const viaWrapper = assessPriceChange(
      { productTitle: 'Test product', costInputsBefore: BASE_COST_INPUTS, newSellingPrice: fromMajor(30.5), automationLevel: 'assisted' },
      DEMO_AUTOMATION_SETTINGS,
    )
    const direct = assessPriceChangePolicy(
      { productTitle: 'Test product', before, after, oldPriceMinor: BASE_COST_INPUTS.sellingPrice.minor, newPriceMinor: fromMajor(30.5).minor, automationLevel: 'assisted' },
      DEMO_AUTOMATION_SETTINGS,
    )

    expect(direct.policy.outcome).toBe(viaWrapper.policy.outcome)
    expect(direct.pctChange).toBeCloseTo(viaWrapper.pctChange)
  })

  it('an AI-originated proposal forced to "assisted" can never auto-apply, even for a small, safe change', () => {
    const before = calculateProfitability(BASE_COST_INPUTS)
    const after = calculateProfitability({ ...BASE_COST_INPUTS, sellingPrice: fromMajor(30.5) })
    const result = assessPriceChangePolicy(
      { productTitle: 'Test product', before, after, oldPriceMinor: BASE_COST_INPUTS.sellingPrice.minor, newPriceMinor: fromMajor(30.5).minor, automationLevel: 'assisted' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(result.policy.outcome).not.toBe('allow_automatic')
    expect(result.policy.outcome).toBe('require_approval')
  })

  it('a margin-failing change is blocked, never surfaced as an approvable proposal, regardless of automation level', () => {
    const before = calculateProfitability(BASE_COST_INPUTS)
    const after = calculateProfitability({ ...BASE_COST_INPUTS, sellingPrice: fromMajor(9.5) })
    const result = assessPriceChangePolicy(
      { productTitle: 'Test product', before, after, oldPriceMinor: BASE_COST_INPUTS.sellingPrice.minor, newPriceMinor: fromMajor(9.5).minor, automationLevel: 'autonomous' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(result.policy.outcome).toBe('block')
  })
})
