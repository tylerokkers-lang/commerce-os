import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications/create'
import { planDecisionChange, decisionRequiresAttention } from './decision'
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server'
import { err, ok, type Result } from '@/lib/core/result'
import type { ProductDecision } from '@/lib/core/domain'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The one real write path for `products.decision` — shared by the
 * `changeProductDecision` Server Action (`products/actions.ts`, form-driven)
 * and `POST /api/products/[id]/decision` (JSON-driven), so the actual
 * update+history+audit+notification sequence exists exactly once rather
 * than being duplicated between the two callers. Neither caller talks to
 * Postgres directly for this write; both go through here.
 */

export interface ExecuteDecisionChangeInput {
  orgId: string
  productId: string
  from: ProductDecision
  to: ProductDecision
  reason: string
  actorUserId: string
  actorLabel: string
}

export interface ExecuteDecisionChangeResult {
  from: ProductDecision
  to: ProductDecision
  decisionChanged: boolean
}

export async function executeDecisionChange(input: ExecuteDecisionChangeInput): Promise<Result<ExecuteDecisionChangeResult, string>> {
  const actorType: Enums<'actor_type'> = 'user'

  const plan = planDecisionChange({
    orgId: input.orgId,
    productId: input.productId,
    from: input.from,
    to: input.to,
    reason: input.reason,
    actorType,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
  })

  if (!plan.ok) return err(plan.error)

  const supabase = await createServerSupabase()
  const { error: updateError } = await supabase.from('products').update(plan.value.productUpdate).eq('id', input.productId).eq('org_id', input.orgId)

  if (updateError) return err(`Could not change decision: ${updateError.message}`)

  if (plan.value.transitionRow) {
    const service = createServiceSupabase()
    const { error: historyError } = await service.from('product_decision_transitions').insert(plan.value.transitionRow)

    if (historyError) {
      await recordAudit({ ...plan.value.auditEntry, result: 'failure', error: `Decision changed but the transition history could not be written: ${historyError.message}` })
      return err(`Decision changed, but the history record failed: ${historyError.message}`)
    }
  }

  await recordAudit(plan.value.auditEntry)

  if (plan.value.decisionChanged && decisionRequiresAttention(input.to)) {
    await createNotification({
      orgId: input.orgId,
      severity: input.to === 'block' ? 'warning' : 'approval_required',
      category: 'product_decision',
      title: `Product ${input.productId} decision set to "${input.to}"`,
      body: input.reason || `Changed by ${input.actorLabel}.`,
      entityType: 'product',
      entityId: input.productId,
      actionUrl: `/products/${input.productId}`,
      dedupeKey: `decision-change:${input.orgId}:${input.productId}:${input.to}`,
    })
  }

  return ok({ from: input.from, to: input.to, decisionChanged: plan.value.decisionChanged })
}
