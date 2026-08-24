import { add, type Money } from '@/lib/core/money'
import { calculateProfitability, assessProfitabilityGate, type CostInputs, type Profitability, type ProfitabilityGate } from '@/lib/profitability'
import { convertMoney } from '@/lib/fx/convert'
import { err, ok, type Result } from '@/lib/core/result'
import type { ExchangeRateFact } from '@/lib/fx/types'
import type { Fact, Freshness } from '@/lib/automation/factsTypes'
import type { MarketCostProfile } from './marketCostProfiles'

/**
 * Market-specific profitability (Milestone 9 §5).
 *
 * This module performs no margin arithmetic itself. It assembles the cost
 * assumptions that differ by market — exactly the role
 * `profitability/channels.ts` already plays for the two live UK channels —
 * and calls `calculateProfitability` (`profitability/index.ts`), the one
 * profitability engine in this codebase, directly. FX conversion happens
 * only when an explicit comparison currency is requested, and the native
 * result is always returned alongside it — never replaced by it.
 */

export interface MarketProjectionInput {
  sellingPriceNative: Money
  productCost: Money
  supplierShipping: Money
  packaging?: Money
  returnRatePct: number
  returnLossPct?: number
  refundRatePct?: number
  vatInclusive?: boolean
}

/** `MarketProjectionInput`'s cost fields before FX normalisation — the supplier's own currency, which may differ from the market's. See `resolveMarketProjectionInput`. */
export interface ForeignCostInput {
  sellingPriceNative: Money
  productCostForeign: Money
  supplierShippingForeign: Money
  packaging?: Money
  returnRatePct: number
  returnLossPct?: number
  refundRatePct?: number
  vatInclusive?: boolean
}

export interface MarketProfitabilityResult {
  marketKey: string
  currency: Money['currency']
  native: Profitability
  gate: ProfitabilityGate
  assumptions: Record<string, unknown>
  /**
   * Present whenever a comparison currency was requested — `exchangeRate`
   * is `null` only when the requested currency already equalled the
   * market's native one (`netProfit` is then simply `native.netProfit`,
   * with no conversion performed or claimed). Absent (`null` on the whole
   * object) when no comparison was requested, or when a genuine
   * conversion was requested but could not be trusted — see
   * `comparisonUnavailableReason` for that case.
   */
  comparison: { currency: Money['currency']; netProfit: Money; exchangeRate: ExchangeRateFact | null; freshness: Freshness } | null
  comparisonUnavailableReason: string | null
}

/**
 * The upstream FX-normalisation step the brief's pipeline diagram
 * describes ("Facts -> Currency/FX normalisation -> Market-specific
 * assumptions -> Existing profitability engine"). A supplier very often
 * quotes cost in their own currency (a UK supplier costs in GBP) even
 * when the market being evaluated sells in a different one (a US market
 * prices and reports in USD) — this is exactly the case a currency
 * movement can flip a market from profitable to not, because the cost
 * side of the equation moves while the selling price does not.
 *
 * `productCostForeign`/`supplierShippingForeign` are in the SUPPLIER's
 * currency; if that already equals the market's currency, no conversion
 * happens and the values pass through unchanged. Otherwise, this requires
 * a fresh `fxFact` — a stale or unavailable rate blocks the conversion
 * entirely (returned as an `Err`) rather than silently using an old rate,
 * exactly the brief's "stale FX blocks the affected profitability
 * assessment" requirement.
 */
export function resolveMarketProjectionInput(
  input: ForeignCostInput,
  marketCurrency: Money['currency'],
  fxFact: Fact<ExchangeRateFact>,
): Result<MarketProjectionInput, string> {
  const { productCostForeign, supplierShippingForeign, ...rest } = input

  if (productCostForeign.currency === marketCurrency) {
    return ok({ ...rest, productCost: productCostForeign, supplierShipping: supplierShippingForeign })
  }

  if (fxFact.freshness === 'unavailable') {
    return err(`No exchange rate has ever been observed for ${productCostForeign.currency}->${marketCurrency}. The supplier's cost cannot be expressed in this market's currency, so profitability cannot be assessed.`)
  }
  if (fxFact.freshness === 'stale' || !fxFact.value) {
    return err(`The ${productCostForeign.currency}->${marketCurrency} rate was last observed ${fxFact.asOf ?? 'never'}, too old to trust for a profitability assessment.`)
  }

  const convertedCost = convertMoney(productCostForeign, marketCurrency, fxFact.value, fxFact.freshness)
  const convertedShipping = convertMoney(supplierShippingForeign, marketCurrency, fxFact.value, fxFact.freshness)
  if (!convertedCost.ok) return err(convertedCost.error.detail)
  if (!convertedShipping.ok) return err(convertedShipping.error.detail)

  return ok({ ...rest, productCost: convertedCost.value.converted, supplierShipping: convertedShipping.value.converted })
}

