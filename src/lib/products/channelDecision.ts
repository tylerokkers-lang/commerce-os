import { err, ok, type Result } from '@/lib/core/result'
import { decisionBlocksExecution, decisionBlockReason } from './decisionGate'
import { PRODUCT_DECISIONS, isValidProductDecision, decisionRequiresAttention } from './decision'
import type { AuditEntry } from '@/lib/audit'
import type { Enums } from '@/lib/supabase/database.types'
import type { ChannelKey, ProductDecision } from '@/lib/core/domain'

/**
 * The operator-controlled CHANNEL-level decision — HANDOVER.md §53's
 * recommended next milestone after the product-level decision (§50,
 * `products/decision.ts`, which this file mirrors line for line). A product
 * can be `add` overall while independently `block` on `amazon_uk`; these
 * are two different gates a caller may need to check, never one collapsed
 * value. Deliberately reuses `ProductDecision`'s existing 7 values
 * (add/block/test/watch/hold/remove/review) rather than inventing a second
 * enum — the same operator permission concept, at finer granularity — and
 * reuses `decisionGate.ts`'s existing `decisionBlocksExecution` unchanged,
 * since "only add/test permit execution" is exactly as true per-channel as
 * it is per-product.
 */

export { PRODUCT_DECISIONS, isValidProductDecision } from './decision'

export function channelDecisionBlockReason(decision: ProductDecision, channel: ChannelKey): string {
  return `${channel} decision is "${decision}" — ${decisionBlockReason(decision)}`
}

export const channelDecisionBlocksExecution = decisionBlocksExecution

export interface ChannelDecisionChangeRequest {
  orgId: string
  productId: string
  channel: ChannelKey
  from: ProductDecision
  to: ProductDecision
  reason: string
  actorType: Enums<'actor_type'>
  actorUserId?: string | null
  actorLabel?: string | null
}

export interface ChannelDecisionChangePlan {
  /** `null` when `from === to` — mirrors `DecisionChangePlan.transitionRow` exactly. */
  transitionRow: {
    org_id: string
    product_id: string
    channel: ChannelKey
    from_decision: ProductDecision | null
    to_decision: ProductDecision
    reason: string
    actor_type: Enums<'actor_type'>
    actor_user_id: string | null
    actor_label: string | null
  } | null
  upsert: {
    org_id: string
    product_id: string
    channel: ChannelKey
    decision: ProductDecision
    decision_reason: string | null
    decision_changed_at: string
  }
  auditEntry: AuditEntry
  decisionChanged: boolean
}

/**
 * Validates and prepares a channel decision change. Nothing is written
 * here — the caller executes `upsert`/`transitionRow`/`auditEntry`
 * together, exactly as `planDecisionChange` already does for the
 * product-level decision.
 */
export function planChannelDecisionChange(request: ChannelDecisionChangeRequest): Result<ChannelDecisionChangePlan, string> {
  if (!isValidProductDecision(request.to)) {
    return err(`"${request.to}" is not a recognised Commerce-OS decision. Valid values: ${PRODUCT_DECISIONS.join(', ')}.`)
  }
  if (!request.reason || request.reason.trim().length < 3) {
    return err('A channel decision change needs a short reason.')
  }

  const decisionChanged = request.from !== request.to
  const reason = request.reason.trim()
  const now = new Date().toISOString()

  return ok({
    transitionRow: decisionChanged
      ? {
          org_id: request.orgId,
          product_id: request.productId,
          channel: request.channel,
          from_decision: request.from,
          to_decision: request.to,
          reason,
          actor_type: request.actorType,
          actor_user_id: request.actorUserId ?? null,
          actor_label: request.actorLabel ?? null,
        }
      : null,
    upsert: {
      org_id: request.orgId,
      product_id: request.productId,
      channel: request.channel,
      decision: request.to,
      decision_reason: reason,
      decision_changed_at: now,
    },
    auditEntry: {
      orgId: request.orgId,
      action: 'CHANNEL_DECISION_CHANGED',
      entityType: 'product',
      entityId: request.productId,
      actorType: request.actorType,
      actorUserId: request.actorUserId ?? null,
      actorLabel: request.actorLabel ?? null,
      previousValue: { channel: request.channel, decision: request.from },
      newValue: { channel: request.channel, decision: request.to },
      reason,
      result: 'success',
      metadata: { decisionChanged, channel: request.channel },
    },
    decisionChanged,
  })
}

export { decisionRequiresAttention }
