import type { ExchangeRateFact } from './types'

/**
 * Deterministic demo/seed exchange rates (Milestone 9 §4). Not a live feed
 * — clearly labelled `source: 'demo'` on every fact, exactly the DEMO/LIVE
 * distinction the rest of this codebase (connector statuses) already
 * insists on. A genuine live provider (e.g. a keyed FX API) is declared as
 * PLANNED in `docs/API.md`/`HANDOVER.md`, not faked here.
 */
export function demoExchangeRates(observedAt: string = new Date().toISOString()): readonly ExchangeRateFact[] {
  const retrievedAt = observedAt
  return [
    { base: 'GBP', quote: 'USD', rate: 1.27, source: 'demo', observedAt, retrievedAt },
    { base: 'GBP', quote: 'EUR', rate: 1.17, source: 'demo', observedAt, retrievedAt },
    { base: 'GBP', quote: 'CAD', rate: 1.73, source: 'demo', observedAt, retrievedAt },
    { base: 'GBP', quote: 'AUD', rate: 1.93, source: 'demo', observedAt, retrievedAt },
    { base: 'USD', quote: 'GBP', rate: 0.79, source: 'demo', observedAt, retrievedAt },
    { base: 'EUR', quote: 'GBP', rate: 0.85, source: 'demo', observedAt, retrievedAt },
  ]
}
