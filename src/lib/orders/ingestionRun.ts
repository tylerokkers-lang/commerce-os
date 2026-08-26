import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications/create'
import { connectorForChannel } from '@/lib/marketplaces/connectors/registry'
import { planOrderWrite } from './ingestionPlan'
import type { ExistingOrderRecord } from './ingestion'
import type { SkuLookup } from './lineItemResolution'
import type { OrderStatus } from './lifecycle'
import type { ChannelKey } from '@/lib/core/domain'

/**
 * The real order-ingestion write path — the piece `orders/pipeline.ts`'s own
 * doc comment always said "a caller with real connectors and real database
 * access executes it," but that caller never existed until now. Mirrors
 * `advertising/sync.ts`'s `runAdvertisingSyncForConnectedOrgs()` shape:
 * discover connected rows, iterate, collect errors per unit of work rather
 * than throwing, called from `automation/maintenance.ts` alongside the other
 * phases — no new cron route.
 *
 * All the deciding happens in `ingestionPlan.ts`'s `planOrderWrite` (pure,
 * fully unit-tested, mirrors the `syncPlan.ts`/`sync.ts` split already used
 * for advertising). This file only fetches what the plan needs and executes
 * whichever plan comes back — the select-then-insert-then-catch-23505
 * idempotency idiom `automation/actions.ts`'s `createAutomationAction`
 * already uses, applied here against `orders.idempotency_key`.
 *
 * Writes only `orders`/`order_items`/`order_status_transitions`. Never
 * touches `fulfilments` — supplier resolution and the AWAITING_PURCHASE
 * state are `purchaseWorkflow.ts`'s job, run as a distinct, separately
 * audited step so a read failure in one never masks a write failure in the
 * other.
 */

export interface OrderIngestionRunResult {
  channelsChecked: number
  ordersFetched: number
  created: number
  statusChanged: number
  statusChangeBlocked: number
  alreadyIngested: number
  rejected: number
  errors: string[]
  createdOrderIds: readonly string[]
}

async function buildSkuLookup(
  supabase: ReturnType<typeof createServiceSupabase>,
  orgId: string,
  skus: readonly string[],
): Promise<SkuLookup> {
  if (skus.length === 0) return new Map()
  const { data } = await supabase.from('product_variants').select('id, product_id, sku').eq('org_id', orgId).in('sku', skus)
  const lookup = new Map<string, { productId: string; variantId: string }>()
  for (const row of data ?? []) lookup.set(row.sku, { productId: row.product_id, variantId: row.id })
  return lookup
}

