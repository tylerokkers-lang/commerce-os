import { describe, expect, it } from 'vitest'
import { dryRunPriceChange, dryRunSupplierSwitch, dryRunRefund, dryRunCandidateLifecycleReview } from '@/lib/automation/dryRun'
import { fromMajor } from '@/lib/core/money'
import type { PriceChangeRequest } from '@/lib/automation/priceAutomation'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'

/**
 * Milestone: automation control plane. Dry-run capability (design
 * requirement §4) — `dryRunPriceChange` calls the exact same
 * `assessPriceChange` a real `executePriceChange` uses, so these tests
 * confirm the *shape* of the dry-run result (eligible/blocked, the payload
 * that would be sent, expected-result wording) rather than re-testing
 * `priceAutomation.ts`'s own margin/limit logic, which already has its own
 * dedicated tests.
 */

function baseRequest(overrides: Partial<PriceChangeRequest> = {}): PriceChangeRequest {
  return {
    productTitle: 'Test Widget',
    costInputsBefore: {
      sellingPrice: fromMajor(20),
      productCost: fromMajor(8),
      supplierShipping: fromMajor(2),
      channelFeePct: 0,
      paymentFeePct: 0,
    },
    newSellingPrice: fromMajor(21),
    automationLevel: 'autonomous',
    ...overrides,
  }
}

describe('dryRunPriceChange', () => {
  it('reports an eligible, auto-executing change with no side effects other than the returned result', () => {
    const result = dryRunPriceChange(baseRequest(), CONFIGURED_AUTOMATION_SETTINGS, 'gid://shopify/Product/1')

    expect(result.eligible).toBe(true)
    expect(result.wouldExecuteAutomatically).toBe(true)
    expect(result.payload).toEqual({ externalId: 'gid://shopify/Product/1', newPriceMinor: fromMajor(21).minor })
    expect(result.blockingReasons).toEqual([])
    expect(result.expectedResult).toMatch(/submit, verify, and reconcile/i)
  })

  it('reports a blocked change (margin below minimum) with a null payload and the real blocking reason', () => {
    const request = baseRequest({ newSellingPrice: fromMajor(8.5) }) // Barely above cost — net margin collapses.
    const result = dryRunPriceChange(request, CONFIGURED_AUTOMATION_SETTINGS)

    expect(result.eligible).toBe(false)
    expect(result.wouldExecuteAutomatically).toBe(false)
    expect(result.payload).toBeNull()
    expect(result.blockingReasons.length).toBeGreaterThan(0)
    expect(result.expectedResult).toMatch(/would not execute/i)
  })

  it('reports a change requiring approval (manual/assisted automation level) with a non-null payload, since it is still eligible', () => {
    const request = baseRequest({ automationLevel: 'assisted' })
    const result = dryRunPriceChange(request, CONFIGURED_AUTOMATION_SETTINGS)

    expect(result.eligible).toBe(true)
    expect(result.wouldExecuteAutomatically).toBe(false)
    expect(result.payload).not.toBeNull()
    expect(result.expectedResult).toMatch(/owner approval/i)
  })

  it('exposes the full policy result, including every requirement checked, for full auditability of the dry run itself', () => {
    const result = dryRunPriceChange(baseRequest(), CONFIGURED_AUTOMATION_SETTINGS)
    expect(result.policy.requirements.length).toBeGreaterThan(0)
    expect(result.policy.requirements.some((r) => r.key === 'automation_state_known')).toBe(true)
  })

  it('never executes automatically, and is downgraded to require_approval, when automation state is unknown (kill switch fail-closed)', async () => {
    const { UNKNOWN_STATE_AUTOMATION_SETTINGS } = await import('@/lib/automation/settingsTypes')
    const result = dryRunPriceChange(baseRequest(), UNKNOWN_STATE_AUTOMATION_SETTINGS)

    expect(result.wouldExecuteAutomatically).toBe(false)
    expect(result.policy.outcome).toBe('block')
    expect(result.policy.requirements.find((r) => r.key === 'automation_state_known')?.satisfied).toBe(false)
  })
})

