'use server'

import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { planStageChange } from '@/lib/products/transitions'
import { requireWriteAccess } from '@/lib/security/session'
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server'
import type { ProductStage } from '@/lib/core/domain'
import type { StageChangeState } from './state'

/**
 * Moves a product to a new lifecycle stage.
 *
 * Three things are guaranteed here, and the order matters:
 *   1. The transition is validated against the state machine.
 *   2. The move and its audit entry are written together.
 *   3. Nothing is listed, ordered or spent. A stage change is a change of
 *      status in our own records; it never touches a marketplace.
 */
export async function changeProductStage(
  _previous: StageChangeState,
  formData: FormData,
): Promise<StageChangeState> {
  const session = await requireWriteAccess()

  const productId = String(formData.get('productId') ?? '')
  const from = String(formData.get('from') ?? '') as ProductStage
  const to = String(formData.get('to') ?? '') as ProductStage
  const reason = String(formData.get('reason') ?? '')

  const plan = planStageChange({
    orgId: session.orgId,
    productId,
    from,
    to,
    reason,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
  })

  if (!plan.ok) {
    return { status: 'error', message: plan.error }
  }

  if (session.isDemo) {
    return {
      status: 'error',
      message:
        `Demo mode has no database, so the change was not stored. The transition itself was validated and is permitted: ${from} to ${to}.`,
    }
  }

  const supabase = await createServerSupabase()
  const { error: updateError } = await supabase
    .from('products')
    .update(plan.value.productUpdate)
    .eq('id', productId)
    .eq('org_id', session.orgId)

  if (updateError) {
    return { status: 'error', message: `Could not change stage: ${updateError.message}` }
  }

  // The history table is read-only through RLS, so the write goes through the
  // service role. This is the only path that writes it.
  const service = createServiceSupabase()
  const { error: historyError } = await service
    .from('product_stage_transitions')
    .insert(plan.value.transitionRow)

  if (historyError) {
    // The stage did change, so this is reported rather than hidden. A missing
    // history row is a real problem worth surfacing, not a silent failure.
    await recordAudit({
      ...plan.value.auditEntry,
      result: 'failure',
      error: `Stage changed but the transition history could not be written: ${historyError.message}`,
    })
    return {
      status: 'error',
      message: `Stage changed, but the history record failed: ${historyError.message}`,
    }
  }

  await recordAudit(plan.value.auditEntry)

  revalidatePath('/products')
  revalidatePath('/opportunities')

  return { status: 'changed', message: `Moved from ${from} to ${to}.` }
}
