import { checkGates, nextStages, type GateState } from './lifecycle'
import type { Freshness } from '@/lib/automation/factsTypes'
import type { ProductStage } from '@/lib/core/domain'

/**
 * The candidate lifecycle gate state (Milestone: continuous candidate
 * lifecycle, Part 4).
 *
 * Pure and deterministic: it takes facts that have already been loaded and
 * says, for each requirement, whether it PASSES, FAILS, or is UNKNOWN.
 * It computes no verdicts of its own — every input here is either a
 * persisted verdict from a real engine (`compliance_records`,
 * `profitability_records`) or a freshness flag from `FactsLoader`. The
 * lifecycle rules themselves stay exactly where they already were:
 * `lifecycle.ts`'s `ALLOWED` graph and `checkGates` are called, never
 * reimplemented.
 *
 * The distinction this type exists to preserve: `lifecycle.ts`'s own
 * `GateState` is all booleans, which cannot tell "we checked and it failed"
 * apart from "we have not checked". Both correctly block a transition, but
 * they need completely different responses — a FAIL needs a human or a
 * changed supplier, an UNKNOWN needs a recheck job. So this carries the
 * three-state view for the caller's reasoning and notifications, and hands
 * `checkGates` the conservative boolean projection where UNKNOWN, exactly
 * like FAIL, is `false`. UNKNOWN is never, anywhere, projected as `true`.
 */

export type GateVerdict = 'pass' | 'fail' | 'unknown'

export interface CandidateGateRequirement {
  key: string
  label: string
  verdict: GateVerdict
  detail: string
}

export interface CandidateGateStateInput {
  /** `null` when the product record itself could not be read — never assumed. */
  stage: string | null
  /** `recommendProduct`'s persisted verdict, and how fresh it is. */
  intelligenceRecommendation: string | null
  intelligenceFreshness: Freshness
  /** `suppliers.<channel>_status` — an `approval_status`: approved | blocked | review_required | not_assessed. */
  supplierChannelStatus: string | null
  supplierStatusFreshness: Freshness
  /** Freshness of the supplier's own cost/stock offer, the input every economic figure derives from. */
  supplierOfferFreshness: Freshness
  /** `compliance_records.verdict` for this channel: pass | fail | review_required | not_assessed. */
  complianceVerdict: string | null
  complianceFreshness: Freshness
  /** `profitability_records.verdict` for this channel: pass | fail | not_assessed. */
  profitabilityVerdict: string | null
  profitabilityFreshness: Freshness
  /** From `AutomationSettings` — never inferred from the presence of other data. */
  businessSettingsConfigured: boolean
}

export interface CandidateGateStateResult {
  stage: ProductStage | null
  requirements: readonly CandidateGateRequirement[]
  /** The conservative boolean projection handed to `lifecycle.ts`'s own `checkGates`. UNKNOWN is `false` here, exactly like FAIL. */
  lifecycleGates: GateState
  /** Requirements that are genuinely UNKNOWN — each one is a recheck to schedule, not a rejection. */
  unknownKeys: readonly string[]
  /** Requirements that genuinely FAILED — each one needs a real change, not a retry. */
  failedKeys: readonly string[]
}

const FRESH: Freshness = 'fresh'

/**
 * `recommendProduct`'s ladder returns at the first unmet condition, so its
 * verdict only tells us about the opportunity-score threshold for the two
 * outcomes that genuinely reached that rung. Anything else is UNKNOWN with
 * respect to the score specifically — reading `do_not_sell` (which fires
 * for an unassigned supplier long before the score is examined) as "score
 * too low" would be inventing a fact the engine never asserted.
 */
function scoreVerdict(recommendation: string | null, freshness: Freshness): GateVerdict {
  if (recommendation === null || freshness !== FRESH) return 'unknown'
  if (recommendation === 'candidate' || recommendation === 'strong_candidate') return 'pass'
  if (recommendation === 'low_priority') return 'fail'
  return 'unknown'
}

function verdictFromPersisted(value: string | null, freshness: Freshness, passValue: string): GateVerdict {
  if (value === null || freshness === 'unavailable') return 'unknown'
  if (freshness !== FRESH) return 'unknown' // Stale is not a failure, and is certainly not a pass.
  if (value === passValue) return 'pass'
  if (value === 'not_assessed') return 'unknown'
  return 'fail' // A real `fail` (or `review_required`) the engine actually returned.
}

