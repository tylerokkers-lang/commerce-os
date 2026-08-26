import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { planFulfilmentTransition, type FulfilmentStatus } from '@/lib/fulfilment/lifecycle'
import { calculatePurchaseVariance, type PurchaseVarianceResult } from './purchaseEconomics'
import { estimateCostForSupplier, type OrderItemForPlanning, type ProductCostOffer } from './purchasePlan'
import { err, ok, type Result } from '@/lib/core/result'

/**
 * Recording a manual purchase — the one and only way a fulfilment ever
 * leaves `'awaiting_supplier'` in this milestone. Always called from an
 * explicit, session-authenticated API route (`/api/fulfilments/[id]/purchase`)
 * — never from a maintenance job, never automatically. You bought the goods
 * yourself; this only records that fact.
 *
 * "Estimated" cost for the actual-vs-estimated variance is not read back
 * from a stored figure — `fulfilments` has no such column, and adding one
 * was deliberately out of scope for this milestone (no migration needed).
 * Instead it is a live re-read of the same `supplier_products` rows for
 * this fulfilment's already-chosen supplier, at the moment of purchase —
 * real, current data, not a historical snapshot, and never fabricated.
 */

export interface RecordSupplierPurchaseInput {
  orgId: string
  fulfilmentId: string
  costMinor: number
  shippingCostMinor: number
  supplierReference: string
  currency: string
}

export interface RecordSupplierPurchaseResult {
  fulfilmentId: string
  orderId: string
  status: FulfilmentStatus
  variance: PurchaseVarianceResult
}

async function estimateCurrentCost(
  supabase: ReturnType<typeof createServiceSupabase>,
  orgId: string,
  fulfilmentId: string,
  supplierId: string,
): Promise<number | null> {
  const { data: fulfilmentItems } = await supabase.from('fulfilment_items').select('order_item_id, quantity').eq('fulfilment_id', fulfilmentId)
  if (!fulfilmentItems || fulfilmentItems.length === 0) return null

  const orderItemIds = fulfilmentItems.map((fi) => fi.order_item_id)
  const { data: orderItemRows } = await supabase.from('order_items').select('id, product_id, quantity').in('id', orderItemIds)
  if (!orderItemRows || orderItemRows.length === 0) return null
  const orderItems: OrderItemForPlanning[] = orderItemRows.map((oi) => ({ id: oi.id, productId: oi.product_id, quantity: oi.quantity }))

  const productIds = [...new Set(orderItems.map((oi) => oi.productId).filter((id): id is string => id !== null))]
  if (productIds.length === 0) return null

  const { data: offers } = await supabase
    .from('supplier_products')
    .select('product_id, unit_cost_minor, shipping_cost_minor')
    .eq('org_id', orgId)
    .eq('supplier_id', supplierId)
    .in('product_id', productIds)
  if (!offers || offers.length === 0) return null

  const offerByProduct = new Map<string, ProductCostOffer>(
    offers.map((o) => [o.product_id, { unitCostMinor: o.unit_cost_minor, shippingCostMinor: o.shipping_cost_minor }]),
  )
  return estimateCostForSupplier(orderItems, offerByProduct)
}

export async function recordSupplierPurchase(input: RecordSupplierPurchaseInput): Promise<Result<RecordSupplierPurchaseResult, string>> {
  const supabase = createServiceSupabase()

  const { data: fulfilment } = await supabase
    .from('fulfilments')
    .select('id, org_id, order_id, supplier_id, status')
    .eq('id', input.fulfilmentId)
    .eq('org_id', input.orgId) // Tenant isolation — never trust the id alone.
    .maybeSingle()

  if (!fulfilment) return err(`Fulfilment ${input.fulfilmentId} was not found for this organisation.`)
  if (!fulfilment.supplier_id) return err('This fulfilment has no supplier assigned; it cannot be marked purchased.')

  const transition = planFulfilmentTransition({
    from: fulfilment.status,
    to: 'submitted',
    reason: `Purchase recorded manually: ${input.supplierReference}.`,
  })
  if (!transition.ok) return err(transition.error)

  const estimatedCostMinor = await estimateCurrentCost(supabase, input.orgId, input.fulfilmentId, fulfilment.supplier_id)
  const variance = calculatePurchaseVariance({ estimatedCostMinor, actualCostMinor: input.costMinor + input.shippingCostMinor })

  await supabase
    .from('fulfilments')
    .update({
      status: transition.value.to,
      cost_minor: input.costMinor,
      shipping_cost_minor: input.shippingCostMinor,
      currency: input.currency,
      supplier_reference: input.supplierReference,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', fulfilment.id)

  await supabase.from('fulfilment_status_transitions').insert({
    org_id: input.orgId,
    fulfilment_id: fulfilment.id,
    from_status: transition.value.from,
    to_status: transition.value.to,
    reason: transition.value.reason,
    actor_type: 'user',
  })

  await recordAudit({
    orgId: input.orgId,
    action: 'FULFILMENT_SUBMITTED',
    entityType: 'fulfilment',
    entityId: fulfilment.id,
    actorType: 'user',
    newValue: { costMinor: input.costMinor, shippingCostMinor: input.shippingCostMinor, supplierReference: input.supplierReference, variance },
    reason: transition.value.reason,
    result: 'success',
  })

  // Recompute the parent order's real cost fields from every one of its
  // fulfilments' actual costs — "populated as real costs land," per the
  // orders table's own schema comment.
  const { data: allFulfilments } = await supabase.from('fulfilments').select('cost_minor, shipping_cost_minor').eq('order_id', fulfilment.order_id)
  const cogsMinor = (allFulfilments ?? []).reduce((sum, f) => sum + f.cost_minor, 0)
  const supplierShippingMinor = (allFulfilments ?? []).reduce((sum, f) => sum + f.shipping_cost_minor, 0)
  await supabase.from('orders').update({ cogs_minor: cogsMinor, supplier_shipping_minor: supplierShippingMinor }).eq('id', fulfilment.order_id)

  return ok({ fulfilmentId: fulfilment.id, orderId: fulfilment.order_id, status: transition.value.to, variance })
}
