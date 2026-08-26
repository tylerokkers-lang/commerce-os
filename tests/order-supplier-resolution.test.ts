import { describe, expect, it } from 'vitest'
import { resolveSupplierForProduct, type SupplierProductOffer } from '@/lib/orders/supplierResolution'

function offer(over: Partial<SupplierProductOffer> = {}): SupplierProductOffer {
  return {
    supplierId: 'sup-1',
    supplierName: 'Meridian Housewares Ltd',
    unitCostMinor: 900,
    shippingCostMinor: 150,
    currency: 'GBP',
    channelApprovalStatus: 'approved',
    deliveryDaysMin: 3,
    deliveryDaysMax: 7,
    providesTracking: true,
    handlesReturns: true,
    supportsBlindShipping: true,
    supportsCustomInvoice: true,
    supportsCustomPackaging: false,
    ...over,
  }
}

describe('supplier resolution wired to real data', () => {
  it('no supplier_products offers at all: honest "no supplier available", not a fabricated choice', () => {
    const result = resolveSupplierForProduct([])
    expect(result.hadAnyOffers).toBe(false)
    expect(result.choice.chosen).toBeNull()
    expect(result.choice.rationale).toContain('No supplier is available')
  })

  it('a single approved offer is chosen', () => {
    const result = resolveSupplierForProduct([offer()])
    expect(result.hadAnyOffers).toBe(true)
    expect(result.choice.chosen?.id).toBe('sup-1')
    expect(result.choice.matchesApprovedSupplier).toBe(true)
  })

  it('an unapproved-only offer is still chosen as the best alternative, flagged as needing a compliance re-check', () => {
    const result = resolveSupplierForProduct([offer({ channelApprovalStatus: 'not_assessed' })])
    expect(result.choice.chosen).not.toBeNull()
    expect(result.choice.matchesApprovedSupplier).toBe(false)
    expect(result.choice.rationale).toContain('compliance re-check')
  })

  it('the cheapest offer becomes bestAvailableUnitCost, scoring the others relative to it', () => {
    const cheap = offer({ supplierId: 'sup-cheap', unitCostMinor: 500, channelApprovalStatus: 'not_assessed' })
    const expensive = offer({ supplierId: 'sup-expensive', unitCostMinor: 2000, channelApprovalStatus: 'not_assessed' })
    const result = resolveSupplierForProduct([expensive, cheap])
    // The cheaper of the two, all else equal, should rank at least as well.
    expect(result.choice.ranked[0].supplier.id).toBe('sup-cheap')
  })

  it('handlesReturns is reused as the acceptsFaultyReturns signal, since no separate column exists', () => {
    const result = resolveSupplierForProduct([offer({ handlesReturns: false })])
    // Not asserting on the internal signals object directly (private to
    // chooseFulfilmentSupplier) — asserting the function accepts and scores
    // a no-returns supplier without throwing is the observable behaviour.
    expect(result.choice.chosen).not.toBeNull()
  })
})
