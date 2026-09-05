import { evaluateAutomationPolicy } from './policyEngine'
import { assembleCandidateGateState, planCandidateAdvance, type CandidateAdvancePlan, type CandidateGateStateInput, type CandidateGateStateResult } from '@/lib/products/candidateGateState'
import type { AutomationSettings } from './settingsTypes'
import type { PolicyResult } from './types'

/**
 * Candidate lifecycle review — the pure decision that
 * `handleCandidateLifecycleReview` (`handlers/productHandlers.ts`) and
 * `dryRunCandidateLifecycleReview` (`dryRun.ts`) both wrap, so the decision
 * exists in exactly one place and a dry run can never diverge from a real
 * execution.
 *
 * Milestone: continuous candidate lifecycle. This previously handled only
 * the single ungated `discovered -> researching` step, because compliance
 * and profitability verdicts existed nowhere durable. Both are now
 * persisted facts (`compliance_records`, `profitability_records`), so this
 * drives the full pre-launch path via `assembleCandidateGateState` and
 * `planCandidateAdvance` — which in turn call `lifecycle.ts`'s own
 * `checkGates`/`nextStages` rather than reimplementing any rule.
 *
 * An UNKNOWN fact never advances anything and never counts as a failure:
 * it produces a recheck instead, so the next monitoring cycle can retry
 * with a real answer.
 */

/** Which requirement, when UNKNOWN, is worth scheduling real work to resolve — and what kind. */
export type RecheckKind = 'lifecycle_facts' | 'product_intelligence'

export const RECHECK_FOR_REQUIREMENT: Readonly<Record<string, RecheckKind>> = {
  // Both persisted verdicts are refreshed by one real assessment pass
  // (`products/lifecycleFactRefresh.ts`), so one recheck resolves either.
  compliance_pass: 'lifecycle_facts',
  profitability_pass: 'lifecycle_facts',
  // Supplier approval status and the supplier's own offer are inputs to
  // that same assessment.
  supplier_approved: 'lifecycle_facts',
  supplier_facts_fresh: 'lifecycle_facts',
  // Intelligence is only ever recomputed by a human today (import, or the
  // "recalculate" action) — there is no job that can refresh it, so this
  // resolves to a notification rather than work the system can do itself.
  intelligence_fresh: 'product_intelligence',
  meets_minimum_score: 'product_intelligence',
}

/** Exactly the gate state's own inputs — named separately so callers read in this module's vocabulary. */
export type CandidateLifecycleReviewInput = CandidateGateStateInput

export interface CandidateLifecycleReviewAssessment {
  gateState: CandidateGateStateResult
  advance: CandidateAdvancePlan
  /** Distinct rechecks worth scheduling because a required fact is genuinely UNKNOWN. Empty when nothing is unknown, or when the blockers are real failures instead. */
  rechecks: readonly RecheckKind[]
  policy: PolicyResult
}

export function assessCandidateLifecycleReview(input: CandidateLifecycleReviewInput, settings: AutomationSettings): CandidateLifecycleReviewAssessment {
  const gateState = assembleCandidateGateState(input)
  const advance = planCandidateAdvance(gateState)

  const rechecks = [
    ...new Set(
      advance.blockedBy
        .filter((r) => r.verdict === 'unknown')
        .map((r) => RECHECK_FOR_REQUIREMENT[r.key])
        .filter((kind): kind is RecheckKind => kind !== undefined),
    ),
  ]

  const policy = evaluateAutomationPolicy({
    actionType: 'alert_owner',
    settings,
    domainOutcome: advance.to ? 'auto_permitted' : 'blocked',
    domainReason: advance.reason,
    domainRequirements: gateState.requirements.map((r) => ({
      key: r.key,
      label: r.label,
      // A three-state requirement collapsed for the policy audit trail:
      // only a genuine PASS satisfies it. UNKNOWN and FAIL are both
      // unsatisfied, and the detail below says which one it actually was.
      satisfied: r.verdict === 'pass',
      detail: `${r.verdict.toUpperCase()} — ${r.detail}`,
    })),
    riskLevel: 'low', // Non-monetary, internal-only bookkeeping; never touches a marketplace, a supplier, or money.
  })

  return { gateState, advance, rechecks, policy }
}
