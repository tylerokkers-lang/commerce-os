import type { CurrencyCode } from '@/lib/core/money'
import { fxRateFact, type ExchangeRateFact, type FxFreshnessUseCase, type FxRateStore } from './types'
import type { FxProvider } from './providers/frankfurter'

/**
 * FX rate ingestion (Milestone: FX rate ingestion layer) — the one thing
 * missing from the existing FX architecture: `fxMonitor.ts` only ever
 * observed whether a rate was fresh, stale, or had never been recorded;
 * nothing anywhere in this codebase ever actually fetched one. This is
 * that missing piece.
 *
 * Deliberately dependency-injected (`store`/`provider` as interfaces,
 * never a concrete `getSupabaseFxStore()`/`frankfurterFxProvider` import
 * here) so this can be driven end to end in tests with the existing
 * in-memory `FxRateStore` test double and a hand-built fake provider —
 * no database, no real network call, no `server-only` import in this
 * file at all.
 */

export type FxIngestStatus = 'recorded' | 'skipped_fresh' | 'failed'

export interface FxIngestOutcome {
  base: CurrencyCode
  quote: CurrencyCode
  status: FxIngestStatus
  reason: string
  /** The rate now on file for this pair after this call — the newly recorded one on success, the untouched previous one (fresh or stale) on skip/failure, or null if none has ever existed and this fetch also failed. */
  rate: ExchangeRateFact | null
}

/**
 * Refreshes one currency pair, idempotently: if the existing stored rate
 * is already fresh under `freshnessUseCase`'s window, this makes no
 * provider request and records nothing new — never a duplicate rate for
 * an already-current pair. Otherwise it asks the provider for a fresh
 * one.
 *
 * On provider failure (network error, malformed response, invalid rate,
 * wrong pair): the previous stored rate — stale or otherwise — is left
 * completely untouched. Nothing is deleted, nothing is overwritten with
 * a guess, and the existing freshness logic (`fxRateFact`) is exactly
 * what decides afterwards whether that untouched rate is still usable.
 * A pair with no rate at all and a failing provider correctly stays
 * with `rate: null` — downstream conversion remains genuinely unknown.
 */
export async function refreshFxRate(
  orgId: string,
  base: CurrencyCode,
  quote: CurrencyCode,
  store: FxRateStore,
  provider: FxProvider,
  freshnessUseCase: FxFreshnessUseCase,
  now: Date,
  isDemo = false,
): Promise<FxIngestOutcome> {
  const existing = await store.getLatestRate(orgId, base, quote)
  const existingFact = fxRateFact(existing, freshnessUseCase, now)

  if (existingFact.freshness === 'fresh') {
    return {
      base,
      quote,
      status: 'skipped_fresh',
      reason: `An existing ${base}->${quote} rate (observed ${existing!.observedAt}) is already fresh under the ${freshnessUseCase} window — no refresh needed.`,
      rate: existing,
    }
  }

  const result = await provider.fetchRate(base, quote)
  if (!result.ok) {
    return {
      base,
      quote,
      status: 'failed',
      reason: `Provider fetch failed (${result.error.reason}): ${result.error.detail}. The previous stored rate, if any, was left untouched.`,
      rate: existing,
    }
  }

  await store.recordRate(orgId, result.value, isDemo)
  return {
    base,
    quote,
    status: 'recorded',
    reason: `Recorded a new ${base}->${quote} rate (${result.value.rate}) from ${result.value.source}.`,
    rate: result.value,
  }
}

/** Refreshes every pair in `pairs`, each independently — one pair's provider failure never blocks another's refresh. */
export async function refreshFxRates(
  orgId: string,
  pairs: readonly { base: CurrencyCode; quote: CurrencyCode }[],
  store: FxRateStore,
  provider: FxProvider,
  freshnessUseCase: FxFreshnessUseCase,
  now: Date,
  isDemo = false,
): Promise<readonly FxIngestOutcome[]> {
  const outcomes: FxIngestOutcome[] = []
  for (const pair of pairs) {
    outcomes.push(await refreshFxRate(orgId, pair.base, pair.quote, store, provider, freshnessUseCase, now, isDemo))
  }
  return outcomes
}
