import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { planFulfilmentTransition, allFulfilmentsComplete, type FulfilmentStatus } from '@/lib/fulfilment/lifecycle'
import { planOrderTransition } from './lifecycle'
import { err, ok, type Result } from '@/lib/core/result'

export interface RecordShipmentInput {
  orgId: string
  fulfilmentId: string
  carrier: string
  trackingNumber: string
  trackingUrl?: string | null
}

export interface RecordDeliveryInput {
  orgId: string
  fulfilmentId: string
}

interface FulfilmentActionResult {
  fulfilmentId: string
  orderId: string
  status: FulfilmentStatus
  orderCascadedToDelivered: boolean
}

async function loadFulfilment(supabase: ReturnType<typeof createServiceSupabase>, orgId: string, fulfilmentId: string) {
  const { data } = await supabase.from('fulfilments').select('id, org_id, order_id, status').eq('id', fulfilmentId).eq('org_id', orgId).maybeSingle()
  return data
}

export async function recordShipment(input: RecordShipmentInput): Promise<Result<FulfilmentActionResult, string>> {
  const supabase = createServiceSupabase()
  const fulfilment = await loadFulfilment(supabase, input.orgId, input.fulfilmentId)
  if (!fulfilment) return err(`Fulfilment ${input.fulfilmentId} was not found for this organisation.`)

  const transition = planFulfilmentTransition({ from: fulfilment.status, to: 'shipped', reason: `Shipped via ${input.carrier}, tracking ${input.trackingNumber}.` })
  if (!transition.ok) return err(transition.error)

  const now = new Date().toISOString()
  await supabase.from('fulfilments').update({ status: transition.value.to, shipped_at: now }).eq('id', fulfilment.id)

  await supabase.from('shipments').insert({
    org_id: input.orgId,
    fulfilment_id: fulfilment.id,
    carrier: input.carrier,
    tracking_number: input.trackingNumber,
    tracking_url: input.trackingUrl ?? null,
    shipped_at: now,
    last_status: 'shipped',
  })

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
    action: 'SHIPMENT_TRACKED',
    entityType: 'fulfilment',
    entityId: fulfilment.id,
    actorType: 'user',
    newValue: { carrier: input.carrier, trackingNumber: input.trackingNumber },
    reason: transition.value.reason,
    result: 'success',
  })

  return ok({ fulfilmentId: fulfilment.id, orderId: fulfilment.order_id, status: transition.value.to, orderCascadedToDelivered: false })
}

export async function recordDelivery(input: RecordDeliveryInput): Promise<Result<FulfilmentActionResult, string>> {
  const supabase = createServiceSupabase()
  const fulfilment = await loadFulfilment(supabase, input.orgId, input.fulfilmentId)
  if (!fulfilment) return err(`Fulfilment ${input.fulfilmentId} was not found for this organisation.`)

  const transition = planFulfilmentTransition({ from: fulfilment.status, to: 'delivered', reason: 'Delivery confirmed.' })
  if (!transition.ok) return err(transition.error)

  const now = new Date().toISOString()
  await supabase.from('fulfilments').update({ status: transition.value.to, delivered_at: now }).eq('id', fulfilment.id)
  await supabase.from('shipments').update({ delivered_at: now, last_status: 'delivered' }).eq('fulfilment_id', fulfilment.id)

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
    action: 'ORDER_FULFILLED',
    entityType: 'fulfilment',
    entityId: fulfilment.id,
    actorType: 'user',
    reason: transition.value.reason,
    result: 'success',
  })

  // Cascade the order to 'delivered' only once every one of its
  // fulfilments has genuinely reached a complete state — never assumed
  // from this one fulfilment alone.
  const { data: siblingFulfilments } = await supabase.from('fulfilments').select('status').eq('order_id', fulfilment.order_id)
  const statuses = (siblingFulfilments ?? []).map((f) => f.status as FulfilmentStatus)
  let orderCascadedToDelivered = false

  if (allFulfilmentsComplete(statuses)) {
    const { data: order } = await supabase.from('orders').select('status').eq('id', fulfilment.order_id).maybeSingle()
    if (order) {
      const orderTransition = planOrderTransition({ from: order.status, to: 'delivered', reason: 'Every fulfilment for this order has been delivered.' })
      if (orderTransition.ok) {
        await supabase.from('orders').update({ status: orderTransition.value.to }).eq('id', fulfilment.order_id)
        await supabase.from('order_status_transitions').insert({
          org_id: input.orgId,
          order_id: fulfilment.order_id,
          from_status: orderTransition.value.from,
          to_status: orderTransition.value.to,
          reason: orderTransition.value.reason,
          actor_type: 'system',
        })
        orderCascadedToDelivered = true
      }
    }
  }

  return ok({ fulfilmentId: fulfilment.id, orderId: fulfilment.order_id, status: transition.value.to, orderCascadedToDelivered })
}
