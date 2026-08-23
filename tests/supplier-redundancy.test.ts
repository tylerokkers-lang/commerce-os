import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { evaluateSupplierRedundancy, type RedundancyRequest } from '@/lib/suppliers/redundancy'
import type { SupplierSignals } from '@/lib/suppliers/scoring'

/** A supplier approved on both channels, good enough to be worth losing. */
const goodSignals: SupplierSignals = {
  unitCost: fromMajor(8.6),
  shippingCost: fromMajor(2.2),
  deliveryDaysMin: 2,
  deliveryDaysMax: 3,
  ordersPlaced: 148,
  ordersLate: 6,
  ordersDefective: 3,
  qualityRating: 4.6,
  communicationRating: 4.7,
  handlesReturns: true,
  returnsWindowDays: 60,
  acceptsFaultyReturns: true,
  providesTracking: true,
  supportsBlindShipping: true,
  supportsCustomInvoice: true,
  supportsCustomPackaging: true,
  supportsOwnBranding: true,
  documentCount: 3,
}

/** An equally capable alternative — same shape, slightly higher cost. */
const suitableAlternativeSignals: SupplierSignals = {
  ...goodSignals,
  unitCost: fromMajor(9.4),
  ordersPlaced: 60,
  ordersLate: 3,
}

/** Cheaper, but fails Amazon outright — the classic marketplace-reseller trap. */
const unsuitableAlternativeSignals: SupplierSignals = {
  unitCost: fromMajor(5.9),
  shippingCost: fromMajor(1.4),
  deliveryDaysMin: 18,
  deliveryDaysMax: 26,
  ordersPlaced: 11,
  ordersLate: 5,
  ordersDefective: 2,
  qualityRating: 2.9,
  communicationRating: 2.4,
  handlesReturns: false,
  returnsWindowDays: 0,
  acceptsFaultyReturns: false,
  providesTracking: false,
  supportsBlindShipping: false,
  supportsCustomInvoice: false,
  supportsCustomPackaging: false,
  supportsOwnBranding: false,
  documentCount: 0,
}

function baseRequest(over: Partial<RedundancyRequest> = {}): RedundancyRequest {
  return {
    productTitle: 'Magnetic Knife Rail',
    channels: ['shopify', 'amazon_uk'],
    reason: { key: 'out_of_stock', detail: 'the supplier reported zero stock' },
    automationLevel: 'assisted',
    thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
    previousChannelStatus: { shopify: 'approved', amazon_uk: 'approved' },
    alternatives: [],
    economics: {
      sellingPrice: fromMajor(32),
      returnRatePct: 3,
      vatRatePct: 20,
      vatInclusive: true,
    },
    profileInput: { category: 'Kitchen' },
    ...over,
  }
}

