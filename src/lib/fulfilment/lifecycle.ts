import { err, ok, type Result } from '@/lib/core/result'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The fulfilment status state machine (Milestone 5).
 *
 * `fulfilment_status` already exists from Milestone 1 (`pending,
 * awaiting_supplier, submitted, accepted, shipped, delivered, failed,
 * cancelled`). This is the transition graph, following the same pattern as
 * `orders/lifecycle.ts`.
 *
 * `failed` is deliberately not terminal here, unlike a failed order: a
 * supplier rejecting a fulfilment is the exact trigger for the supplier
 * redundancy evaluator (`suppliers/redundancy.ts`) built in Milestone 3 — the
 * fulfilment can be retried against a different supplier without the order
 * itself failing.
 */

export type FulfilmentStatus = Enums<'fulfilment_status'>

const ALLOWED: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  pending: ['awaiting_supplier', 'cancelled'],

  awaiting_supplier: ['submitted', 'failed', 'cancelled'],

  // Sent to the supplier. Waiting on their acknowledgement.
  submitted: ['accepted', 'failed', 'cancelled'],

  // Supplier has accepted responsibility for the order.
  accepted: ['shipped', 'failed', 'cancelled'],

  shipped: ['delivered', 'failed'],

  delivered: [],

  // Not terminal: a rejected or failed fulfilment can be resubmitted, most
  // often against a different supplier chosen by the redundancy evaluator.
  failed: ['awaiting_supplier', 'cancelled'],

  cancelled: [],
}

export const TERMINAL_STATUSES: readonly FulfilmentStatus[] = ['delivered', 'cancelled']

export const isTerminal = (status: FulfilmentStatus): boolean => TERMINAL_STATUSES.includes(status)
export const nextStatuses = (from: FulfilmentStatus): readonly FulfilmentStatus[] => ALLOWED[from]

export interface FulfilmentTransitionRequest {
  from: FulfilmentStatus
  to: FulfilmentStatus
  reason: string
}

export interface FulfilmentTransition {
  from: FulfilmentStatus
  to: FulfilmentStatus
  reason: string
}

export function planFulfilmentTransition(
  request: FulfilmentTransitionRequest,
): Result<FulfilmentTransition, string> {
  const { from, to, reason } = request

  if (from === to) {
    return err(`The fulfilment is already at "${to}".`)
  }
  if (isTerminal(from)) {
    return err(`"${from}" is terminal for this fulfilment.`)
  }
  if (!reason || reason.trim().length < 8) {
    return err('A fulfilment status change needs a reason of at least 8 characters for the audit trail.')
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

/** Whether the order this fulfilment belongs to should now be considered fully fulfilled. */
export function allFulfilmentsComplete(statuses: readonly FulfilmentStatus[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status === 'delivered' || status === 'shipped')
}

/** Whether at least one, but not all, fulfilments for the order have progressed. */
export function isPartiallyFulfilled(statuses: readonly FulfilmentStatus[]): boolean {
  const advanced = statuses.filter((s) => s === 'shipped' || s === 'delivered').length
  return advanced > 0 && advanced < statuses.length
}
