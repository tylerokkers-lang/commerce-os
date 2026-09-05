import { describe, expect, it } from 'vitest'
import { assessPriceChangePolicy } from '@/lib/automation/priceAutomation'
import { evaluateOrderAutomation } from '@/lib/automation/orderAutomation'
import { evaluateRefundAutomation } from '@/lib/automation/refundAutomation'
import { evaluateSupplierSwitchAutomation } from '@/lib/automation/supplierSwitching'
import { assessCampaignActionPolicy } from '@/lib/automation/advertisingAutomation'
import { fromMajor } from '@/lib/core/money'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import type { OrderPipelineInput } from '@/lib/orders/pipeline'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'

function goodSupplierSignals(overrides = {}) {
  return {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2, ...overrides,
  }
}

/**
 * Milestone: autonomous decision & capability layer, Part 1. Four domain
 * engines (pricing, orders, refunds, supplier switching) were migrated from
 * their own ad hoc risk ternaries to the shared `classifyActionRisk()`.
 * This file proves the one thing that actually matters about that
 * migration: it never changes whether an action executes, is held for
 * approval, or is blocked — only the descriptive risk *label* attached to
 * an already-independently-decided outcome. A migration that silently
 * loosened a real gate would show up here as a `policy.outcome` flip; none
 * should.
 */

describe('pricing: risk-label migration never changes the execution outcome', () => {
  const before = { netMarginPct: 20 }
  const after = { netMarginPct: 18 }

  function assess(oldPriceMinor: number, newPriceMinor: number) {
    return assessPriceChangePolicy(
      { productTitle: 'Widget', before: { ...before, currency: 'GBP' } as never, after: { ...after, currency: 'GBP' } as never, oldPriceMinor, newPriceMinor, automationLevel: 'autonomous' },
      CONFIGURED_AUTOMATION_SETTINGS,
    )
  }

  it('a change within the configured limit still auto-executes, labelled low', () => {
    const result = assess(10000, 10100) // 1% move, well within a 5%-style limit
    expect(result.policy.outcome).toBe('allow_automatic')
    expect(result.policy.riskLevel).toBe('low')
  })

  it('a change more than double the configured limit is STILL require_approval — the same outcome as before this migration, only the label changed from medium to high', () => {
    const result = assess(10000, 30000) // 200% move
    expect(result.policy.outcome).toBe('require_approval') // unchanged: the percentage check already forced this pre-migration
    expect(result.policy.riskLevel).toBe('high') // the one label difference this migration introduces — never a behavior difference
  })
})

