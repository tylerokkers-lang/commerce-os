import { describe, expect, it } from 'vitest'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { proposeCampaignAction, submitCampaignAction, type CampaignActionInput } from '@/lib/automation/advertisingExecution'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { demoAdvertisingConnector } from '@/lib/advertising/connectors/demo'
import type { CampaignActionRequest } from '@/lib/automation/advertisingAutomation'

/**
 * Milestone 15's SUBMIT -> VERIFY -> RECONCILE proof, driven through the
 * real entry points (`proposeCampaignAction`, `submitCampaignAction`)
 * against a real demo advertising connector — never by asserting on the
 * connector's internal state directly. Mirrors
 * `tests/automation-execution-e2e.test.ts` exactly.
 */

const ORG_A = 'org-a'
const ORG_B = 'org-b'

function request(overrides: Partial<CampaignActionRequest> = {}): CampaignActionRequest {
  return {
    actionType: 'pause_campaign',
    campaignName: 'Demo: Wasteful Campaign',
    currentDailyBudgetMinor: 3000,
    proposedDailyBudgetMinor: null,
    isPaused: false,
    connectionStatus: 'demo',
    dataAgeHours: 1,
    roas: 0,
    ...overrides,
  }
}

function input(overrides: Partial<CampaignActionInput> = {}): CampaignActionInput {
  return {
    orgId: ORG_A,
    channel: 'amazon_uk',
    externalCampaignId: 'demo-camp-1',
    request: request(),
    idempotencyKey: 'campaign-evt-1',
    ...overrides,
  }
}

describe('proposeCampaignAction: never touches the connector, always requires approval or blocks', () => {
  it('a healthy, fully-passing proposal reaches requires_approval and creates a real approval — never allow_automatic', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await proposeCampaignAction(input(), DEMO_AUTOMATION_SETTINGS, store)

    expect(result.policyOutcome).toBe('require_approval')
    expect(result.executed).toBe(false)
    expect(store.getState().approvals).toHaveLength(1)
    expect(store.getState().approvals[0].decisionType).toBe('pause_campaign')
    expect(store.getState().notifications[0].severity).toBe('approval_required')
  })

  it('a blocked proposal (stale data) never creates an approval', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await proposeCampaignAction(input({ request: request({ dataAgeHours: null }) }), DEMO_AUTOMATION_SETTINGS, store)

    expect(result.policyOutcome).toBe('block')
    expect(result.executed).toBe(false)
    expect(store.getState().approvals).toHaveLength(0)
    expect(store.getState().notifications[0].severity).toBe('warning')
  })

  it('a budget-increase proposal exceeding the daily spend cap is blocked, never merely flagged', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await proposeCampaignAction(
      input({
        externalCampaignId: 'demo-camp-2',
        request: request({ actionType: 'increase_ad_budget', currentDailyBudgetMinor: 4000, proposedDailyBudgetMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor + 500 }),
      }),
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(result.policyOutcome).toBe('block')
    expect(store.getState().approvals).toHaveLength(0)
  })

  it('resubmitting the same idempotency key never creates a second action or a second approval', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const first = await proposeCampaignAction(input(), DEMO_AUTOMATION_SETTINGS, store)
    const second = await proposeCampaignAction(input(), DEMO_AUTOMATION_SETTINGS, store)

    expect(second.actionId).toBe(first.actionId)
    expect(store.getState().approvals).toHaveLength(1)
  })

  it('organisation isolation: two orgs proposing the identical campaign action never collide', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS, [ORG_B]: DEMO_AUTOMATION_SETTINGS } })

    await proposeCampaignAction(input({ orgId: ORG_A }), DEMO_AUTOMATION_SETTINGS, store)
    await proposeCampaignAction(input({ orgId: ORG_B }), DEMO_AUTOMATION_SETTINGS, store)

    const approvals = store.getState().approvals
    expect(approvals).toHaveLength(2)
    expect(new Set(approvals.map((a) => a.orgId))).toEqual(new Set([ORG_A, ORG_B]))
  })
})