async function executePlan(
  supabase: ReturnType<typeof createServiceSupabase>,
  orgId: string,
  channel: ChannelKey,
  plan: ReturnType<typeof planOrderWrite>,
): Promise<{ kind: string; orderId: string | null }> {
  if (plan.kind === 'already_ingested') {
    return { kind: 'alreadyIngested', orderId: plan.orderId }
  }

  if (plan.kind === 'rejected') {
    await recordAudit({
      orgId,
      action: 'ORDER_INGESTION_REJECTED',
      entityType: 'order',
      entityId: plan.externalId,
      actorType: 'system',
      reason: plan.reason,
      result: 'blocked',
      metadata: { channel, unresolvedSkus: plan.unresolvedSkus },
    })
    await createNotification({
      orgId,
      severity: 'warning',
      category: 'order_ingestion',
      title: `Order ${plan.externalId} could not be ingested`,
      body: plan.reason,
      entityType: 'order',
      entityId: plan.externalId,
      dedupeKey: `order-rejected:${orgId}:${channel}:${plan.externalId}`,
    })
    return { kind: 'rejected', orderId: null }
  }

  if (plan.kind === 'status_change_blocked') {
    await recordAudit({
      orgId,
      action: 'ORDER_STATUS_CHANGE_BLOCKED',
      entityType: 'order',
      entityId: plan.orderId,
      actorType: 'system',
      reason: plan.blockedReason,
      result: 'blocked',
      metadata: { channel, externalId: plan.externalId, from: plan.attemptedFrom, to: plan.attemptedTo },
    })
    await createNotification({
      orgId,
      severity: 'warning',
      category: 'order_ingestion',
      title: `Order ${plan.externalId} status change needs review`,
      body: plan.blockedReason,
      entityType: 'order',
      entityId: plan.orderId,
      dedupeKey: `order-status-blocked:${orgId}:${plan.orderId}:${plan.attemptedTo}`,
    })
    return { kind: 'statusChangeBlocked', orderId: plan.orderId }
  }

  if (plan.kind === 'status_changed') {
    await supabase.from('orders').update({ status: plan.to }).eq('id', plan.orderId)
    await supabase.from('order_status_transitions').insert({
      org_id: orgId,
      order_id: plan.orderId,
      from_status: plan.from,
      to_status: plan.to,
      reason: plan.reason,
      actor_type: 'system',
    })
    await recordAudit({
      orgId,
      action: 'ORDER_UPDATED',
      entityType: 'order',
      entityId: plan.orderId,
      actorType: 'system',
      previousValue: { status: plan.from },
      newValue: { status: plan.to },
      reason: plan.reason,
      result: 'success',
    })
    return { kind: 'statusChanged', orderId: plan.orderId }
  }

  // plan.kind === 'create'
  const { data: byKey } = await supabase.from('orders').select('id').eq('org_id', orgId).eq('idempotency_key', plan.order.idempotencyKey).maybeSingle()
  if (byKey) return { kind: 'alreadyIngested', orderId: byKey.id }

  const { data: inserted, error } = await supabase
    .from('orders')
    .insert({
      org_id: orgId,
      order_number: plan.order.orderNumber,
      channel: plan.order.channel,
      external_id: plan.order.externalId,
      status: plan.order.status,
      subtotal_minor: plan.order.subtotalMinor,
      total_minor: plan.order.totalMinor,
      currency: plan.order.currency,
      placed_at: plan.order.placedAt,
      idempotency_key: plan.order.idempotencyKey,
      // risk_level intentionally left null — no connector populates
      // MarketplaceOrderSnapshot.riskLevel yet (see connectors/types.ts).
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: raced } = await supabase.from('orders').select('id').eq('org_id', orgId).eq('idempotency_key', plan.order.idempotencyKey).maybeSingle()
      if (raced) return { kind: 'alreadyIngested', orderId: raced.id }
    }
    throw new Error(`Could not create order ${plan.order.externalId}: ${error.message}`)
  }

  if (plan.items.length > 0) {
    await supabase.from('order_items').insert(
      plan.items.map((item) => ({
        org_id: orgId,
        order_id: inserted.id,
        product_id: item.productId,
        variant_id: item.variantId,
        sku: item.sku,
        description: item.description,
        quantity: item.quantity,
        unit_price_minor: item.unitPriceMinor,
        line_total_minor: item.lineTotalMinor,
      })),
    )
  }

  await supabase.from('order_status_transitions').insert({
    org_id: orgId,
    order_id: inserted.id,
    from_status: null,
    to_status: plan.order.status,
    reason: plan.reason,
    actor_type: 'system',
  })

  await recordAudit({
    orgId,
    action: 'ORDER_CREATED',
    entityType: 'order',
    entityId: inserted.id,
    actorType: 'system',
    newValue: { externalId: plan.order.externalId, channel, status: plan.order.status, totalMinor: plan.order.totalMinor },
    reason: plan.reason,
    result: 'success',
  })

  return { kind: 'created', orderId: inserted.id }
}

export async function runOrderIngestionForConnectedOrgs(): Promise<OrderIngestionRunResult> {
  const supabase = createServiceSupabase()
  const { data: channelRows } = await supabase.from('channels').select('org_id, key, connection_mode').eq('is_enabled', true).eq('is_connected', true)

  const result: OrderIngestionRunResult = {
    channelsChecked: 0,
    ordersFetched: 0,
    created: 0,
    statusChanged: 0,
    statusChangeBlocked: 0,
    alreadyIngested: 0,
    rejected: 0,
    errors: [],
    createdOrderIds: [],
  }
  const createdOrderIds: string[] = []

  for (const row of channelRows ?? []) {
    result.channelsChecked++
    const channel = row.key as ChannelKey
    try {
      const connector = connectorForChannel(channel as 'shopify' | 'amazon_uk' | 'ebay', row.connection_mode === 'demo')
      const fetched = await connector.fetchOrders({ limit: 50 })
      if (!fetched.ok) {
        result.errors.push(`${row.org_id}:${channel}: ${fetched.error}`)
        continue
      }
      result.ordersFetched += fetched.value.records.length

      const skus = [...new Set(fetched.value.records.flatMap((o) => o.lineItems.map((li) => li.sku).filter((s): s is string => s !== null)))]
      const lookup = await buildSkuLookup(supabase, row.org_id, skus)

      for (const snapshot of fetched.value.records) {
        const { data: existingRow } = await supabase
          .from('orders')
          .select('id, status')
          .eq('org_id', row.org_id)
          .eq('channel', channel)
          .eq('external_id', snapshot.externalId)
          .maybeSingle()
        const existing: ExistingOrderRecord | null = existingRow ? { id: existingRow.id, status: existingRow.status as OrderStatus } : null

        const plan = planOrderWrite(channel, snapshot, existing, lookup)
        const outcome = await executePlan(supabase, row.org_id, channel, plan)

        if (outcome.kind === 'created') result.created++
        else if (outcome.kind === 'statusChanged') result.statusChanged++
        else if (outcome.kind === 'statusChangeBlocked') result.statusChangeBlocked++
        else if (outcome.kind === 'alreadyIngested') result.alreadyIngested++
        else result.rejected++
        if (outcome.kind === 'created' && outcome.orderId) createdOrderIds.push(outcome.orderId)
      }
    } catch (error) {
      result.errors.push(`${row.org_id}:${channel}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { ...result, createdOrderIds }
}
