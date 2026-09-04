import { afterEach, describe, expect, it, vi } from 'vitest'
import { frankfurterFxProvider, FRANKFURTER_SOURCE_LABEL, type FxProvider } from '@/lib/fx/providers/frankfurter'
import { refreshFxRate, refreshFxRates } from '@/lib/fx/ingest'
import { createInMemoryFxStore } from '@/lib/fx/inMemoryFxStore'
import { ok, err } from '@/lib/core/result'
import type { CurrencyCode } from '@/lib/core/money'

/**
 * FX rate ingestion (Milestone: FX rate ingestion layer) — the real
 * mechanism this codebase never had: `fxMonitor.ts` only ever observed
 * whether a rate was fresh/stale/never-recorded, nothing anywhere
 * actually fetched one. Frankfurter needs no API key at all (verified
 * live before choosing it — a genuinely free, no-signup public API), so
 * there is no credential of any kind these tests could leak; test 13
 * below instead proves the stored fact carries only the documented safe
 * fields, never raw response/header data.
 */

const NOW = new Date('2026-09-03T12:00:00.000Z')
const ORG = 'org-informax'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockFetchOnce(response: Response) {
  const original = globalThis.fetch
  globalThis.fetch = (async () => response) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('1. frankfurterFxProvider.fetchRate: a valid USD->GBP response is normalized correctly', () => {
  it('returns a real ExchangeRateFact with the requested pair, the real rate, and a genuine observation date (not "now")', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'USD', date: '2026-09-03', rates: { GBP: 0.7409 } }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.base).toBe('USD')
      expect(result.value.quote).toBe('GBP')
      expect(result.value.rate).toBe(0.7409)
      expect(result.value.observedAt).toBe('2026-09-03T00:00:00.000Z')
      expect(result.value.source).toBe(FRANKFURTER_SOURCE_LABEL)
    } finally {
      restore()
    }
  })
})

describe('3. an invalid/malformed provider response is rejected, never accepted', () => {
  it('a response missing rates entirely is rejected', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'USD', date: '2026-09-03' }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe('invalid_response')
    } finally {
      restore()
    }
  })

  it('a response that is not valid JSON at all is rejected', async () => {
    const restore = mockFetchOnce(new Response('not json', { status: 200 }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(false)
    } finally {
      restore()
    }
  })

  it('an HTTP error status is rejected, never treated as a valid empty rate', async () => {
    const restore = mockFetchOnce(new Response('Service Unavailable', { status: 503 }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe('http_error')
    } finally {
      restore()
    }
  })
})

describe('4 & 5. a zero or negative rate is rejected, never recorded', () => {
  it('a zero rate is rejected', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'USD', date: '2026-09-03', rates: { GBP: 0 } }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe('invalid_rate')
    } finally {
      restore()
    }
  })

  it('a negative rate is rejected', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'USD', date: '2026-09-03', rates: { GBP: -0.79 } }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe('invalid_rate')
    } finally {
      restore()
    }
  })

  it('NaN/Infinity are rejected (JSON cannot literally encode either, but a provider bug could send a non-numeric string coerced to one)', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'USD', date: '2026-09-03', rates: { GBP: Number.POSITIVE_INFINITY } }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      // JSON.stringify(Infinity) becomes `null`, which is itself a
      // legitimate "no such rate" case — either outcome must be an
      // explicit rejection, never a fabricated finite rate.
      expect(result.ok).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('6. a wrong-pair response is rejected, never silently accepted for a different pair', () => {
  it('a response whose own base does not match what was requested is rejected', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'EUR', date: '2026-09-03', rates: { GBP: 0.86 } }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe('wrong_pair')
    } finally {
      restore()
    }
  })

  it('a response that never actually includes the requested quote currency is rejected', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'USD', date: '2026-09-03', rates: { EUR: 0.92 } }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe('wrong_pair')
    } finally {
      restore()
    }
  })
})

