import { describe, expect, it } from 'vitest'
import { assessCampaignActionPolicy, MAX_CAMPAIGN_DATA_AGE_HOURS, type CampaignActionRequest } from '@/lib/automation/advertisingAutomation'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'

/**
 * Phases 7/9/10 — the safety-critical domain policy (Milestone 15). The
 * one property every test in the first block proves, directly:
 * `assessCampaignActionPolicy` can NEVER produce `outcome: 'allow_automatic'`
 * — the explicit, structural "no unrestricted automatic campaign changes"
 * boundary the brief requires. Everything else here proves the specific
 * safety gates (Phase 9) and the staleness check (Phase 10).
 */

function request(overrides: Partial<CampaignActionRequest> = {}): CampaignActionRequest {
  return {
    actionType: 'pause_campaign',
    campaignName: 'Test Campaign',
    currentDailyBudgetMinor: 2000,
    proposedDailyBudgetMinor: null,
    isPaused: false,
    connectionStatus: 'connected',
    dataAgeHours: 2,
    roas: 1.2,
    ...overrides,
  }
}

const ALL_ACTION_TYPES = ['pause_campaign', 'increase_ad_budget', 'decrease_ad_budget'] as const

describe('assessCampaignActionPolicy: NEVER auto-permitted, for any input (the explicit dry-run boundary)', () => {
  it.each(ALL_ACTION_TYPES)('%s never reaches allow_automatic even with every gate passing and autonomous automation level', (actionType) => {
    const settings = { ...DEMO_AUTOMATION_SETTINGS, automationLevel: 'autonomous' as const }
    const { policy } = assessCampaignActionPolicy(
      request({ actionType, currentDailyBudgetMinor: 1000, proposedDailyBudgetMinor: actionType === 'pause_campaign' ? null : 1100 }),
      settings,
    )
    expect(policy.outcome).not.toBe('allow_automatic')
    expect(['block', 'require_approval']).toContain(policy.outcome)
  })

  it('a genuinely healthy, fully-passing request still lands on require_approval, not a fake block', () => {
    const { policy } = assessCampaignActionPolicy(request(), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('require_approval')
  })
})

describe('assessCampaignActionPolicy: safety gates (Phase 9)', () => {
  it('missing/no connection blocks the action', () => {
    const { policy } = assessCampaignActionPolicy(request({ connectionStatus: 'not_configured' }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('block')
  })

  it('a degraded connection blocks the action', () => {
    const { policy } = assessCampaignActionPolicy(request({ connectionStatus: 'degraded' }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('block')
  })

  it('a demo connection is treated as live enough to propose (never blocked purely for being demo)', () => {
    const { policy } = assessCampaignActionPolicy(request({ connectionStatus: 'demo' }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('require_approval')
  })

  it('missing data (dataAgeHours null) blocks the action — "missing data" gate', () => {
    const { policy } = assessCampaignActionPolicy(request({ dataAgeHours: null }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('block')
    expect(policy.reason).toContain('Blocked')
  })

  it('pausing an already-paused campaign blocks — "duplicate-action prevention"', () => {
    const { policy } = assessCampaignActionPolicy(request({ actionType: 'pause_campaign', isPaused: true }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('block')
  })

  it('changing budget on a paused campaign blocks', () => {
    const { policy } = assessCampaignActionPolicy(request({ actionType: 'increase_ad_budget', isPaused: true, proposedDailyBudgetMinor: 3000 }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('block')
  })

  it('an unknown current or proposed budget blocks a budget-change action', () => {
    const missingCurrent = assessCampaignActionPolicy(request({ actionType: 'increase_ad_budget', currentDailyBudgetMinor: null, proposedDailyBudgetMinor: 3000 }), DEMO_AUTOMATION_SETTINGS)
    expect(missingCurrent.policy.outcome).toBe('block')
    const missingProposed = assessCampaignActionPolicy(request({ actionType: 'increase_ad_budget', proposedDailyBudgetMinor: null }), DEMO_AUTOMATION_SETTINGS)
    expect(missingProposed.policy.outcome).toBe('block')
  })

  it('a proposed budget exceeding the configured maximum daily ad spend blocks outright — never merely requires approval', () => {
    const { policy } = assessCampaignActionPolicy(
      request({ actionType: 'increase_ad_budget', currentDailyBudgetMinor: 4000, proposedDailyBudgetMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor + 1 }),
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(policy.outcome).toBe('block')
  })

  it('every requirement is machine-readable: key, label, satisfied, detail — never a bare boolean', () => {
    const { policy } = assessCampaignActionPolicy(request({ connectionStatus: 'not_configured' }), DEMO_AUTOMATION_SETTINGS)
    for (const req of policy.requirements) {
      expect(typeof req.key).toBe('string')
      expect(typeof req.label).toBe('string')
      expect(typeof req.satisfied).toBe('boolean')
      expect(typeof req.detail).toBe('string')
    }
    expect(policy.requirements.some((r) => !r.satisfied)).toBe(true)
  })
})

describe('assessCampaignActionPolicy: staleness (Phase 10)', () => {
  it('data exactly at the freshness limit is still fresh (boundary, <=)', () => {
    const { policy } = assessCampaignActionPolicy(request({ dataAgeHours: MAX_CAMPAIGN_DATA_AGE_HOURS }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('require_approval')
  })

  it('data one hour past the freshness limit blocks, with an explicit "stale; fresh synchronization required" explanation naming the age and the limit', () => {
    const { policy } = assessCampaignActionPolicy(request({ dataAgeHours: MAX_CAMPAIGN_DATA_AGE_HOURS + 1 }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('block')
    expect(policy.reason.toLowerCase()).toContain('stale')
    expect(policy.reason).toContain(`${MAX_CAMPAIGN_DATA_AGE_HOURS}h freshness limit`)
  })

  it('very old data (e.g. a week) blocks the same as barely-stale data — no silent tolerance creep', () => {
    const { policy } = assessCampaignActionPolicy(request({ dataAgeHours: 24 * 7 }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.outcome).toBe('block')
  })
})

describe('assessCampaignActionPolicy: percentage-magnitude cap (boundary conditions)', () => {
  it('a budget increase exactly equal to the configured maximum percentage is reported satisfied', () => {
    const current = 1000
    const proposed = Math.round(current * (1 + DEMO_AUTOMATION_SETTINGS.maxAutoAdIncreasePct / 100))
    const { policy, pctChange } = assessCampaignActionPolicy(
      request({ actionType: 'increase_ad_budget', currentDailyBudgetMinor: current, proposedDailyBudgetMinor: proposed }),
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(pctChange).toBeCloseTo(DEMO_AUTOMATION_SETTINGS.maxAutoAdIncreasePct, 0)
    const pctReq = policy.requirements.find((r) => r.label === 'Maximum automatic ad budget change')!
    expect(pctReq.satisfied).toBe(true)
    expect(policy.outcome).toBe('require_approval')
  })

  it('a budget increase past the configured maximum percentage is reported unsatisfied, but still only requires approval (never auto-blocked purely for magnitude, unlike the absolute daily-spend cap)', () => {
    const { policy } = assessCampaignActionPolicy(
      request({ actionType: 'increase_ad_budget', currentDailyBudgetMinor: 1000, proposedDailyBudgetMinor: 1000 + Math.round(1000 * (DEMO_AUTOMATION_SETTINGS.maxAutoAdIncreasePct + 10) / 100) }),
      DEMO_AUTOMATION_SETTINGS,
    )
    const pctReq = policy.requirements.find((r) => r.label === 'Maximum automatic ad budget change')!
    expect(pctReq.satisfied).toBe(false)
    expect(policy.outcome).toBe('require_approval')
    expect(policy.riskLevel).toBe('medium')
  })

  it('a large budget decrease is never blocked by the increase-only percentage magnitude alone', () => {
    const { policy } = assessCampaignActionPolicy(
      request({ actionType: 'decrease_ad_budget', currentDailyBudgetMinor: 4000, proposedDailyBudgetMinor: 100 }),
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(policy.outcome).toBe('require_approval')
  })

  it('a request with no budget component (pause) carries no percentage check at all', () => {
    const { policy, pctChange } = assessCampaignActionPolicy(request({ actionType: 'pause_campaign' }), DEMO_AUTOMATION_SETTINGS)
    expect(pctChange).toBeNull()
    expect(policy.requirements.some((r) => r.label === 'Maximum automatic ad budget change')).toBe(false)
  })
})

describe('assessCampaignActionPolicy: explainability (Phase 5/11 format)', () => {
  it('the reason names the campaign and, for a budget action, the current/proposed values', () => {
    const { policy } = assessCampaignActionPolicy(
      request({ actionType: 'increase_ad_budget', campaignName: 'Christmas Gifts Campaign', currentDailyBudgetMinor: 4200, proposedDailyBudgetMinor: 5000, roas: 0.75 }),
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(policy.reason).toContain('Christmas Gifts Campaign')
    expect(policy.reason).toContain('4200')
    expect(policy.reason).toContain('5000')
    expect(policy.reason).toContain('0.75')
  })

  it('multiple simultaneous gate failures are all named, not just the first', () => {
    const { policy } = assessCampaignActionPolicy(request({ connectionStatus: 'error', dataAgeHours: null }), DEMO_AUTOMATION_SETTINGS)
    expect(policy.reason).toMatch(/connect/i)
    expect(policy.reason).toMatch(/synchroniz/i)
  })
})
