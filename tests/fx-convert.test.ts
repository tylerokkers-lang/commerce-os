import { describe, expect, it } from 'vitest'
import { add, money } from '@/lib/core/money'
import { convertMoney } from '@/lib/fx/convert'
import { fxRateFact } from '@/lib/fx/types'
import { createInMemoryFxStore } from '@/lib/fx/inMemoryFxStore'
import type { ExchangeRateFact } from '@/lib/fx/types'

const ORG_A = 'org-a'

function rate(overrides: Partial<ExchangeRateFact> = {}): ExchangeRateFact {
  return { base: 'GBP', quote: 'USD', rate: 1.27, source: 'demo', observedAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), ...overrides }
}

describe('convertMoney — currency safety', () => {
  it('converts using the exact rate given, rounding to whole minor units', () => {
    const usedRate = rate()
    const result = convertMoney(money(1000, 'GBP'), 'USD', usedRate, 'fresh')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.converted).toEqual({ minor: 1270, currency: 'USD' })
    expect(result.value.original).toEqual({ minor: 1000, currency: 'GBP' })
    expect(result.value.exchangeRate).toEqual(usedRate)
  })

  it('refuses to convert money already in the target currency, rather than silently no-op succeeding', () => {
    const result = convertMoney(money(1000, 'USD'), 'USD', rate({ base: 'USD', quote: 'USD', rate: 1 }), 'fresh')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toBe('same_currency')
  })

  it('refuses a rate that does not match the requested currency pair — this is the currency-contamination guard', () => {
    // £10 vs $10: attempting to use a GBP->EUR rate to convert GBP->USD must fail loudly, not silently produce a wrong number.
    const wrongRate = rate({ base: 'GBP', quote: 'EUR', rate: 1.17 })
    const result = convertMoney(money(1000, 'GBP'), 'USD', wrongRate, 'fresh')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toBe('rate_currency_mismatch')
  })

  it('refuses a non-positive or non-finite rate rather than producing nonsense money', () => {
    const bad = convertMoney(money(1000, 'GBP'), 'USD', rate({ rate: 0 }), 'fresh')
    expect(bad.ok).toBe(false)
    const negative = convertMoney(money(1000, 'GBP'), 'USD', rate({ rate: -1.2 }), 'fresh')
    expect(negative.ok).toBe(false)
    const nan = convertMoney(money(1000, 'GBP'), 'USD', rate({ rate: NaN }), 'fresh')
    expect(nan.ok).toBe(false)
  })

  it('£10 and $10 can never be compared or added without going through convertMoney first — attempting it throws', () => {
    // This is the direct "currency contamination" probe: money.ts's own
    // assertSameCurrency guard (proven already in money.test.ts) is what
    // makes this impossible even before FX enters the picture — confirming
    // the guard is still in force after Milestone 9's currency additions.
    const gbp = money(1000, 'GBP')
    const usd = money(1000, 'USD')
    expect(() => add(gbp, usd)).toThrow(/Cannot combine/)
  })
})

describe('fxRateFact — freshness classification', () => {
  it('a rate observed just now is fresh for every use case', () => {
    const now = new Date()
    const f = fxRateFact(rate({ observedAt: now.toISOString() }), 'automation', now)
    expect(f.freshness).toBe('fresh')
  })

  it('a rate older than the automation window (6h) but within the strategic-expansion window (7 days) is stale for automation but fresh for expansion', () => {
    const now = new Date('2026-08-24T12:00:00Z')
    const observedAt = new Date('2026-08-24T02:00:00Z').toISOString() // 10 hours old.
    const forAutomation = fxRateFact(rate({ observedAt }), 'automation', now)
    const forExpansion = fxRateFact(rate({ observedAt }), 'strategicExpansion', now)
    expect(forAutomation.freshness).toBe('stale')
    expect(forExpansion.freshness).toBe('fresh')
  })

  it('no rate at all is unavailable, never treated as zero or as "no change"', () => {
    const f = fxRateFact(null, 'automation', new Date())
    expect(f.freshness).toBe('unavailable')
    expect(f.value).toBeNull()
  })
})

describe('in-memory FX store', () => {
  it('records rate history without overwriting, and returns the most recently observed rate as latest', async () => {
    const store = createInMemoryFxStore()
    await store.recordRate(ORG_A, rate({ rate: 1.20, observedAt: '2026-08-01T00:00:00Z' }))
    await store.recordRate(ORG_A, rate({ rate: 1.25, observedAt: '2026-08-10T00:00:00Z' }))
    await store.recordRate(ORG_A, rate({ rate: 1.30, observedAt: '2026-08-20T00:00:00Z' }))

    const latest = await store.getLatestRate(ORG_A, 'GBP', 'USD')
    expect(latest?.rate).toBe(1.30)

    const history = await store.getRateHistory(ORG_A, 'GBP', 'USD', 10)
    expect(history).toHaveLength(3)
    expect(history[0].rate).toBe(1.30) // Most recent first.
  })

  it('rates for one organisation never leak into another organisation\'s latest/history reads', async () => {
    const store = createInMemoryFxStore()
    await store.recordRate('org-a', rate({ rate: 1.20 }))
    await store.recordRate('org-b', rate({ rate: 99.0 }))

    const latestForA = await store.getLatestRate('org-a', 'GBP', 'USD')
    expect(latestForA?.rate).toBe(1.20)
    const historyForA = await store.getRateHistory('org-a', 'GBP', 'USD', 10)
    expect(historyForA.every((r) => r.rate !== 99.0)).toBe(true)
  })

  it('an unrecorded pair returns null, never a guessed or default rate', async () => {
    const store = createInMemoryFxStore()
    const latest = await store.getLatestRate(ORG_A, 'GBP', 'CAD')
    expect(latest).toBeNull()
  })
})
