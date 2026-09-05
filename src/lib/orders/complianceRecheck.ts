/**
 * Compliance re-check "where necessary" (Milestone 5).
 *
 * A product's compliance was already assessed for its channel before it was
 * ever listed (Milestone 2). Re-running the full assessment on every single
 * order would be wasted work — the product, its identifiers, its category and
 * its IP status have not changed just because someone bought it. What *can*
 * change between listing and an individual order is the supplier actually
 * fulfilling it, which is exactly the one input the compliance assessment
 * depends on that this module tracks.
 *
 * This is a decision about *whether* to re-run `assessCompliance`
 * (Milestone 2's engine, never duplicated), not a second compliance engine.
 */

export interface ComplianceRecheckContext {
  /** The supplier the channel listing was approved against. */
  approvedSupplierId: string | null
  /** The supplier actually chosen to fulfil this specific order. */
  fulfillingSupplierId: string | null
  /** How long ago (in days) the listing's compliance was last assessed. */
  daysSinceLastAssessment: number | null
  /** True when the product's category or identifiers changed since approval. */
  productDetailsChangedSinceApproval: boolean
}

export interface ComplianceRecheckDecision {
  required: boolean
  reason: string
}

/**
 * Compliance is never trusted indefinitely; a stale assessment is worth
 * confirming even with no other change. Exported (Milestone: continuous
 * candidate lifecycle) so the persisted-verdict freshness window is this
 * exact number rather than a second, independently-drifting one.
 */
export const MAX_ASSESSMENT_AGE_DAYS = 90

export function decideComplianceRecheck(context: ComplianceRecheckContext): ComplianceRecheckDecision {
  if (context.fulfillingSupplierId === null) {
    return { required: true, reason: 'No supplier is recorded for this order yet; compliance cannot be confirmed without one.' }
  }

  if (context.approvedSupplierId !== context.fulfillingSupplierId) {
    return {
      required: true,
      reason: `This order is being fulfilled by a different supplier (${context.fulfillingSupplierId}) than the one the listing was approved against (${context.approvedSupplierId ?? 'none recorded'}). Amazon's compliance verdict in particular depends on supplier capability, which must be reassessed.`,
    }
  }

  if (context.productDetailsChangedSinceApproval) {
    return {
      required: true,
      reason: 'The product’s category or identifiers have changed since compliance was last assessed.',
    }
  }

  if (context.daysSinceLastAssessment === null || context.daysSinceLastAssessment > MAX_ASSESSMENT_AGE_DAYS) {
    return {
      required: true,
      reason: context.daysSinceLastAssessment === null
        ? 'No compliance assessment is on record for this listing.'
        : `The last compliance assessment is ${context.daysSinceLastAssessment} days old, beyond the ${MAX_ASSESSMENT_AGE_DAYS}-day freshness window.`,
    }
  }

  return {
    required: false,
    reason: `Same supplier as approved, product details unchanged, and the assessment is ${context.daysSinceLastAssessment} days old — within the ${MAX_ASSESSMENT_AGE_DAYS}-day freshness window.`,
  }
}
