import 'server-only'

import { demoOrderScenarios } from '@/lib/demo/orders'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'
import type { ChannelKey } from '@/lib/core/domain'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * Order orchestration reads.
 *
 * Live mode has no order data source yet — no order has ever actually been
 * ingested from a real marketplace, since no live connector exists (§11 of
 * `docs/MILESTONES.md`'s Milestone 4 section). Returning an empty list in
 * live mode is the honest answer, matching the pattern every prior
 * milestone's repository follows.
 */
export async function getOrderScenarios() {
  const session = await requireSession()
  if (!session.isDemo) return []
  return demoOrderScenarios()
}

export type PurchaseQueueStatus = Extract<Enums<'fulfilment_status'>, 'awaiting_supplier' | 'submitted' | 'shipped'>

export interface PurchaseQueueLineItem {
  sku: string
  description: string
  quantity: number
}

export interface PurchaseQueueItem {
  fulfilmentId: string
  orderId: string
  orderNumber: string
  channel: ChannelKey
  placedAt: string
  status: PurchaseQueueStatus
  supplierId: string | null
  supplierName: string | null
  supplierReference: string | null
  costMinor: number
  shippingCostMinor: number
  currency: string
  lineItems: readonly PurchaseQueueLineItem[]
}

/**
 * The operator's AWAITING_PURCHASE queue — every fulfilment that needs a
 * human to buy the goods, has been bought and needs its tracking recorded,
 * or has been shipped and is awaiting delivery confirmation. Genuinely real
 * data only: no demo fixture exists for this (§49/§52 of HANDOVER.md), since
 * fabricating a "you bought this" queue in demo mode would misrepresent the
 * one workflow this project is most careful never to automate or invent.
 * Demo mode honestly returns empty; the page explains why.
 */
export async function getPurchaseQueue(): Promise<readonly PurchaseQueueItem[]> {
  const session = await requireSession()
  if (session.isDemo) return []

  const supabase = await createServerSupabase()
  const { data: fulfilments } = await supabase
    .from('fulfilments')
    .select('id, order_id, status, supplier_id, cost_minor, shipping_cost_minor, currency, supplier_reference, orders(order_number, channel, placed_at), suppliers(name)')
    .eq('org_id', session.orgId)
    .in('status', ['awaiting_supplier', 'submitted', 'shipped'])
    .order('created_at', { ascending: true })

  if (!fulfilments || fulfilments.length === 0) return []

  const fulfilmentIds = fulfilments.map((f) => f.id)
  const { data: fulfilmentItems } = await supabase
    .from('fulfilment_items')
    .select('fulfilment_id, quantity, order_items(sku, description)')
    .in('fulfilment_id', fulfilmentIds)

  const lineItemsByFulfilment = new Map<string, PurchaseQueueLineItem[]>()
  for (const item of fulfilmentItems ?? []) {
    const orderItem = item.order_items as unknown as { sku: string; description: string } | null
    if (!orderItem) continue
    const existing = lineItemsByFulfilment.get(item.fulfilment_id) ?? []
    existing.push({ sku: orderItem.sku, description: orderItem.description, quantity: item.quantity })
    lineItemsByFulfilment.set(item.fulfilment_id, existing)
  }

  return fulfilments.map((f) => {
    const order = f.orders as unknown as { order_number: string; channel: ChannelKey; placed_at: string } | null
    const supplier = f.suppliers as unknown as { name: string } | null
    return {
      fulfilmentId: f.id,
      orderId: f.order_id,
      orderNumber: order?.order_number ?? 'Unknown order',
      channel: order?.channel ?? 'shopify',
      placedAt: order?.placed_at ?? f.id,
      status: f.status as PurchaseQueueStatus,
      supplierId: f.supplier_id,
      supplierName: supplier?.name ?? null,
      supplierReference: f.supplier_reference,
      costMinor: f.cost_minor,
      shippingCostMinor: f.shipping_cost_minor,
      currency: f.currency,
      lineItems: lineItemsByFulfilment.get(f.id) ?? [],
    }
  })
}
