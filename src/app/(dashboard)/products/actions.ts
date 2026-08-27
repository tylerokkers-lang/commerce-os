'use server'

import { revalidatePath } from 'next/cache'
import { executeDecisionChange } from '@/lib/products/decisionExecutor'
import { executeChannelDecisionChange } from '@/lib/products/channelDecisionExecutor'
import { requireWriteAccess } from '@/lib/security/session'
import type { ChannelKey, ProductDecision } from '@/lib/core/domain'
import type { DecisionChangeState } from './state'

/**
 * Changes a product's operator-controlled Commerce-OS decision — mirrors
 * `opportunities/actions.ts`'s `changeProductStage` in shape (a form-driven
 * Server Action) but delegates the actual write sequence to
 * `products/decisionExecutor.ts`'s `executeDecisionChange`, the one shared
 * path this and `POST /api/products/[id]/decision` both use. This is the
 * ONLY UI-facing way `products.decision` is ever written — no automated
 * code path anywhere sets it; only an authorised, session-authenticated
 * person, here or via the equivalent API route.
 *
 * A decision change never itself lists, prices, orders or spends — it only
 * changes an internal control other gates read.
 */
export async function changeProductDecision(
  _previous: DecisionChangeState,
  formData: FormData,
): Promise<DecisionChangeState> {
  const session = await requireWriteAccess()

  const productId = String(formData.get('productId') ?? '')
  const from = String(formData.get('from') ?? '') as ProductDecision
  const to = String(formData.get('to') ?? '') as ProductDecision
  const reason = String(formData.get('reason') ?? '')

  if (session.isDemo) {
    return {
      status: 'error',
      message: `Demo mode has no database, so the change was not stored. Requested: ${from} to ${to}.`,
    }
  }

  const result = await executeDecisionChange({
    orgId: session.orgId,
    productId,
    from,
    to,
    reason,
    actorUserId: session.userId,
    actorLabel: session.email,
  })

  if (!result.ok) {
    return { status: 'error', message: result.error }
  }

  revalidatePath('/products')
  revalidatePath(`/products/${productId}`)

  return { status: 'changed', message: `Moved from ${result.value.from} to ${result.value.to}.` }
}

/**
 * Changes a product's operator-controlled decision for ONE channel —
 * mirrors `changeProductDecision` exactly, delegating to
 * `channelDecisionExecutor.ts`'s `executeChannelDecisionChange`, the one
 * shared write path. A channel decision never itself lists, prices, orders
 * or spends — it only changes an internal gate `publicationGate.ts` reads,
 * exactly like the product-wide decision it sits alongside.
 */
export async function changeChannelDecision(
  _previous: DecisionChangeState,
  formData: FormData,
): Promise<DecisionChangeState> {
  const session = await requireWriteAccess()

  const productId = String(formData.get('productId') ?? '')
  const channel = String(formData.get('channel') ?? '') as ChannelKey
  const from = String(formData.get('from') ?? '') as ProductDecision
  const to = String(formData.get('to') ?? '') as ProductDecision
  const reason = String(formData.get('reason') ?? '')

  if (session.isDemo) {
    return {
      status: 'error',
      message: `Demo mode has no database, so the change was not stored. Requested: ${from} to ${to} on ${channel}.`,
    }
  }

  const result = await executeChannelDecisionChange({
    orgId: session.orgId,
    productId,
    channel,
    from,
    to,
    reason,
    actorUserId: session.userId,
    actorLabel: session.email,
  })

  if (!result.ok) {
    return { status: 'error', message: result.error }
  }

  revalidatePath('/products')
  revalidatePath(`/products/${productId}`)

  return { status: 'changed', message: `${channel}: moved from ${result.value.from} to ${result.value.to}.` }
}
