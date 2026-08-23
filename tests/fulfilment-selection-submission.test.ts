import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { chooseFulfilmentSupplier, type FulfilmentSupplierCandidate } from '@/lib/fulfilment/selection'
import { assessFulfilmentSubmission, type SubmissionInput } from '@/lib/fulfilment/submission'
import { recheckOrderLineProfitability } from '@/lib/orders/profitabilityRecheck'
import { decideComplianceRecheck } from '@/lib/orders/complianceRecheck'
import { reserveStock } from '@/lib/inventory/reservation'
import type { SupplierSignals } from '@/lib/suppliers/scoring'

const goodSignals: SupplierSignals = {
  unitCost: fromMajor(8), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 3,
  ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
  handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
  supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
  supportsOwnBranding: true, documentCount: 2,
}

const weakerSignals: SupplierSignals = {
  ...goodSignals, unitCost: fromMajor(7), ordersPlaced: 5, qualityRating: 3.0, ordersLate: 2,
}

function candidate(id: string, signals: SupplierSignals, isApprovedForListing: boolean): FulfilmentSupplierCandidate {
  return { id, name: `Supplier ${id}`, signals, isApprovedForListing }
}

describe('fulfilment supplier selection', () => {
  it('reports no supplier when none is available', () => {
    const choice = chooseFulfilmentSupplier([])
    expect(choice.chosen).toBeNull()
  })

  it('chooses the approved supplier when it is also best-ranked', () => {
    const choice = chooseFulfilmentSupplier([
      candidate('sup-approved', goodSignals, true),
      candidate('sup-other', weakerSignals, false),
    ])
    expect(choice.chosen?.id).toBe('sup-approved')
    expect(choice.matchesApprovedSupplier).toBe(true)
  })

  it('falls back to the best-ranked alternative when no supplier is approved', () => {
    const choice = chooseFulfilmentSupplier([
      candidate('sup-a', goodSignals, false),
      candidate('sup-b', weakerSignals, false),
    ])
    expect(choice.chosen?.id).toBe('sup-a')
    expect(choice.matchesApprovedSupplier).toBe(false)
    expect(choice.rationale).toMatch(/compliance re-check/)
  })

  it('keeps the approved supplier even when a higher-scoring alternative exists, and says so', () => {
    const choice = chooseFulfilmentSupplier([
      candidate('sup-approved-but-weaker', weakerSignals, true),
      candidate('sup-better-unapproved', goodSignals, false),
    ])
    expect(choice.chosen?.id).toBe('sup-approved-but-weaker')
    expect(choice.rationale).toMatch(/now scores higher/)
  })
})

const passingProfitability = recheckOrderLineProfitability(
  { sellingPrice: fromMajor(30), supplierUnitCost: fromMajor(8), supplierShipping: fromMajor(2), channelFee: fromMajor(4.5), paymentFee: fromMajor(0.5), quantity: 1, vatRatePct: 20 },
  { minNetMarginPct: 10 },
)
const failingProfitability = recheckOrderLineProfitability(
  { sellingPrice: fromMajor(30), supplierUnitCost: fromMajor(25), supplierShipping: fromMajor(2), channelFee: fromMajor(4.5), paymentFee: fromMajor(0.5), quantity: 1, vatRatePct: 20 },
  { minNetMarginPct: 10 },
)

const noRecheckNeeded = decideComplianceRecheck({ approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-1', daysSinceLastAssessment: 5, productDetailsChangedSinceApproval: false })
const recheckNeeded = decideComplianceRecheck({ approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-2', daysSinceLastAssessment: 5, productDetailsChangedSinceApproval: false })

function baseSubmission(over: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    supplierChoice: chooseFulfilmentSupplier([candidate('sup-1', goodSignals, true)]),
    reservation: (() => {
      const r = reserveStock({ onHandQty: 10, reservedQty: 0 }, { orderId: 'ord-1', quantity: 1 })
      return r.ok ? { ok: true as const, value: r.value } : { ok: false as const, error: r.error }
    })(),
    profitability: passingProfitability,
    complianceRecheck: noRecheckNeeded,
    complianceRecheckPasses: null,
    automationLevel: 'supervised',
    ...over,
  }
}

describe('blocked fulfilment: no supplier available', () => {
  it('blocks when no supplier could be chosen', () => {
    const decision = assessFulfilmentSubmission(baseSubmission({ supplierChoice: chooseFulfilmentSupplier([]) }))
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'supplier_selected')?.satisfied).toBe(false)
  })
})

describe('blocked fulfilment: stock race condition', () => {
  it('blocks when the reservation could not be granted', () => {
    const denied = reserveStock({ onHandQty: 5, reservedQty: 5 }, { orderId: 'ord-1', quantity: 1 })
    expect(denied.ok).toBe(false)
    const decision = assessFulfilmentSubmission(
      baseSubmission({ reservation: denied.ok ? { ok: true, value: denied.value } : { ok: false, error: denied.error } }),
    )
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'stock_reserved')?.satisfied).toBe(false)
  })
})

describe('compliant but unprofitable order', () => {
  it('blocks on profitability alone when compliance needs no re-check', () => {
    const decision = assessFulfilmentSubmission(baseSubmission({ profitability: failingProfitability }))
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'profitability')?.satisfied).toBe(false)
    expect(decision.requirements.find((r) => r.key === 'compliance')?.satisfied).toBe(true)
  })
})

describe('profitable but non-compliant order (supplier changed)', () => {
  it('blocks on compliance when a re-check is required and has not passed', () => {
    const decision = assessFulfilmentSubmission(
      baseSubmission({ complianceRecheck: recheckNeeded, complianceRecheckPasses: false }),
    )
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'compliance')?.satisfied).toBe(false)
    expect(decision.requirements.find((r) => r.key === 'profitability')?.satisfied).toBe(true)
  })

  it('proceeds once the required re-check has actually passed', () => {
    const decision = assessFulfilmentSubmission(
      baseSubmission({ complianceRecheck: recheckNeeded, complianceRecheckPasses: true }),
    )
    expect(decision.outcome).not.toBe('blocked')
  })

  it('blocks while a required re-check has not been run yet, distinct from having failed', () => {
    const decision = assessFulfilmentSubmission(
      baseSubmission({ complianceRecheck: recheckNeeded, complianceRecheckPasses: null }),
    )
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'compliance')?.detail).toMatch(/has not been run yet/)
  })
})

describe('automation approval requirement', () => {
  it('requires approval at "manual" and "assisted" even when every requirement passes', () => {
    for (const automationLevel of ['manual', 'assisted'] as const) {
      const decision = assessFulfilmentSubmission(baseSubmission({ automationLevel }))
      expect(decision.outcome).toBe('pending_approval')
    }
  })

  it('submits automatically at "supervised" and "autonomous" once every requirement passes', () => {
    for (const automationLevel of ['supervised', 'autonomous'] as const) {
      const decision = assessFulfilmentSubmission(baseSubmission({ automationLevel }))
      expect(decision.outcome).toBe('submit_automatically')
      expect(decision.requiresOwnerApproval).toBe(false)
    }
  })

  it('never submits automatically at "supervised" if a requirement genuinely fails', () => {
    const decision = assessFulfilmentSubmission(
      baseSubmission({ automationLevel: 'supervised', profitability: failingProfitability }),
    )
    expect(decision.outcome).toBe('blocked')
  })
})
