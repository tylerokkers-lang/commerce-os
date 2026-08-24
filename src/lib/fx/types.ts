import type { CurrencyCode, Money } from '@/lib/core/money'
import type { Fact, Freshness } from '@/lib/automation/factsTypes'

/**
 * Exchange-rate facts (Milestone 9 §4).
 *
 * An exchange rate is a fact with provenance, never a bare number — the
 * same discipline Milestone 7's `Fact<T>` established for supplier/product
 * data, reused here rather than reinvented. A rate is always expressed as
 * "1 unit of `base` equals `rate` units of `quote`" (the conventional FX
 * quoting direction), and every rate carries where it came from and when it
 * was actually observed, independent of when it was fetched.
 */

export interface ExchangeRateFact {
  base: CurrencyCode
  quote: CurrencyCode
  /** 1 `base` = `rate` `quote`. Never used directly for money arithmetic — always through `convertMoney`, which rounds to whole minor units exactly once. */
  rate: number
  source: string
  /** When the rate was true, per the source. */
  observedAt: string
  /** When this application actually fetched/recorded it — can lag `observedAt`. */
  retrievedAt: string
}

/** How long a rate may go unrefreshed before it is treated as stale, by use case — a strategic expansion read can tolerate an older rate than an automated price/profitability decision. */
export const FX_FRESHNESS_WINDOW_HOURS = {
  automation: 6,
  productEvaluation: 24,
  orderFulfilment: 24,
  strategicExpansion: 24 * 7,
} as const

export type FxFreshnessUseCase = keyof typeof FX_FRESHNESS_WINDOW_HOURS

/** Wraps a raw rate with the same Fresh/Stale/Unknown/Unavailable vocabulary every other fact in this codebase uses — never a silent boolean. */
export function fxRateFact(rate: ExchangeRateFact | null, useCase: FxFreshnessUseCase, now: Date): Fact<ExchangeRateFact> {
  const windowHours = FX_FRESHNESS_WINDOW_HOURS[useCase]
  if (!rate) return { value: null, freshness: 'unavailable', asOf: null }
  const ageHours = (now.getTime() - new Date(rate.observedAt).getTime()) / (1000 * 60 * 60)
  return { value: rate, freshness: ageHours <= windowHours ? 'fresh' : 'stale', asOf: rate.observedAt }
}

export interface ConversionResult {
  original: Money
  converted: Money
  exchangeRate: ExchangeRateFact
  freshness: Freshness
}

export interface FxRateStore {
  /** The most recently observed rate for this pair, or null if none has ever been recorded. */
  getLatestRate(orgId: string, base: CurrencyCode, quote: CurrencyCode): Promise<ExchangeRateFact | null>
  /** Appends a new observed rate — history is never overwritten, so "what did we believe at time X" stays answerable. */
  recordRate(orgId: string, rate: ExchangeRateFact, isDemo?: boolean): Promise<void>
  /** Rate history for a pair, most recent first — used to detect genuine movement, not just staleness. */
  getRateHistory(orgId: string, base: CurrencyCode, quote: CurrencyCode, limit: number): Promise<readonly ExchangeRateFact[]>
}
