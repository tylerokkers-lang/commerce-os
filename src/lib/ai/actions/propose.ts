import 'server-only'

import { getCEOCommandCentre } from '@/lib/ceo/repository'
import { getProducts } from '@/lib/products/repository'
import { proposeApproval } from '@/lib/automation/proposeApproval'
import type { SessionContext } from '@/lib/security/session'
import { buildFactBundle } from '../factBundle'
import { extractActionIntent } from './intentExtraction'
import { validateActionIntent } from './validate'
import type { ProposedAction } from './types'

/**
 * Phase 3, the "click to actually raise it" step. Reachable only from
 * `src/app/(dashboard)/chat/actions.ts`'s Server Action — the same
 * `requireSession()`-gated, direct-POST-reachable pattern every other
 * mutating Server Action in this codebase follows.
 *
 * Deliberately re-derives the proposal from scratch rather than trusting
 * whatever `ProposedAction` object the client echoes back: the only input
 * that carries forward from the chat turn is the user's own original
 * message text (which the client already had — nothing new is trusted
 * from it), and this function reloads `getCEOCommandCentre()`/
 * `getProducts()` fresh and rebuilds the exact same `FactBundle`
 * `factBundle.ts` always builds, then re-runs
 * `extractActionIntent`/`validateActionIntent` against it. This is the
 * same "materially changed facts invalidate a stale approval" discipline
 * `automation/approvalWorkflow.ts`'s `approveDecision` already applies at
 * the *next* step (owner approval) — applied here one step earlier, at
 * proposal time, so the numbers a decision is proposed on are never more
 * than one fresh read old.
 *
 * Only ever creates an `ai_decisions` row via the pre-existing
 * `proposeApproval()` (Milestone 6) — never a second approval mechanism.
 * If validation does not land on `outcome: 'requires_approval'`, nothing
 * is written: a blocked, invalid, or review-only proposal is returned
 * as-is, with `approvalId: null`.
 */
export async function proposeAction(session: SessionContext, userMessage: string): Promise<ProposedAction | { error: string }> {
  if (session.isDemo) {
    return { error: 'Demo mode has no database — proposing an action is disabled until Supabase is connected.' }
  }

  const [ceo, products] = await Promise.all([getCEOCommandCentre(), getProducts()])
  const bundle = buildFactBundle({
    ceo, orgName: session.orgName, opportunities: [], opportunitySummary: null, suppliers: [], products,
    now: new Date().toISOString(),
  })

  const intent = extractActionIntent(userMessage, bundle.products)
  if (!intent) return { error: 'Could not identify a specific, real product and action from that message. Name the product exactly as it appears in the catalogue, e.g. "increase the price of Magnetic Knife Rail by 10%".' }

  const validated = await validateActionIntent(session, intent, bundle)
  if (validated.outcome !== 'requires_approval') return validated

  const { id } = await proposeApproval({
    orgId: session.orgId,
    decisionType: validated.actionType === 'UPDATE_PRICE' ? 'update_price' : 'request_approval',
    entityType: validated.targetEntityType,
    entityId: validated.targetEntityId,
    title: validated.actionType === 'UPDATE_PRICE' ? `Update price: ${validated.targetLabel}` : validated.reason,
    detail: validated.reason,
    reasoning: `Proposed via Commerce Intelligence chat: "${userMessage}". ${validated.reason}`,
    confidence: validated.confidence === 'high' ? 0.9 : validated.confidence === 'medium' ? 0.6 : 0.3,
    estimatedImpactMinor: null,
    automationLevelRequired: 'assisted',
    riskLevel: 'medium',
    inputs: { currentState: validated.currentState, proposedState: validated.proposedState },
    actionPayload: {
      actionType: validated.actionType === 'UPDATE_PRICE' ? 'update_price' : 'request_approval',
      entityType: validated.targetEntityType,
      entityId: validated.targetEntityId,
      reason: validated.reason,
      inputFacts: { channel: validated.channel, currentState: validated.currentState, proposedState: validated.proposedState },
    },
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  })

  return { ...validated, approvalId: id }
}
