import { evaluateAutomationPolicy } from './policyEngine'
import type { AutomationSettings } from './settingsTypes'
import type { Freshness } from './factsTypes'
import type { PolicyResult } from './types'

/**
 * Candidate lifecycle review — the pure decision `handleCandidateLifecycleReview`
 * (`handlers/productHandlers.ts`) and `dryRunCandidateLifecycleReview`
 * (`dryRun.ts`) both wrap, so the policy-assembly logic exists in exactly
 * one place (Milestone: autonomous decision & capability layer, mirroring
 * every other domain's `assess*`/`execute*` split).
 */

export interface CandidateLifecycleReviewInput {
  recommendation: string | null
  recommendationFreshness: Freshness
  /** `null` only when the product record itself could not be confirmed — never treated as "discovered" by default. */
  stage: string | null
}

export interface CandidateLifecycleReviewAssessment {
  /** `true` only when the recommendation was genuinely computed at least once — never a guess when it wasn't. */
  hasIntelligence: boolean
  isStale: boolean
  /** Eligible for the one, single, completely ungated transition (`discovered` -> `researching`). */
  readyToAdvance: boolean
  policy: PolicyResult
}

export function assessCandidateLifecycleReview(input: CandidateLifecycleReviewInput, settings: AutomationSettings): CandidateLifecycleReviewAssessment {
  const hasIntelligence = input.recommendationFreshness !== 'unavailable'
  const isStale = hasIntelligence && input.recommendationFreshness === 'stale'
  const readyToAdvance = hasIntelligence && !isStale && input.stage === 'discovered'

  const policy = evaluateAutomationPolicy({
    actionType: 'alert_owner',
    settings,
    domainOutcome: 'auto_permitted',
    domainReason: !hasIntelligence
      ? 'No opportunity score has ever been computed for this candidate.'
      : isStale
        ? `Candidate intelligence was last computed outside the freshness window — recalculating would give a current view.`
        : readyToAdvance
          ? `A real, fresh opportunity score is on file (recommendation: ${input.recommendation}) and the candidate is still at "discovered".`
          : 'No lifecycle action is due.',
    domainRequirements: [],
    riskLevel: 'low', // Non-monetary, internal-only bookkeeping; never touches a marketplace, a supplier, or money.
  })

  return { hasIntelligence, isStale, readyToAdvance, policy }
}
