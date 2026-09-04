import { calculateProfitability, type CostInputs } from '@/lib/profitability'
import { money, type CurrencyCode } from '@/lib/core/money'

/**
 * Recommended / minimum viable pricing (Milestone: product intelligence,
 * Phase 4).
 *
 * Deliberately not a second cost formula: this searches for the smallest
 * selling price at which the REAL, existing `calculateProfitability`
 * engine (`@/lib/profitability`) reports a net margin at or above a target
 * — the exact same formula every other margin figure in this codebase
 * already uses, run repeatedly rather than re-derived algebraically.
 * `calculateProfitability` is pure arithmetic on a handful of numbers, so
 * a bounded binary search over price is cheap and avoids the real risk of
 * a hand-rolled inverse formula silently drifting out of sync with the
 * real one.
 */

export interface PriceSearchResult {
  priceMinor: number | null
  /** True when even the search ceiling fails to clear the target margin — the product cannot be priced into profitability at any realistic price. */
  unreachable: boolean
}

const MAX_ITERATIONS = 40
const CEILING_MULTIPLIER = 50 // Search up to 50x the unit cost before giving up.

function findMinimumPriceForMargin(
  costs: Omit<CostInputs, 'sellingPrice' | 'adSpendPerUnit'>,
  currency: CurrencyCode,
  targetNetMarginPct: number,
  floorMinor: number,
  ceilingMinor: number,
  advertisingAllowancePct: number,
): PriceSearchResult {
  if (ceilingMinor <= floorMinor) return { priceMinor: null, unreachable: true }

  // Advertising is a percentage of the selling price (the same convention
  // `assemble.ts`'s profitability call already uses), so it cannot be fixed
  // in advance of the very price this search is solving for — found live
  // testing the real CJdropshipping pipeline: a fixed, zero ad-spend
  // assumption here previously let this search converge on a price that
  // then failed to hit its own target margin the moment the *separate*
  // profitability calculation (correctly) applied advertising to it.
  // Recomputing it fresh at every candidate price keeps the two
  // calculations self-consistent by construction.
  const meetsTarget = (priceMinor: number): boolean => {
    const adSpendPerUnit = money(Math.round((priceMinor * advertisingAllowancePct) / 100), currency)
    const result = calculateProfitability({ ...costs, sellingPrice: money(priceMinor, currency), adSpendPerUnit })
    return result.netProfit.minor > 0 && (result.netMarginPct ?? -Infinity) >= targetNetMarginPct
  }

  if (!meetsTarget(ceilingMinor)) return { priceMinor: null, unreachable: true }

  let low = floorMinor
  let high = ceilingMinor
  for (let i = 0; i < MAX_ITERATIONS && high - low > 1; i++) {
    const mid = Math.floor((low + high) / 2)
    if (meetsTarget(mid)) high = mid
    else low = mid
  }

  return { priceMinor: high, unreachable: false }
}

export interface PricingRecommendation {
  minimumViablePriceMinor: number | null
  minimumViableUnreachable: boolean
  recommendedPriceMinor: number | null
  recommendedUnreachable: boolean
  currency: CurrencyCode
  basis: string
}

/**
 * `costs` must not include `sellingPrice` or `adSpendPerUnit` — the price
 * is exactly what this function searches for, and advertising is derived
 * fresh from each candidate price via `advertisingAllowancePct` (the same
 * org-configured percentage `assemble.ts`'s profitability calculation
 * applies), never a fixed figure the caller supplies. `unitCostMinor`
 * anchors the search range: prices below cost are never worth searching,
 * and 50x cost is a generous ceiling no real dropshipping product should
 * need.
 */
export function recommendPricing(
  costs: Omit<CostInputs, 'sellingPrice' | 'adSpendPerUnit'>,
  currency: CurrencyCode,
  unitCostMinor: number,
  minNetMarginPct: number,
  targetNetMarginPct: number,
  advertisingAllowancePct: number,
): PricingRecommendation {
  const floor = Math.max(1, unitCostMinor)
  const ceiling = Math.max(floor * CEILING_MULTIPLIER, floor + 10000)

  const minimum = findMinimumPriceForMargin(costs, currency, minNetMarginPct, floor, ceiling, advertisingAllowancePct)
  const recommended = findMinimumPriceForMargin(costs, currency, targetNetMarginPct, floor, ceiling, advertisingAllowancePct)

  const basis = minimum.unreachable
    ? `No price up to ${(ceiling / 100).toFixed(2)} clears the configured minimum net margin of ${minNetMarginPct}% — this product cannot currently be priced into profitability.`
    : `Minimum viable price clears the ${minNetMarginPct}% minimum net margin; recommended price aims for the ${targetNetMarginPct}% target instead.`

  return {
    minimumViablePriceMinor: minimum.priceMinor,
    minimumViableUnreachable: minimum.unreachable,
    recommendedPriceMinor: recommended.priceMinor,
    recommendedUnreachable: recommended.unreachable,
    currency,
    basis,
  }
}
