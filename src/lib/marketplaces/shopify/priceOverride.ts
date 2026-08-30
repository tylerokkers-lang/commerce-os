import { calculateProfitability, type CostInputs } from '@/lib/profitability'
import { money, type CurrencyCode } from '@/lib/core/money'

/**
 * Manual price override checking (Milestone: controlled Shopify
 * publication, Phase 6).
 *
 * Reuses `calculateProfitability` (`@/lib/profitability`) directly — the
 * exact same engine Phase 4 already uses for `recommendedPrice`/
 * `minimumViablePrice` — to re-run the real margin at whatever price the
 * operator wants to select, rather than approximating it. Never a second
 * pricing formula.
 */

export interface PriceOverrideInput {
  costs: Omit<CostInputs, 'sellingPrice'>
  currency: CurrencyCode
  recommendedPriceMinor: number
  selectedPriceMinor: number
  minNetMarginPct: number
}

export interface PriceOverrideResult {
  /** True whenever the selected price differs from the recommended one — the caller decides whether that alone needs a UI warning. */
  isOverride: boolean
  recommendedMarginPct: number | null
  selectedMarginPct: number | null
  belowConfiguredMinimum: boolean
  message: string | null
}

export function checkPriceOverride(input: PriceOverrideInput): PriceOverrideResult {
  const isOverride = input.selectedPriceMinor !== input.recommendedPriceMinor

  const recommended = calculateProfitability({ ...input.costs, sellingPrice: money(input.recommendedPriceMinor, input.currency) })
  const selected = calculateProfitability({ ...input.costs, sellingPrice: money(input.selectedPriceMinor, input.currency) })

  const belowConfiguredMinimum = selected.netMarginPct !== null && selected.netMarginPct < input.minNetMarginPct

  let message: string | null = null
  if (isOverride && recommended.netMarginPct !== null && selected.netMarginPct !== null) {
    message = `This price changes estimated contribution margin from ${recommended.netMarginPct.toFixed(1)}% to ${selected.netMarginPct.toFixed(1)}%.${belowConfiguredMinimum ? ` Minimum configured margin is ${input.minNetMarginPct}%.` : ''}`
  }

  return {
    isOverride,
    recommendedMarginPct: recommended.netMarginPct,
    selectedMarginPct: selected.netMarginPct,
    belowConfiguredMinimum,
    message,
  }
}
