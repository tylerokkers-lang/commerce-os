import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications/create'
import { planPurchaseWorkflow, type OrderItemForPlanning } from './purchasePlan'
import type { SupplierProductOffer } from './supplierResolution'
import type { OrderStatus } from './lifecycle'
import type { CurrencyCode } from '@/lib/core/money'
import type { ChannelKey } from '@/lib/core/domain'

/**
 * The AWAITING_PURCHASE step. Runs only after `ingestionRun.ts` has written
 * a real `orders` row — this file never fetches from a marketplace itself.
 * All deciding happens in `purchasePlan.ts`'s pure `planPurchaseWorkflow`
 * (same `syncPlan.ts`/`sync.ts` split `ingestionPlan.ts`/`ingestionRun.ts`
 * already follows) — this file only fetches what the plan needs and
 * executes whatever plan comes back.
 *
 * SAFETY: this is the one file in this milestone that decides what happens
 * after an order exists, and it is deliberately narrow. The only things it
 * ever does are: (1) a read-only, in-memory computation of which supplier
 * *would* fulfil the order, from `supplier_products`/`suppliers` rows
 * already in Postgres — no network call to any supplier; (2) create a
 * `fulfilments` row in `'awaiting_supplier'` status plus its
 * `fulfilment_items`/`fulfilment_status_transitions`/audit rows — internal
 * bookkeeping only; (3) one `createNotification` call. It never calls
 * `fulfilment/submission.ts`'s `assessFulfilmentSubmission` — that module's
 * automation-level auto-submit path is exactly what must never trigger a
 * purchase here, regardless of the org's configured automation level. A
 * fulfilment only ever leaves `'awaiting_supplier'` via `manualPurchase.ts`'s
 * `recordSupplierPurchase`, called from an explicit, session-authenticated
 * API route — never from this file, never automatically.
 */

export interface PurchaseWorkflowResult {
  ordersChecked: number
  fulfilmentsCreated: number
  ordersWithNoSupplierAvailable: number
  errors: string[]
}

interface OrderRow {
  id: string
  org_id: string
  channel: ChannelKey
  external_id: string | null
  status: OrderStatus
}

async function loadOffersByProduct(
  supabase: ReturnType<typeof createServiceSupabase>,
  orgId: string,
  productIds: readonly string[],
  channel: ChannelKey,
): Promise<Map<string, SupplierProductOffer[]>> {
  const map = new Map<string, SupplierProductOffer[]>()
  if (productIds.length === 0) return map

  const { data } = await supabase
    .from('supplier_products')
    .select(
      `product_id, supplier_id, unit_cost_minor, shipping_cost_minor, currency,
       suppliers(name, shopify_status, amazon_status, provides_tracking, handles_returns,
       supports_blind_shipping, supports_custom_invoice, supports_custom_packaging,
       typical_delivery_days_min, typical_delivery_days_max)`,
    )
    .eq('org_id', orgId)
    .in('product_id', productIds)

  for (const row of data ?? []) {
    const supplier = Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers
    if (!supplier) continue
    const approvalStatus = channel === 'amazon_uk' ? supplier.amazon_status : supplier.shopify_status
    const offer: SupplierProductOffer = {
      supplierId: row.supplier_id,
      supplierName: supplier.name,
      unitCostMinor: row.unit_cost_minor,
      shippingCostMinor: row.shipping_cost_minor,
      currency: row.currency as CurrencyCode,
      channelApprovalStatus: approvalStatus,
      deliveryDaysMin: supplier.typical_delivery_days_min,
      deliveryDaysMax: supplier.typical_delivery_days_max,
      providesTracking: supplier.provides_tracking,
      handlesReturns: supplier.handles_returns,
      supportsBlindShipping: supplier.supports_blind_shipping,
      supportsCustomInvoice: supplier.supports_custom_invoice,
      supportsCustomPackaging: supplier.supports_custom_packaging,
    }
    const existing = map.get(row.product_id)
    if (existing) existing.push(offer)
    else map.set(row.product_id, [offer])
  }

  return map
}

