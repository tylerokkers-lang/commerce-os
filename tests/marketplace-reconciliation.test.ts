import { describe, expect, it } from 'vitest'
import {
  reconcileFulfilment,
  reconcileInventory,
  reconcileListings,
  reconcileOrders,
  summariseDiscrepancies,
} from '@/lib/marketplaces/reconciliation'
import { demoShopifyInventory, demoShopifyListings } from '@/lib/demo/marketplaceData'

describe('inventory reconciliation', () => {
  it("detects the brief's exact scenario: our stock disagrees with the marketplace's", () => {
    const discrepancies = reconcileInventory(
      [{ channelProductRef: 'SKU-A', stockQty: 12, recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'ext-1', channelProductRef: 'SKU-A', stockQty: 7, reportedAt: '2026-08-23T09:00:00Z' }],
    )
    expect(discrepancies).toHaveLength(1)
    expect(discrepancies[0].field).toBe('stock')
    expect(discrepancies[0].ourValue).toBe('12')
    expect(discrepancies[0].marketplaceValue).toBe('7')
  })

  it('never assumes one side is correct: both values are preserved, neither is overwritten', () => {
    const discrepancies = reconcileInventory(
      [{ channelProductRef: 'SKU-A', stockQty: 12, recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'ext-1', channelProductRef: 'SKU-A', stockQty: 7, reportedAt: '2026-08-23T09:00:00Z' }],
    )
    // The function returns a record, not a resolved value — there is no code
    // path here that picks a winner.
    expect(discrepancies[0]).toHaveProperty('ourValue')
    expect(discrepancies[0]).toHaveProperty('marketplaceValue')
  })

  it('reports nothing when stock agrees', () => {
    const discrepancies = reconcileInventory(
      [{ channelProductRef: 'SKU-A', stockQty: 12, recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'ext-1', channelProductRef: 'SKU-A', stockQty: 12, reportedAt: '2026-08-23T09:00:00Z' }],
    )
    expect(discrepancies).toHaveLength(0)
  })

  it('does not report a discrepancy for a SKU we do not hold', () => {
    const discrepancies = reconcileInventory(
      [],
      [{ externalId: 'ext-1', channelProductRef: 'SKU-UNKNOWN', stockQty: 7, reportedAt: '2026-08-23T09:00:00Z' }],
    )
    expect(discrepancies).toHaveLength(0)
  })

  it('finds the real seeded demo discrepancy for CMO-1001', () => {
    const ours = [{ channelProductRef: 'CMO-1001', stockQty: 41, recordedAt: '2026-08-23T00:00:00Z' }]
    const discrepancies = reconcileInventory(ours, demoShopifyInventory())
    expect(discrepancies).toHaveLength(1)
    expect(discrepancies[0].ourValue).toBe('41')
    expect(discrepancies[0].marketplaceValue).toBe('33')
  })

  it('the demo listings and inventory agree on stock for the same SKU', () => {
    const listing = demoShopifyListings().find((l) => l.channelProductRef === 'CMO-1001')!
    const inventory = demoShopifyInventory().find((i) => i.channelProductRef === 'CMO-1001')!
    expect(listing.stockQty).toBe(inventory.stockQty)
  })
})

describe('listing reconciliation', () => {
  it('detects a price discrepancy', () => {
    const discrepancies = reconcileListings(
      [{ channelProductRef: 'SKU-A', priceMinor: 1000, status: 'live', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'e1', channelProductRef: 'SKU-A', title: 'x', status: 'active', priceMinor: 1200, currency: 'GBP', stockQty: 5, reportedAt: '2026-08-23T09:00:00Z', raw: {} }],
    )
    expect(discrepancies.some((d) => d.field === 'price')).toBe(true)
  })

  it('detects a listing status discrepancy: we think it is live, the marketplace has archived it', () => {
    const discrepancies = reconcileListings(
      [{ channelProductRef: 'SKU-A', priceMinor: 1000, status: 'live', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'e1', channelProductRef: 'SKU-A', title: 'x', status: 'archived', priceMinor: 1000, currency: 'GBP', stockQty: 5, reportedAt: '2026-08-23T09:00:00Z', raw: {} }],
    )
    expect(discrepancies.some((d) => d.field === 'listing_status')).toBe(true)
  })

  it('reports nothing when price and status both agree', () => {
    const discrepancies = reconcileListings(
      [{ channelProductRef: 'SKU-A', priceMinor: 1000, status: 'live', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'e1', channelProductRef: 'SKU-A', title: 'x', status: 'active', priceMinor: 1000, currency: 'GBP', stockQty: 5, reportedAt: '2026-08-23T09:00:00Z', raw: {} }],
    )
    expect(discrepancies).toHaveLength(0)
  })
})

