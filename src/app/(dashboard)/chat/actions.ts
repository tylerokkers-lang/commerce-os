'use server'

import { requireSession } from '@/lib/security/session'
import { proposeAction } from '@/lib/ai/actions/propose'
import type { ProposedAction } from '@/lib/ai/actions/types'

/**
 * The only Server Action the chat exposes that can create real state
 * (Milestone 13, Phase 3 — "click to actually raise it"). Everything else
 * the chat does is a read. This still cannot execute anything itself: it
 * can only, at most, create an `ai_decisions` row through the pre-existing
 * `proposeApproval()` pipeline — the same one Milestones 6–9's own
 * automation already uses — which the owner must separately approve on
 * `/approvals` (Milestone 6's existing `approveApproval` Server Action,
 * unchanged) before anything is even attempted.
 *
 * Session-gated like every Server Action in this codebase (reachable by
 * direct POST, not only through the UI). No role restriction beyond
 * authentication — matching the chat's own read access — but note the
 * *result* is only ever a pending approval request, never a change any
 * role could make happen without a separate, explicit approval.
 */
export async function requestActionApproval(userMessage: string): Promise<ProposedAction | { error: string }> {
  const session = await requireSession()
  return proposeAction(session, userMessage)
}
