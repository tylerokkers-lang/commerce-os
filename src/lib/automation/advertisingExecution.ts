import { assessCampaignActionPolicy, type CampaignActionRequest } from './advertisingAutomation'
import type { AutomationStore } from './store'
import type { AutomationSettings } from './settingsTypes'
import type { AdvertisingProvider } from '@/lib/advertising/connectors/types'
import type { ChannelKey } from '@/lib/core/domain'

/**
 * The advertising campaign action pipeline (Milestone 15). Mirrors
 * `priceExecution.ts`'s shape exactly, split into two functions rather
 * than one, for a reason specific to this milestone:
 *
 *   FACT (synced campaign data) -> assessCampaignActionPolicy (safety
 *   gates, never auto_permitted) -> APPROVAL (always, if not blocked)
 *
 * is `proposeCampaignAction` below — the event-driven entry point a job
 * handler calls, which can only ever end in `blocked` or
 * `require_approval`, never touching the connector.
 *
 *   APPROVED DECISION -> SUBMIT -> VERIFY -> RECONCILE -> AUDIT
 *
 * is `submitCampaignAction` — a separate, independently callable and
 * independently tested function representing what *would* run once a
 * decision is actually approved. It is deliberately not called from
 * `proposeCampaignAction`, and not called from `automation/approvalWorkflow.ts`
 * either: `approveDecision` today has no per-decision-type dispatch at all
 * for *any* action type (price changes included — it always reports "no
 * live executor configured yet," see `docs/SECURITY.md`'s Milestone 15
 * section for the full explanation of this pre-existing gap). Wiring
 * `submitCampaignAction` into `approveDecision` would make advertising
 * more connected than every other decision type in this codebase, which
 * would be inconsistent, not an improvement — so it is built, tested
 * directly, and left unconnected, exactly like `priceExecution.ts`'s own
 * `executePriceChange` already is.
 */

export interface CampaignActionInput {
  orgId: string
  channel: ChannelKey
  externalCampaignId: string
  request: CampaignActionRequest
  /** One execution per real-world action intent — a retried job must reuse the same key. */
  idempotencyKey: string
  jobId?: string
  correlationId?: string
}

export interface CampaignActionResult {
  actionId: string
  policyOutcome: 'allow_automatic' | 'require_approval' | 'block'
  /** Always false from `proposeCampaignAction` — see module comment. Only `submitCampaignAction` can ever set this true. */
  executed: boolean
}

export async function proposeCampaignAction(input: CampaignActionInput, settings: AutomationSettings, store: AutomationStore): Promise<CampaignActionResult> {
  const assessment = assessCampaignActionPolicy(input.request, settings)

  const created = await store.createAutomationAction({
    orgId: input.orgId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actionType: input.request.actionType,
    entityType: 'advertising_campaign',
    entityId: `${input.channel}:${input.externalCampaignId}`,
    reason: assessment.policy.reason,
    inputFacts: {
      currentDailyBudgetMinor: input.request.currentDailyBudgetMinor,
      proposedDailyBudgetMinor: input.request.proposedDailyBudgetMinor,
      isPaused: input.request.isPaused,
      connectionStatus: input.request.connectionStatus,
      dataAgeHours: input.request.dataAgeHours,
      roas: input.request.roas,
    },
    decision: { pctChange: assessment.pctChange },
    policy: assessment.policy,
    automationLevel: settings.automationLevel,
    jobId: input.jobId,
  })

  if (created.alreadyExisted) {
    return { actionId: created.id, policyOutcome: assessment.policy.outcome, executed: created.status === 'succeeded' }
  }

  const notifyBase = { orgId: input.orgId, entityType: 'advertising_campaign', entityId: `${input.channel}:${input.externalCampaignId}`, dedupeKey: `action:${created.id}` }

  if (created.status === 'blocked') {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'advertising', title: `Campaign action blocked for "${input.request.campaignName}"`, body: assessment.policy.reason })
    return { actionId: created.id, policyOutcome: 'block', executed: false }
  }

  // `created.status` can only be 'blocked' or 'requires_approval' here —
  // `assessCampaignActionPolicy` never produces a domain outcome that
  // reaches 'executing'/`allow_automatic`. This branch exists because
  // TypeScript's `AutomationActionStatus` is not narrowed to exclude it,
  // not because it is reachable; see the module comment.
  await store.proposeApproval({
    orgId: input.orgId,
    decisionType: input.request.actionType,
    entityType: 'advertising_campaign',
    entityId: `${input.channel}:${input.externalCampaignId}`,
    title: `${describeActionTitle(input.request)} for "${input.request.campaignName}"`,
    detail: assessment.policy.reason,
    reasoning: assessment.policy.reason,
    confidence: null,
    estimatedImpactMinor: input.request.proposedDailyBudgetMinor !== null && input.request.currentDailyBudgetMinor !== null
      ? Math.abs(input.request.proposedDailyBudgetMinor - input.request.currentDailyBudgetMinor)
      : null,
    automationLevelRequired: settings.automationLevel,
    riskLevel: assessment.policy.riskLevel,
    inputs: { currentDailyBudgetMinor: input.request.currentDailyBudgetMinor, proposedDailyBudgetMinor: input.request.proposedDailyBudgetMinor },
    actionPayload: {
      actionType: input.request.actionType,
      entityType: 'advertising_campaign',
      entityId: `${input.channel}:${input.externalCampaignId}`,
      reason: assessment.policy.reason,
      inputFacts: { channel: input.channel, externalCampaignId: input.externalCampaignId, proposedDailyBudgetMinor: input.request.proposedDailyBudgetMinor },
    },
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  })
  await store.notify({ ...notifyBase, severity: 'approval_required', category: 'advertising', title: `Approval needed: ${describeActionTitle(input.request).toLowerCase()} "${input.request.campaignName}"`, body: assessment.policy.reason, actionUrl: '/approvals' })
  return { actionId: created.id, policyOutcome: 'require_approval', executed: false }
}