describe('submitCampaignAction: SUBMIT -> VERIFY -> RECONCILE, only ever called for an already-approved action', () => {
  it('a pause is submitted, verified against the platform, and reconciled locally', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const created = await store.createAutomationAction({
      orgId: ORG_A, actionType: 'pause_campaign', entityType: 'advertising_campaign', entityId: 'amazon_uk:demo-camp-1',
      reason: 'test', inputFacts: {}, decision: {}, automationLevel: 'assisted',
      policy: { outcome: 'require_approval', requirements: [], reason: 'test', riskLevel: 'low' },
    })

    const result = await submitCampaignAction(
      { orgId: ORG_A, channel: 'amazon_uk', externalCampaignId: 'demo-camp-1', actionType: 'pause_campaign', proposedDailyBudgetMinor: null, connector: demoAdvertisingConnector, automationActionId: created.id, idempotencyKey: 'submit-1' },
      store,
    )

    expect(result.executed).toBe(true)
    expect(result.verified).toBe(true)
    const action = store.getState().actions.find((a) => a.id === created.id)!
    expect(action.status).toBe('succeeded')
    expect(action.verificationStatus).toBe('verified')
    expect(action.reconciliationStatus).toBe('matched')
    expect(store.getState().advertisingCampaignReconciliations['amazon_uk:demo-camp-1']?.isPaused).toBe(true)

    // Confirm the connector's own state actually changed — not assumed.
    const verified = await demoAdvertisingConnector.verifyCampaignState('demo-camp-1')
    expect(verified.ok && verified.value.status).toBe('paused')
  })

  it('a budget change is submitted, verified, and reconciled', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const created = await store.createAutomationAction({
      orgId: ORG_A, actionType: 'increase_ad_budget', entityType: 'advertising_campaign', entityId: 'amazon_uk:demo-camp-2',
      reason: 'test', inputFacts: {}, decision: {}, automationLevel: 'assisted',
      policy: { outcome: 'require_approval', requirements: [], reason: 'test', riskLevel: 'low' },
    })

    const result = await submitCampaignAction(
      { orgId: ORG_A, channel: 'amazon_uk', externalCampaignId: 'demo-camp-2', actionType: 'increase_ad_budget', proposedDailyBudgetMinor: 4500, connector: demoAdvertisingConnector, automationActionId: created.id, idempotencyKey: 'submit-2' },
      store,
    )

    expect(result.executed).toBe(true)
    expect(store.getState().advertisingCampaignReconciliations['amazon_uk:demo-camp-2']?.dailyBudgetMinor).toBe(4500)
  })

  it('the platform rejecting the write never marks the action succeeded', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const created = await store.createAutomationAction({
      orgId: ORG_A, actionType: 'pause_campaign', entityType: 'advertising_campaign', entityId: 'amazon_uk:no-such-campaign',
      reason: 'test', inputFacts: {}, decision: {}, automationLevel: 'assisted',
      policy: { outcome: 'require_approval', requirements: [], reason: 'test', riskLevel: 'low' },
    })

    const result = await submitCampaignAction(
      { orgId: ORG_A, channel: 'amazon_uk', externalCampaignId: 'no-such-campaign', actionType: 'pause_campaign', proposedDailyBudgetMinor: null, connector: demoAdvertisingConnector, automationActionId: created.id, idempotencyKey: 'submit-3' },
      store,
    )

    expect(result.executed).toBe(false)
    expect(store.getState().actions.find((a) => a.id === created.id)!.status).toBe('failed')
    expect(store.getState().advertisingCampaignReconciliations['amazon_uk:no-such-campaign']).toBeUndefined()
  })

  it('a connector without the required write capability never gets called, and the action fails honestly', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const created = await store.createAutomationAction({
      orgId: ORG_A, actionType: 'pause_campaign', entityType: 'advertising_campaign', entityId: 'amazon_uk:demo-camp-1',
      reason: 'test', inputFacts: {}, decision: {}, automationLevel: 'assisted',
      policy: { outcome: 'require_approval', requirements: [], reason: 'test', riskLevel: 'low' },
    })
    const noPauseConnector: typeof demoAdvertisingConnector = Object.create(demoAdvertisingConnector, {
      descriptor: { value: { ...demoAdvertisingConnector.descriptor, capabilities: { ...demoAdvertisingConnector.descriptor.capabilities, pauseCampaign: false } } },
    })

    const result = await submitCampaignAction(
      { orgId: ORG_A, channel: 'amazon_uk', externalCampaignId: 'demo-camp-1', actionType: 'pause_campaign', proposedDailyBudgetMinor: null, connector: noPauseConnector, automationActionId: created.id, idempotencyKey: 'submit-4' },
      store,
    )

    expect(result.executed).toBe(false)
    const action = store.getState().actions.find((a) => a.id === created.id)!
    expect(action.error).toContain('does not support')
  })

  it('a connector that cannot verify writes never marks the action succeeded, even when the write itself was accepted (uncertain, not success)', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const created = await store.createAutomationAction({
      orgId: ORG_A, actionType: 'pause_campaign', entityType: 'advertising_campaign', entityId: 'amazon_uk:demo-camp-2',
      reason: 'test', inputFacts: {}, decision: {}, automationLevel: 'assisted',
      policy: { outcome: 'require_approval', requirements: [], reason: 'test', riskLevel: 'low' },
    })
    const noVerifyConnector: typeof demoAdvertisingConnector = Object.create(demoAdvertisingConnector, {
      descriptor: { value: { ...demoAdvertisingConnector.descriptor, capabilities: { ...demoAdvertisingConnector.descriptor.capabilities, verifyWrites: false } } },
    })

    const result = await submitCampaignAction(
      { orgId: ORG_A, channel: 'amazon_uk', externalCampaignId: 'demo-camp-2', actionType: 'pause_campaign', proposedDailyBudgetMinor: null, connector: noVerifyConnector, automationActionId: created.id, idempotencyKey: 'submit-5' },
      store,
    )

    expect(result.executed).toBe(false)
    expect(result.verified).toBe(false)
    const action = store.getState().actions.find((a) => a.id === created.id)!
    expect(action.verificationStatus).toBe('uncertain')
    expect(action.status).toBe('failed')
    expect(store.getState().advertisingCampaignReconciliations['amazon_uk:demo-camp-2']).toBeUndefined()
  })
})

