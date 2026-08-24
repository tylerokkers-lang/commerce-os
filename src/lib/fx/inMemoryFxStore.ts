import type { CurrencyCode } from '@/lib/core/money'
import type { ExchangeRateFact, FxRateStore } from './types'

/**
 * A real (not mocked) in-memory `FxRateStore` — the same "define the
 * interface, satisfy it twice" pattern as `EventStore`/`AutomationStore`,
 * so monitors and job handlers that need FX facts can be driven end to end
 * in tests without a live database.
 */
export function createInMemoryFxStore(seed?: readonly (ExchangeRateFact & { orgId: string })[]) {
  const history: (ExchangeRateFact & { orgId: string })[] = seed ? [...seed] : []

  const pairKey = (base: CurrencyCode, quote: CurrencyCode) => `${base}:${quote}`

  const store: FxRateStore & { getState: () => readonly (ExchangeRateFact & { orgId: string })[] } = {
    async getLatestRate(orgId, base, quote) {
      const matches = history.filter((r) => r.orgId === orgId && pairKey(r.base, r.quote) === pairKey(base, quote))
      if (matches.length === 0) return null
      // `matches` preserves insertion order (filtered from `history`, which
      // only ever grows via `push`), so `>=` — not `>` — makes the LAST
      // recorded rate win an `observedAt` tie. Real timestamps can collide
      // at millisecond resolution (two `recordRate` calls issued in the
      // same synchronous tick, common in fast tests); the most recently
      // *recorded* rate is the correct tiebreaker, not an arbitrary one.
      return matches.reduce((latest, r) => (new Date(r.observedAt).getTime() >= new Date(latest.observedAt).getTime() ? r : latest))
    },

    async recordRate(orgId, rate) {
      history.push({ ...rate, orgId })
    },

    async getRateHistory(orgId, base, quote, limit) {
      return history
        .filter((r) => r.orgId === orgId && pairKey(r.base, r.quote) === pairKey(base, quote))
        .map((r, insertionIndex) => ({ r, insertionIndex }))
        .sort((a, b) => new Date(b.r.observedAt).getTime() - new Date(a.r.observedAt).getTime() || b.insertionIndex - a.insertionIndex)
        .map(({ r }) => r)
        .slice(0, limit)
    },

    getState() {
      return [...history]
    },
  }

  return store
}