function describeActionTitle(request: CampaignActionRequest): string {
  if (request.actionType === 'pause_campaign') return 'Pause campaign'
  return request.actionType === 'increase_ad_budget' ? 'Increase campaign budget' : 'Decrease campaign budget'
}

export interface SubmitCampaignActionInput {
  orgId: string
  channel: ChannelKey
  externalCampaignId: string
  actionType: 'pause_campaign' | 'increase_ad_budget' | 'decrease_ad_budget'
  proposedDailyBudgetMinor: number | null
  connector: AdvertisingProvider
  automationActionId: string
  idempotencyKey: string
}

export interface SubmitCampaignActionResult {
  executed: boolean
  verified: boolean
}

/**
 * SUBMIT -> VERIFY -> RECONCILE for one already-approved campaign action.
 * Never called from `proposeCampaignAction` — see module comment. Exercised
 * directly by `tests/advertising-execution-e2e.test.ts` to prove the
 * mechanics work, independently of the (deliberately unbuilt this
 * milestone) code path that would call it after a real `/approvals` click.
 */
export async function submitCampaignAction(input: SubmitCampaignActionInput, store: AutomationStore): Promise<SubmitCampaignActionResult> {
  const capabilityFlag = input.actionType === 'pause_campaign' ? 'pauseCampaign' : 'setBudget'
  if (!input.connector.descriptor.capabilities[capabilityFlag]) {
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: `This connector does not support ${input.actionType === 'pause_campaign' ? 'pausing campaigns' : 'budget writes'}.`,
      orgId: input.orgId,
      entityType: 'advertising_campaign',
      entityId: `${input.channel}:${input.externalCampaignId}`,
      verificationStatus: 'not_applicable',
      reconciliationStatus: 'not_applicable',
    })
    return { executed: false, verified: false }
  }

  const writeResult = input.actionType === 'pause_campaign'
    ? await input.connector.pauseCampaign({ externalCampaignId: input.externalCampaignId, idempotencyKey: input.idempotencyKey })
    : await input.connector.setCampaignBudget({ externalCampaignId: input.externalCampaignId, idempotencyKey: input.idempotencyKey, dailyBudgetMinor: input.proposedDailyBudgetMinor ?? 0 })

  if (!writeResult.ok) {
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: `${writeResult.error.reason}: ${writeResult.error.detail}`,
      orgId: input.orgId,
      entityType: 'advertising_campaign',
      entityId: `${input.channel}:${input.externalCampaignId}`,
      verificationStatus: 'failed',
      reconciliationStatus: 'not_applicable',
    })
    return { executed: false, verified: false }
  }

  // VERIFY — never assume the write call's own "accepted" response is proof; read it back.
  let verified = false
  let verificationStatus: 'verified' | 'failed' | 'uncertain' = 'uncertain'
  if (input.connector.descriptor.capabilities.verifyWrites) {
    const verifyResult = await input.connector.verifyCampaignState(input.externalCampaignId)
    if (verifyResult.ok) {
      const matches = input.actionType === 'pause_campaign'
        ? verifyResult.value.status === 'paused'
        : verifyResult.value.dailyBudgetMinor === input.proposedDailyBudgetMinor
      verified = matches
      verificationStatus = matches ? 'verified' : 'failed'
    }
  }

  // RECONCILE — only ever applies a change we have actually confirmed.
  if (verified) {
    await store.reconcileAdvertisingCampaign({
      orgId: input.orgId,
      channel: input.channel,
      externalId: input.externalCampaignId,
      ...(input.actionType === 'pause_campaign' ? { isPaused: true } : { dailyBudgetMinor: input.proposedDailyBudgetMinor ?? undefined }),
    })
  }

  await store.completeAutomationAction(input.automationActionId, {
    succeeded: verified,
    error: verified ? null : 'The write was submitted, but the platform could not be confirmed to reflect it.',
    orgId: input.orgId,
    entityType: 'advertising_campaign',
    entityId: `${input.channel}:${input.externalCampaignId}`,
    externalRef: writeResult.value.externalRef,
    verificationStatus,
    reconciliationStatus: verified ? 'matched' : verificationStatus === 'failed' ? 'discrepancy' : 'pending',
  })

  return { executed: verified, verified }
}
