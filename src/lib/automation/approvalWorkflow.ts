import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { SessionContext } from '@/lib/security/session'
import { createAutomationAction } from './actions'
import { factsHaveMaterializedChanged } from './factsComparison'
import { classifyDecisionType, type DecisionExecutionOutcome } from './executionDispatch'
import { executeApprovedPriceChange } from './handlers/priceApprovalExecutor'
import { executeApprovedCampaignAction } from './handlers/advertisingApprovalExecutor'
import { getAutomationSettingsForOrg } from './settings'
import { getSupabaseAutomationStore } from './supabaseStore'
import type { AutomationActionType } from './types'

export { factsHaveMaterializedChanged } from './factsComparison'

/**
 * The formal approval action pipeline (brief §18; execution dispatch added
 * Milestone 16).
 *
 * Milestone 5 deliberately left the Approvals page read-only, noting that
 * approve/reject belonged here. Three rules shape everything below:
 *
 *   1. Approving executes the *exact* action that was proposed — never a
 *      silently recalculated one. `ai_decisions.action_payload` (added in
 *      migration 0019) is captured at proposal time and is what identifies
 *      *what* to execute; this module never re-derives the action type or
 *      target from scratch.
 *   2. If the underlying facts materially changed before execution, the
 *      approval is invalidated rather than executed against stale data —
 *      the same check as before, at approval time (`factsHaveMaterializedChanged`).
 *   3. (Milestone 16) Approval is not itself proof execution is still safe.
 *      Immediately before any connector is touched, the relevant domain
 *      executor (`priceApprovalExecutor.ts`/`advertisingApprovalExecutor.ts`)
 *      re-derives every safety-relevant fact fresh and re-runs the real
 *      policy gate a second time — a genuinely changed fact between
 *      approval and execution (campaign paused in the meantime, connection
 *      dropped, margin no longer clears the minimum) blocks execution at
 *      this second gate even though the decision was already approved.
 *
 * `classifyDecisionType` (`executionDispatch.ts`) is the one routing table:
 * `pricing` -> `priceApprovalExecutor.ts`, `advertising` ->
 * `advertisingApprovalExecutor.ts`, `escalation` (`request_approval`/
 * `review_campaign` — pure "flag for the owner" decisions with nothing
 * external to do) -> marked succeeded directly, nothing dispatched,
 * `unknown` -> an honest "no handler registered" failure, never silently
 * treated as either of the other two. A future domain registers itself in
 * that one table and gets its own executor file — never a special case
 * bolted onto this function.
 */

export interface ApprovalActionPayload {
  actionType: AutomationActionType
  entityType: string
  entityId: string | null
  reason: string
  inputFacts: Record<string, unknown>
}

export type ApprovalOutcome =
  | { status: 'approved'; automationActionId: string }
  | { status: 'rejected' }
  | { status: 'invalidated'; reason: string }
  | { status: 'error'; message: string }

