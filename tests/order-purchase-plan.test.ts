import { describe, expect, it } from 'vitest'
import { planPurchaseWorkflow, estimateCostForSupplier, type OrderItemForPlanning, type ProductCostOffer } from '@/lib/orders/purchasePlan'
import type { SupplierProductOffer } from '@/lib/orders/supplierResolution'

function item(over: Partial<OrderItemForPlanning> = {}): OrderItemForPlanning {
  return { id: 'item-1', productId: 'prod-1', quantity: 2, ...over }
}

function offer(over: Partial<SupplierProductOffer> = {}): SupplierProductOffer {
  return {
    supplierId: 'sup-1',
    supplierName: 'Meridian Housewares Ltd',
    unitCostMinor: 500,
    shippingCostMinor: 100,
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

describe('planPurchaseWorkflow (pure AWAITING_PURCHASE decision layer)', () => {
  it('a resolvable order item plans one fulfilment group and the awaiting_fulfilment order transition', () => {
    const offers = new Map([['prod-1', [offer()]]])
    const plan = planPurchaseWorkflow([item()], offers, 'paid')
    expect(plan.kind).toBe('create_fulfilments')
    if (plan.kind !== 'create_fulfilments') return
    expect(plan.groups).toEqual([{ supplierId: 'sup-1', orderItemIds: ['item-1'], estimatedCostMinor: 1200, currency: 'GBP' }]) // (500+100)*2
    expect(plan.anyLineItemUnresolved).toBe(false)
    expect(plan.orderTransition).toEqual({ from: 'paid', to: 'awaiting_fulfilment', reason: expect.any(String) })
  })

  it('missing supplier: no offers at all for the only product plans no_supplier_available, never a fabricated fulfilment', () => {
    const plan = planPurchaseWorkflow([item()], new Map(), 'paid')
    expect(plan).toEqual({ kind: 'no_supplier_available' })
  })

  it('a mix of resolvable and unresolvable items still creates fulfilments for the resolvable ones, flagging the rest', () => {
    const offers = new Map([['prod-1', [offer()]]]) // prod-2 has no offers at all
    const items = [item({ id: 'item-1', productId: 'prod-1' }), item({ id: 'item-2', productId: 'prod-2' })]
    const plan = planPurchaseWorkflow(items, offers, 'paid')
    expect(plan.kind).toBe('create_fulfilments')
    if (plan.kind !== 'create_fulfilments') return
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].orderItemIds).toEqual(['item-1'])
    expect(plan.anyLineItemUnresolved).toBe(true)
  })

  it('multiple items resolving to the same supplier are grouped into one fulfilment, cost summed', () => {
    const offers = new Map([
      ['prod-1', [offer({ supplierId: 'sup-1' })]],
      ['prod-2', [offer({ supplierId: 'sup-1' })]],
    ])
    const items = [item({ id: 'item-1', productId: 'prod-1', quantity: 1 }), item({ id: 'item-2', productId: 'prod-2', quantity: 1 })]
    const plan = planPurchaseWorkflow(items, offers, 'paid')
    expect(plan.kind).toBe('create_fulfilments')
    if (plan.kind !== 'create_fulfilments') return
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].orderItemIds).toEqual(['item-1', 'item-2'])
    expect(plan.groups[0].estimatedCostMinor).toBe(1200) // 600 + 600
  })

  it('items resolving to different suppliers are split into separate fulfilment groups', () => {
    const offers = new Map([
      ['prod-1', [offer({ supplierId: 'sup-1' })]],
      ['prod-2', [offer({ supplierId: 'sup-2', supplierName: 'Other Supplier' })]],
    ])
    const items = [item({ id: 'item-1', productId: 'prod-1' }), item({ id: 'item-2', productId: 'prod-2' })]
    const plan = planPurchaseWorkflow(items, offers, 'paid')
    expect(plan.kind).toBe('create_fulfilments')
    if (plan.kind !== 'create_fulfilments') return
    expect(plan.groups).toHaveLength(2)
  })

  it('an order not currently in a status that can transition to awaiting_fulfilment still creates fulfilments, with orderTransition null', () => {
    const offers = new Map([['prod-1', [offer()]]])
    // 'cancelled' is terminal — planOrderTransition refuses it, but supplier resolution/fulfilment creation is independent of that.
    const plan = planPurchaseWorkflow([item()], offers, 'cancelled')
    expect(plan.kind).toBe('create_fulfilments')
    if (plan.kind !== 'create_fulfilments') return
    expect(plan.orderTransition).toBeNull()
  })
})

describe('estimateCostForSupplier (live re-estimate used by manual purchase recording)', () => {
  it('sums unit cost + shipping across every item for a known supplier', () => {
    const offerByProduct = new Map<string, ProductCostOffer>([['prod-1', { unitCostMinor: 500, shippingCostMinor: 100 }]])
    const total = estimateCostForSupplier([item({ quantity: 3 })], offerByProduct)
    expect(total).toBe(1800) // (500+100)*3
  })

  it('returns null, never a fabricated figure, when any item has no offer from this supplier', () => {
    const offerByProduct = new Map<string, ProductCostOffer>()
    const total = estimateCostForSupplier([item()], offerByProduct)
    expect(total).toBeNull()
  })

  it('sums correctly across multiple distinct products', () => {
    const offerByProduct = new Map<string, ProductCostOffer>([
      ['prod-1', { unitCostMinor: 500, shippingCostMinor: 100 }],
      ['prod-2', { unitCostMinor: 200, shippingCostMinor: 50 }],
    ])
    const items = [item({ productId: 'prod-1', quantity: 1 }), item({ id: 'item-2', productId: 'prod-2', quantity: 2 })]
    const total = estimateCostForSupplier(items, offerByProduct)
    expect(total).toBe(1100) // (600*1) + (250*2)
  })
})
