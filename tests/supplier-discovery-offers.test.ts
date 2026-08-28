import { describe, expect, it } from 'vitest'
import { compareSupplierOffers, type SupplierOffer } from '@/lib/suppliers/discovery/offerComparison'

const baseOffer = (overrides: Partial<SupplierOffer>): SupplierOffer => ({
  supplierId: 'sup-1',
  supplierName: 'Supplier A',
  unitCostMinor: 650,
  shippingCostMinor: 200,
  currency: 'GBP',
  deliveryDaysMax: 10,
  inStock: true,
  providesTracking: false,
  handlesReturns: false,
  reliabilityScore: null,
  ...overrides,
})

describe('Supplier offer comparison', () => {
  it('with no offers, reports honestly rather than picking one', () => {
    const result = compareSupplierOffers([])
    expect(result.preferredSupplierId).toBeNull()
    expect(result.ranked).toHaveLength(0)
  })

  it('with a single offer, that offer is preferred', () => {
    const offer = baseOffer({})
    const result = compareSupplierOffers([offer])
    expect(result.preferredSupplierId).toBe('sup-1')
  })

  it('the cheapest offer wins when all else is equal', () => {
    const cheap = baseOffer({ supplierId: 'sup-1', supplierName: 'Cheap Co', unitCostMinor: 500, shippingCostMinor: 100 })
    const expensive = baseOffer({ supplierId: 'sup-2', supplierName: 'Pricey Co', unitCostMinor: 900, shippingCostMinor: 200 })
    const result = compareSupplierOffers([cheap, expensive])
    expect(result.preferredSupplierId).toBe('sup-1')
    expect(result.reason).toMatch(/lowest total fulfilment cost/)
  })

  it('a slightly pricier offer with much faster delivery and tracking can beat the cheapest — the brief\'s own example shape', () => {
    const cheap = baseOffer({ supplierId: 'sup-a', supplierName: 'Supplier A', unitCostMinor: 500, shippingCostMinor: 0, deliveryDaysMax: 14, providesTracking: false })
    const better = baseOffer({ supplierId: 'sup-b', supplierName: 'Supplier B', unitCostMinor: 500, shippingCostMinor: 70, deliveryDaysMax: 8, providesTracking: true })
    const result = compareSupplierOffers([cheap, better])
    expect(result.preferredSupplierId).toBe('sup-b')
    expect(result.reason).toContain('Supplier B')
    expect(result.reason).toMatch(/faster/)
    expect(result.reason).toMatch(/tracking is available/)
  })

  it('an out-of-stock offer is never preferred, even if it is the cheapest', () => {
    const outOfStock = baseOffer({ supplierId: 'sup-cheap', unitCostMinor: 100, shippingCostMinor: 0, inStock: false })
    const inStock = baseOffer({ supplierId: 'sup-available', unitCostMinor: 900, shippingCostMinor: 200, inStock: true })
    const result = compareSupplierOffers([outOfStock, inStock])
    expect(result.preferredSupplierId).toBe('sup-available')
    const outOfStockRanked = result.ranked.find((r) => r.supplierId === 'sup-cheap')
    expect(outOfStockRanked?.excludedReason).toMatch(/out of stock/)
  })

  it('when every offer is out of stock, no supplier is preferred', () => {
    const a = baseOffer({ supplierId: 'sup-1', inStock: false })
    const b = baseOffer({ supplierId: 'sup-2', inStock: false })
    const result = compareSupplierOffers([a, b])
    expect(result.preferredSupplierId).toBeNull()
    expect(result.reason).toMatch(/out of stock/)
  })

  it('unknown delivery time is scored below a known, slow delivery time — never assumed fine', () => {
    const known = baseOffer({ supplierId: 'sup-known', deliveryDaysMax: 25 })
    const unknown = baseOffer({ supplierId: 'sup-unknown', deliveryDaysMax: null })
    const result = compareSupplierOffers([known, unknown])
    const knownRanked = result.ranked.find((r) => r.supplierId === 'sup-known')!
    const unknownRanked = result.ranked.find((r) => r.supplierId === 'sup-unknown')!
    expect(unknownRanked.compositeScore).toBeLessThan(knownRanked.compositeScore)
  })

  it('a higher reliability score improves ranking, all else equal', () => {
    const reliable = baseOffer({ supplierId: 'sup-reliable', reliabilityScore: 95 })
    const unreliable = baseOffer({ supplierId: 'sup-unreliable', reliabilityScore: 20 })
    const result = compareSupplierOffers([reliable, unreliable])
    expect(result.preferredSupplierId).toBe('sup-reliable')
  })

  it('every offer is present in the ranked list, not only the preferred one', () => {
    const a = baseOffer({ supplierId: 'sup-1' })
    const b = baseOffer({ supplierId: 'sup-2', unitCostMinor: 1200 })
    const c = baseOffer({ supplierId: 'sup-3', unitCostMinor: 800 })
    const result = compareSupplierOffers([a, b, c])
    expect(result.ranked).toHaveLength(3)
  })
})
