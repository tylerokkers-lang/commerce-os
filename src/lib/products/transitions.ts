import { err, ok, type Result } from '@/lib/core/result'
import { checkGates, planTransition, type GateState } from './lifecycle'
import type { AuditAction, AuditEntry } from '@/lib/audit'
import type { Enums, Json } from '@/lib/supabase/database.types'
import type { ProductStage } from '@/lib/core/domain'

/**
 * Stage changes, prepared as data.
 *
 * Kept pure and separate from the code that writes them so the rule "every
 * state change is audited" is testable rather than merely intended: there is
 * exactly one function that produces a stage change, and it always produces the
 * audit entry alongside the row.
 */

export interface StageChangeRequest {
  orgId: string
  productId: string
  from: ProductStage
  to: ProductStage
  reason: string
  actorType: Enums<'actor_type'>
  actorUserId?: string | null
  actorLabel?: string | null
  opportunityScore?: number | null
  evidence?: Record<string, unknown>
  aiDecisionId?: string | null
  /** Gate state, when the target stage has prerequisites. */
  gates?: GateState
}

export interface StageChangePlan {
  transitionRow: {
    org_id: string
    product_id: string
    from_stage: ProductStage
    to_stage: ProductStage
    reason: string
    actor_type: Enums<'actor_type'>
    actor_user_id: string | null
    actor_label: string | null
    opportunity_score: number | null
    evidence: Json
    ai_decision_id: string | null
  }
  productUpdate: { stage: ProductStage }
  auditEntry: AuditEntry
}

/**
 * Narrows arbitrary evidence to something the database can actually store.
 *
 * A round trip through JSON is the honest conversion: it drops functions,
 * `undefined` and symbols exactly as the column would, rather than asserting a
 * type and discovering the difference at insert time.
 */
function toJson(value: Record<string, unknown>): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

const ACTION_FOR_STAGE: Partial<Record<ProductStage, AuditAction>> = {
  rejected: 'PRODUCT_REMOVED',
  removed: 'PRODUCT_REMOVED',
}

/**
 * Validates a stage change and produces everything needed to record it.
 *
 * Returns a `Result`: a refused transition is a normal outcome the caller must
 * surface, not an exception. Nothing is written here, so a plan can be built,
 * inspected and asserted on without a database.
 */
export function planStageChange(request: StageChangeRequest): Result<StageChangePlan, string> {
  const planned = planTransition({
    from: request.from,
    to: request.to,
    reason: request.reason,
  })
  if (!planned.ok) return planned

  if (request.gates) {
    const gate = checkGates(request.to, request.gates)
    if (!gate.satisfied) {
      return err(
        `Cannot move to "${request.to}" yet: ${gate.missing.join(' ')}`,
      )
    }
  }

  const evidence = request.evidence ?? {}

  return ok({
    transitionRow: {
      org_id: request.orgId,
      product_id: request.productId,
      from_stage: request.from,
      to_stage: request.to,
      reason: planned.value.reason,
      actor_type: request.actorType,
      actor_user_id: request.actorUserId ?? null,
      actor_label: request.actorLabel ?? null,
      opportunity_score: request.opportunityScore ?? null,
      evidence: toJson(evidence),
      ai_decision_id: request.aiDecisionId ?? null,
    },
    productUpdate: { stage: request.to },
    auditEntry: {
      orgId: request.orgId,
      action: ACTION_FOR_STAGE[request.to] ?? 'PRODUCT_STAGE_CHANGED',
      entityType: 'product',
      entityId: request.productId,
      actorType: request.actorType,
      actorUserId: request.actorUserId ?? null,
      actorLabel: request.actorLabel ?? null,
      previousValue: { stage: request.from },
      newValue: { stage: request.to },
      reason: planned.value.reason,
      aiDecisionId: request.aiDecisionId ?? null,
      result: 'success',
      metadata: {
        opportunityScore: request.opportunityScore ?? null,
        ...evidence,
      },
    },
  })
}