export async function approveDecision(
  session: SessionContext,
  decisionId: string,
  currentFacts?: Record<string, unknown>,
): Promise<ApprovalOutcome> {
  if (session.isDemo) {
    return { status: 'error', message: 'Demo mode has no database — approving is disabled until Supabase is connected.' }
  }

  const supabase = createServiceSupabase()
  const { data: decision, error: loadError } = await supabase
    .from('ai_decisions')
    .select('*')
    .eq('id', decisionId)
    .eq('org_id', session.orgId)
    .maybeSingle()

  if (loadError) return { status: 'error', message: loadError.message }
  if (!decision) return { status: 'error', message: 'Decision not found.' }
  if (decision.status !== 'awaiting_approval') {
    return { status: 'error', message: `Decision is "${decision.status}", not awaiting approval.` }
  }
  if (decision.expires_at && new Date(decision.expires_at) < new Date()) {
    await supabase.from('ai_decisions').update({ status: 'expired' }).eq('id', decisionId)
    await recordAudit({
      orgId: session.orgId,
      action: 'APPROVAL_EXPIRED',
      entityType: decision.entity_type,
      entityId: decision.entity_id ?? undefined,
      actorType: 'system',
      actorLabel: 'Approval expiry check',
      reason: `Expired at ${decision.expires_at}, before anyone approved or rejected it.`,
      aiDecisionId: decisionId,
    })
    return { status: 'invalidated', reason: 'This approval request has expired.' }
  }

  const proposedFacts = (decision.inputs ?? {}) as Record<string, unknown>
  if (currentFacts && factsHaveMaterializedChanged(proposedFacts, currentFacts)) {
    await supabase.from('ai_decisions').update({ status: 'superseded' }).eq('id', decisionId)
    await recordAudit({
      orgId: session.orgId,
      action: 'APPROVAL_INVALIDATED',
      entityType: decision.entity_type,
      entityId: decision.entity_id ?? undefined,
      actorType: 'system',
      actorLabel: 'Approval facts check',
      reason: 'The facts this decision was proposed on have changed; it must be re-evaluated rather than executed as approved.',
      previousValue: proposedFacts,
      newValue: currentFacts,
      aiDecisionId: decisionId,
    })
    return { status: 'invalidated', reason: 'The underlying facts changed since this was proposed. It has been superseded — a fresh evaluation is needed rather than executing stale approval.' }
  }

  const payload = (decision.action_payload ?? {}) as unknown as ApprovalActionPayload

  await supabase
    .from('ai_decisions')
    .update({ status: 'approved', approved_by: session.userId, approved_at: new Date().toISOString() })
    .eq('id', decisionId)

  await recordAudit({
    orgId: session.orgId,
    action: 'APPROVAL_GRANTED',
    entityType: decision.entity_type,
    entityId: decision.entity_id ?? undefined,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
    reason: `Approved: ${decision.recommendation && typeof decision.recommendation === 'object' ? JSON.stringify(decision.recommendation) : decision.decision_type}`,
    aiDecisionId: decisionId,
  })

  // Phase 3 — idempotency: a deterministic key tied to the decision itself
  // means a double-click, two open tabs, or a retried request after a
  // network timeout all resolve to the exact same `automation_actions` row
  // rather than each creating (and potentially each executing) their own.
  const executionIdempotencyKey = `approval:${decisionId}`

  const created = await createAutomationAction({
    orgId: session.orgId,
    idempotencyKey: executionIdempotencyKey,
    actionType: payload.actionType ?? (decision.decision_type as AutomationActionType),
    entityType: payload.entityType ?? decision.entity_type,
    entityId: payload.entityId ?? decision.entity_id,
    reason: payload.reason ?? decision.reasoning,
    inputFacts: payload.inputFacts ?? proposedFacts,
    decision: { approvedByOwner: true },
    policy: {
      outcome: 'allow_automatic',
      requirements: [{ key: 'owner_approval', label: 'Owner approval', satisfied: true, detail: `Approved by ${session.email}.` }],
      reason: 'Approved by the owner.',
      riskLevel: decision.risk_level,
    },
    automationLevel: 'assisted',
    actorType: 'user',
    aiDecisionId: decisionId,
  })

  // A previous call already ran this exact execution to completion —
  // return the cached result rather than re-executing (idempotent replay,
  // Phase 3). A previous call that left it `blocked`/`failed` (network
  // timeout mid-flight, a transient provider error) falls through instead,
  // so a retry can genuinely make progress rather than being stuck forever
  // on one bad attempt.
  if (created.alreadyExisted && created.status === 'succeeded') {
    return { status: 'approved', automationActionId: created.id }
  }

  // `createAutomationAction` can still override the synthetic "allow_automatic"
  // policy above — the runaway-automation safeguard forces `blocked`
  // regardless of what the caller asked for — so dispatch only proceeds
  // when the action is genuinely `executing`, never blindly.
  if (created.status !== 'executing') {
    await supabase
      .from('ai_decisions')
      .update({ status: 'failed', execution_error: `Blocked at execution time: ${created.status}.` })
      .eq('id', decisionId)
    return { status: 'approved', automationActionId: created.id }
  }

  const outcome = await dispatchApprovedExecution(session, decision, payload, created.id, executionIdempotencyKey)
  await applyExecutionOutcome(supabase, session.orgId, decisionId, outcome)

  return { status: 'approved', automationActionId: created.id }
}

/**
 * Phase 2 — the approval execution dispatcher. Classifies the decision
 * type (`executionDispatch.ts`), then calls the one domain executor that
 * owns it — never the browser, never this function itself deciding *how*
 * to execute, only *which* registered handler is allowed to. Every
 * handler independently re-validates organisation scope (every query
 * inside it is `.eq('org_id', session.orgId)`), so this dispatcher itself
 * never has to.
 */
async function dispatchApprovedExecution(
  session: SessionContext,
  decision: { org_id: string; entity_type: string; entity_id: string | null },
  payload: ApprovalActionPayload,
  automationActionId: string,
  idempotencyKey: string,
): Promise<DecisionExecutionOutcome> {
  const decisionType = payload.actionType ?? ''
  const classification = classifyDecisionType(decisionType)
  const facts = (payload.inputFacts ?? {}) as Record<string, unknown>

  if (classification.domain === 'escalation') {
    return { kind: 'no_execution_needed' }
  }

  const settings = await getAutomationSettingsForOrg(session.orgId)
  const store = getSupabaseAutomationStore()

  if (classification.domain === 'pricing') {
    return executeApprovedPriceChange(
      {
        orgId: session.orgId,
        isDemo: session.isDemo,
        automationActionId,
        idempotencyKey,
        entityType: payload.entityType ?? decision.entity_type,
        entityId: payload.entityId ?? decision.entity_id ?? '',
        channelHint: typeof facts.channel === 'string' ? (facts.channel as never) : null,
        productTitle: typeof facts.productTitle === 'string' ? facts.productTitle : 'this product',
        newPriceMinor: typeof facts.newPriceMinor === 'number' ? facts.newPriceMinor : 0,
      },
      settings,
      store,
    )
  }

  if (classification.domain === 'advertising') {
    if (typeof facts.channel !== 'string' || typeof facts.provider !== 'string' || typeof facts.externalCampaignId !== 'string' || typeof facts.externalAccountId !== 'string') {
      return { kind: 'no_handler', reason: 'This campaign decision is missing required identity facts and cannot be dispatched.' }
    }
    return executeApprovedCampaignAction(
      {
        orgId: session.orgId,
        isDemo: session.isDemo,
        automationActionId,
        idempotencyKey,
        actionType: decisionType as 'pause_campaign' | 'increase_ad_budget' | 'decrease_ad_budget',
        channel: facts.channel as never,
        provider: facts.provider as never,
        externalAccountId: facts.externalAccountId,
        externalCampaignId: facts.externalCampaignId,
        campaignName: typeof facts.campaignName === 'string' ? facts.campaignName : 'this campaign',
        classification: typeof facts.classification === 'string' ? (facts.classification as never) : null,
        proposedDailyBudgetMinor: typeof facts.proposedDailyBudgetMinor === 'number' ? facts.proposedDailyBudgetMinor : null,
      },
      settings,
      store,
    )
  }

  return { kind: 'no_handler', reason: `No execution handler is registered for decision type "${decisionType}".` }
}

