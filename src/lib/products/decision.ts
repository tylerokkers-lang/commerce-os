import { err, ok, type Result } from '@/lib/core/result'
import type { AuditEntry } from '@/lib/audit'
import type { Enums } from '@/lib/supabase/database.types'
import type { ProductDecision } from '@/lib/core/domain'

/**
 * The operator-controlled product decision (ADD/BLOCK/TEST/WATCH/HOLD/
 * REMOVE/REVIEW) — a distinct concept from `products/lifecycle.ts`'s
 * `stage`, which is a discovery-to-trading pipeline *position*. This is an
 * operator *permission*: it does not progress through a fixed graph the way
 * `stage` does, so unlike `planStageChange` (`products/transitions.ts`,
 * the sibling this file otherwise mirrors exactly), there is no `ALLOWED`
 * map here — any decision may move to any other. `ADD → TEST → BLOCK` and
 * back again must all be valid; refusing a transition here would be
 * refusing the operator's own explicit instruction, which is the one thing
 * this feature exists to honour.
 */

export const PRODUCT_DECISIONS: readonly ProductDecision[] = ['add', 'block', 'test', 'watch', 'hold', 'remove', 'review']

export function isValidProductDecision(value: string): value is ProductDecision {
  return (PRODUCT_DECISIONS as readonly string[]).includes(value)
}

export interface DecisionChangeRequest {
  orgId: string
  productId: string
  from: ProductDecision
  to: ProductDecision
  reason: string
  actorType: Enums<'actor_type'>
  actorUserId?: string | null
  actorLabel?: string | null
}

export interface DecisionChangePlan {
  /**
   * `null` when `from === to` — a same-value resubmission (e.g. editing
   * only the reason) is a valid, idempotent operation, but
   * `product_decision_transitions` records CHANGES, so no row is written
   * for a non-change. The audit entry is still produced either way, so a
   * reason-only edit remains fully auditable.
   */
  transitionRow: {
    org_id: string
    product_id: string
    from_decision: ProductDecision | null
    to_decision: ProductDecision
    reason: string
    actor_type: Enums<'actor_type'>
    actor_user_id: string | null
    actor_label: string | null
  } | null
  productUpdate: { decision: ProductDecision; decision_reason: string | null; decision_changed_at: string }
  auditEntry: AuditEntry
  decisionChanged: boolean
}

const REQUIRES_ATTENTION: readonly ProductDecision[] = ['review', 'block']

export const decisionRequiresAttention = (decision: ProductDecision): boolean => REQUIRES_ATTENTION.includes(decision)

/**
 * Validates and prepares a decision change. Nothing is written here — the
 * caller executes `productUpdate`/`transitionRow`/`auditEntry` together,
 * exactly as `planStageChange` already does for `stage`.
 */
export function planDecisionChange(request: DecisionChangeRequest): Result<DecisionChangePlan, string> {
  if (!isValidProductDecision(request.to)) {
    return err(`"${request.to}" is not a recognised Commerce-OS decision. Valid values: ${PRODUCT_DECISIONS.join(', ')}.`)
  }
  if (!request.reason || request.reason.trim().length < 3) {
    return err('A product decision change needs a short reason.')
  }

  const decisionChanged = request.from !== request.to
  const reason = request.reason.trim()
  const now = new Date().toISOString()

  return ok({
    transitionRow: decisionChanged
      ? {
          org_id: request.orgId,
          product_id: request.productId,
          from_decision: request.from,
          to_decision: request.to,
          reason,
          actor_type: request.actorType,
          actor_user_id: request.actorUserId ?? null,
          actor_label: request.actorLabel ?? null,
        }
      : null,
    productUpdate: { decision: request.to, decision_reason: reason, decision_changed_at: now },
    auditEntry: {
      orgId: request.orgId,
      action: 'PRODUCT_DECISION_CHANGED',
      entityType: 'product',
      entityId: request.productId,
      actorType: request.actorType,
      actorUserId: request.actorUserId ?? null,
      actorLabel: request.actorLabel ?? null,
      previousValue: { decision: request.from },
      newValue: { decision: request.to },
      reason,
      result: 'success',
      metadata: { decisionChanged },
    },
    decisionChanged,
  })
}
