import { validateOrder, type ValidationResult } from './validation'
import type { MarketplaceOrderSnapshot } from '@/lib/marketplaces/connectors/types'
import type { ChannelKey } from '@/lib/core/domain'
import type { OrderStatus } from './lifecycle'

/**
 * Order ingestion (Milestone 5).
 *
 * Turns a `MarketplaceOrderSnapshot` (Milestone 4's read-only connector
 * output) into a decision: create a new order, do nothing because we already
 * have it, or flag that the marketplace has moved the order to a status we
 * have not caught up with yet. This is also where a duplicate webhook
 * delivery and a genuine re-ingestion during a scheduled sync produce the
 * same, correct, idempotent answer — both call this with the same snapshot,
 * and both get `already_ingested` once the order exists.
 *
 * `orders` already enforces `unique (org_id, channel, external_id)`
 * (Milestone 1), which is the actual guarantee against a duplicate row. This
 * module is the decision logic in front of that constraint, in the same
 * relationship `decideWebhookIngest` has to `channel_webhook_events`'s unique
 * constraint.
 */

export type IngestionOutcome = 'create' | 'already_ingested' | 'status_changed' | 'rejected'

export interface ExistingOrderRecord {
  id: string
  status: OrderStatus
}

export interface IngestionDecision {
  outcome: IngestionOutcome
  reason: string
  validation: ValidationResult
  /** Present only for `status_changed`: what our record should move to. */
  suggestedStatusChange: { from: OrderStatus; to: OrderStatus } | null
}

/** Exported so a real write path (`orders/ingestionRun.ts`) can compute the initial `orders.status` value on `create` without duplicating this mapping. */
export const MARKETPLACE_TO_ORDER_STATUS: Record<MarketplaceOrderSnapshot['status'], OrderStatus> = {
  pending: 'pending',
  paid: 'paid',
  fulfilled: 'fulfilled',
  cancelled: 'cancelled',
  refunded: 'refunded',
}

export interface IngestOrderInput {
  channel: ChannelKey
  snapshot: MarketplaceOrderSnapshot
  existing: ExistingOrderRecord | null
  /** Whether every line item in the snapshot resolved to a known SKU. */
  allLineItemsResolved: boolean
  lineItemsTotalMinor: number | null
}

export function planOrderIngestion(input: IngestOrderInput): IngestionDecision {
  const validation = validateOrder({
    externalId: input.snapshot.externalId,
    totalMinor: input.snapshot.totalMinor,
    currency: input.snapshot.currency,
    lineItemCount: input.snapshot.lineItems.length,
    allLineItemsResolved: input.allLineItemsResolved,
    lineItemsTotalMinor: input.lineItemsTotalMinor,
  })

  if (!validation.valid) {
    return {
      outcome: 'rejected',
      reason: `Order ${input.snapshot.externalId} failed validation: ${validation.issues
        .filter((i) => i.severity === 'fatal')
        .map((i) => i.message)
        .join(' ')}`,
      validation,
      suggestedStatusChange: null,
    }
  }

  if (!input.existing) {
    return {
      outcome: 'create',
      reason: `New order from ${input.channel}: ${input.snapshot.externalId}.`,
      validation,
      suggestedStatusChange: null,
    }
  }

  const marketplaceStatus = MARKETPLACE_TO_ORDER_STATUS[input.snapshot.status]
  if (marketplaceStatus === input.existing.status) {
    return {
      outcome: 'already_ingested',
      reason: `Order ${input.snapshot.externalId} is already recorded at status "${input.existing.status}"; nothing to do.`,
      validation,
      suggestedStatusChange: null,
    }
  }

  return {
    outcome: 'status_changed',
    reason: `Order ${input.snapshot.externalId} moved from "${input.existing.status}" to "${marketplaceStatus}" on the marketplace since we last recorded it.`,
    validation,
    suggestedStatusChange: { from: input.existing.status, to: marketplaceStatus },
  }
}
