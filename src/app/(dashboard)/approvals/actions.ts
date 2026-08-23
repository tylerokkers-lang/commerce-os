'use server'

import { revalidatePath } from 'next/cache'
import { requireSession, canApprove } from '@/lib/security/session'
import { approveDecision, rejectDecision } from '@/lib/automation/approvalWorkflow'

/**
 * The approve/reject actions Milestone 5 deferred to Milestone 6 (brief §18).
 *
 * Both are thin: all the actual decision logic — expiry, stale-fact
 * invalidation, executing the exact proposed action, auditing — lives in
 * `automation/approvalWorkflow.ts`. This file only checks the caller may
 * approve at all and re-renders the page afterwards.
 */

export async function approveApproval(formData: FormData): Promise<void> {
  const session = await requireSession()
  if (!canApprove(session)) throw new Error(`Role "${session.role}" may not approve decisions.`)

  const decisionId = String(formData.get('decisionId') ?? '')
  await approveDecision(session, decisionId)
  revalidatePath('/approvals')
  revalidatePath('/automation')
}

export async function rejectApproval(formData: FormData): Promise<void> {
  const session = await requireSession()
  if (!canApprove(session)) throw new Error(`Role "${session.role}" may not reject decisions.`)

  const decisionId = String(formData.get('decisionId') ?? '')
  await rejectDecision(session, decisionId, 'Rejected from the Approvals page.')
  revalidatePath('/approvals')
  revalidatePath('/automation')
}
