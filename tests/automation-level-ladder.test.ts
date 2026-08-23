import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { assessPriceChange } from '@/lib/automation/priceAutomation'
import { evaluateSupplierSwitchAutomation } from '@/lib/automation/supplierSwitching'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'
import type { AutomationLevel } from '@/lib/automation/types'

/**
 * Demonstrates the four automation levels side by side, for the same
 * underlying decision, per the brief §4:
 *
 *   MANUAL      -> recommendation only
 *   ASSISTED    -> action prepared, approval required
 *   SUPERVISED  -> a permitted low-risk action executes automatically
 *   AUTONOMOUS  -> a permitted action executes automatically
 *
 * and proves the level never overrides a genuine compliance or
 * profitability failure at any level.
 */

const SAFE_PRICE_CHANGE = {
  productTitle: 'Ladder Test Widget',
  costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
  newSellingPrice: fromMajor(30.5), // A 1.7% increase — comfortably inside every configured limit.
}

const LEVELS: readonly AutomationLevel[] = ['manual', 'assisted', 'supervised', 'autonomous']

describe('the automation-level ladder', () => {
  it('a safe, well within limits price change: manual/assisted only recommend; supervised/autonomous execute', () => {
    const outcomes = Object.fromEntries(
      LEVELS.map((level) => [level, assessPriceChange({ ...SAFE_PRICE_CHANGE, automationLevel: level }, DEMO_AUTOMATION_SETTINGS).policy.outcome]),
    )

    expect(outcomes.manual).toBe('require_approval')
    expect(outcomes.assisted).toBe('require_approval')
    expect(outcomes.supervised).toBe('allow_automatic')
    expect(outcomes.autonomous).toBe('allow_automatic')
  })

  it('a price change that fails the minimum margin is blocked at every level, including autonomous', () => {
    const unsafeChange = { ...SAFE_PRICE_CHANGE, newSellingPrice: fromMajor(9.5) } // Below cost — impossible to be profitable.
    for (const level of LEVELS) {
      const result = assessPriceChange({ ...unsafeChange, automationLevel: level }, DEMO_AUTOMATION_SETTINGS)
      expect(result.policy.outcome).toBe('block')
    }
  })

  it('a supplier switch with a genuinely good alternative: manual/assisted only recommend; supervised/autonomous switch automatically', () => {
    const request = (level: AutomationLevel): RedundancyRequest => ({
      productTitle: 'Ladder Test Widget',
      channels: ['shopify'],
      reason: { key: 'out_of_stock', detail: 'zero stock' },
      automationLevel: level,
      thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
      previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed' },
      economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: 20, vatInclusive: true },
      profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
      alternatives: [{
        id: 'sup-good', name: 'Good Alternative Supply', signals: {
          unitCost: fromMajor(9.5), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
          ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
          handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
          supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
          supportsOwnBranding: true, documentCount: 2,
        },
      }],
    })

    const outcomes = Object.fromEntries(
      LEVELS.map((level) => [level, evaluateSupplierSwitchAutomation({ request: request(level), previousUnitCostPlusShippingMinor: fromMajor(11).minor, settings: DEMO_AUTOMATION_SETTINGS }).policy.outcome]),
    )

    expect(outcomes.manual).toBe('require_approval')
    expect(outcomes.assisted).toBe('require_approval')
    expect(outcomes.supervised).toBe('allow_automatic')
    expect(outcomes.autonomous).toBe('allow_automatic')
  })

  it('the automation level never overrides the kill switch at any level', () => {
    const paused = { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true }
    for (const level of LEVELS) {
      const result = assessPriceChange({ ...SAFE_PRICE_CHANGE, automationLevel: level }, paused)
      expect(result.policy.outcome).not.toBe('allow_automatic')
    }
  })
})