describe('supplier redundancy', () => {
  it('reports no alternative available when there is none, and asks for approval', () => {
    const decision = evaluateSupplierRedundancy(baseRequest({ alternatives: [] }))
    expect(decision.outcome).toBe('no_alternative_available')
    expect(decision.requiresOwnerApproval).toBe(true)
    expect(decision.recommended).toBeNull()
  })

  it('never selects on price alone: the cheaper, unsuitable alternative is not recommended', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        alternatives: [
          { id: 'cheap', name: 'Cheap But Unsuitable', signals: unsuitableAlternativeSignals },
          { id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals },
        ],
      }),
    )
    expect(decision.recommended?.candidate.id).not.toBe('cheap')
  })

  it('requests approval when no alternative preserves the approved channels', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        alternatives: [{ id: 'cheap', name: 'Cheap But Unsuitable', signals: unsuitableAlternativeSignals }],
      }),
    )
    expect(decision.outcome).toBe('request_approval')
    expect(decision.requiresOwnerApproval).toBe(true)
    expect(decision.reason).toMatch(/none preserves the channels/)
    // Still reports what was considered, for transparency, even though it is
    // not recommended.
    expect(decision.assessed).toHaveLength(1)
  })

  it('names why the alternative fails, via its own capability assessment', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        alternatives: [{ id: 'cheap', name: 'Cheap But Unsuitable', signals: unsuitableAlternativeSignals }],
      }),
    )
    expect(decision.assessed[0].capability.amazon_uk.status).toBe('blocked')
    expect(decision.assessed[0].preservesApprovedChannels).toBe(false)
  })

  it('recommends a suitable alternative but still asks for approval at "assisted"', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        automationLevel: 'assisted',
        alternatives: [{ id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals }],
      }),
    )
    expect(decision.outcome).toBe('request_approval')
    expect(decision.recommended?.candidate.id).toBe('good')
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  it('never auto-switches at "manual", even with a perfect alternative', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        automationLevel: 'manual',
        alternatives: [{ id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals }],
      }),
    )
    expect(decision.outcome).toBe('request_approval')
  })

  it('auto-switches at "supervised" when the alternative preserves every approved channel', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        automationLevel: 'supervised',
        alternatives: [{ id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals }],
      }),
    )
    expect(decision.outcome).toBe('switch_automatically')
    expect(decision.requiresOwnerApproval).toBe(false)
    expect(decision.recommended?.candidate.id).toBe('good')
  })

  it('auto-switches at "autonomous" under the same conditions as "supervised"', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        automationLevel: 'autonomous',
        alternatives: [{ id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals }],
      }),
    )
    expect(decision.outcome).toBe('switch_automatically')
  })

  it('never auto-switches at "supervised" or "autonomous" when compliance would be lost, regardless of level', () => {
    // The guardrail from docs/PRINCIPLES.md #4: automation cannot override
    // compliance, no matter how high the automation level is set.
    for (const automationLevel of ['supervised', 'autonomous'] as const) {
      const decision = evaluateSupplierRedundancy(
        baseRequest({
          automationLevel,
          alternatives: [{ id: 'cheap', name: 'Cheap But Unsuitable', signals: unsuitableAlternativeSignals }],
        }),
      )
      expect(decision.outcome).toBe('request_approval')
    }
  })

  it('does not require preserving a channel that was never approved to begin with', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        automationLevel: 'supervised',
        previousChannelStatus: { shopify: 'approved', amazon_uk: 'blocked' },
        alternatives: [{ id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals }],
      }),
    )
    // Amazon was already blocked before the outage, so an alternative that is
    // merely "review_required" for Amazon has not made anything worse.
    expect(decision.outcome).toBe('switch_automatically')
  })

  it('ranks and reports every alternative considered, not only the winner', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        alternatives: [
          { id: 'cheap', name: 'Cheap But Unsuitable', signals: unsuitableAlternativeSignals },
          { id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals },
        ],
      }),
    )
    expect(decision.assessed).toHaveLength(2)
    expect(new Set(decision.assessed.map((a) => a.candidate.id))).toEqual(new Set(['cheap', 'good']))
  })

  it('recomputes profitability through the real channel comparison, not a shortcut', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        alternatives: [{ id: 'good', name: 'Suitable Alternative', signals: suitableAlternativeSignals }],
      }),
    )
    const assessment = decision.assessed[0]
    expect(assessment.channels.projections).toHaveLength(2)
    expect(assessment.channels.projections.every((p) => p.profitability.netProfit)).toBeTruthy()
  })

  it('rejects an alternative whose margin has fallen below the threshold even if compliance passes', () => {
    const expensiveButCompliant: SupplierSignals = {
      ...suitableAlternativeSignals,
      unitCost: fromMajor(26), // leaves almost nothing after a £32 selling price
    }
    const decision = evaluateSupplierRedundancy(
      baseRequest({
        automationLevel: 'supervised',
        alternatives: [{ id: 'pricey', name: 'Compliant But Unprofitable', signals: expensiveButCompliant }],
      }),
    )
    expect(decision.assessed[0].meetsProfitabilityBar).toBe(false)
    expect(decision.outcome).toBe('request_approval')
  })

  it('includes the reason for the outage in the explanation', () => {
    const decision = evaluateSupplierRedundancy(
      baseRequest({ reason: { key: 'connector_failing', detail: 'the feed has failed for three consecutive syncs' } }),
    )
    expect(decision.reason).toMatch(/feed has failed for three consecutive syncs/)
  })
})
