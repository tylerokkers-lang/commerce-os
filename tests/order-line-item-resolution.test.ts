import { describe, expect, it } from 'vitest'
import { resolveLineItems, type SkuLookup } from '@/lib/orders/lineItemResolution'
import type { MarketplaceOrderLineItem } from '@/lib/marketplaces/connectors/types'

function lineItem(over: Partial<MarketplaceOrderLineItem> = {}): MarketplaceOrderLineItem {
  return { externalId: 'li-1', sku: 'SKU-A', quantity: 2, unitPriceMinor: 500, ...over }
}

describe('SKU/line-item resolution', () => {
  it('resolves every line item present in the lookup map', () => {
    const lookup: SkuLookup = new Map([['SKU-A', { productId: 'prod-1', variantId: 'var-1' }]])
    const result = resolveLineItems([lineItem()], lookup)
    expect(result.allLineItemsResolved).toBe(true)
    expect(result.resolved).toEqual([{ lineItem: lineItem(), productId: 'prod-1', variantId: 'var-1' }])
    expect(result.unresolved).toEqual([])
    expect(result.lineItemsTotalMinor).toBe(1000) // 500 * 2
  })

  it('a line item with no SKU at all is unresolved, never guessed at', () => {
    const lookup: SkuLookup = new Map()
    const result = resolveLineItems([lineItem({ sku: null })], lookup)
    expect(result.allLineItemsResolved).toBe(false)
    expect(result.resolved).toEqual([])
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].reason).toContain('did not report a SKU')
    expect(result.lineItemsTotalMinor).toBeNull()
  })

  it('a SKU not found in the catalogue is unresolved, not silently dropped from the count', () => {
    const lookup: SkuLookup = new Map()
    const result = resolveLineItems([lineItem({ sku: 'SKU-MISSING' })], lookup)
    expect(result.allLineItemsResolved).toBe(false)
    expect(result.unresolved[0].reason).toContain('SKU-MISSING')
    expect(result.unresolved[0].reason).toContain('not found')
  })

  it('a mix of resolved and unresolved items is not fully resolved, and total is null', () => {
    const lookup: SkuLookup = new Map([['SKU-A', { productId: 'prod-1', variantId: 'var-1' }]])
    const result = resolveLineItems([lineItem({ sku: 'SKU-A' }), lineItem({ externalId: 'li-2', sku: 'SKU-B' })], lookup)
    expect(result.allLineItemsResolved).toBe(false)
    expect(result.resolved).toHaveLength(1)
    expect(result.unresolved).toHaveLength(1)
    expect(result.lineItemsTotalMinor).toBeNull()
  })

  it('an order with zero line items is not considered fully resolved (there is nothing to resolve, but nothing to ingest either)', () => {
    const result = resolveLineItems([], new Map())
    expect(result.allLineItemsResolved).toBe(false)
  })

  it('sums resolved totals across multiple resolved line items correctly', () => {
    const lookup: SkuLookup = new Map([
      ['SKU-A', { productId: 'prod-1', variantId: 'var-1' }],
      ['SKU-B', { productId: 'prod-2', variantId: 'var-2' }],
    ])
    const result = resolveLineItems(
      [lineItem({ sku: 'SKU-A', quantity: 1, unitPriceMinor: 1000 }), lineItem({ externalId: 'li-2', sku: 'SKU-B', quantity: 3, unitPriceMinor: 200 })],
      lookup,
    )
    expect(result.allLineItemsResolved).toBe(true)
    expect(result.lineItemsTotalMinor).toBe(1600) // 1000*1 + 200*3
  })
})