export function assembleCandidateGateState(input: CandidateGateStateInput): CandidateGateStateResult {
  const intelligence: GateVerdict = input.intelligenceRecommendation === null || input.intelligenceFreshness === 'unavailable'
    ? 'unknown'
    : input.intelligenceFreshness === FRESH
      ? 'pass'
      : 'unknown'

  const score = scoreVerdict(input.intelligenceRecommendation, input.intelligenceFreshness)

  const supplier: GateVerdict = input.supplierChannelStatus === null || input.supplierStatusFreshness === 'unavailable'
    ? 'unknown'
    : input.supplierStatusFreshness !== FRESH
      ? 'unknown'
      : input.supplierChannelStatus === 'approved'
        ? 'pass'
        : input.supplierChannelStatus === 'not_assessed'
          ? 'unknown'
          : 'fail'

  const supplierFacts: GateVerdict = input.supplierOfferFreshness === FRESH ? 'pass' : 'unknown'

  const compliance = verdictFromPersisted(input.complianceVerdict, input.complianceFreshness, 'pass')
  const profitability = verdictFromPersisted(input.profitabilityVerdict, input.profitabilityFreshness, 'pass')
  const settings: GateVerdict = input.businessSettingsConfigured ? 'pass' : 'unknown'

  const requirements: CandidateGateRequirement[] = [
    { key: 'intelligence_fresh', label: 'Product intelligence is fresh', verdict: intelligence, detail: describeFreshness('Opportunity score', input.intelligenceFreshness) },
    { key: 'meets_minimum_score', label: 'Opportunity score meets the configured minimum', verdict: score, detail: input.intelligenceRecommendation ? `Latest recommendation: ${input.intelligenceRecommendation}.` : 'No recommendation has ever been computed.' },
    { key: 'supplier_facts_fresh', label: 'Supplier cost and stock facts are fresh', verdict: supplierFacts, detail: describeFreshness('Supplier offer', input.supplierOfferFreshness) },
    { key: 'supplier_approved', label: 'A supplier is approved for this channel', verdict: supplier, detail: input.supplierChannelStatus ? `Supplier channel status: ${input.supplierChannelStatus}.` : 'No supplier status on file.' },
    { key: 'compliance_pass', label: 'Compliance passes for this channel', verdict: compliance, detail: input.complianceVerdict ? `Persisted verdict: ${input.complianceVerdict} (${input.complianceFreshness}).` : 'No compliance verdict has ever been persisted for this channel.' },
    { key: 'profitability_pass', label: 'Profitability passes for this channel', verdict: profitability, detail: input.profitabilityVerdict ? `Persisted verdict: ${input.profitabilityVerdict} (${input.profitabilityFreshness}).` : 'No profitability verdict has ever been persisted for this channel.' },
    { key: 'business_settings_configured', label: 'Business settings are configured', verdict: settings, detail: input.businessSettingsConfigured ? 'All required business settings are on file.' : 'Required business settings are missing, so every threshold behind these verdicts is a placeholder.' },
  ]

  return {
    stage: (input.stage as ProductStage | null) ?? null,
    requirements,
    lifecycleGates: {
      hasScore: intelligence === 'pass',
      meetsMinimumScore: score === 'pass',
      // Deliberately stricter than the status flag alone. `checkGates` asks
      // "is a supplier approved for this channel", and a supplier whose own
      // cost and stock facts are outside their freshness window is not a
      // currently-verified supplier — every economic figure behind that
      // approval would be computed from data we no longer trust. Reading
      // the stale case as approved would be inferring a pass from absence,
      // which is the one thing this whole model exists to prevent. This
      // makes the boolean projection more conservative; it never makes it
      // more permissive, so `lifecycle.ts`'s own rules stay untouched.
      hasApprovedSupplier: supplier === 'pass' && supplierFacts === 'pass',
      complianceAssessed: compliance === 'pass' || compliance === 'fail',
      compliancePassesAnyChannel: compliance === 'pass',
      profitablePassesAnyChannel: profitability === 'pass',
    },
    unknownKeys: requirements.filter((r) => r.verdict === 'unknown').map((r) => r.key),
    failedKeys: requirements.filter((r) => r.verdict === 'fail').map((r) => r.key),
  }
}

