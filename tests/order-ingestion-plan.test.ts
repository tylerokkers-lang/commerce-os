import { describe, expect, it } from 'vitest'
import { planOrderWrite } from '@/lib/orders/ingestionPlan'
import type { ExistingOrderRecord } from '@/lib/orders/ingestion'
import type { SkuLookup } from '@/lib/orders/lineItemResolution'
import type { MarketplaceOrderSnapshot } from '@/lib/marketplaces/connectors/types'

function snapshot(over: Partial<MarketplaceOrderSnapshot> = {}): MarketplaceOrderSnapshot {
  return {
    externalId: 'ord-1',
    placedAt: '2026-08-23T09:00:00Z',
    status: 'paid',
    totalMinor: 2000,
    currency: 'GBP',
    lineItems: [{ externalId: 'li-1', sku: 'SKU-A', quantity: 2, unitPriceMinor: 1000 }],
    raw: {},
    ...over,
  }
}

const RESOLVED_LOOKUP: SkuLookup = new Map([['SKU-A', { productId: 'prod-1', variantId: 'var-1' }]])

describe('planOrderWrite (pure ingestion decision layer)', () => {
  it('a genuinely new order plans a create, with items resolved against the SKU lookup', () => {
    const plan = planOrderWrite('shopify', snapshot(), null, RESOLVED_LOOKUP)
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.order.externalId).toBe('ord-1')
    expect(plan.order.status).toBe('paid')
    expect(plan.order.idempotencyKey).toBe('order:shopify:ord-1')
    expect(plan.items).toEqual([
      { productId: 'prod-1', variantId: 'var-1', sku: 'SKU-A', description: 'SKU-A', quantity: 2, unitPriceMinor: 1000, lineTotalMinor: 2000 },
    ])
  })

  it('missing SKU/product: an unresolvable line item plans a rejection, never a create', () => {
    const plan = planOrderWrite('shopify', snapshot(), null, new Map())
    expect(plan.kind).toBe('rejected')
    if (plan.kind !== 'rejected') return
    expect(plan.unresolvedSkus).toEqual(['SKU-A'])
    expect(plan.reason).toContain('failed validation')
  })

  it('duplicate-order idempotency: the same order already recorded at the same status plans a no-op', () => {
    const existing: ExistingOrderRecord = { id: 'order-db-1', status: 'paid' }
    const plan = planOrderWrite('shopify', snapshot(), existing, RESOLVED_LOOKUP)
    expect(plan).toEqual({ kind: 'already_ingested', orderId: 'order-db-1' })
  })

  it('a genuine status change from the marketplace plans a valid transition', () => {
    const existing: ExistingOrderRecord = { id: 'order-db-1', status: 'paid' }
    const plan = planOrderWrite('shopify', snapshot({ status: 'refunded' }), existing, RESOLVED_LOOKUP)
    expect(plan.kind).toBe('status_changed')
    if (plan.kind !== 'status_changed') return
    expect(plan.from).toBe('paid')
    expect(plan.to).toBe('refunded')
  })

  it('a status change our own state machine does not allow is blocked, never forced through', () => {
    // pending -> fulfilled skips an intermediate state ALLOWED['pending'] does not permit.
    const existing: ExistingOrderRecord = { id: 'order-db-1', status: 'pending' }
    const plan = planOrderWrite('shopify', snapshot({ status: 'fulfilled' }), existing, RESOLVED_LOOKUP)
    expect(plan.kind).toBe('status_change_blocked')
    if (plan.kind !== 'status_change_blocked') return
    expect(plan.attemptedFrom).toBe('pending')
    expect(plan.attemptedTo).toBe('fulfilled')
  })

  it('the marketplace order id is used as both order_number and external_id — no separate order number is fabricated', () => {
    const plan = planOrderWrite('shopify', snapshot({ externalId: 'gid://shopify/Order/999' }), null, RESOLVED_LOOKUP)
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.order.orderNumber).toBe('gid://shopify/Order/999')
    expect(plan.order.externalId).toBe('gid://shopify/Order/999')
  })
})
