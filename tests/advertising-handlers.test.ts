import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { handleAdvertisingSync, handleAdvertisingCampaignAction, handleAdvertisingCampaignReview } from '@/lib/automation/handlers/advertisingHandlers'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { JobRecord } from '@/lib/automation/store'

/**
 * Job-handler dispatch (Milestone 15). Confirms malformed payloads fail
 * safely and non-retryably (never silently "succeeding" having done
 * nothing — the same rule every handler in this codebase follows), and
 * that `handleAdvertisingSync` never imports `advertising/sync.ts`
 * directly — `runSync` is always injected, which is what lets this test
 * file (and `worker.ts`) run in Vitest at all despite the real sync
 * engine being `server-only`.
 */

const ORG_A = 'org-a'

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: randomUUID(), orgId: ORG_A, jobType: 'advertising_sync', status: 'running', payload: {},
    runAt: new Date().toISOString(), idempotencyKey: null, attempts: 1, maxAttempts: 5, lastError: null,
    lockedAt: new Date().toISOString(), lockedBy: 'test-worker', correlationId: randomUUID(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null,
    ...overrides,
  }
}

describe('handleAdvertisingSync', () => {
  it('a malformed payload (missing connectorKey) fails non-retryably', async () => {
    const store = createInMemoryAutomationStore()
    const result = await handleAdvertisingSync(job({ payload: {} }), store, undefined, undefined, undefined, { runSync: async () => ({ succeeded: true, error: null }) })
    expect(result.succeeded).toBe(false)
    expect(result.retryable).toBe(false)
  })

  it('missing advertisingDeps fails non-retryably rather than silently no-op-succeeding', async () => {
    const store = createInMemoryAutomationStore()
    const result = await handleAdvertisingSync(job({ payload: { connectorKey: 'demo_ads' } }), store, undefined, undefined, undefined, undefined)
    expect(result.succeeded).toBe(false)
    expect(result.retryable).toBe(false)
  })

  it('a successful sync reports success', async () => {
    const store = createInMemoryAutomationStore()
    const result = await handleAdvertisingSync(
      job({ payload: { connectorKey: 'demo_ads' } }), store, undefined, undefined, undefined,
      { runSync: async () => ({ succeeded: true, error: null }) },
    )
    expect(result.succeeded).toBe(true)
  })

  it('a sync failure (e.g. platform API error) reports failure as retryable — a transient error, not a config problem', async () => {
    const store = createInMemoryAutomationStore()
    const result = await handleAdvertisingSync(
      job({ payload: { connectorKey: 'demo_ads' } }), store, undefined, undefined, undefined,
      { runSync: async () => ({ succeeded: false, error: 'Platform API returned 500.' }) },
    )
    expect(result.succeeded).toBe(false)
    expect(result.retryable).toBe(true)
    expect(result.error).toContain('500')
  })
})

describe('handleAdvertisingCampaignAction', () => {
  it('a malformed payload fails non-retryably', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const result = await handleAdvertisingCampaignAction(job({ jobType: 'advertising_campaign_action', payload: { channel: 'amazon_uk' } }), store)
    expect(result.succeeded).toBe(false)
    expect(result.retryable).toBe(false)
  })

  it('a well-formed payload for a healthy, connected campaign reaches requires_approval (reported as handler success — proposing is not a failure)', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const result = await handleAdvertisingCampaignAction(
      job({
        jobType: 'advertising_campaign_action',
        payload: {
          channel: 'amazon_uk', provider: 'amazon_ads', externalAccountId: 'acct-1', externalCampaignId: 'camp-1', actionType: 'pause_campaign',
          campaignName: 'Test Campaign', classification: 'wasted_spend', currentDailyBudgetMinor: 2000, proposedDailyBudgetMinor: null,
          isPaused: false, connectionStatus: 'connected', dataAgeHours: 2, roas: 1.1, idempotencyKey: 'job-1',
        },
      }),
      store,
    )
    expect(result.succeeded).toBe(true)
    expect(store.getState().approvals).toHaveLength(1)
  })

  it('a well-formed payload that fails a safety gate is reported as handler failure (blocked)', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const result = await handleAdvertisingCampaignAction(
      job({
        jobType: 'advertising_campaign_action',
        payload: {
          channel: 'amazon_uk', provider: 'amazon_ads', externalAccountId: 'acct-1', externalCampaignId: 'camp-1', actionType: 'pause_campaign',
          campaignName: 'Test Campaign', classification: 'wasted_spend', currentDailyBudgetMinor: 2000, proposedDailyBudgetMinor: null,
          isPaused: false, connectionStatus: 'not_configured', dataAgeHours: 2, roas: 1.1, idempotencyKey: 'job-2',
        },
      }),
      store,
    )
    expect(result.succeeded).toBe(false)
  })

  it('a duplicate pending proposal for the same campaign+action is recognised, never creating a second approval', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const payload = {
      channel: 'amazon_uk' as const, provider: 'amazon_ads' as const, externalAccountId: 'acct-1', externalCampaignId: 'camp-1', actionType: 'pause_campaign' as const,
      campaignName: 'Test Campaign', classification: 'wasted_spend' as const, currentDailyBudgetMinor: 2000, proposedDailyBudgetMinor: null,
      isPaused: false, connectionStatus: 'connected' as const, dataAgeHours: 2, roas: 1.1,
    }
    await handleAdvertisingCampaignAction(job({ jobType: 'advertising_campaign_action', payload: { ...payload, idempotencyKey: 'job-3' } }), store)
    await handleAdvertisingCampaignAction(job({ jobType: 'advertising_campaign_action', payload: { ...payload, idempotencyKey: 'job-4' } }), store)

    expect(store.getState().approvals).toHaveLength(1)
  })
})

describe('handleAdvertisingCampaignReview (Phases 5-7 — the automatic monitor job)', () => {
  it('missing advertisingDeps.runCampaignReview fails non-retryably, never silently succeeding having done nothing', async () => {
    const store = createInMemoryAutomationStore()
    const result = await handleAdvertisingCampaignReview(job({ jobType: 'advertising_campaign_review' }), store, undefined, undefined, undefined, {
      runSync: async () => ({ succeeded: true, error: null }),
    })
    expect(result.succeeded).toBe(false)
    expect(result.retryable).toBe(false)
  })

  it('a successful review reports success', async () => {
    const store = createInMemoryAutomationStore()
    const result = await handleAdvertisingCampaignReview(job({ jobType: 'advertising_campaign_review' }), store, undefined, undefined, undefined, {
      runSync: async () => ({ succeeded: true, error: null }),
      runCampaignReview: async () => ({ succeeded: true, error: null, campaignsEvaluated: 5, recommendationsCreated: 2, duplicatesAvoided: 0, blocked: 1, blockedByFreshness: 0 }),
    })
    expect(result.succeeded).toBe(true)
  })

  it('a review with errors reports failure as retryable — transient, not a config problem', async () => {
    const store = createInMemoryAutomationStore()
    const result = await handleAdvertisingCampaignReview(job({ jobType: 'advertising_campaign_review' }), store, undefined, undefined, undefined, {
      runSync: async () => ({ succeeded: true, error: null }),
      runCampaignReview: async () => ({ succeeded: false, error: 'Could not load advertising intelligence: connection timed out.', campaignsEvaluated: 0, recommendationsCreated: 0, duplicatesAvoided: 0, blocked: 0, blockedByFreshness: 0 }),
    })
    expect(result.succeeded).toBe(false)
    expect(result.retryable).toBe(true)
    expect(result.error).toContain('timed out')
  })
})