function describeFreshness(label: string, freshness: Freshness): string {
  if (freshness === 'unavailable') return `${label}: never recorded.`
  if (freshness === 'unknown') return `${label}: on file, but with no observation time to judge freshness.`
  if (freshness === 'stale') return `${label}: outside its freshness window.`
  return `${label}: fresh.`
}

/**
 * The single next stage this candidate is genuinely entitled to move to,
 * or `null` when it should stay put.
 *
 * Stops at `approved` on purpose, and this is a safety boundary rather
 * than an omission: `lifecycle.ts` defines `testing` as "live on at least
 * one channel, on a limited budget". Nothing may claim that state without
 * a verified external listing, and this milestone deliberately creates no
 * marketplace listings at all. `approved` — "cleared every gate, not yet
 * listed" — is exactly as far as an unpublished candidate can honestly go.
 */
export const AUTONOMOUS_STAGE_PATH: Readonly<Record<string, ProductStage>> = {
  discovered: 'researching',
  researching: 'supplier_review',
  supplier_review: 'compliance_review',
  compliance_review: 'approved',
}

export interface CandidateAdvancePlan {
  /** `null` when no advance is warranted — either the stage is terminal/beyond this path, or a gate blocks it. */
  to: ProductStage | null
  reason: string
  /** Requirements that must become PASS before this candidate can move. */
  blockedBy: readonly CandidateGateRequirement[]
  /** True when everything blocking is merely UNKNOWN — a recheck may unblock it, no human decision needed. */
  blockedOnlyByUnknowns: boolean
}

export function planCandidateAdvance(state: CandidateGateStateResult): CandidateAdvancePlan {
  const stage = state.stage
  if (!stage) {
    return { to: null, reason: 'The product’s current stage could not be read, so no transition can be considered.', blockedBy: [], blockedOnlyByUnknowns: false }
  }

  const target = AUTONOMOUS_STAGE_PATH[stage]
  if (!target) {
    return {
      to: null,
      reason: `"${stage}" is not part of the autonomous pre-launch path — nothing to advance automatically.`,
      blockedBy: [],
      blockedOnlyByUnknowns: false,
    }
  }

  // The existing state machine remains the authority on what may follow what.
  if (!nextStages(stage).includes(target)) {
    return { to: null, reason: `"${stage}" cannot move to "${target}" under the lifecycle rules.`, blockedBy: [], blockedOnlyByUnknowns: false }
  }

  const gate = checkGates(target, state.lifecycleGates)
  if (gate.satisfied) {
    return { to: target, reason: `Every gate required for "${target}" is satisfied by current, fresh facts.`, blockedBy: [], blockedOnlyByUnknowns: false }
  }

  // Which of *our* three-state requirements explain the refusal. Only the
  // requirements `checkGates` actually consults for this target count.
  const consulted = REQUIREMENTS_BY_TARGET[target] ?? []
  const blockedBy = state.requirements.filter((r) => consulted.includes(r.key) && r.verdict !== 'pass')
  const blockedOnlyByUnknowns = blockedBy.length > 0 && blockedBy.every((r) => r.verdict === 'unknown')

  return {
    to: null,
    reason: `Cannot move to "${target}" yet: ${gate.missing.join(' ')}`,
    blockedBy,
    blockedOnlyByUnknowns,
  }
}

/**
 * Which requirement keys `checkGates` actually consults per target stage —
 * mirrors `lifecycle.ts`'s own conditions exactly, so a blocked transition
 * is explained by the requirements that genuinely caused it rather than by
 * every requirement that happens to be unmet.
 */
const REQUIREMENTS_BY_TARGET: Readonly<Record<string, readonly string[]>> = {
  researching: [],
  supplier_review: ['intelligence_fresh', 'meets_minimum_score'],
  compliance_review: ['intelligence_fresh', 'meets_minimum_score', 'supplier_approved', 'supplier_facts_fresh'],
  approved: ['intelligence_fresh', 'meets_minimum_score', 'supplier_approved', 'supplier_facts_fresh', 'compliance_pass', 'profitability_pass'],
}
