import type { SupplierShippingQuote } from './connectors/types'

/**
 * Deterministic shipping suitability (Milestone: real supplier connector,
 * Phase 8; wired into publication eligibility and given a freshness
 * concept in Phase 9).
 *
 * Answers a genuinely different question from `readShipping`'s existing
 * coarse dispatch/delivery-day range: "can this specific supplier
 * realistically deliver THIS product to THIS destination, and is that
 * fast enough for this business?" Reuses `business_settings.max_delivery_days`
 * (an existing column, configured in Settings since Milestone 1, never
 * previously wired into a live decision until this feature) rather than
 * inventing a second delivery-time limit.
 *
 * A fixed ladder, like every other scoring engine in this codebase: no
 * quote at all is `review_required` (never a guessed rejection — the
 * supplier may well ship there, this check simply couldn't confirm it),
 * a stale quote is `review_required` regardless of what it once said
 * (a supplier's shipping situation can change — an old "approved" is no
 * more trustworthy than an old "rejected"), a quote with no known
 * delivery estimate is likewise `review_required`, and only a *known*,
 * *fresh*, *too-slow* estimate is ever `rejected`.
 */

export type ShippingSuitabilityStatus = 'approved' | 'review_required' | 'rejected'

/**
 * How long a fetched shipping quote is trusted before it must be
 * re-checked. Not a `business_settings` column: this is a technical
 * "how current is current" default, not a business policy an operator
 * would reasonably want to tune per-org, and the brief's own instruction
 * is to add "the smallest possible mechanism" — a documented constant,
 * not a fifth settings field. Fourteen days is deliberately conservative
 * for freight pricing/transit times, which do not meaningfully change
 * hour to hour but genuinely can over a couple of weeks.
 */
export const SHIPPING_QUOTE_MAX_AGE_DAYS = 14

export interface ShippingPolicyInput {
  destinationCountry: string
  quotes: readonly SupplierShippingQuote[]
  maxDeliveryDays: number
  /** When these quotes were fetched, ISO timestamp — `null` when there are no quotes to date them. */
  quotedAt: string | null
  /** Injectable for tests; defaults to the real current time. */
  now?: Date
}

export interface ShippingPolicyResult {
  status: ShippingSuitabilityStatus
  reason: string
  bestQuote: SupplierShippingQuote | null
}

export function assessShippingSuitability(input: ShippingPolicyInput): ShippingPolicyResult {
  if (input.quotes.length === 0 || !input.quotedAt) {
    return {
      status: 'review_required',
      reason: `No shipping quote has been fetched for ${input.destinationCountry} yet — cannot confirm this supplier can deliver here without checking.`,
      bestQuote: null,
    }
  }

  const now = input.now ?? new Date()
  const ageDays = (now.getTime() - new Date(input.quotedAt).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays > SHIPPING_QUOTE_MAX_AGE_DAYS) {
    return {
      status: 'review_required',
      reason: `The shipping quote for ${input.destinationCountry} is ${Math.floor(ageDays)} days old, past the ${SHIPPING_QUOTE_MAX_AGE_DAYS}-day freshness limit — refresh it before relying on it.`,
      bestQuote: input.quotes[0] ?? null,
    }
  }

  const withKnownEstimate = input.quotes.filter((q) => q.totalDeliveryDaysMax !== null)
  if (withKnownEstimate.length === 0) {
    return {
      status: 'review_required',
      reason: `${input.quotes.length} shipping option${input.quotes.length === 1 ? '' : 's'} to ${input.destinationCountry} exist, but none reports a delivery-time estimate.`,
      bestQuote: input.quotes[0],
    }
  }

  const fastest = withKnownEstimate.reduce((best, q) => ((q.totalDeliveryDaysMax as number) < (best.totalDeliveryDaysMax as number) ? q : best))

  if ((fastest.totalDeliveryDaysMax as number) > input.maxDeliveryDays) {
    return {
      status: 'rejected',
      reason: `The fastest available shipping to ${input.destinationCountry} (${fastest.method}, up to ${fastest.totalDeliveryDaysMax} days) exceeds the configured maximum of ${input.maxDeliveryDays} days.`,
      bestQuote: fastest,
    }
  }

  return {
    status: 'approved',
    reason: `${fastest.method} can reach ${input.destinationCountry} in up to ${fastest.totalDeliveryDaysMax} day${fastest.totalDeliveryDaysMax === 1 ? '' : 's'}, within the ${input.maxDeliveryDays}-day limit.`,
    bestQuote: fastest,
  }
}
