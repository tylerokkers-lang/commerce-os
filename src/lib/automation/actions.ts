import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { Enums } from '@/lib/supabase/database.types'
import { RUNAWAY_MAX_ACTIONS_PER_WINDOW, RUNAWAY_WINDOW_MINUTES, type AdvertisingCampaignReconciliation, type ChannelProductReconciliation, type CompleteActionOutcome, type CreateActionInput } from './store'
import type { AutomationActionType } from './types'

/**
 * The typed automation action record (brief §4), Supabase-backed.
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
 *
 * Also enforces the runaway-automation safeguard (brief §15, `store.ts`):
 * before inserting, counts how many actions of the exact same type have
 * already been created for the exact same entity within the last
 * `RUNAWAY_WINDOW_MINUTES`. At or past `RUNAWAY_MAX_ACTIONS_PER_WINDOW`, the
 * action is forced to `blocked` regardless of what the policy engine
 * decided — a hard backstop independent of any domain engine's own verdict,
 * so a rule that keeps re-triggering itself (a flapping signal repeatedly
 * "switching" and "switching back") cannot execute unboundedly.
 */

const STATUS_BY_POLICY_OUTCOME: Record<'allow_automatic' | 'require_approval' | 'block', Enums<'automation_action_status'>> = {
  allow_automatic: 'executing',
  require_approval: 'requires_approval',
  block: 'blocked',
}