async function processOneOrder(supabase: ReturnType<typeof createServiceSupabase>, order: OrderRow): Promise<'fulfilment_created' | 'no_supplier'> {
  const { data: items } = await supabase.from('order_items').select('id, product_id, quantity').eq('order_id', order.id)
  const orderItems: OrderItemForPlanning[] = (items ?? []).map((i) => ({ id: i.id, productId: i.product_id, quantity: i.quantity }))

  const productIds = [...new Set(orderItems.map((i) => i.productId).filter((id): id is string => id !== null))]
  const offersByProduct = await loadOffersByProduct(supabase, order.org_id, productIds, order.channel)

  const plan = planPurchaseWorkflow(orderItems, offersByProduct, order.status)

  if (plan.kind === 'no_supplier_available') {
    await recordAudit({
      orgId: order.org_id,
      action: 'ORDER_STATUS_CHANGE_BLOCKED',
      entityType: 'order',
      entityId: order.id,
      actorType: 'system',
      reason: 'No approved or available supplier could be resolved for any line item on this order.',
      result: 'blocked',
    })
    await createNotification({
      orgId: order.org_id,
      severity: 'warning',
      category: 'purchase_workflow',
      title: `Order ${order.external_id ?? order.id} has no supplier available`,
      body: 'None of this order\'s line items could be matched to an available supplier. Add or approve a supplier for these products to proceed.',
      entityType: 'order',
      entityId: order.id,
      dedupeKey: `no-supplier:${order.org_id}:${order.id}`,
    })
    return 'no_supplier'
  }

  for (const group of plan.groups) {
    const idempotencyKey = `fulfilment:${order.id}:${group.supplierId}`
    const { data: existingFulfilment } = await supabase
      .from('fulfilments')
      .select('id')
      .eq('org_id', order.org_id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    if (existingFulfilment) continue

    const { data: fulfilment, error } = await supabase
      .from('fulfilments')
      .insert({
        org_id: order.org_id,
        order_id: order.id,
        supplier_id: group.supplierId,
        status: 'awaiting_supplier',
        cost_minor: 0, // Real cost is unknown until you actually purchase — see manualPurchase.ts.
        shipping_cost_minor: 0,
        currency: group.currency,
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') continue // Raced with another run; the existing row already covers this.
      throw new Error(`Could not create fulfilment for order ${order.id}: ${error.message}`)
    }

    await supabase
      .from('fulfilment_items')
      .insert(group.orderItemIds.map((orderItemId) => ({ org_id: order.org_id, fulfilment_id: fulfilment.id, order_item_id: orderItemId, quantity: 1 })))

    await supabase.from('fulfilment_status_transitions').insert({
      org_id: order.org_id,
      fulfilment_id: fulfilment.id,
      from_status: null,
      to_status: 'awaiting_supplier',
      reason: `Supplier resolved for order ${order.external_id ?? order.id}; awaiting manual purchase.`,
      actor_type: 'system',
    })

    await recordAudit({
      orgId: order.org_id,
      action: 'SUPPLIER_ORDER_CREATED',
      entityType: 'fulfilment',
      entityId: fulfilment.id,
      actorType: 'system',
      newValue: { orderId: order.id, supplierId: group.supplierId, estimatedCostMinor: group.estimatedCostMinor, status: 'awaiting_supplier' },
      reason: `Estimated cost ${group.estimatedCostMinor} minor units across ${group.orderItemIds.length} line item(s). Awaiting manual purchase — never placed automatically.`,
      result: 'success',
    })
  }

  if (plan.orderTransition) {
    await supabase.from('orders').update({ status: plan.orderTransition.to }).eq('id', order.id)
    await supabase.from('order_status_transitions').insert({
      org_id: order.org_id,
      order_id: order.id,
      from_status: plan.orderTransition.from,
      to_status: plan.orderTransition.to,
      reason: plan.orderTransition.reason,
      actor_type: 'system',
    })
  }

  await createNotification({
    orgId: order.org_id,
    severity: 'approval_required',
    category: 'purchase_workflow',
    title: `Order ${order.external_id ?? order.id} is awaiting your purchase`,
    body: plan.anyLineItemUnresolved
      ? 'Some line items are ready for purchase; one or more others had no supplier available and need attention separately.'
      : 'A supplier has been identified. Purchase the goods yourself, then record the actual cost to complete this order.',
    entityType: 'order',
    entityId: order.id,
    actionUrl: '/orders',
    dedupeKey: `awaiting-purchase:${order.org_id}:${order.id}`,
  })

  return 'fulfilment_created'
}

export async function runPurchaseWorkflowForConnectedOrgs(): Promise<PurchaseWorkflowResult> {
  const supabase = createServiceSupabase()
  const result: PurchaseWorkflowResult = { ordersChecked: 0, fulfilmentsCreated: 0, ordersWithNoSupplierAvailable: 0, errors: [] }

  const { data: paidOrders } = await supabase.from('orders').select('id, org_id, channel, external_id, status').eq('status', 'paid')
  if (!paidOrders || paidOrders.length === 0) return result

  const orderIds = paidOrders.map((o) => o.id)
  const { data: existingFulfilments } = await supabase.from('fulfilments').select('order_id').in('order_id', orderIds)
  const alreadyHasFulfilment = new Set((existingFulfilments ?? []).map((f) => f.order_id))

  for (const order of paidOrders as OrderRow[]) {
    if (alreadyHasFulfilment.has(order.id)) continue
    result.ordersChecked++
    try {
      const outcome = await processOneOrder(supabase, order)
      if (outcome === 'fulfilment_created') result.fulfilmentsCreated++
      else result.ordersWithNoSupplierAvailable++
    } catch (error) {
      result.errors.push(`${order.org_id}:${order.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return result
}
