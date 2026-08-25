import { describe, expect, it } from 'vitest'
import { validateNormalizedCampaignFact, validateNormalizedCampaignFacts } from '@/lib/advertising/validation'
import type { NormalizedCampaignFact } from '@/lib/advertising/connectors/types'

/**
 * Phase 5 — data-quality validation (Milestone 15). Every check maps
 * directly to the brief's list: campaign ID, organisation ID (checked by
 * the caller — `sync.ts` — not this pure function), provider, currency,
 * date, spend, revenue, impressions, clicks, conversions.
 */

function fact(overrides: Partial<NormalizedCampaignFact> = {}): NormalizedCampaignFact {
  return {
    provider: 'amazon_ads', externalAccountId: 'acct-1', externalCampaignId: 'camp-1',
    campaignName: 'Test Campaign', status: 'active', periodDate: '2026-08-20',
    impressions: 1000, clicks: 50, conversions: 5, spendMinor: 10000, revenueMinor: 30000,
    currency: 'GBP', dailyBudgetMinor: 2000, attributionModel: '7-day click', reportedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

describe('validateNormalizedCampaignFact: a genuinely valid fact passes', () => {
  it('a well-formed fact validates cleanly', () => {
    const result = validateNormalizedCampaignFact(fact())
    expect(result.ok).toBe(true)
  })

  it('null dailyBudgetMinor is valid — a real "unknown/uncapped" state, not an error', () => {
    const result = validateNormalizedCampaignFact(fact({ dailyBudgetMinor: null }))
    expect(result.ok).toBe(true)
  })
})

describe('validateNormalizedCampaignFact: missing identifiers', () => {
  it('rejects a missing campaign id', () => {
    const result = validateNormalizedCampaignFact(fact({ externalCampaignId: '' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'externalCampaignId')).toBe(true)
  })

  it('rejects a missing account id', () => {
    const result = validateNormalizedCampaignFact(fact({ externalAccountId: '' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'externalAccountId')).toBe(true)
  })

  it('rejects a missing campaign name', () => {
    const result = validateNormalizedCampaignFact(fact({ campaignName: '   ' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'campaignName')).toBe(true)
  })
})

describe('validateNormalizedCampaignFact: currency and provider', () => {
  it('rejects an unsupported currency', () => {
    const result = validateNormalizedCampaignFact(fact({ currency: 'JPY' as never }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'currency')).toBe(true)
  })

  it('rejects a malformed provider value from a malformed provider response', () => {
    const result = validateNormalizedCampaignFact(fact({ provider: 'not_a_real_platform' as never }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'provider')).toBe(true)
  })

  it('rejects a malformed status value', () => {
    const result = validateNormalizedCampaignFact(fact({ status: 'deleted' as never }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'status')).toBe(true)
  })
})

describe('validateNormalizedCampaignFact: dates', () => {
  it('rejects an invalid date string', () => {
    const result = validateNormalizedCampaignFact(fact({ periodDate: 'not-a-date' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'periodDate')).toBe(true)
  })

  it('rejects a malformed but date-shaped string', () => {
    const result = validateNormalizedCampaignFact(fact({ periodDate: '2026-13-40' }))
    expect(result.ok).toBe(false)
  })

  it('rejects a future date — a real provider never reports one', () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const result = validateNormalizedCampaignFact(fact({ periodDate: future }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'periodDate')).toBe(true)
  })
})

describe('validateNormalizedCampaignFact: negative and invalid metrics', () => {
  it('rejects negative spend', () => {
    const result = validateNormalizedCampaignFact(fact({ spendMinor: -100 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'spendMinor')).toBe(true)
  })

  it('rejects negative revenue', () => {
    const result = validateNormalizedCampaignFact(fact({ revenueMinor: -1 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'revenueMinor')).toBe(true)
  })

  it('rejects null/non-numeric metrics from a malformed provider response', () => {
    const result = validateNormalizedCampaignFact(fact({ impressions: null as never, clicks: 'five' as never }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.some((f) => f.field === 'impressions')).toBe(true)
      expect(result.error.some((f) => f.field === 'clicks')).toBe(true)
    }
  })

  it('rejects non-integer metrics (a fractional impression is a malformed value, not a real observation)', () => {
    const result = validateNormalizedCampaignFact(fact({ impressions: 100.5 }))
    expect(result.ok).toBe(false)
  })

  it('rejects a negative daily budget', () => {
    const result = validateNormalizedCampaignFact(fact({ dailyBudgetMinor: -500 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'dailyBudgetMinor')).toBe(true)
  })
})

describe('validateNormalizedCampaignFact: sanity checks between related fields', () => {
  it('rejects clicks exceeding impressions', () => {
    const result = validateNormalizedCampaignFact(fact({ impressions: 10, clicks: 50 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'clicks')).toBe(true)
  })

  it('rejects conversions exceeding clicks', () => {
    const result = validateNormalizedCampaignFact(fact({ clicks: 5, conversions: 20 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((f) => f.field === 'conversions')).toBe(true)
  })

  it('allows clicks exactly equal to impressions — a valid boundary, not an error', () => {
    const result = validateNormalizedCampaignFact(fact({ impressions: 50, clicks: 50, conversions: 0 }))
    expect(result.ok).toBe(true)
  })

  it('zero impressions/clicks/conversions/spend/revenue is a valid, honest fact, never rejected', () => {
    const result = validateNormalizedCampaignFact(fact({ impressions: 0, clicks: 0, conversions: 0, spendMinor: 0, revenueMinor: 0 }))
    expect(result.ok).toBe(true)
  })

  it('does not throw on garbage input', () => {
    expect(() => validateNormalizedCampaignFact(fact({ campaignName: undefined as never, currency: {} as never }))).not.toThrow()
  })
})

describe('validateNormalizedCampaignFacts: batch splitting', () => {
  it('splits a mixed batch into valid and quarantined, never dropping a record silently', () => {
    const facts = [fact({ externalCampaignId: 'good-1' }), fact({ externalCampaignId: '' }), fact({ externalCampaignId: 'good-2', spendMinor: -1 })]
    const { valid, quarantined } = validateNormalizedCampaignFacts(facts)
    expect(valid).toHaveLength(1)
    expect(valid[0].externalCampaignId).toBe('good-1')
    expect(quarantined).toHaveLength(2)
    expect(quarantined.every((q) => q.failures.length > 0)).toBe(true)
  })

  it('an all-valid batch quarantines nothing', () => {
    const { valid, quarantined } = validateNormalizedCampaignFacts([fact(), fact({ externalCampaignId: 'camp-2' })])
    expect(valid).toHaveLength(2)
    expect(quarantined).toHaveLength(0)
  })

  it('an empty batch produces an empty result, never throws', () => {
    expect(validateNormalizedCampaignFacts([])).toEqual({ valid: [], quarantined: [] })
  })
})
