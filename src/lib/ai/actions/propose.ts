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
    advertisingIntelligence: ceo.advertisingIntelligence,
    now: new Date().toISOString(),
  })

  const intent = extractActionIntent(userMessage, bundle.products, bundle.advertisingCampaigns)
  if (!intent) return { error: 'Could not identify a specific, real product and action from that message. Name the product exactly as it appears in the catalogue, e.g. "increase the price of Magnetic Knife Rail by 10%".' }

  const validated = await validateActionIntent(session, intent, bundle)
  if (validated.outcome !== 'requires_approval') return validated

  // Milestone 16 — the real `automation_action_type` this decision is
  // recorded and later dispatched under. Kept a real per-type mapping
  // rather than collapsing every non-price escalation into
  // `request_approval`: `REVIEW_CAMPAIGN` must stay `review_campaign` so
  // it is indistinguishable neither from a generic escalation in the audit
  // trail nor from `advertising/monitor.ts`'s own campaign reviews, even
  // though both decision types dispatch identically today (both are pure
  // escalations — see `executionDispatch.ts`'s `ESCALATION_DECISION_TYPES`).
  // Milestone 22 — `PAUSE_CAMPAIGN`/`INCREASE_BUDGET`/`DECREASE_BUDGET` map
  // onto `executionDispatch.ts`'s `ADVERTISING_DECISION_TYPES` exactly,
  // the same three strings `advertising/monitor.ts`'s own campaign
  // recommendations already use for this domain.
  const decisionType = validated.actionType === 'UPDATE_PRICE'
    ? 'update_price'
    : validated.actionType === 'REVIEW_CAMPAIGN'
      ? 'review_campaign'
      : validated.actionType === 'PAUSE_CAMPAIGN'
        ? 'pause_campaign'
        : validated.actionType === 'INCREASE_BUDGET'
          ? 'increase_ad_budget'
          : validated.actionType === 'DECREASE_BUDGET'
            ? 'decrease_ad_budget'
            : 'request_approval'

  const { id } = await proposeApproval({
    orgId: session.orgId,
    decisionType,
    entityType: validated.targetEntityType,
    entityId: validated.targetEntityId,
    title: validated.actionType === 'UPDATE_PRICE'
      ? `Update price: ${validated.targetLabel}`
      : validated.actionType === 'REVIEW_CAMPAIGN'
        ? `Review campaign: ${validated.targetLabel}`
        : validated.actionType === 'PAUSE_CAMPAIGN'
          ? `Pause campaign: ${validated.targetLabel}`
          : validated.actionType === 'INCREASE_BUDGET' || validated.actionType === 'DECREASE_BUDGET'
            ? `Change budget: ${validated.targetLabel}`
            : validated.reason,
    detail: validated.reason,
    reasoning: `Proposed via Commerce Intelligence chat: "${userMessage}". ${validated.reason}`,
    confidence: validated.confidence === 'high' ? 0.9 : validated.confidence === 'medium' ? 0.6 : 0.3,
    estimatedImpactMinor: null,
    automationLevelRequired: 'assisted',
    riskLevel: 'medium',
    inputs: { currentState: validated.currentState, proposedState: validated.proposedState },
    actionPayload: {
      actionType: decisionType,
      entityType: validated.targetEntityType,
      entityId: validated.targetEntityId,
      reason: validated.reason,
      // `productTitle`/`newPriceMinor` (Milestone 16) and
      // `provider`/`externalAccountId`/`externalCampaignId`/`campaignName`/
      // `classification`/`proposedDailyBudgetMinor` (Milestone 22) are the
      // structured values `automation/handlers/priceApprovalExecutor.ts`/
      // `advertisingApprovalExecutor.ts` need at execution time —
      // `currentState`/`proposedState` are formatted display strings for
      // the chat UI only, never re-parsed for this. `dispatchApprovedExecution`
      // (`approvalWorkflow.ts`) requires the four advertising identity
      // fields to be present before it will even attempt to dispatch a
      // campaign decision — `validateCampaignAction` never reaches
      // `requires_approval` without all four already resolved.
      inputFacts: {
        channel: validated.channel, productTitle: validated.targetLabel, newPriceMinor: validated.newPriceMinor,
        provider: validated.provider, externalAccountId: validated.externalAccountId, externalCampaignId: validated.externalCampaignId,
        campaignName: validated.targetLabel, classification: validated.campaignClassification,
        proposedDailyBudgetMinor: validated.proposedDailyBudgetMinor,
        currentState: validated.currentState, proposedState: validated.proposedState,
      },
    },
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  })

  return { ...validated, approvalId: id }
}
