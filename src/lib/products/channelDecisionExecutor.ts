import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications/create'
import { planChannelDecisionChange, decisionRequiresAttention } from './channelDecision'
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server'
import { err, ok, type Result } from '@/lib/core/result'
import type { ChannelKey, ProductDecision } from '@/lib/core/domain'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The one real write path for `channel_product_decisions` — mirrors
 * `products/decisionExecutor.ts` exactly. `channel_product_decisions` is
 * current-state (like `products` itself), written via the user-scoped
 * client so the table's own owner/admin RLS write policy (0036) is what
 * actually enforces permission — not this function. Only the append-only
 * `channel_decision_transitions` history write goes through the service
 * role, same as the product-level pattern.
 */

export interface ExecuteChannelDecisionChangeInput {
  orgId: string
  productId: string
  channel: ChannelKey
  from: ProductDecision
  to: ProductDecision
  reason: string
  actorUserId: string
  actorLabel: string
}

export interface ExecuteChannelDecisionChangeResult {
  channel: ChannelKey
  from: ProductDecision
  to: ProductDecision
  decisionChanged: boolean
}

export async function executeChannelDecisionChange(
  input: ExecuteChannelDecisionChangeInput,
): Promise<Result<ExecuteChannelDecisionChangeResult, string>> {
  const actorType: Enums<'actor_type'> = 'user'

  const plan = planChannelDecisionChange({
    orgId: input.orgId,
    productId: input.productId,
    channel: input.channel,
    from: input.from,
    to: input.to,
    reason: input.reason,
    actorType,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
  })

  if (!plan.ok) return err(plan.error)

  const supabase = await createServerSupabase()
  const { error: upsertError } = await supabase
    .from('channel_product_decisions')
    .upsert(plan.value.upsert, { onConflict: 'org_id,product_id,channel' })

  if (upsertError) return err(`Could not change channel decision: ${upsertError.message}`)

  if (plan.value.transitionRow) {
    const service = createServiceSupabase()
    const { error: historyError } = await service.from('channel_decision_transitions').insert(plan.value.transitionRow)

    if (historyError) {
      await recordAudit({ ...plan.value.auditEntry, result: 'failure', error: `Channel decision changed but the transition history could not be written: ${historyError.message}` })
      return err(`Channel decision changed, but the history record failed: ${historyError.message}`)
    }
  }

  await recordAudit(plan.value.auditEntry)

  if (plan.value.decisionChanged && decisionRequiresAttention(input.to)) {
    await createNotification({
      orgId: input.orgId,
      severity: input.to === 'block' ? 'warning' : 'approval_required',
      category: 'channel_decision',
      title: `Product ${input.productId} decision on ${input.channel} set to "${input.to}"`,
      body: input.reason || `Changed by ${input.actorLabel}.`,
      entityType: 'product',
      entityId: input.productId,
      actionUrl: `/products/${input.productId}`,
      dedupeKey: `channel-decision-change:${input.orgId}:${input.productId}:${input.channel}:${input.to}`,
    })
  }

  return ok({ channel: input.channel, from: input.from, to: input.to, decisionChanged: plan.value.decisionChanged })
}
