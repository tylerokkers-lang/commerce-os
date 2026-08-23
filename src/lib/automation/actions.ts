import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { Enums } from '@/lib/supabase/database.types'
import type { AutomationActionType, AutomationLevel, PolicyResult } from './types'

/**
 * The typed automation action record (brief §4).
 *
 * Live mode only — demo mode has no database to persist a row against, and
 * demo scenarios (`automation/demoScenarios.ts`) render the same decision
 * logic's output directly rather than writing and reading it back, matching
 * every other demo-mode module in this codebase.
 *
 * `automation_actions` is the fact-first record of one decision and its
 * execution outcome; every write here is paired with a generic `audit_logs`
 * entry via `recordAudit`, since the two serve different readers — this
 * table is queried by entity/action-type for "what has the engine done to
 * X", while `audit_logs` is the org-wide chronological ledger.
 */

export interface CreateActionInput {
  orgId: string
  correlationId?: string
  idempotencyKey?: string | null
  actionType: AutomationActionType
  entityType: string
  entityId?: string | null
  reason: string
  inputFacts: Record<string, unknown>
  decision: Record<string, unknown>
  policy: PolicyResult
  automationLevel: AutomationLevel
  expectedOutcome?: string | null
  actorType?: Enums<'actor_type'>
  aiDecisionId?: string | null
  jobId?: string | null
}

const STATUS_BY_POLICY_OUTCOME: Record<PolicyResult['outcome'], Enums<'automation_action_status'>> = {
  allow_automatic: 'executing',
  require_approval: 'requires_approval',
  block: 'blocked',
}

/**
 * Creates the action record for one decision, honouring its idempotency key
 * if given: a duplicate event (the same key) returns the existing row rather
 * than creating a second one, which is what makes the automation engine safe
 * against duplicate webhooks and re-fired jobs (brief §23).
 */
export async function createAutomationAction(
  input: CreateActionInput,
): Promise<{ id: string; status: Enums<'automation_action_status'>; alreadyExisted: boolean }> {
  const supabase = createServiceSupabase()

  if (input.idempotencyKey) {
    const { data: existing } = await supabase
      .from('automation_actions')
      .select('id, status')
      .eq('org_id', input.orgId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()
    if (existing) return { id: existing.id, status: existing.status, alreadyExisted: true }
  }

  const status = STATUS_BY_POLICY_OUTCOME[input.policy.outcome]

  const { data, error } = await supabase
    .from('automation_actions')
    .insert({
      org_id: input.orgId,
      correlation_id: input.correlationId,
      idempotency_key: input.idempotencyKey ?? null,
      action_type: input.actionType,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      reason: input.reason,
      input_facts: input.inputFacts as never,
      decision: input.decision as never,
      policy_result: input.policy as never,
      automation_level: input.automationLevel,
      risk_level: input.policy.riskLevel,
      expected_outcome: input.expectedOutcome ?? null,
      status,
      actor_type: input.actorType ?? 'system',
      ai_decision_id: input.aiDecisionId ?? null,
      job_id: input.jobId ?? null,
      completed_at: status === 'executing' ? null : new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not record automation action: ${error.message}`)

  await recordAudit({
    orgId: input.orgId,
    action: status === 'blocked' ? 'AUTOMATION_ACTION_BLOCKED' : status === 'requires_approval' ? 'APPROVAL_REQUESTED' : 'AUTOMATION_ACTION_CREATED',
    entityType: input.entityType,
    entityId: input.entityId ?? undefined,
    actorType: input.actorType ?? 'system',
    reason: input.reason,
    ruleKey: input.actionType,
    aiDecisionId: input.aiDecisionId ?? undefined,
    metadata: { automationActionId: data.id, policyOutcome: input.policy.outcome },
  })

  return { id: data.id, status, alreadyExisted: false }
}

/**
 * Marks an action's real-world execution outcome. Never guesses success —
 * the caller must have actually attempted the underlying operation (a
 * supplier switch, a price change, a refund) before calling this.
 */
export async function completeAutomationAction(
  actionId: string,
  outcome: { succeeded: boolean; error?: string | null; orgId: string; entityType: string; entityId?: string | null },
): Promise<void> {
  const supabase = createServiceSupabase()
  const status: Enums<'automation_action_status'> = outcome.succeeded ? 'succeeded' : 'failed'

  const { error } = await supabase
    .from('automation_actions')
    .update({ status, error: outcome.error ?? null, completed_at: new Date().toISOString() })
    .eq('id', actionId)

  if (error) throw new Error(`Could not complete automation action: ${error.message}`)

  await recordAudit({
    orgId: outcome.orgId,
    action: outcome.succeeded ? 'AUTOMATION_ACTION_EXECUTED' : 'AUTOMATION_ACTION_FAILED',
    entityType: outcome.entityType,
    entityId: outcome.entityId ?? undefined,
    actorType: 'system',
    reason: outcome.succeeded ? 'Automation action executed successfully.' : (outcome.error ?? 'Automation action failed.'),
    result: outcome.succeeded ? 'success' : 'failure',
    error: outcome.error ?? undefined,
    metadata: { automationActionId: actionId },
  })
}