describe('order reconciliation', () => {
  it('detects an order status discrepancy', () => {
    const discrepancies = reconcileOrders(
      [{ externalId: 'ord-1', status: 'paid', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'ord-1', placedAt: '2026-08-22T00:00:00Z', status: 'cancelled', totalMinor: 1000, currency: 'GBP', lineItems: [], raw: {} }],
    )
    expect(discrepancies).toHaveLength(1)
    expect(discrepancies[0].field).toBe('order_status')
  })

  it('matches on the marketplace order id, not on our own internal id', () => {
    const discrepancies = reconcileOrders(
      [{ externalId: 'ord-1', status: 'paid', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalId: 'ord-999', placedAt: '2026-08-22T00:00:00Z', status: 'cancelled', totalMinor: 1000, currency: 'GBP', lineItems: [], raw: {} }],
    )
    expect(discrepancies).toHaveLength(0)
  })
})

describe('discrepancy summary', () => {
  it('counts discrepancies by field for a run record', () => {
    const summary = summariseDiscrepancies(
      [
        { field: 'stock', channelProductRef: 'a', ourValue: '1', marketplaceValue: '2', ourRecordedAt: 'x', marketplaceReportedAt: 'y' },
        { field: 'stock', channelProductRef: 'b', ourValue: '1', marketplaceValue: '2', ourRecordedAt: 'x', marketplaceReportedAt: 'y' },
        { field: 'price', channelProductRef: 'c', ourValue: '1', marketplaceValue: '2', ourRecordedAt: 'x', marketplaceReportedAt: 'y' },
      ],
      10,
    )
    expect(summary.discrepancyCount).toBe(3)
    expect(summary.checkedCount).toBe(10)
    expect(summary.byField.stock).toBe(2)
    expect(summary.byField.price).toBe(1)
    expect(summary.byField.order_status).toBe(0)
  })
})

describe('fulfilment and tracking reconciliation (Milestone 5)', () => {
  it('detects a fulfilment status discrepancy', () => {
    const discrepancies = reconcileFulfilment(
      [{ externalOrderId: 'ord-1', status: 'shipped', trackingNumber: 'T1', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalOrderId: 'ord-1', fulfilmentStatus: 'delivered', trackingNumber: 'T1', reportedAt: '2026-08-23T09:00:00Z' }],
    )
    expect(discrepancies.some((d) => d.field === 'fulfilment_status')).toBe(true)
  })

  it('detects a tracking number discrepancy', () => {
    const discrepancies = reconcileFulfilment(
      [{ externalOrderId: 'ord-1', status: 'shipped', trackingNumber: 'T1', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalOrderId: 'ord-1', fulfilmentStatus: 'shipped', trackingNumber: 'T2-CORRECTED', reportedAt: '2026-08-23T09:00:00Z' }],
    )
    expect(discrepancies.some((d) => d.field === 'tracking')).toBe(true)
  })

  it('the missing-tracking case: we have none recorded, the marketplace does', () => {
    const discrepancies = reconcileFulfilment(
      [{ externalOrderId: 'ord-1', status: 'shipped', trackingNumber: null, recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalOrderId: 'ord-1', fulfilmentStatus: 'shipped', trackingNumber: 'T1', reportedAt: '2026-08-23T09:00:00Z' }],
    )
    expect(discrepancies.some((d) => d.field === 'tracking' && d.ourValue === '(none)')).toBe(true)
  })

  it('reports nothing when fulfilment status and tracking both agree', () => {
    const discrepancies = reconcileFulfilment(
      [{ externalOrderId: 'ord-1', status: 'shipped', trackingNumber: 'T1', recordedAt: '2026-08-23T00:00:00Z' }],
      [{ externalOrderId: 'ord-1', fulfilmentStatus: 'shipped', trackingNumber: 'T1', reportedAt: '2026-08-23T09:00:00Z' }],
    )
    expect(discrepancies).toHaveLength(0)
  })
})
