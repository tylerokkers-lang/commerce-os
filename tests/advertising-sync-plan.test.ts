import { describe, expect, it } from 'vitest'
import { planAdvertisingSync } from '@/lib/advertising/syncPlan'
import type { NormalizedCampaignFact } from '@/lib/advertising/connectors/types'

/**
 * Phase 4 — the sync engine's pure decision logic (Milestone 15).
 * `advertising/sync.ts` (server-only) is the thin writer; every decision
 * — what gets written, what gets quarantined, what blocks the whole sync
 * — is made here, driven directly without a database.
 */

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const NOW = '2026-08-25T09:00:00.000Z'

function fact(overrides: Partial<NormalizedCampaignFact> = {}): NormalizedCampaignFact {
  return {
    provider: 'amazon_ads', externalAccountId: 'acct-1', externalCampaignId: 'camp-1',
    campaignName: 'Test Campaign', status: 'active', periodDate: '2026-08-20',
    impressions: 1000, clicks: 50, conversions: 5, spendMinor: 10000, revenueMinor: 30000,
    currency: 'GBP', dailyBudgetMinor: 2000, attributionModel: '7-day click', reportedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

describe('planAdvertisingSync: missing configuration blocks the whole sync', () => {
  it('no channel configured for the connection blocks with zero upserts — never guesses a channel', () => {
    const plan = planAdvertisingSync({ orgId: ORG_A, provider: 'amazon_ads', channel: null, fetched: [fact()], nowIso: NOW })
    expect(plan.blocked).not.toBeNull()
    expect(plan.upserts).toHaveLength(0)
    expect(plan.quarantined).toHaveLength(0)
  })
})

describe('planAdvertisingSync: valid facts become upserts', () => {
  it('a single valid fact produces exactly one upsert, correctly mapped', () => {
    const plan = planAdvertisingSync({ orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk', fetched: [fact()], nowIso: NOW })
    expect(plan.blocked).toBeNull()
    expect(plan.upserts).toHaveLength(1)
    const u = plan.upserts[0]
    expect(u.orgId).toBe(ORG_A)
    expect(u.channel).toBe('amazon_uk')
    expect(u.provider).toBe('amazon_ads')
    expect(u.externalId).toBe('camp-1')
    expect(u.spendMinor).toBe(10000)
    expect(u.revenueMinor).toBe(30000)
    expect(u.isPaused).toBe(false)
    expect(u.syncedAt).toBe(NOW)
  })

  it('a paused campaign fact maps isPaused: true', () => {
    const plan = planAdvertisingSync({ orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk', fetched: [fact({ status: 'paused' })], nowIso: NOW })
    expect(plan.upserts[0].isPaused).toBe(true)
  })

  it('multiple distinct campaigns each produce their own upsert', () => {
    const plan = planAdvertisingSync({
      orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk',
      fetched: [fact({ externalCampaignId: 'camp-1' }), fact({ externalCampaignId: 'camp-2' }), fact({ externalCampaignId: 'camp-3' })],
      nowIso: NOW,
    })
    expect(plan.upserts).toHaveLength(3)
    expect(new Set(plan.upserts.map((u) => u.externalId)).size).toBe(3)
  })
})

describe('planAdvertisingSync: invalid facts are quarantined, never written', () => {
  it('an invalid fact never appears in upserts, and is reported in quarantined with its reasons', () => {
    const plan = planAdvertisingSync({ orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk', fetched: [fact({ spendMinor: -1 })], nowIso: NOW })
    expect(plan.upserts).toHaveLength(0)
    expect(plan.quarantined).toHaveLength(1)
    expect(plan.quarantined[0].failures.length).toBeGreaterThan(0)
  })

  it('a mixed batch writes only the valid records — one bad campaign never blocks the whole sync (partial failure handling)', () => {
    const plan = planAdvertisingSync({
      orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk',
      fetched: [fact({ externalCampaignId: 'good' }), fact({ externalCampaignId: '' })],
      nowIso: NOW,
    })
    expect(plan.blocked).toBeNull()
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].externalId).toBe('good')
    expect(plan.quarantined).toHaveLength(1)
  })
})

describe('planAdvertisingSync: idempotency', () => {
  it('running the exact same input twice produces an identical plan — a repeat sync never duplicates or drifts', () => {
    const input = { orgId: ORG_A, provider: 'amazon_ads' as const, channel: 'amazon_uk' as const, fetched: [fact(), fact({ externalCampaignId: 'camp-2' })], nowIso: NOW }
    const first = planAdvertisingSync(input)
    const second = planAdvertisingSync(input)
    expect(second.upserts).toEqual(first.upserts)
  })
})

describe('planAdvertisingSync: organisation isolation', () => {
  it('every upsert carries exactly the orgId it was planned for — never mixed across a batch', () => {
    const planA = planAdvertisingSync({ orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk', fetched: [fact()], nowIso: NOW })
    const planB = planAdvertisingSync({ orgId: ORG_B, provider: 'amazon_ads', channel: 'amazon_uk', fetched: [fact()], nowIso: NOW })
    expect(planA.upserts[0].orgId).toBe(ORG_A)
    expect(planB.upserts[0].orgId).toBe(ORG_B)
  })
})

describe('planAdvertisingSync: currency handling', () => {
  it('currency flows through unchanged — never converted or defaulted', () => {
    const plan = planAdvertisingSync({ orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk', fetched: [fact({ currency: 'USD' })], nowIso: NOW })
    expect(plan.upserts[0].currency).toBe('USD')
  })
})

describe('planAdvertisingSync: empty input', () => {
  it('an empty fetched array produces an empty plan, never throws', () => {
    const plan = planAdvertisingSync({ orgId: ORG_A, provider: 'amazon_ads', channel: 'amazon_uk', fetched: [], nowIso: NOW })
    expect(plan.upserts).toHaveLength(0)
    expect(plan.quarantined).toHaveLength(0)
    expect(plan.blocked).toBeNull()
  })
})
