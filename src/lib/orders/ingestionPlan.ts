import { planOrderIngestion, MARKETPLACE_TO_ORDER_STATUS, type ExistingOrderRecord } from './ingestion'
import { resolveLineItems, type SkuLookup, type ResolvedLineItem } from './lineItemResolution'
import { planOrderTransition, type OrderStatus } from './lifecycle'
import type { ChannelKey } from '@/lib/core/domain'
import type { MarketplaceOrderSnapshot } from '@/lib/marketplaces/connectors/types'

/**
 * The pure planning layer for order ingestion — split out of `ingestionRun.ts`
 * (which has `import 'server-only'` and so can never be imported into
 * Vitest, matching every other server-only orchestrator in this codebase:
 * `advertising/syncPlan.ts`/`sync.ts`, `monitoring/monitorPlan.ts`/`monitor.ts`,
 * `advertising/verificationCheck.ts`/`verification.ts` all follow the same
 * split). This file decides exactly what write(s) an incoming marketplace
 * order requires; `ingestionRun.ts` is a thin executor of whatever plan
 * comes back — no Supabase import here, no I/O, fully deterministic.
 */

export interface OrderInsertPlan {
  orderNumber: string
  channel: ChannelKey
  externalId: string
  status: OrderStatus
  subtotalMinor: number
  totalMinor: number
  currency: string
  placedAt: string
  idempotencyKey: string
}

export interface OrderItemInsertPlan {
  productId: string
  variantId: string
  sku: string
  description: string
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number
}

export type OrderWritePlan =
  | {
      kind: 'create'
      order: OrderInsertPlan
      items: readonly OrderItemInsertPlan[]
      reason: string
    }
  | {
      kind: 'status_changed'
      orderId: string
      from: OrderStatus
      to: OrderStatus
      reason: string
    }
  | {
      kind: 'status_change_blocked'
      orderId: string
      externalId: string
      attemptedFrom: OrderStatus
      attemptedTo: OrderStatus
      blockedReason: string
    }
  | {
      kind: 'rejected'
      externalId: string
      reason: string
      unresolvedSkus: readonly (string | null)[]
    }
  | { kind: 'already_ingested'; orderId: string | null }

function toItemInsertPlans(resolved: readonly ResolvedLineItem[]): OrderItemInsertPlan[] {
  return resolved.map((r) => ({
    productId: r.productId,
    variantId: r.variantId,
    sku: r.lineItem.sku ?? '',
    description: r.lineItem.sku ?? r.lineItem.externalId,
    quantity: r.lineItem.quantity,
    unitPriceMinor: r.lineItem.unitPriceMinor,
    lineTotalMinor: r.lineItem.unitPriceMinor * r.lineItem.quantity,
  }))
}

/**
 * The marketplace's own order id doubles as both `order_number` and
 * `external_id` — no connector fetches a separate human-facing order
 * number, and each channel's id scheme (Shopify GIDs, Amazon's
 * alphanumeric ids, eBay's dashed ids) is distinct enough that a
 * cross-channel collision on the org-wide `order_number` uniqueness
 * constraint is not a realistic concern.
 */
export function planOrderWrite(
  channel: ChannelKey,
  snapshot: MarketplaceOrderSnapshot,
  existing: ExistingOrderRecord | null,
  lookup: SkuLookup,
): OrderWritePlan {
  const resolution = resolveLineItems(snapshot.lineItems, lookup)

  const decision = planOrderIngestion({
    channel,
    snapshot,
    existing,
    allLineItemsResolved: resolution.allLineItemsResolved,
    lineItemsTotalMinor: resolution.lineItemsTotalMinor,
  })

  if (decision.outcome === 'rejected') {
    return { kind: 'rejected', externalId: snapshot.externalId, reason: decision.reason, unresolvedSkus: resolution.unresolved.map((u) => u.lineItem.sku) }
  }

  if (decision.outcome === 'already_ingested') {
    return { kind: 'already_ingested', orderId: existing?.id ?? null }
  }

  if (decision.outcome === 'status_changed' && existing && decision.suggestedStatusChange) {
    const transition = planOrderTransition({ from: decision.suggestedStatusChange.from, to: decision.suggestedStatusChange.to, reason: decision.reason })
    if (!transition.ok) {
      return {
        kind: 'status_change_blocked',
        orderId: existing.id,
        externalId: snapshot.externalId,
        attemptedFrom: decision.suggestedStatusChange.from,
        attemptedTo: decision.suggestedStatusChange.to,
        blockedReason: transition.error,
      }
    }
    return { kind: 'status_changed', orderId: existing.id, from: transition.value.from, to: transition.value.to, reason: transition.value.reason }
  }

  // outcome === 'create'
  const initialStatus = MARKETPLACE_TO_ORDER_STATUS[snapshot.status]
  return {
    kind: 'create',
    order: {
      orderNumber: snapshot.externalId,
      channel,
      externalId: snapshot.externalId,
      status: initialStatus,
      subtotalMinor: snapshot.totalMinor,
      totalMinor: snapshot.totalMinor,
      currency: snapshot.currency,
      placedAt: snapshot.placedAt,
      idempotencyKey: `order:${channel}:${snapshot.externalId}`,
    },
    items: toItemInsertPlans(resolution.resolved),
    reason: decision.reason,
  }
}
