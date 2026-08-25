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
 *
 * Campaign identity (`provider`/`externalAccountId`/`externalCampaignId`)
 * lives entirely on `CampaignActionRequest` (`advertisingAutomation.ts`) —
 * `CampaignActionInput` below adds only `channel` (a routing/attribution
 * fact, not identity) and execution metadata (idempotency, job/correlation
 * ids), so there is exactly one place a campaign's identity is stated,
 * never two fields that could silently drift apart.
 */

export interface CampaignActionInput {
  orgId: string
  /** The sales channel this campaign's spend is attributed to — routing, not identity. See `CampaignActionRequest`'s own comment on why this is never conflated with `provider`. */
  channel: ChannelKey
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
  /** True when this call found and returned an already-pending proposal for the same campaign+action rather than creating a new one (Phase 5 — duplicate-pending-action protection). */
  wasDuplicate: boolean
}

function entityIdFor(channel: ChannelKey, externalCampaignId: string): string {
  return `${channel}:${externalCampaignId}`
}

function thresholdsSnapshot(settings: AutomationSettings) {
  return { maxDailyAdSpendMinor: settings.maxDailyAdSpendMinor, minRoas: settings.minRoas, maxAutoAdIncreasePct: settings.maxAutoAdIncreasePct }
}

export async function proposeCampaignAction(input: CampaignActionInput, settings: AutomationSettings, store: AutomationStore): Promise<CampaignActionResult> {
  const entityId = entityIdFor(input.channel, input.request.externalCampaignId)

  // Phase 5 — duplicate-pending-action protection: never create a second
  // "please review this" when one for the exact same campaign+action is
  // already sitting in the approvals queue. This is deliberately a
  // separate check from `createAutomationAction`'s own idempotency-key
  // uniqueness (which only catches the *same event* retried with the same
  // key) and from the runaway-automation safeguard baked into
  // `createAutomationAction` (which counts *any* actions, including
  // already-decided ones, in a rolling window) — this one specifically
  // asks "is there already something awaiting the owner's decision right
  // now," which neither of those answers.
  const pending = await store.findPendingCampaignAction(input.orgId, 'advertising_campaign', entityId, input.request.actionType)
  if (pending) {
    return { actionId: pending.id, policyOutcome: 'require_approval', executed: false, wasDuplicate: true }
  }

  const assessment = assessCampaignActionPolicy(input.request, settings)

  const inputFacts = {
    provider: input.request.provider,
    externalAccountId: input.request.externalAccountId,
    externalCampaignId: input.request.externalCampaignId,
    channel: input.channel,
    campaignName: input.request.campaignName,
    classification: input.request.classification,
    currentDailyBudgetMinor: input.request.currentDailyBudgetMinor,
    proposedDailyBudgetMinor: input.request.proposedDailyBudgetMinor,
    isPaused: input.request.isPaused,
    connectionStatus: input.request.connectionStatus,
    dataAgeHours: input.request.dataAgeHours,
    roas: input.request.roas,
    metricsSnapshot: input.request.metricsSnapshot ?? null,
    thresholds: thresholdsSnapshot(settings),
  }

  const created = await store.createAutomationAction({
    orgId: input.orgId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actionType: input.request.actionType,
    entityType: 'advertising_campaign',
    entityId,
    reason: assessment.policy.reason,
    inputFacts,
    decision: { pctChange: assessment.pctChange },
    policy: assessment.policy,
    automationLevel: settings.automationLevel,
    jobId: input.jobId,
  })

  if (created.alreadyExisted) {
    return { actionId: created.id, policyOutcome: assessment.policy.outcome, executed: created.status === 'succeeded', wasDuplicate: false }
  }

  const notifyBase = { orgId: input.orgId, entityType: 'advertising_campaign', entityId, dedupeKey: `action:${created.id}` }

  if (created.status === 'blocked') {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'advertising', title: `Campaign action blocked for "${input.request.campaignName}"`, body: assessment.policy.reason })
    return { actionId: created.id, policyOutcome: 'block', executed: false, wasDuplicate: false }
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
    entityId,
    title: `${describeActionTitle(input.request)} for "${input.request.campaignName}"`,
    detail: assessment.policy.reason,
    reasoning: assessment.policy.reason,
    confidence: null,
    estimatedImpactMinor: input.request.proposedDailyBudgetMinor !== null && input.request.currentDailyBudgetMinor !== null
      ? Math.abs(input.request.proposedDailyBudgetMinor - input.request.currentDailyBudgetMinor)
      : null,
    automationLevelRequired: settings.automationLevel,
    riskLevel: assessment.policy.riskLevel,
    inputs: inputFacts,
    actionPayload: {
      actionType: input.request.actionType,
      entityType: 'advertising_campaign',
      entityId,
      reason: assessment.policy.reason,
      inputFacts,
    },
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  })
  await store.notify({ ...notifyBase, severity: 'approval_required', category: 'advertising', title: `Approval needed: ${describeActionTitle(input.request).toLowerCase()} "${input.request.campaignName}"`, body: assessment.policy.reason, actionUrl: '/approvals' })
  return { actionId: created.id, policyOutcome: 'require_approval', executed: false, wasDuplicate: false }
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
  /**
   * Phase 7 — dry-run mode. When true, no write is ever sent to the
   * connector: the whole SUBMIT step is skipped and a clearly-labelled
   * simulated result is returned instead. `reconcileAdvertisingCampaign`
   * is never called in this mode, so a dry run can never change what this
   * system believes about the campaign, let alone the real platform.
   */
  dryRun?: boolean
}

