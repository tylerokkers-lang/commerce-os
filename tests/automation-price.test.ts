import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { assessPriceChange } from '@/lib/automation/priceAutomation'
import { CONFIGURED_AUTOMATION_SETTINGS as DEMO_AUTOMATION_SETTINGS } from './helpers/automationSettings'

const BASE_COST_INPUTS = { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 }

describe('guarded price automation', () => {
  it('blocks a price cut that would fall below the minimum net margin, regardless of automation level', () => {
    const result = assessPriceChange(
      { productTitle: 'Test product', costInputsBefore: BASE_COST_INPUTS, newSellingPrice: fromMajor(9.5), automationLevel: 'autonomous' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(result.policy.outcome).toBe('block')
  })

  it('manual and assisted levels never auto-apply a price change, even one that is perfectly safe', () => {
    const manual = assessPriceChange(
      { productTitle: 'Test product', costInputsBefore: BASE_COST_INPUTS, newSellingPrice: fromMajor(30.5), automationLevel: 'manual' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(manual.policy.outcome).toBe('require_approval')

    const assisted = assessPriceChange(
      { productTitle: 'Test product', costInputsBefore: BASE_COST_INPUTS, newSellingPrice: fromMajor(30.5), automationLevel: 'assisted' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(assisted.policy.outcome).toBe('require_approval')
  })

  it('supervised applies a small, safe price change automatically', () => {
    const result = assessPriceChange(
      { productTitle: 'Test product', costInputsBefore: BASE_COST_INPUTS, newSellingPrice: fromMajor(30.5), automationLevel: 'supervised' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(result.policy.outcome).toBe('allow_automatic')
  })

  it('a change larger than the configured per-action limit requires approval even at autonomous', () => {
    const result = assessPriceChange(
      { productTitle: 'Test product', costInputsBefore: BASE_COST_INPUTS, newSellingPrice: fromMajor(45), automationLevel: 'autonomous' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(result.policy.outcome).toBe('require_approval')
  })

  it('never bypasses the profitability engine: before/after both come from calculateProfitability', () => {
    const result = assessPriceChange(
      { productTitle: 'Test product', costInputsBefore: BASE_COST_INPUTS, newSellingPrice: fromMajor(30.5), automationLevel: 'supervised' },
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(result.before.netMarginPct).not.toBeNull()
    expect(result.after.netMarginPct).not.toBeNull()
    expect(result.after.netMarginPct).not.toBe(result.before.netMarginPct)
  })
})
