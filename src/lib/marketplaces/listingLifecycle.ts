import { err, ok, type Result } from '@/lib/core/result'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The marketplace listing workflow (Milestone 4).
 *
 * Distinct from, and beneath, the product lifecycle in
 * `src/lib/products/lifecycle.ts`. A product reaching `approved` there means
 * it has cleared the supplier, compliance and profitability gates in
 * principle; this state machine tracks the specific, per-channel path from
 * that point through to an actual live listing, exactly mirroring the
 * structure of `products/lifecycle.ts` (an `ALLOWED` transition map, a
 * `planTransition` that refuses anything not on it, and gates that explain a
 * refusal in terms of what is missing).
 */

export type ListingState = Enums<'marketplace_listing_state'>

const ALLOWED: Record<ListingState, readonly ListingState[]> = {
  // Surfaced as a candidate listing for this channel.
  discovered: ['evaluating', 'blocked'],

  // Being run through the publication gate.
  evaluating: ['approved', 'blocked', 'discovered'],

  // Cleared every publication requirement. Not yet prepared for listing.
  approved: ['ready_to_list', 'blocked', 'evaluating'],

  // Listing content prepared. Waiting on either approval or auto-publish.
  ready_to_list: ['pending_approval', 'published', 'blocked'],

  // Sitting in the approval queue.
  pending_approval: ['published', 'blocked', 'ready_to_list'],

  // Live on the marketplace.
  published: ['paused', 'ended', 'blocked'],

  // Reversible. Stops without losing the listing's history.
  paused: ['published', 'ended', 'blocked'],

  // Terminal: a listing that was live and has been deliberately withdrawn.
  ended: [],

  // Terminal from any non-terminal state: a listing that must not proceed.
  // Not marked reversible from here because a block always has a specific,
  // recorded reason (a compliance failure, a policy violation) that has to be
  // resolved by returning to `evaluating` deliberately, not by an automatic
  // bounce-back.
  blocked: ['evaluating'],
}

export const TERMINAL_STATES: readonly ListingState[] = ['ended']

export const isTerminal = (state: ListingState): boolean => TERMINAL_STATES.includes(state)
export const nextStates = (from: ListingState): readonly ListingState[] => ALLOWED[from]

export interface ListingTransitionRequest {
  from: ListingState
  to: ListingState
  reason: string
}

export interface ListingTransition {
  from: ListingState
  to: ListingState
  reason: string
}

/**
 * Validates a listing workflow transition. Returns a `Result`: a refused
 * transition is a normal outcome to surface, not an exception.
 */
export function planListingTransition(request: ListingTransitionRequest): Result<ListingTransition, string> {
  const { from, to, reason } = request

  if (from === to) {
    return err(`The listing is already at "${to}".`)
  }
  if (from === 'ended') {
    return err(`"ended" is terminal. Create a new listing rather than reviving this one.`)
  }
  if (!reason || reason.trim().length < 8) {
    return err('A listing state change needs a reason of at least 8 characters for the audit trail.')
  }
  if (!ALLOWED[from].includes(to)) {
    const permitted = ALLOWED[from]
    return err(
      permitted.length === 0
        ? `Nothing may follow "${from}".`
        : `"${from}" cannot move to "${to}". Permitted next states: ${permitted.join(', ')}.`,
    )
  }

  return ok({ from, to, reason: reason.trim() })
}
