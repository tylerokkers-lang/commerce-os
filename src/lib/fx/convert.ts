import { money, type Money } from '@/lib/core/money'
import { err, ok, type Result } from '@/lib/core/result'
import type { ExchangeRateFact, ConversionResult } from './types'

export type FxConversionError =
  | { reason: 'same_currency'; detail: string }
  | { reason: 'rate_currency_mismatch'; detail: string }
  | { reason: 'invalid_rate'; detail: string }

/**
 * Converts money using an explicit, already-fetched exchange-rate fact —
 * the only conversion path in this codebase, so a caller can never combine
 * or compare money from different currencies without one going through
 * here. Rounding happens exactly once, to whole minor units, at the end.
 *
 * This function does not check freshness — that is a decision for the
 * caller (a strategic read may accept a week-old rate; an automated price
 * change must not). Freshness is read from `Fact<ExchangeRateFact>`
 * (`fxRateFact`) before this is ever called; conversion itself only
 * validates that the rate given actually applies to the currencies asked
 * for.
 */
export function convertMoney(original: Money, targetCurrency: Money['currency'], rate: ExchangeRateFact, freshness: ConversionResult['freshness']): Result<ConversionResult, FxConversionError> {
  if (original.currency === targetCurrency) {
    return err({ reason: 'same_currency', detail: `${original.currency} is already the target currency — no conversion needed.` })
  }
  if (rate.base !== original.currency || rate.quote !== targetCurrency) {
    return err({
      reason: 'rate_currency_mismatch',
      detail: `This rate converts ${rate.base}->${rate.quote}, not ${original.currency}->${targetCurrency}. A rate can only be used for the exact pair it was observed for.`,
    })
  }
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
    return err({ reason: 'invalid_rate', detail: `Rate ${rate.rate} is not a usable positive number.` })
  }

  const converted = money(Math.round(original.minor * rate.rate), targetCurrency)
  return ok({ original, converted, exchangeRate: rate, freshness })
}
