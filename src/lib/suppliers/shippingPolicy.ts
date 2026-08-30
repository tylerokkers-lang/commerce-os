import type { SupplierShippingQuote } from './connectors/types'

/**
 * Deterministic shipping suitability (Milestone: real supplier connector,
 * Phase 8).
 *
 * Answers a genuinely different question from `readShipping`'s existing
 * coarse dispatch/delivery-day range: "can this specific supplier
 * realistically deliver THIS product to THIS destination, and is that
 * fast enough for this business?" Reuses `business_settings.max_delivery_days`
 * (an existing column, configured in Settings since Milestone 1, never
 * previously wired into a live decision — see `HANDOVER.md`) rather than
 * inventing a second delivery-time limit.
 *
 * A fixed ladder, like every other scoring engine in this codebase: no
 * quote at all is `review_required` (never a guessed rejection — the
 * supplier may well ship there, this check simply couldn't confirm it),
 * a quote with no known delivery estimate is likewise `review_required`,
 * and only a *known*, *too-slow* estimate is ever `rejected`.
 */

export type ShippingSuitabilityStatus = 'approved' | 'review_required' | 'rejected'

export interface ShippingPolicyInput {
  destinationCountry: string
  quotes: readonly SupplierShippingQuote[]
  maxDeliveryDays: number
}

export interface ShippingPolicyResult {
  status: ShippingSuitabilityStatus
  reason: string
  bestQuote: SupplierShippingQuote | null
}

export function assessShippingSuitability(input: ShippingPolicyInput): ShippingPolicyResult {
  if (input.quotes.length === 0) {
    return {
      status: 'review_required',
      reason: `No shipping quote was returned for ${input.destinationCountry} — cannot confirm this supplier can deliver here without a manual check.`,
      bestQuote: null,
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