describe('Audit trail (Phase 11): every recommendation and execution attempt is recorded', () => {
  it('a proposed, blocked campaign action leaves an audit entry explaining why', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    await proposeCampaignAction(input({ request: request({ dataAgeHours: null }) }), DEMO_AUTOMATION_SETTINGS, store)

    const entries = store.getState().auditLog.filter((e) => e.entityType === 'advertising_campaign')
    expect(entries.some((e) => e.action === 'AUTOMATION_ACTION_BLOCKED')).toBe(true)
  })

  it('a proposed, approval-requiring campaign action leaves an audit entry recording the escalation', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    await proposeCampaignAction(input(), DEMO_AUTOMATION_SETTINGS, store)

    const entries = store.getState().auditLog.filter((e) => e.entityType === 'advertising_campaign')
    expect(entries.some((e) => e.action === 'APPROVAL_REQUESTED')).toBe(true)
  })

  it('a verified, executed submit leaves an audit trail covering both the action outcome and the reconciliation', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const created = await store.createAutomationAction({
      orgId: ORG_A, actionType: 'pause_campaign', entityType: 'advertising_campaign', entityId: 'amazon_uk:demo-camp-1',
      reason: 'test', inputFacts: {}, decision: {}, automationLevel: 'assisted',
      policy: { outcome: 'require_approval', requirements: [], reason: 'test', riskLevel: 'low' },
    })
    await submitCampaignAction(
      { orgId: ORG_A, channel: 'amazon_uk', externalCampaignId: 'demo-camp-1', actionType: 'pause_campaign', proposedDailyBudgetMinor: null, connector: demoAdvertisingConnector, automationActionId: created.id, idempotencyKey: 'audit-1' },
      store,
    )

    const entries = store.getState().auditLog
    expect(entries.some((e) => e.action === 'AUTOMATION_ACTION_EXECUTED')).toBe(true)
    expect(entries.some((e) => e.action === 'ADVERTISING_CHANGED' && e.entityId === 'amazon_uk:demo-camp-1')).toBe(true)
  })
})