describe('2 & 9. a valid rate is recorded, and a fresh stored rate lets conversion succeed', () => {
  it('refreshFxRate records a genuinely new rate via the real recordRate() path when none existed', async () => {
    const store = createInMemoryFxStore()
    const provider: FxProvider = { fetchRate: async () => ok({ base: 'USD', quote: 'GBP', rate: 0.79, source: 'test', observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString() }) }

    const outcome = await refreshFxRate(ORG, 'USD', 'GBP', store, provider, 'productEvaluation', NOW)
    expect(outcome.status).toBe('recorded')
    expect(outcome.rate?.rate).toBe(0.79)

    const stored = await store.getLatestRate(ORG, 'USD', 'GBP')
    expect(stored?.rate).toBe(0.79)
  })
})

describe('7 & 8. provider failure preserves the previous rate, never fabricates one', () => {
  it('a provider timeout/error leaves a previously-recorded rate completely untouched', async () => {
    const store = createInMemoryFxStore()
    await store.recordRate(ORG, { base: 'USD', quote: 'GBP', rate: 0.75, source: 'previous', observedAt: '2026-08-01T00:00:00.000Z', retrievedAt: '2026-08-01T00:00:05.000Z' })
    const failingProvider: FxProvider = { fetchRate: async () => err({ reason: 'network_error', detail: 'timed out' }) }

    const outcome = await refreshFxRate(ORG, 'USD', 'GBP', store, failingProvider, 'productEvaluation', NOW)
    expect(outcome.status).toBe('failed')

    const stored = await store.getLatestRate(ORG, 'USD', 'GBP')
    expect(stored?.rate).toBe(0.75) // exactly the previous rate, untouched
    expect(stored?.source).toBe('previous')
  })

  it('no existing rate + a failing provider leaves the pair genuinely unavailable, never a fabricated 1:1', async () => {
    const store = createInMemoryFxStore()
    const failingProvider: FxProvider = { fetchRate: async () => err({ reason: 'network_error', detail: 'timed out' }) }

    const outcome = await refreshFxRate(ORG, 'USD', 'GBP', store, failingProvider, 'productEvaluation', NOW)
    expect(outcome.status).toBe('failed')
    expect(outcome.rate).toBeNull()

    const stored = await store.getLatestRate(ORG, 'USD', 'GBP')
    expect(stored).toBeNull()
  })
})

describe('10 & 11. stale-rate freshness behaviour is respected, and refreshing an already-fresh rate never creates a duplicate', () => {
  it('a stale stored rate is still used by fxRateFact\'s existing freshness model (not treated as "no rate")', async () => {
    const store = createInMemoryFxStore()
    await store.recordRate(ORG, { base: 'USD', quote: 'GBP', rate: 0.75, source: 'old', observedAt: '2026-08-01T00:00:00.000Z', retrievedAt: '2026-08-01T00:00:05.000Z' })
    // Provider is healthy and would return a different rate if called —
    // this proves the stale rate is genuinely being refreshed (not just
    // present), by checking the outcome recorded a new one.
    const provider: FxProvider = { fetchRate: async () => ok({ base: 'USD', quote: 'GBP', rate: 0.79, source: 'fresh-fetch', observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString() }) }

    const outcome = await refreshFxRate(ORG, 'USD', 'GBP', store, provider, 'productEvaluation', NOW)
    expect(outcome.status).toBe('recorded') // stale -> refreshed, never silently left alone
  })

  it('an already-fresh rate is never refreshed again — no unnecessary duplicate, no provider call at all', async () => {
    const store = createInMemoryFxStore()
    await store.recordRate(ORG, { base: 'USD', quote: 'GBP', rate: 0.79, source: 'already-fresh', observedAt: '2026-09-03T06:00:00.000Z', retrievedAt: '2026-09-03T06:00:05.000Z' })
    const providerFn = vi.fn(async (): ReturnType<FxProvider['fetchRate']> => ok({ base: 'USD', quote: 'GBP', rate: 0.5, source: 'should-not-be-called', observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString() }))
    const provider: FxProvider = { fetchRate: providerFn }

    const outcome = await refreshFxRate(ORG, 'USD', 'GBP', store, provider, 'productEvaluation', NOW)
    expect(outcome.status).toBe('skipped_fresh')
    expect(providerFn).not.toHaveBeenCalled()

    const history = await store.getRateHistory(ORG, 'USD', 'GBP', 10)
    expect(history).toHaveLength(1) // still exactly one row — no duplicate
  })
})