/**
 * Projects one market. `fxFact` is the caller's already-classified rate
 * (via `fxRateFact`) for `sellingPriceNative.currency -> comparisonCurrency`
 * — this function never fetches a rate itself, and never converts using a
 * stale or unavailable one; it explains why the comparison figure is
 * missing instead.
 */
export function projectMarketProfitability(
  input: MarketProjectionInput,
  profile: MarketCostProfile,
  thresholds: { minGrossMarginPct: number; minNetMarginPct: number },
  comparison?: { currency: Money['currency']; fxFact: Fact<ExchangeRateFact> },
): MarketProfitabilityResult {
  const currency = input.sellingPriceNative.currency

  const costs: CostInputs = {
    sellingPrice: input.sellingPriceNative,
    productCost: input.productCost,
    supplierShipping: add(input.supplierShipping, profile.internationalShipping),
    fulfilment: profile.fulfilment,
    packaging: input.packaging,
    channelFeePct: profile.channelFeePct,
    channelFeeFixed: profile.channelFeeFixed,
    paymentFeePct: profile.paymentFeePct,
    paymentFeeFixed: profile.paymentFeeFixed,
    adSpendPerUnit: profile.adSpendPerUnit,
    returnRatePct: input.returnRatePct,
    returnLossPct: input.returnLossPct ?? 65,
    refundRatePct: input.refundRatePct ?? 1,
    vatRatePct: profile.taxRatePct,
    vatInclusive: input.vatInclusive ?? true,
  }

  const native = calculateProfitability(costs)
  const gate = assessProfitabilityGate(native, thresholds)

  let comparisonResult: MarketProfitabilityResult['comparison'] = null
  let comparisonUnavailableReason: string | null = null

  if (comparison && comparison.currency === currency) {
    // Requesting a comparison in the market's own currency needs no
    // conversion at all — reported as the native figure directly rather
    // than manufacturing an identity exchange rate that never happened.
    comparisonResult = { currency, netProfit: native.netProfit, exchangeRate: null, freshness: 'fresh' }
  } else if (comparison) {
    if (comparison.fxFact.freshness === 'unavailable') {
      comparisonUnavailableReason = `No exchange rate has ever been observed for ${currency}->${comparison.currency}. The comparison figure is withheld rather than guessed.`
    } else if (comparison.fxFact.freshness === 'stale') {
      comparisonUnavailableReason = `The ${currency}->${comparison.currency} rate was last observed ${comparison.fxFact.asOf}, which is too old to trust for this comparison.`
    } else if (!comparison.fxFact.value) {
      comparisonUnavailableReason = `No usable exchange rate for ${currency}->${comparison.currency}.`
    } else {
      const converted = convertMoney(native.netProfit, comparison.currency, comparison.fxFact.value, comparison.fxFact.freshness)
      if (!converted.ok) {
        comparisonUnavailableReason = converted.error.detail
      } else {
        comparisonResult = { currency: comparison.currency, netProfit: converted.value.converted, exchangeRate: converted.value.exchangeRate, freshness: converted.value.freshness }
      }
    }
  }

  return {
    marketKey: profile.marketKey,
    currency,
    native,
    gate,
    assumptions: {
      channelFeePct: profile.channelFeePct, paymentFeePct: profile.paymentFeePct,
      fulfilmentMinor: profile.fulfilment.minor, adSpendPerUnitMinor: profile.adSpendPerUnit.minor,
      internationalShippingMinor: profile.internationalShipping.minor, taxRatePct: profile.taxRatePct,
      returnRatePct: input.returnRatePct, notes: profile.notes,
    },
    comparison: comparisonResult,
    comparisonUnavailableReason,
  }
}
