import type { PublicationDecision } from './publicationGate'

/**
 * Maps a `PublicationDecision` (Milestone 4's existing gate) to the
 * SELL/WATCH/HOLD/REVIEW/REMOVE vocabulary the operator wants to see at a
 * glance. This derives nothing new — it only labels an outcome the gate
 * already computed deterministically from real facts. No LLM, no scoring
 * invented here; a genuinely different mapping would be a genuinely
 * different requirement, not a tuning knob.
 *
 * Deliberately conservative where the reason for a block isn't a decision
 * the operator themselves already made: any requirement other than the
 * product/channel decision failing (profitability, compliance, supplier,
 * lifecycle) maps to REVIEW, never REMOVE or HOLD — this system never
 * infers "get rid of it" from an incomplete fact, only from an operator's
 * own explicit decision.
 */

export type ChannelRecommendation = 'SELL' | 'WATCH' | 'HOLD' | 'REVIEW' | 'REMOVE'

export interface ChannelRecommendationResult {
  recommendation: ChannelRecommendation
  reason: string
}

export function deriveChannelRecommendation(readiness: PublicationDecision): ChannelRecommendationResult {
  if (readiness.outcome !== 'blocked') {
    return { recommendation: 'SELL', reason: readiness.reason }
  }

  const decisionRequirement = readiness.requirements.find((r) => r.key === 'channel_decision' && !r.satisfied)
    ?? readiness.requirements.find((r) => r.key === 'product_decision' && !r.satisfied)

  if (decisionRequirement) {
    if (decisionRequirement.detail.includes('"remove"')) return { recommendation: 'REMOVE', reason: decisionRequirement.detail }
    if (decisionRequirement.detail.includes('"watch"')) return { recommendation: 'WATCH', reason: decisionRequirement.detail }
    if (decisionRequirement.detail.includes('"block"') || decisionRequirement.detail.includes('"hold"')) {
      return { recommendation: 'HOLD', reason: decisionRequirement.detail }
    }
    return { recommendation: 'REVIEW', reason: decisionRequirement.detail }
  }

  // Blocked for a reason other than the operator's own decision (lifecycle,
  // supplier, profitability, compliance, identifiers) — always REVIEW, never
  // an inferred REMOVE/HOLD, since none of those checks are the operator
  // saying "stop selling this."
  const firstFailed = readiness.requirements.find((r) => !r.satisfied)
  return { recommendation: 'REVIEW', reason: firstFailed?.detail ?? readiness.reason }
}