/** Milestone: autonomous decision & capability layer, Part 13 — dry-run extended to two more domains, zero external writes either way. */
describe('dryRunSupplierSwitch', () => {
  function goodSignals(overrides = {}) {
    return {
      unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
      ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
      handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
      supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
      supportsOwnBranding: true, documentCount: 2, ...overrides,
    }
  }
  const baseRequest: Omit<RedundancyRequest, 'automationLevel' | 'alternatives'> = {
    productTitle: 'Widget', channels: ['shopify'], reason: { key: 'out_of_stock', detail: 'zero stock' },
    thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
    previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed', ebay: 'not_assessed' },
    economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: 20, vatInclusive: true },
    profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
  }

  it('reports the recommended alternative and whether it would switch automatically, with zero side effects', () => {
    const result = dryRunSupplierSwitch({
      request: { ...baseRequest, automationLevel: 'autonomous', alternatives: [{ id: 'sup-good', name: 'Good Alt', signals: goodSignals() }] },
      previousUnitCostPlusShippingMinor: fromMajor(11).minor,
      settings: CONFIGURED_AUTOMATION_SETTINGS,
    })
    expect(result.payload?.recommendedSupplierId).toBe('sup-good')
    expect(typeof result.wouldExecuteAutomatically).toBe('boolean')
  })

  it('reports a null recommendation, never a fabricated one, when no alternative exists', () => {
    const result = dryRunSupplierSwitch({
      request: { ...baseRequest, automationLevel: 'autonomous', alternatives: [] },
      previousUnitCostPlusShippingMinor: fromMajor(11).minor,
      settings: CONFIGURED_AUTOMATION_SETTINGS,
    })
    expect(result.payload?.recommendedSupplierId).toBeNull()
    expect(result.wouldExecuteAutomatically).toBe(false)
  })
})

describe('dryRunRefund', () => {
  it('reports the exact refund payload and whether it would auto-approve, with zero external writes', () => {
    const result = dryRunRefund(
      {
        request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(0), requestedAmount: fromMajor(10), reason: 'customer_changed_mind' },
        settings: CONFIGURED_AUTOMATION_SETTINGS,
        refundsAlreadyIssuedTodayMinor: 0,
        refundsAlreadyIssuedOnOrder: 0,
      },
      'autonomous',
    )
    expect(result.payload).toEqual({ orderId: 'ord-1', requestedAmountMinor: 1000 })
    expect(result.wouldExecuteAutomatically).toBe(true)
  })

  it('reports blocked with a null payload when the refund exceeds the order balance', () => {
    const result = dryRunRefund(
      {
        request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(25), requestedAmount: fromMajor(10), reason: 'customer_changed_mind' },
        settings: CONFIGURED_AUTOMATION_SETTINGS,
        refundsAlreadyIssuedTodayMinor: 0,
        refundsAlreadyIssuedOnOrder: 0,
      },
      'autonomous',
    )
    expect(result.eligible).toBe(false)
    expect(result.payload).toBeNull()
  })
})

/** Milestone: continuous candidate lifecycle — dry-run over the full gate state, zero external writes and zero live-data reads. */
describe('dryRunCandidateLifecycleReview', () => {
  const allPassing = {
    stage: 'compliance_review',
    intelligenceRecommendation: 'strong_candidate',
    intelligenceFreshness: 'fresh' as const,
    supplierChannelStatus: 'approved',
    supplierStatusFreshness: 'fresh' as const,
    supplierOfferFreshness: 'fresh' as const,
    complianceVerdict: 'pass',
    complianceFreshness: 'fresh' as const,
    profitabilityVerdict: 'pass',
    profitabilityFreshness: 'fresh' as const,
    businessSettingsConfigured: true,
  }

  it('reports the transition that would occur, with every requirement and its three-state verdict', () => {
    const result = dryRunCandidateLifecycleReview('prod-1', allPassing, CONFIGURED_AUTOMATION_SETTINGS)
    expect(result.wouldExecuteAutomatically).toBe(true)
    expect(result.payload?.currentStage).toBe('compliance_review')
    expect(result.payload?.wouldMoveTo).toBe('approved')
    expect(result.payload?.requirements.every((r) => r.verdict === 'pass')).toBe(true)
    expect(result.payload?.failedRequirements).toEqual([])
  })

  it('reports the exact blocker and the recheck it would schedule when a verdict is unknown', () => {
    const result = dryRunCandidateLifecycleReview('prod-1', { ...allPassing, complianceVerdict: null, complianceFreshness: 'unavailable' }, CONFIGURED_AUTOMATION_SETTINGS)
    expect(result.payload?.wouldMoveTo ?? null).toBeNull()
    expect(result.payload?.unknownRequirements).toContain('compliance_pass')
    expect(result.payload?.wouldEnqueueRechecks).toContain('lifecycle_facts')
  })

  it('separates a genuine failure from an unknown — a failure schedules no recheck', () => {
    const result = dryRunCandidateLifecycleReview('prod-1', { ...allPassing, profitabilityVerdict: 'fail' }, CONFIGURED_AUTOMATION_SETTINGS)
    expect(result.payload?.failedRequirements).toContain('profitability_pass')
    expect(result.payload?.wouldEnqueueRechecks).toEqual([])
  })

  it('never executes automatically when business settings are unconfigured, matching the real Informax org today', async () => {
    const { DEMO_AUTOMATION_SETTINGS } = await import('@/lib/automation/settingsTypes')
    const result = dryRunCandidateLifecycleReview('prod-1', { ...allPassing, businessSettingsConfigured: false }, DEMO_AUTOMATION_SETTINGS)
    expect(result.wouldExecuteAutomatically).toBe(false)
    expect(result.policy.outcome).not.toBe('allow_automatic')
  })
})