describe('supplier orders: risk-label migration never changes the execution outcome', () => {
  function baseInput(unitCostMinor: number): OrderPipelineInput {
    return {
      orderId: 'test-order-1',
      ingestion: {
        channel: 'shopify',
        snapshot: { externalId: 'ext-1', placedAt: new Date().toISOString(), status: 'paid', totalMinor: 3000, currency: 'GBP', lineItems: [{ externalId: 'li-1', sku: 'SKU-A', quantity: 1, unitPriceMinor: 3000 }], raw: {} },
        existing: null,
        allLineItemsResolved: true,
        lineItemsTotalMinor: 3000,
      },
      lineEconomics: {
        sellingPrice: fromMajor(30), supplierUnitCost: { minor: unitCostMinor, currency: 'GBP' }, supplierShipping: fromMajor(0),
        channelFee: fromMajor(0), paymentFee: fromMajor(0.75), quantity: 1, vatRatePct: 20,
      },
      marginThreshold: { minNetMarginPct: 10 },
      stock: { onHandQty: 100, reservedQty: 10 },
      requestedQuantity: 1,
      supplierCandidates: [{
        id: 'sup-1', name: 'Meridian', signals: goodSupplierSignals(), isApprovedForListing: true,
      }],
      complianceContext: { approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-1', daysSinceLastAssessment: 5, productDetailsChangedSinceApproval: false },
      complianceRecheckResult: null,
      automationLevel: 'autonomous',
      shipment: null,
    } as never
  }

  it('a small order (well within the cap) auto-submits, labelled low', () => {
    const result = evaluateOrderAutomation(baseInput(900), CONFIGURED_AUTOMATION_SETTINGS, 0)
    expect(result.policy.outcome).toBe('allow_automatic')
    expect(result.policy.riskLevel).toBe('low')
  })

  it('an order more than double the automatic ceiling never auto-executes regardless of the risk label — this migration only makes the label honestly reflect size instead of a flat "medium"', () => {
    const overLimit = baseInput(CONFIGURED_AUTOMATION_SETTINGS.maxAutoPurchaseMinor * 3)
    const result = evaluateOrderAutomation(overLimit, CONFIGURED_AUTOMATION_SETTINGS, 0)
    // Blocked outright here because a unit cost this large also fails the pipeline's own profitability
    // check before the financial ceiling is even reached — either way, never allow_automatic.
    expect(result.policy.outcome).not.toBe('allow_automatic')
    expect(result.policy.riskLevel).toBe('high') // previously a flat 'medium' regardless of size — now honestly reflects the real ratio
  })
})

describe('refunds: risk-label migration never changes the execution outcome, and now reflects amount rather than a full/partial boolean', () => {
  function request(requestedMinor: number) {
    return {
      request: { orderId: 'ord-1', orderTotal: fromMajor(1000), alreadyRefunded: fromMajor(0), requestedAmount: { ...fromMajor(0), minor: requestedMinor }, reason: 'customer_changed_mind' as const },
      settings: CONFIGURED_AUTOMATION_SETTINGS,
      refundsAlreadyIssuedTodayMinor: 0,
      refundsAlreadyIssuedOnOrder: 0,
    }
  }

  it('a small partial refund is low risk and auto-approved', () => {
    const result = evaluateRefundAutomation(request(500), 'autonomous')
    expect(result.policy.outcome).toBe('allow_automatic')
    expect(result.policy.riskLevel).toBe('low')
  })

  it('a full refund of a trivial amount is no longer inflated to medium risk purely because it is "full" — risk now tracks the real amount at stake, matching what the financial check itself gates on', () => {
    // A full refund of a tiny order: old code (isFullRefund ? medium : low) would have said 'medium'. The real amount is trivial against the ceiling, so the shared classifier correctly says 'low' — a more honest label, not a laxer gate (the execution outcome is unaffected either way since this is well within every limit).
    const result = evaluateRefundAutomation({ ...request(100), request: { ...request(100).request, orderTotal: fromMajor(1), alreadyRefunded: fromMajor(0) } }, 'autonomous')
    expect(result.policy.riskLevel).toBe('low')
  })

  it('a refund whose amount alone exceeds double the single-refund ceiling is high risk and still requires approval', () => {
    const result = evaluateRefundAutomation(request(CONFIGURED_AUTOMATION_SETTINGS.maxAutoRefundMinor * 3), 'autonomous')
    expect(result.policy.outcome).toBe('require_approval') // planRefund's own ceiling already forces this
    expect(result.policy.riskLevel).toBe('high')
  })
})

describe('supplier switching: risk-label migration is no longer circular (derived from the cost increase, not from the verdict it used to justify itself with)', () => {
  const goodSignals = goodSupplierSignals

  const baseRequest: Omit<RedundancyRequest, 'automationLevel' | 'alternatives'> = {
    productTitle: 'Widget', channels: ['shopify'], reason: { key: 'out_of_stock', detail: 'zero stock' },
    thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
    previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed', ebay: 'not_assessed' },
    economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: 20, vatInclusive: true },
    profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
  }

  it('a genuinely good, low-cost-increase alternative still switches automatically, labelled low', () => {
    const result = evaluateSupplierSwitchAutomation({
      request: { ...baseRequest, automationLevel: 'autonomous', alternatives: [{ id: 'sup-good', name: 'Good Alt', signals: goodSignals() }] },
      previousUnitCostPlusShippingMinor: fromMajor(11).minor,
      settings: CONFIGURED_AUTOMATION_SETTINGS,
    })
    expect(result.redundancy.outcome).toBe('switch_automatically')
    expect(result.policy.outcome).toBe('allow_automatic')
    expect(result.policy.riskLevel).toBe('low')
  })

  it('no candidate found at all is honestly "unknown" risk, never a guessed default — and still requires approval since the domain never permits automatic action without a candidate', () => {
    const result = evaluateSupplierSwitchAutomation({
      request: { ...baseRequest, automationLevel: 'autonomous', alternatives: [] },
      previousUnitCostPlusShippingMinor: fromMajor(11).minor,
      settings: CONFIGURED_AUTOMATION_SETTINGS,
    })
    expect(result.redundancy.recommended).toBeFalsy()
    expect(result.policy.outcome).not.toBe('allow_automatic')
    expect(result.policy.riskLevel).toBe('unknown')
  })
})

describe('advertising: pause_campaign is now honestly "unknown" risk instead of a guessed "low" default, with zero change to the always-require-approval-or-blocked outcome', () => {
  const settings = CONFIGURED_AUTOMATION_SETTINGS

  it('pause_campaign (no budget magnitude at all) reports unknown risk, and never auto-executes regardless — matching the pre-migration behavior exactly, since campaign actions can never reach auto_permitted by design', () => {
    const result = assessCampaignActionPolicy(
      {
        actionType: 'pause_campaign', provider: 'amazon_ads', externalAccountId: 'acc-1', externalCampaignId: 'camp-1', campaignName: 'Test',
        classification: null, currentDailyBudgetMinor: null, proposedDailyBudgetMinor: null, isPaused: false,
        connectionStatus: 'connected', dataAgeHours: 1, roas: null,
      },
      settings,
    )
    expect(result.policy.riskLevel).toBe('unknown')
    expect(result.policy.outcome).not.toBe('allow_automatic')
  })

  it('a budget change within the configured ceiling is low risk, still requiring approval (campaign actions never auto-execute, by explicit design, regardless of risk label)', () => {
    const result = assessCampaignActionPolicy(
      {
        actionType: 'increase_ad_budget', provider: 'amazon_ads', externalAccountId: 'acc-1', externalCampaignId: 'camp-1', campaignName: 'Test',
        classification: null, currentDailyBudgetMinor: 10000, proposedDailyBudgetMinor: 10500, isPaused: false,
        connectionStatus: 'connected', dataAgeHours: 1, roas: 4,
      },
      settings,
    )
    expect(result.policy.riskLevel).toBe('low')
    expect(result.policy.outcome).not.toBe('allow_automatic')
  })
})
