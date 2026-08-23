import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { evaluateOrderAutomation } from '@/lib/automation/orderAutomation'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { OrderPipelineInput } from '@/lib/orders/pipeline'

const BASE_INPUT: OrderPipelineInput = {
  orderId: 'test-order-1',
  ingestion: {
    channel: 'shopify',
    snapshot: { externalId: 'ext-1', placedAt: new Date().toISOString(), status: 'paid', totalMinor: 3000, currency: 'GBP', lineItemRefs: ['SKU-A'], raw: {} },
    existing: null,
    allLineItemsResolved: true,
    lineItemsTotalMinor: 3000,
  },
  lineEconomics: {
    sellingPrice: fromMajor(30), supplierUnitCost: fromMajor(9), supplierShipping: fromMajor(2),
    channelFee: fromMajor(0), paymentFee: fromMajor(0.75), quantity: 1, vatRatePct: 20,
  },
  marginThreshold: { minNetMarginPct: 10 },
  stock: { onHandQty: 100, reservedQty: 10 },
  requestedQuantity: 1,
  supplierCandidates: [{ id: 'sup-1', name: 'Meridian', signals: {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2,
  }, isApprovedForListing: true }],
  complianceContext: { approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-1', daysSinceLastAssessment: 5, productDetailsChangedSinceApproval: false },
  complianceRecheckResult: null,
  automationLevel: 'autonomous',
  shipment: null,
}

describe('order automation', () => {
  it('submits automatically when every requirement passes and spend is within the daily limit', () => {
    const result = evaluateOrderAutomation(BASE_INPUT, DEMO_AUTOMATION_SETTINGS, 0)
    expect(result.pipeline.submission.outcome).toBe('submit_automatically')
    expect(result.policy.outcome).toBe('allow_automatic')
  })

  it('requires approval once the daily automatic supplier-spend limit would be exceeded', () => {
    const tightSettings = { ...DEMO_AUTOMATION_SETTINGS, maxDailyAutoSupplierSpendMinor: 100 }
    const result = evaluateOrderAutomation(BASE_INPUT, tightSettings, 0)
    expect(result.policy.outcome).toBe('require_approval')
  })

  it('never widens a blocked submission (e.g. a stock shortfall) into an automatic one', () => {
    const shortfall: OrderPipelineInput = { ...BASE_INPUT, stock: { onHandQty: 0, reservedQty: 0 } }
    const result = evaluateOrderAutomation(shortfall, DEMO_AUTOMATION_SETTINGS, 0)
    expect(result.pipeline.submission.outcome).toBe('blocked')
    expect(result.policy.outcome).toBe('block')
  })

  describe('maximum automatic supplier order (a single order, distinct from the daily total)', () => {
    it('permits an order within the single-order limit', () => {
      const result = evaluateOrderAutomation(BASE_INPUT, { ...DEMO_AUTOMATION_SETTINGS, maxAutoPurchaseMinor: 5000 }, 0)
      expect(result.policy.outcome).toBe('allow_automatic')
    })

    it('requires approval once a single order exceeds the limit, even with no other spend today', () => {
      const result = evaluateOrderAutomation(BASE_INPUT, { ...DEMO_AUTOMATION_SETTINGS, maxAutoPurchaseMinor: 500 }, 0)
      expect(result.policy.outcome).toBe('require_approval')
    })
  })
})
