import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { SessionContext } from '@/lib/security/session'
import { createAutomationAction, completeAutomationAction } from './actions'
import { factsHaveMaterializedChanged } from './factsComparison'
import type { AutomationActionType } from './types'

export { factsHaveMaterializedChanged } from './factsComparison'

/**
 * The formal approval action pipeline (brief §18).
 *
 * Milestone 5 deliberately left the Approvals page read-only, noting that
 * approve/reject belonged here. Two rules from the brief shape everything
 * below:
 *
 *   1. Approving executes the *exact* action that was proposed — never a
 *      silently recalculated one. `ai_decisions.action_payload` (added in
 *      migration 0019) is captured at proposal time and is what gets
 *      dispatched; this module never re-derives the action from scratch.
 *   2. If the underlying facts materially changed before execution, the
 *      approval is invalidated rather than executed against stale data.
 *      "Materially changed" is judged by comparing the `inputs` snapshot
 *      stored on the decision against the caller-supplied current facts for
 *      the same keys — an exact, auditable comparison, not a guess.
 *
 * What "execute" means here is deliberately honest about a real limitation:
 * no live connector in this codebase yet performs the external write side
 * of switching a supplier, publishing a listing, or processing a refund
 * (Milestone 4 already documented listing writes as "declared but not
 * called anywhere"; Milestone 5 documented the same for refunds needing a
 * payment provider). So approval genuinely changes the decision's status,
 * is genuinely audited, and genuinely creates the `automation_actions`
 * record — but that record's own execution outcome honestly reports that no
 * live executor exists yet, rather than claiming a marketplace or supplier
 * was actually contacted.
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

  const created = await createAutomationAction({
    orgId: session.orgId,
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

  // `createAutomationAction` can still override the synthetic "allow_automatic"
  // policy above — the runaway-automation safeguard forces `blocked`
  // regardless of what the caller asked for — so this only marks completion
  // when the action is genuinely `executing`, never blindly.
  if (created.status === 'executing') {
    // Honest limitation: no live connector in this codebase yet performs the
    // external write side of these actions (see the module comment above).
    await completeAutomationAction(created.id, {
      succeeded: false,
      error: 'Approved, but no live connector or supplier/marketplace writer is configured to execute this action automatically in this environment yet.',
      orgId: session.orgId,
      entityType: payload.entityType ?? decision.entity_type,
      entityId: payload.entityId ?? decision.entity_id,
    })
    await supabase.from('ai_decisions').update({ status: 'failed', execution_error: 'No live executor configured yet.' }).eq('id', decisionId)
  } else {
    await supabase
      .from('ai_decisions')
      .update({ status: 'failed', execution_error: `Blocked at execution time: ${created.status}.` })
      .eq('id', decisionId)
  }

  return { status: 'approved', automationActionId: created.id }
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
