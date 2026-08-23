import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { evaluateProductMonitoring } from '@/lib/automation/monitoring'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'

const HEALTHY_COST_INPUTS = { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 }

describe('automated product monitoring', () => {
  it('recommends nothing when supplier, stock and profitability are all healthy', () => {
    const result = evaluateProductMonitoring({
      productTitle: 'Widget', automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS,
      supplierAvailable: true, stockAvailableUnits: 100, lowStockThreshold: 10,
      hasCompliantAlternativeSupplier: false, costInputs: HEALTHY_COST_INPUTS, minNetMarginPct: 10,
    })
    expect(result.recommendation).toBe('none')
    expect(result.isProfitable).toBe(true)
  })

  it('recommends a price/supplier review, and does not pause, when unprofitable', () => {
    const result = evaluateProductMonitoring({
      productTitle: 'Widget', automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS,
      supplierAvailable: true, stockAvailableUnits: 100, lowStockThreshold: 10,
      hasCompliantAlternativeSupplier: false,
      costInputs: { sellingPrice: fromMajor(10), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
      minNetMarginPct: 10,
    })
    expect(result.isProfitable).toBe(false)
    expect(result.recommendation).toBe('needs_price_or_supplier_review')
  })

  it('recommends pausing when the supplier is unavailable and no alternative exists, even if the last-known cost was profitable', () => {
    const result = evaluateProductMonitoring({
      productTitle: 'Widget', automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS,
      supplierAvailable: false, stockAvailableUnits: 100, lowStockThreshold: 10,
      hasCompliantAlternativeSupplier: false, costInputs: HEALTHY_COST_INPUTS, minNetMarginPct: 10,
    })
    expect(result.recommendation).toBe('pause_listing')
  })

  it('recommends evaluating an alternative supplier rather than pausing when one exists', () => {
    const result = evaluateProductMonitoring({
      productTitle: 'Widget', automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS,
      supplierAvailable: false, stockAvailableUnits: 100, lowStockThreshold: 10,
      hasCompliantAlternativeSupplier: true, costInputs: HEALTHY_COST_INPUTS, minNetMarginPct: 10,
    })
    expect(result.recommendation).toBe('evaluate_supplier')
  })
})
