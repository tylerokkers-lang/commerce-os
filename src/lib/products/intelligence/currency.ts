import { money, type CurrencyCode } from '@/lib/core/money'
import { convertMoney } from '@/lib/fx/convert'
import { fxRateFact, type ExchangeRateFact, type FxFreshnessUseCase } from '@/lib/fx/types'

/**
 * Currency-correct landed cost (Milestone: product intelligence pipeline
 * hardening) — found live testing the real CJdropshipping pipeline: every
 * economic calculation in `assemble.ts` (pricing, profitability, capital
 * exposure, opportunity) previously used the supplier's raw minor units
 * as if they were already in the channel's own currency, with no
 * conversion of any kind. CJ quotes in USD; this org's channel currency
 * is GBP — a silent, real conflation ($38.14 treated as £38.14), never
 * caught because every Money value in that file carried the same
 * (wrong) currency label, so `@/lib/core/money`'s own currency-mismatch
 * guard never had anything to catch.
 *
 * Reuses the existing FX architecture built for Milestone 9
 * (`convertMoney`, `fxRateFact`, `FxRateStore`) exactly as-is — this file
 * adds no new conversion mechanism, no new rate source, and never
 * invents a rate. `assemble.ts` is `server-only` (touches
 * `createServerSupabase`/`createServiceSupabase` transitively) and
 * cannot be imported by this test suite at all; this module holds the
 * pure decision logic on its own specifically so it can be unit-tested
 * without a database, matching `pricingEngine.ts`/`maintenanceHealth.ts`'s
 * own established split between pure logic and I/O.
 */

export interface SupplierEconomicsFacts {
  unitCostMinor: number
  shippingCostMinor: number
  currency: CurrencyCode
}

export interface ChannelCurrencyLandedCost {
  available: boolean
  unitCostMinor: number | null
  shippingCostMinor: number | null
  currency: CurrencyCode
  /** Set only when a real conversion was actually applied — never present when the supplier already quoted in the channel currency (nothing to convert), and never present when conversion failed. */
  rateUsed: ExchangeRateFact | null
  /** Explains a stale-but-usable conversion or an unavailable one. Null on a clean same-currency or fresh-rate path — nothing to explain. */
  detail: string | null
}

/**
 * `latestRate` must already be fetched by the caller (`assemble.ts`, via
 * the real `FxRateStore`) — this function makes no I/O of its own, so it
 * can be tested with a hand-constructed rate or `null` (simulating "no
 * rate has ever been recorded") without touching a database.
 *
 * Never falls back to a 1:1 assumption: when the supplier's currency
 * differs from the channel's and no usable rate exists,
 * `available: false` is returned and the caller must treat every
 * downstream economic figure as genuinely unknown, not silently
 * conflated.
 */
export function deriveChannelCurrencyLandedCost(
  supplier: SupplierEconomicsFacts,
  channelCurrency: CurrencyCode,
  latestRate: ExchangeRateFact | null,
  freshnessUseCase: FxFreshnessUseCase,
  now: Date,
): ChannelCurrencyLandedCost {
  if (supplier.currency === channelCurrency) {
    return { available: true, unitCostMinor: supplier.unitCostMinor, shippingCostMinor: supplier.shippingCostMinor, currency: channelCurrency, rateUsed: null, detail: null }
  }

  const fact = fxRateFact(latestRate, freshnessUseCase, now)
  if (fact.freshness === 'unavailable' || !fact.value) {
    return {
      available: false,
      unitCostMinor: null,
      shippingCostMinor: null,
      currency: channelCurrency,
      rateUsed: null,
      detail: `No exchange rate is on file for ${supplier.currency}->${channelCurrency}, so supplier economics cannot be converted into the channel currency.`,
    }
  }

  const costResult = convertMoney(money(supplier.unitCostMinor, supplier.currency), channelCurrency, fact.value, fact.freshness)
  const shippingResult = convertMoney(money(supplier.shippingCostMinor, supplier.currency), channelCurrency, fact.value, fact.freshness)

  if (!costResult.ok || !shippingResult.ok) {
    const failure = !costResult.ok ? costResult.error : (shippingResult as { ok: false; error: { detail: string } }).error
    return { available: false, unitCostMinor: null, shippingCostMinor: null, currency: channelCurrency, rateUsed: null, detail: failure.detail }
  }

  return {
    available: true,
    unitCostMinor: costResult.value.converted.minor,
    shippingCostMinor: shippingResult.value.converted.minor,
    currency: channelCurrency,
    rateUsed: fact.value,
    detail:
      fact.freshness === 'stale'
        ? `Converted using a ${supplier.currency}->${channelCurrency} rate from ${fact.value.source}, last observed ${fact.value.observedAt} (older than the ${freshnessUseCase} freshness window).`
        : null,
  }
}