export async function countRecentActionsForEntity(
  orgId: string,
  entityType: string,
  entityId: string | null,
  actionType: AutomationActionType,
  sinceIso: string,
): Promise<number> {
  const supabase = createServiceSupabase()
  let query = supabase
    .from('automation_actions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('action_type', actionType)
    .gte('created_at', sinceIso)

  query = entityId === null ? query.is('entity_id', null) : query.eq('entity_id', entityId)

  const { count, error } = await query
  if (error) throw new Error(`Could not count recent automation actions: ${error.message}`)
  return count ?? 0
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

  const windowStart = new Date(Date.now() - RUNAWAY_WINDOW_MINUTES * 60_000).toISOString()
  const recentCount = await countRecentActionsForEntity(input.orgId, input.entityType, input.entityId ?? null, input.actionType, windowStart)
  const runawayTripped = recentCount >= RUNAWAY_MAX_ACTIONS_PER_WINDOW

  const policyOutcome = input.policy.outcome
  const status = runawayTripped ? 'blocked' : STATUS_BY_POLICY_OUTCOME[policyOutcome]
  const reason = runawayTripped
    ? `Blocked by the runaway-automation safeguard: ${recentCount} "${input.actionType}" actions already recorded for ${input.entityType} ${input.entityId ?? '(none)'} in the last ${RUNAWAY_WINDOW_MINUTES} minutes (limit ${RUNAWAY_MAX_ACTIONS_PER_WINDOW}). ${input.reason}`
    : input.reason

  const { data, error } = await supabase
    .from('automation_actions')
    .insert({
      org_id: input.orgId,
      correlation_id: input.correlationId,
      idempotency_key: input.idempotencyKey ?? null,
      action_type: input.actionType,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      reason,
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
    .select('*')
    .single()

  if (error) {
    // Phase 5 — a genuine concurrent-request race: two callers (a
    // double-click, two open tabs) can both pass the `SELECT` check above
    // before either `INSERT` commits. The `unique(org_id, idempotency_key)`
    // constraint (migration 0019) is what actually prevents two rows for
    // the same real-world action from ever existing; this branch is only
    // what turns the loser's Postgres error into the same graceful
    // "already exists" result the winner's own SELECT-first check would
    // have returned, rather than an unhandled 500. No second idempotency
    // mechanism — this reads back the exact row the constraint protected.
    if (error.code === '23505' && input.idempotencyKey) {
      const { data: raced } = await supabase
        .from('automation_actions')
        .select('id, status')
        .eq('org_id', input.orgId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle()
      if (raced) return { id: raced.id, status: raced.status, alreadyExisted: true }
    }
    throw new Error(`Could not record automation action: ${error.message}`)
  }

  await recordAudit({
    orgId: input.orgId,
    action: status === 'blocked' ? 'AUTOMATION_ACTION_BLOCKED' : status === 'requires_approval' ? 'APPROVAL_REQUESTED' : 'AUTOMATION_ACTION_CREATED',
    entityType: input.entityType,
    entityId: input.entityId ?? undefined,
    actorType: input.actorType ?? 'system',
    reason,
    ruleKey: input.actionType,
    aiDecisionId: input.aiDecisionId ?? undefined,
    metadata: { automationActionId: data.id, policyOutcome, runawayTripped, correlationId: input.correlationId },
  })

  return { id: data.id, status, alreadyExisted: false }
}

/**
 * Marks an action's real-world execution outcome. Never guesses success —
 * the caller must have actually attempted the underlying operation (a
 * supplier switch, a price change, a refund) before calling this.
 */
export async function completeAutomationAction(actionId: string, outcome: CompleteActionOutcome): Promise<void> {
  const supabase = createServiceSupabase()
  const status: Enums<'automation_action_status'> = outcome.succeeded ? 'succeeded' : 'failed'

  const { error } = await supabase
    .from('automation_actions')
    .update({
      status,
      error: outcome.error ?? null,
      completed_at: new Date().toISOString(),
      external_ref: outcome.externalRef ?? null,
      verification_status: outcome.verificationStatus ?? (outcome.succeeded ? 'not_applicable' : 'not_applicable'),
      reconciliation_status: outcome.reconciliationStatus ?? 'not_applicable',
    })
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

/**
 * The RECONCILE step: applies a verified external change to our own
 * `channel_products` record. Callers must only reach this after a
 * `verifyListingState` (or equivalent) call has confirmed the marketplace's
 * own state — never speculatively from a write's own "accepted" response.
 */
export async function reconcileChannelProduct(input: ChannelProductReconciliation): Promise<void> {
  const supabase = createServiceSupabase()
  const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() }
  if (input.priceMinor !== undefined) patch.price_minor = input.priceMinor
  if (input.status !== undefined) patch.status = input.status
  if (input.fulfilmentSupplierId !== undefined) patch.fulfilment_supplier_id = input.fulfilmentSupplierId

  const { error } = await supabase.from('channel_products').update(patch as never).eq('org_id', input.orgId).eq('id', input.channelProductId)
  if (error) throw new Error(`Could not reconcile channel product ${input.channelProductId}: ${error.message}`)

  await recordAudit({
    orgId: input.orgId,
    action: 'CHANNEL_PRODUCT_RECONCILED',
    entityType: 'channel_product',
    entityId: input.channelProductId,
    actorType: 'system',
    reason: 'Reconciled local record with the marketplace\'s verified state after an automated write.',
    newValue: patch,
  })
}

/**
 * The advertising equivalent of `reconcileChannelProduct` (Milestone 15) —
 * same discipline: a partial patch applied only after a verified external
 * write, never speculatively, never inserting a new row with fabricated
 * metrics. Reconciles the most recent existing `advertising` row for this
 * campaign; if none exists, there is nothing real to reconcile against
 * (the safety gates in `advertisingAutomation.ts` never propose an action
 * against a campaign with no synced data in the first place).
 */
export async function reconcileAdvertisingCampaign(input: AdvertisingCampaignReconciliation): Promise<void> {
  const supabase = createServiceSupabase()
  const patch: Record<string, unknown> = { synced_at: new Date().toISOString() }
  if (input.isPaused !== undefined) patch.is_paused = input.isPaused
  if (input.dailyBudgetMinor !== undefined) patch.daily_budget_minor = input.dailyBudgetMinor

  const { data: latest } = await supabase
    .from('advertising')
    .select('id')
    .eq('org_id', input.orgId).eq('channel', input.channel).eq('external_id', input.externalId)
    .order('period_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latest) {
    throw new Error(`No advertising row found to reconcile for campaign ${input.externalId} on ${input.channel} — a real synced row must exist before an action can be reconciled against it.`)
  }

  const { error } = await supabase.from('advertising').update(patch as never).eq('id', latest.id)
  if (error) throw new Error(`Could not reconcile advertising campaign ${input.externalId}: ${error.message}`)

  await recordAudit({
    orgId: input.orgId,
    action: 'ADVERTISING_CHANGED',
    entityType: 'advertising_campaign',
    entityId: `${input.channel}:${input.externalId}`,
    actorType: 'system',
    reason: 'Reconciled local record with the advertising platform\'s verified state after an automated write.',
    newValue: patch,
  })
}
