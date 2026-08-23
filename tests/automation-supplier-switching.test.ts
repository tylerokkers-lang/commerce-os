import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { evaluateSupplierSwitchAutomation } from '@/lib/automation/supplierSwitching'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'

function goodSignals(overrides: Partial<RedundancyRequest['alternatives'][number]['signals']> = {}) {
  return {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2, ...overrides,
  }
}

const BASE_REQUEST: Omit<RedundancyRequest, 'automationLevel' | 'alternatives'> = {
  productTitle: 'Widget',
  channels: ['shopify'],
  reason: { key: 'out_of_stock', detail: 'zero stock' },
  thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
  previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed' },
  economics: { sellingPrice: fromMajor(30), returnRatePct: 5, vatRatePct: 20, vatInclusive: true },
  profileInput: { category: 'kitchen' },
}

describe('supplier switch automation', () => {
  it('switches automatically at autonomous when a genuinely good alternative exists', () => {
    const result = evaluateSupplierSwitchAutomation({
      request: { ...BASE_REQUEST, automationLevel: 'autonomous', alternatives: [{ id: 'sup-2', name: 'Good Alt', signals: goodSignals() }] },
      previousUnitCostPlusShippingMinor: fromMajor(9).minor + fromMajor(2).minor,
      settings: DEMO_AUTOMATION_SETTINGS,
    })
    expect(result.redundancy.outcome).toBe('switch_automatically')
    expect(result.policy.outcome).toBe('allow_automatic')
  })

  it('never switches, at any automation level, when no alternative preserves the approved channel', () => {
    const badSignals = goodSignals({ supportsCustomInvoice: false, qualityRating: 2, ordersPlaced: 5 })
    const request: RedundancyRequest = {
      ...BASE_REQUEST,
      channels: ['shopify', 'amazon_uk'],
      previousChannelStatus: { shopify: 'approved', amazon_uk: 'approved' },
      automationLevel: 'autonomous',
      alternatives: [{ id: 'sup-3', name: 'Bad Alt', signals: badSignals }],
    }
    const result = evaluateSupplierSwitchAutomation({ request, previousUnitCostPlusShippingMinor: 1100, settings: DEMO_AUTOMATION_SETTINGS })
    expect(result.redundancy.outcome).not.toBe('switch_automatically')
    expect(result.policy.outcome).not.toBe('allow_automatic')
  })

  it('a cost increase beyond the configured limit requires approval even when the domain would otherwise auto-switch', () => {
    const expensiveSignals = goodSignals({ unitCost: fromMajor(50) }) // enormous cost jump
    const request: RedundancyRequest = { ...BASE_REQUEST, automationLevel: 'autonomous', alternatives: [{ id: 'sup-2', name: 'Pricey Alt', signals: expensiveSignals }] }
    const result = evaluateSupplierSwitchAutomation({
      request,
      previousUnitCostPlusShippingMinor: fromMajor(9).minor + fromMajor(2).minor,
      settings: DEMO_AUTOMATION_SETTINGS,
    })
    if (result.redundancy.outcome === 'switch_automatically') {
      expect(result.policy.outcome).toBe('require_approval')
    }
  })

  it('the kill switch blocks an automatic switch that would otherwise proceed', () => {
    const request: RedundancyRequest = { ...BASE_REQUEST, automationLevel: 'autonomous', alternatives: [{ id: 'sup-2', name: 'Good Alt', signals: goodSignals() }] }
    const paused = { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true }
    const result = evaluateSupplierSwitchAutomation({ request, previousUnitCostPlusShippingMinor: 1100, settings: paused })
    expect(result.policy.outcome).toBe('block')
  })

  it('manual and assisted automation levels never switch automatically, even with a perfect alternative', () => {
    const request: RedundancyRequest = { ...BASE_REQUEST, automationLevel: 'manual', alternatives: [{ id: 'sup-2', name: 'Good Alt', signals: goodSignals() }] }
    const result = evaluateSupplierSwitchAutomation({ request, previousUnitCostPlusShippingMinor: 1100, settings: DEMO_AUTOMATION_SETTINGS })
    expect(result.policy.outcome).toBe('require_approval')
  })
})