async function applyExecutionOutcome(
  supabase: ReturnType<typeof createServiceSupabase>,
  orgId: string,
  decisionId: string,
  outcome: DecisionExecutionOutcome,
): Promise<void> {
  const now = new Date().toISOString()

  if (outcome.kind === 'no_execution_needed') {
    await supabase.from('ai_decisions').update({ status: 'executed', executed_at: now }).eq('id', decisionId)
    await recordAudit({ orgId, action: 'AI_DECISION_EXECUTED', entityType: 'ai_decision', entityId: decisionId, actorType: 'system', result: 'success', reason: 'Pure escalation — approval itself is the action; nothing further to execute.', aiDecisionId: decisionId })
    return
  }
  if (outcome.kind === 'executed') {
    await supabase.from('ai_decisions').update({ status: outcome.succeeded ? 'executed' : 'failed', executed_at: now, execution_error: outcome.succeeded ? null : outcome.error }).eq('id', decisionId)
    await recordAudit({ orgId, action: outcome.succeeded ? 'AI_DECISION_EXECUTED' : 'AUTOMATION_ACTION_FAILED', entityType: 'ai_decision', entityId: decisionId, actorType: 'system', result: outcome.succeeded ? 'success' : 'failure', error: outcome.error ?? undefined, aiDecisionId: decisionId })
    return
  }
  if (outcome.kind === 'revalidation_blocked') {
    // Stored under 'failed' — `decision_status` (migration 0008) has no
    // distinct 'blocked' value, and adding one is not justified by this
    // alone (Phase 14). The UI recovers the distinction from this exact
    // "Blocked on revalidation:" prefix rather than a new column.
    await supabase.from('ai_decisions').update({ status: 'failed', executed_at: now, execution_error: `Blocked on revalidation: ${outcome.reason}` }).eq('id', decisionId)
    await recordAudit({ orgId, action: 'AUTOMATION_ACTION_BLOCKED', entityType: 'ai_decision', entityId: decisionId, actorType: 'system', result: 'blocked', reason: outcome.reason, aiDecisionId: decisionId })
    return
  }
  if (outcome.kind === 'no_handler') {
    await supabase.from('ai_decisions').update({ status: 'failed', executed_at: now, execution_error: outcome.reason }).eq('id', decisionId)
    await recordAudit({ orgId, action: 'AUTOMATION_ACTION_FAILED', entityType: 'ai_decision', entityId: decisionId, actorType: 'system', result: 'failure', error: outcome.reason, aiDecisionId: decisionId })
    return
  }
  // 'already_in_progress' is reserved for a future concurrent-claim
  // mechanism — not reachable via any path in this milestone (the
  // idempotency-key short-circuit above handles the "already succeeded"
  // case before this function is ever called).
}

export async function rejectDecision(session: SessionContext, decisionId: string, reason: string): Promise<ApprovalOutcome> {
  if (session.isDemo) {
    return { status: 'error', message: 'Demo mode has no database — rejecting is disabled until Supabase is connected.' }
  }

  const supabase = createServiceSupabase()
  const { data: decision, error: loadError } = await supabase
    .from('ai_decisions')
    .select('id, status, entity_type, entity_id')
    .eq('id', decisionId)
    .eq('org_id', session.orgId)
    .maybeSingle()

  if (loadError) return { status: 'error', message: loadError.message }
  if (!decision) return { status: 'error', message: 'Decision not found.' }
  if (decision.status !== 'awaiting_approval') {
    return { status: 'error', message: `Decision is "${decision.status}", not awaiting approval.` }
  }

  await supabase.from('ai_decisions').update({ status: 'rejected' }).eq('id', decisionId)

  await recordAudit({
    orgId: session.orgId,
    action: 'APPROVAL_REJECTED',
    entityType: decision.entity_type,
    entityId: decision.entity_id ?? undefined,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
    reason,
    aiDecisionId: decisionId,
  })

  return { status: 'rejected' }
}
