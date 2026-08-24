import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import type { CurrencyCode } from '@/lib/core/money'
import type { ExchangeRateFact, FxRateStore } from './types'

/**
 * The production `FxRateStore`: real, append-only reads/writes against
 * `exchange_rates`. Mirrors `automation/facts.ts`'s shape exactly — this
 * module only reads and appends; it never decides whether a rate is fresh
 * enough to use (that is `fxRateFact`, in `types.ts`, called by whichever
 * monitor or handler needs the rate).
 */
export function getSupabaseFxStore(): FxRateStore {
  return {
    async getLatestRate(orgId: string, base: CurrencyCode, quote: CurrencyCode) {
      const supabase = createServiceSupabase()
      // Ordered by `observed_at`, then `id` (insertion order) as a
      // tiebreaker — two rates recorded in the same request can share an
      // `observed_at` value (e.g. a batch import), and without a
      // deterministic tiebreaker Postgres may return either one, which is
      // exactly the kind of "which rate did we actually just record"
      // ambiguity `inMemoryFxStore.ts` had to fix for the same reason.
      const { data } = await supabase
        .from('exchange_rates')
        .select('base_currency, quote_currency, rate, source, observed_at, retrieved_at')
        .eq('org_id', orgId).eq('base_currency', base).eq('quote_currency', quote)
        .order('observed_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!data) return null
      return {
        base: data.base_currency as CurrencyCode, quote: data.quote_currency as CurrencyCode,
        rate: data.rate, source: data.source, observedAt: data.observed_at, retrievedAt: data.retrieved_at,
      }
    },

    async recordRate(orgId: string, rate: ExchangeRateFact, isDemo = false) {
      const supabase = createServiceSupabase()
      await supabase.from('exchange_rates').insert({
        org_id: orgId, base_currency: rate.base, quote_currency: rate.quote, rate: rate.rate,
        source: rate.source, observed_at: rate.observedAt, retrieved_at: rate.retrievedAt, is_demo: isDemo,
      })
    },

    async getRateHistory(orgId: string, base: CurrencyCode, quote: CurrencyCode, limit: number) {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('exchange_rates')
        .select('base_currency, quote_currency, rate, source, observed_at, retrieved_at')
        .eq('org_id', orgId).eq('base_currency', base).eq('quote_currency', quote)
        .order('observed_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)

      return (data ?? []).map((r) => ({
        base: r.base_currency as CurrencyCode, quote: r.quote_currency as CurrencyCode,
        rate: r.rate, source: r.source, observedAt: r.observed_at, retrievedAt: r.retrieved_at,
      }))
    },
  }
}
