import type { MarketplaceOrderLineItem } from '@/lib/marketplaces/connectors/types'

/**
 * SKU/line-item resolution (the resolver `orders/ingestion.ts`'s
 * `allLineItemsResolved`/`lineItemsTotalMinor` params always anticipated but
 * that was never built — see `HANDOVER.md`'s order-ingestion sections).
 *
 * Pure: the caller already ran the real `product_variants` lookup and hands
 * in the result as a plain map. A line item with no SKU at all, or a SKU not
 * present in the lookup map, is `unresolved` — never guessed at, never
 * silently dropped from the count.
 */

export interface ResolvedLineItem {
  lineItem: MarketplaceOrderLineItem
  productId: string
  variantId: string
}

export interface UnresolvedLineItem {
  lineItem: MarketplaceOrderLineItem
  reason: string
}

export interface LineItemResolutionResult {
  resolved: readonly ResolvedLineItem[]
  unresolved: readonly UnresolvedLineItem[]
  allLineItemsResolved: boolean
  /** Sum of resolved line items' own totals — `null` when any item is unresolved, matching `planOrderIngestion`'s own contract for this field. */
  lineItemsTotalMinor: number | null
}

export type SkuLookup = ReadonlyMap<string, { productId: string; variantId: string }>

export function resolveLineItems(lineItems: readonly MarketplaceOrderLineItem[], lookup: SkuLookup): LineItemResolutionResult {
  const resolved: ResolvedLineItem[] = []
  const unresolved: UnresolvedLineItem[] = []

  for (const lineItem of lineItems) {
    if (!lineItem.sku) {
      unresolved.push({ lineItem, reason: 'The marketplace did not report a SKU for this line item.' })
      continue
    }
    const match = lookup.get(lineItem.sku)
    if (!match) {
      unresolved.push({ lineItem, reason: `SKU "${lineItem.sku}" was not found in the product catalogue.` })
      continue
    }
    resolved.push({ lineItem, productId: match.productId, variantId: match.variantId })
  }

  const allLineItemsResolved = lineItems.length > 0 && unresolved.length === 0

  return {
    resolved,
    unresolved,
    allLineItemsResolved,
    lineItemsTotalMinor: allLineItemsResolved
      ? resolved.reduce((sum, r) => sum + r.lineItem.unitPriceMinor * r.lineItem.quantity, 0)
      : null,
  }
}