export interface SubmitCampaignActionResult {
  executed: boolean
  verified: boolean
  /** True only when this call was a dry run — `executed`/`verified` are always false alongside it, since nothing real happened. */
  simulated: boolean
}

/**
 * SUBMIT -> VERIFY -> RECONCILE for one already-approved campaign action.
 * Never called from `proposeCampaignAction` — see module comment. Exercised
 * directly by `tests/advertising-execution-e2e.test.ts` to prove the
 * mechanics work, independently of the (deliberately unbuilt this
 * milestone) code path that would call it after a real `/approvals` click.
 */
export async function submitCampaignAction(input: SubmitCampaignActionInput, store: AutomationStore): Promise<SubmitCampaignActionResult> {
  const entityId = entityIdFor(input.channel, input.externalCampaignId)

  if (input.dryRun) {
    await store.recordAudit({
      orgId: input.orgId, action: 'ADVERTISING_DRY_RUN_EXECUTED', entityType: 'advertising_campaign', entityId,
      actorType: 'system', result: 'success',
      reason: `Dry run: would have ${input.actionType === 'pause_campaign' ? 'paused this campaign' : `set its daily budget to ${input.proposedDailyBudgetMinor} minor units`} via ${input.connector.descriptor.label} — no write was sent, nothing on the real platform changed.`,
      metadata: { automationActionId: input.automationActionId, actionType: input.actionType, proposedDailyBudgetMinor: input.proposedDailyBudgetMinor },
    })
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: 'Dry run only — no write was sent to the platform. Re-run without dryRun to execute for real.',
      orgId: input.orgId,
      entityType: 'advertising_campaign',
      entityId,
      verificationStatus: 'not_applicable',
      reconciliationStatus: 'not_applicable',
    })
    return { executed: false, verified: false, simulated: true }
  }

  const capabilityFlag = input.actionType === 'pause_campaign' ? 'pauseCampaign' : 'setBudget'
  if (!input.connector.descriptor.capabilities[capabilityFlag]) {
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: `This connector does not support ${input.actionType === 'pause_campaign' ? 'pausing campaigns' : 'budget writes'}.`,
      orgId: input.orgId,
      entityType: 'advertising_campaign',
      entityId,
      verificationStatus: 'not_applicable',
      reconciliationStatus: 'not_applicable',
    })
    return { executed: false, verified: false, simulated: false }
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
      entityId,
      verificationStatus: 'failed',
      reconciliationStatus: 'not_applicable',
    })
    return { executed: false, verified: false, simulated: false }
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
    entityId,
    externalRef: writeResult.value.externalRef,
    verificationStatus,
    reconciliationStatus: verified ? 'matched' : verificationStatus === 'failed' ? 'discrepancy' : 'pending',
  })

  return { executed: verified, verified, simulated: false }
}