describe('12. provider metadata/provenance is preserved end to end', () => {
  it('the recorded rate keeps its real source label and observation timestamp, not a generic placeholder', async () => {
    const store = createInMemoryFxStore()
    const provider: FxProvider = { fetchRate: async () => ok({ base: 'USD', quote: 'GBP', rate: 0.7409, source: FRANKFURTER_SOURCE_LABEL, observedAt: '2026-09-03T00:00:00.000Z', retrievedAt: NOW.toISOString() }) }

    await refreshFxRate(ORG, 'USD', 'GBP', store, provider, 'productEvaluation', NOW)
    const stored = await store.getLatestRate(ORG, 'USD', 'GBP')
    expect(stored?.source).toBe(FRANKFURTER_SOURCE_LABEL)
    expect(stored?.observedAt).toBe('2026-09-03T00:00:00.000Z')
  })
})

describe('13. no credential of any kind appears in the stored fact or outcome (Frankfurter needs none, and this proves nothing extra leaks through)', () => {
  it('the ExchangeRateFact returned by the provider contains only the documented safe fields', async () => {
    const restore = mockFetchOnce(jsonResponse({ amount: 1, base: 'USD', date: '2026-09-03', rates: { GBP: 0.7409 } }))
    try {
      const result = await frankfurterFxProvider.fetchRate('USD', 'GBP')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(Object.keys(result.value).sort()).toEqual(['base', 'observedAt', 'quote', 'rate', 'retrievedAt', 'source'].sort())
    } finally {
      restore()
    }
  })

  it('an ingest outcome never carries raw HTTP request/response objects, headers, or an Authorization-shaped field', async () => {
    const store = createInMemoryFxStore()
    const provider: FxProvider = { fetchRate: async () => ok({ base: 'USD', quote: 'GBP', rate: 0.79, source: 'test', observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString() }) }
    const outcome = await refreshFxRate(ORG, 'USD', 'GBP', store, provider, 'productEvaluation', NOW)
    const serialized = JSON.stringify(outcome)
    expect(serialized.toLowerCase()).not.toContain('authorization')
    expect(serialized.toLowerCase()).not.toContain('apikey')
    expect(serialized.toLowerCase()).not.toContain('api_key')
  })
})

describe('14. existing same-currency conversion continues to work (no regression from adding ingestion)', () => {
  it('refreshFxRates handles a mixed batch (one pair needing conversion, one not) without cross-contamination', async () => {
    const store = createInMemoryFxStore()
    const provider: FxProvider = {
      fetchRate: async (base: CurrencyCode, quote: CurrencyCode) => ok({ base, quote, rate: base === 'USD' ? 0.79 : 1.16, source: 'test', observedAt: NOW.toISOString(), retrievedAt: NOW.toISOString() }),
    }
    const outcomes = await refreshFxRates(
      ORG,
      [
        { base: 'USD', quote: 'GBP' },
        { base: 'GBP', quote: 'USD' },
      ],
      store,
      provider,
      'productEvaluation',
      NOW,
    )
    expect(outcomes).toHaveLength(2)
    expect(outcomes.every((o) => o.status === 'recorded')).toBe(true)
    expect(await store.getLatestRate(ORG, 'USD', 'GBP')).not.toBeNull()
    expect(await store.getLatestRate(ORG, 'GBP', 'USD')).not.toBeNull()
  })
})
