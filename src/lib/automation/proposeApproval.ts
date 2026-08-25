import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { ProposeApprovalInput } from './store'

/**
 * Surfaces a `requires_approval` automation decision on the owner-facing
 * Approvals queue (brief §11). Before this, a job/handler that determined
 * approval was needed only ever wrote an `automation_actions` row — nothing
 * bridged that into `ai_decisions`, so it never actually appeared on
 * `/approvals` for the owner to see or act on. This is that bridge.
 *
 * `actionPayload` is stored verbatim and is exactly what
 * `approvalWorkflow.ts` replays on approval — never recomputed.
 */
export async function proposeApproval(input: ProposeApprovalInput): Promise<{ id: string }> {
  const supabase = createServiceSupabase()

  const { data, error } = await supabase
    .from('ai_decisions')
    .insert({
      org_id: input.orgId,
      decision_type: input.decisionType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      status: 'awaiting_approval',
      inputs: input.inputs as never,
      recommendation: { title: input.title, detail: input.detail } as never,
      reasoning: input.reasoning,
      confidence: input.confidence,
      estimated_impact_minor: input.estimatedImpactMinor,
      automation_level_required: input.automationLevelRequired,
      requires_owner_approval: true,
      risk_level: input.riskLevel,
      action_payload: input.actionPayload as never,
      expires_at: input.expiresAt,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not propose approval: ${error.message}`)

  await recordAudit({
    orgId: input.orgId,
    action: 'APPROVAL_REQUESTED',
    entityType: input.entityType,
    entityId: input.entityId ?? undefined,
    actorType: 'system',
    reason: input.reasoning,
    aiDecisionId: data.id,
  })

  return { id: data.id }
}

/**
 * Milestone 15, Phase 5 — duplicate-pending-action protection. A plain
 * existence check against `ai_decisions`, scoped by org/entity/decision
 * type and `status = 'awaiting_approval'` — the same table
 * `proposeApproval` itself writes to, never a second store of "what's
 * pending."
 */
export async function findPendingCampaignAction(orgId: string, entityType: string, entityId: string, decisionType: string): Promise<{ id: string } | null> {
  const supabase = createServiceSupabase()
  const { data } = await supabase
    .from('ai_decisions')
    .select('id')
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('decision_type', decisionType)
    .eq('status', 'awaiting_approval')
    .limit(1)
    .maybeSingle()

  return data ? { id: data.id } : null
}
