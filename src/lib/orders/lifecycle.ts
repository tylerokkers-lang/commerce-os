import { err, ok, type Result } from '@/lib/core/result'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The order status state machine (Milestone 5).
 *
 * `order_status` already exists as a database enum from Milestone 1
 * (`pending, paid, awaiting_fulfilment, partially_fulfilled, fulfilled,
 * delivered, cancelled, refunded, partially_refunded, failed`). This file is
 * the transition rules that were always implied by that enum but never
 * written down — mirroring `products/lifecycle.ts` and
 * `marketplaces/listingLifecycle.ts` exactly: an `ALLOWED` map, a
 * `planTransition` that refuses anything not on it, and every transition
 * carrying a reason for `order_status_transitions`, which is append-only.
 */

export type OrderStatus = Enums<'order_status'>

const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  // Ingested from the marketplace, payment not yet confirmed.
  pending: ['paid', 'cancelled', 'failed'],

  // Paid. Waiting for fulfilment to begin.
  paid: ['awaiting_fulfilment', 'cancelled', 'refunded'],

  awaiting_fulfilment: ['partially_fulfilled', 'fulfilled', 'cancelled', 'failed'],

  // Some, not all, line items have shipped.
  partially_fulfilled: ['fulfilled', 'partially_refunded', 'refunded', 'cancelled'],

  fulfilled: ['delivered', 'partially_refunded', 'refunded'],

  // Confirmed received by the customer. Can still be returned.
  delivered: ['partially_refunded', 'refunded'],

  // Terminal: no payment was taken, or the order never proceeded.
  cancelled: [],

  // Terminal: every penny returned.
  refunded: [],

  // Not terminal: further partial refunds remain possible until fully refunded.
  partially_refunded: ['refunded'],

  // Terminal: something about the order itself could not be processed
  // (a genuinely invalid line item, an unrecoverable validation failure).
  failed: [],
}

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['cancelled', 'refunded', 'failed']

export const isTerminal = (status: OrderStatus): boolean => TERMINAL_STATUSES.includes(status)
export const nextStatuses = (from: OrderStatus): readonly OrderStatus[] => ALLOWED[from]

export interface OrderTransitionRequest {
  from: OrderStatus
  to: OrderStatus
  reason: string
}

export interface OrderTransition {
  from: OrderStatus
  to: OrderStatus
  reason: string
}

export function planOrderTransition(request: OrderTransitionRequest): Result<OrderTransition, string> {
  const { from, to, reason } = request

  if (from === to) {
    return err(`The order is already at "${to}".`)
  }
  if (isTerminal(from)) {
    return err(`"${from}" is terminal. This order's status history cannot be reopened.`)
  }
  if (!reason || reason.trim().length < 8) {
    return err('An order status change needs a reason of at least 8 characters for the audit trail.')
  }
  if (!ALLOWED[from].includes(to)) {
    const permitted = ALLOWED[from]
    return err(
      permitted.length === 0
        ? `Nothing may follow "${from}".`
        : `"${from}" cannot move to "${to}". Permitted next statuses: ${permitted.join(', ')}.`,
    )
  }

  return ok({ from, to, reason: reason.trim() })
}

/**
 * Whether an order can still be cancelled from its current status.
 *
 * Separate from `planOrderTransition` because cancellation eligibility is a
 * question asked constantly (to decide whether to show a "cancel" action at
 * all) whereas a transition plan is only built at the moment of acting.
 */
export const canCancel = (status: OrderStatus): boolean => ALLOWED[status].includes('cancelled')
