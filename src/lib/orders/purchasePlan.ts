import { resolveSupplierForProduct, type SupplierProductOffer } from './supplierResolution'
import { planOrderTransition, type OrderStatus } from './lifecycle'

/**
 * The pure planning layer for the AWAITING_PURCHASE step — split out of
 * `purchaseWorkflow.ts` (`import 'server-only'`, so it can never be
 * imported into Vitest) the same way `ingestionPlan.ts` was split out of
 * `ingestionRun.ts`. No Supabase import, no I/O: given an order's already-
 * loaded line items and each product's already-loaded supplier offers,
 * decides which fulfilment(s) to create and what the order's own status
 * should become. `purchaseWorkflow.ts` only executes whatever this returns.
 */

export interface OrderItemForPlanning {
  id: string
  productId: string | null
  quantity: number
}

export interface FulfilmentGroupPlan {
  supplierId: string
  orderItemIds: readonly string[]
  estimatedCostMinor: number
  currency: string
}

export type PurchaseWorkflowPlan =
  | { kind: 'no_supplier_available' }
  | {
      kind: 'create_fulfilments'
      groups: readonly FulfilmentGroupPlan[]
      anyLineItemUnresolved: boolean
      orderTransition: { from: OrderStatus; to: OrderStatus; reason: string } | null
    }

export interface ProductCostOffer {
  unitCostMinor: number
  shippingCostMinor: number
}

/**
 * A live re-estimate of what a specific, already-chosen supplier's offers
 * would cost for a given set of order items — used by `manualPurchase.ts`
 * to compute the actual-vs-estimated variance at the moment a purchase is
 * recorded, since `fulfilments` has no stored historical estimate column.
 * `null` when any item's product has no offer at all from this supplier,
 * matching `purchaseEconomics.ts`'s own "unknown, never fabricated" contract.
 * `offerByProduct` is already scoped to one specific supplier's rows by the
 * caller — this function has no supplier concept of its own.
 */
export function estimateCostForSupplier(
  items: readonly OrderItemForPlanning[],
  offerByProduct: ReadonlyMap<string, ProductCostOffer>,
): number | null {
  let total = 0
  for (const item of items) {
    const offer = item.productId ? offerByProduct.get(item.productId) : undefined
    if (!offer) return null
    total += (offer.unitCostMinor + offer.shippingCostMinor) * item.quantity
  }
  return total
}

/**
 * `offersByProduct` is keyed by `productId`, already scoped to real
 * `supplier_products`/`suppliers` rows the caller loaded — this function
 * never queries anything itself.
 */
export function planPurchaseWorkflow(
  orderItems: readonly OrderItemForPlanning[],
  offersByProduct: ReadonlyMap<string, readonly SupplierProductOffer[]>,
  currentOrderStatus: OrderStatus,
): PurchaseWorkflowPlan {
  const bySupplier = new Map<string, { orderItemIds: string[]; estimatedCostMinor: number; currency: string }>()
  let anyLineItemUnresolved = false

  for (const item of orderItems) {
    const offers = item.productId ? (offersByProduct.get(item.productId) ?? []) : []
    const { choice, hadAnyOffers } = resolveSupplierForProduct(offers)
    if (!item.productId || !hadAnyOffers || !choice.chosen) {
      anyLineItemUnresolved = true
      continue
    }
    const offer = offers.find((o) => o.supplierId === choice.chosen!.id)!
    const itemCostMinor = (offer.unitCostMinor + offer.shippingCostMinor) * item.quantity
    const existing = bySupplier.get(offer.supplierId)
    if (existing) {
      existing.orderItemIds.push(item.id)
      existing.estimatedCostMinor += itemCostMinor
    } else {
      bySupplier.set(offer.supplierId, { orderItemIds: [item.id], estimatedCostMinor: itemCostMinor, currency: offer.currency })
    }
  }

  if (bySupplier.size === 0) {
    return { kind: 'no_supplier_available' }
  }

  const groups: FulfilmentGroupPlan[] = [...bySupplier.entries()].map(([supplierId, g]) => ({
    supplierId,
    orderItemIds: g.orderItemIds,
    estimatedCostMinor: g.estimatedCostMinor,
    currency: g.currency,
  }))

  const transition = planOrderTransition({ from: currentOrderStatus, to: 'awaiting_fulfilment', reason: 'Supplier resolved; order is now awaiting manual purchase.' })

  return {
    kind: 'create_fulfilments',
    groups,
    anyLineItemUnresolved,
    orderTransition: transition.ok ? { from: transition.value.from, to: transition.value.to, reason: transition.value.reason } : null,
  }
}
