import type { ComplianceRecheckDecision } from '@/lib/orders/complianceRecheck'
import type { OrderProfitabilityResult } from '@/lib/orders/profitabilityRecheck'
import type { FulfilmentSupplierChoice } from './selection'
import type { ReservationOutcome } from '@/lib/inventory/reservation'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The fulfilment submission gate (Milestone 5).
 *
 * The direct sibling of `marketplaces/publicationGate.ts`: composes existing
 * decisions — supplier selection, the profitability re-check, the compliance
 * re-check decision, and stock reservation — into one verdict on whether a
 * fulfilment may be submitted to a supplier, and whether that submission may
 * happen automatically or needs the owner first. Nothing here recalculates
 * any of those; it only asks each one for its result.
 */

export type AutomationLevel = Enums<'automation_level'>

export interface SubmissionRequirement {
  key: string
  label: string
  satisfied: boolean
  detail: string
}

export type SubmissionOutcome = 'blocked' | 'pending_approval' | 'submit_automatically'

export interface SubmissionDecision {
  outcome: SubmissionOutcome
  requirements: readonly SubmissionRequirement[]
  reason: string
  requiresOwnerApproval: boolean
}

export interface SubmissionInput {
  supplierChoice: FulfilmentSupplierChoice
  reservation: { ok: true; value: ReservationOutcome } | { ok: false; error: string }
  profitability: OrderProfitabilityResult
  complianceRecheck: ComplianceRecheckDecision
  /** Only meaningful when complianceRecheck.required is true. */
  complianceRecheckPasses: boolean | null
  automationLevel: AutomationLevel
}

/**
 * Submitting a fulfilment is a smaller decision than publishing a new
 * product, and the automation levels reflect that: `supervised` already
 * permits automatic submission once every requirement passes, because a
 * fulfilment against an already-approved listing carries far less downside
 * than creating a brand new listing does. `autonomous` behaves identically —
 * the distinction between the two levels matters for other decisions
 * (redundancy switching, new listings), not this one.
 */
function automationPermitsAutoSubmit(level: AutomationLevel): boolean {
  return level === 'supervised' || level === 'autonomous'
}

export function assessFulfilmentSubmission(input: SubmissionInput): SubmissionDecision {
  const requirements: SubmissionRequirement[] = [
    {
      key: 'supplier_selected',
      label: 'Supplier selected',
      satisfied: input.supplierChoice.chosen !== null,
      detail: input.supplierChoice.rationale,
    },
    {
      key: 'stock_reserved',
      label: 'Stock reservation',
      satisfied: input.reservation.ok,
      detail: input.reservation.ok
        ? `Reserved. ${input.reservation.value.availableAfter} units remain available.`
        : input.reservation.error,
    },
    {
      key: 'profitability',
      label: 'Profitability re-check',
      satisfied: input.profitability.passesMinimumMargin,
      detail: input.profitability.passesMinimumMargin
        ? 'Passes the configured margin threshold using this order\'s real costs.'
        : (input.profitability.failureReason ?? 'Fails the configured margin threshold.'),
    },
    {
      key: 'compliance',
      label: 'Compliance re-check',
      satisfied: !input.complianceRecheck.required || input.complianceRecheckPasses === true,
      detail: !input.complianceRecheck.required
        ? input.complianceRecheck.reason
        : input.complianceRecheckPasses === null
          ? 'A re-check is required but has not been run yet.'
          : input.complianceRecheckPasses
            ? `Re-checked: ${input.complianceRecheck.reason}`
            : `Re-check failed: ${input.complianceRecheck.reason}`,
    },
  ]

  const failed = requirements.filter((r) => !r.satisfied)
  if (failed.length > 0) {
    return {
      outcome: 'blocked',
      requirements,
      reason: `Blocked: ${failed.map((r) => r.label).join(', ')} not satisfied.`,
      requiresOwnerApproval: true,
    }
  }

  const autoPermitted = automationPermitsAutoSubmit(input.automationLevel)
  const automationRequirement: SubmissionRequirement = {
    key: 'automation_permission',
    label: 'Automation permission',
    satisfied: true,
    detail: autoPermitted
      ? `Automation level "${input.automationLevel}" permits automatic submission.`
      : `Automation level "${input.automationLevel}" requires your approval before submitting.`,
  }

  return {
    outcome: autoPermitted ? 'submit_automatically' : 'pending_approval',
    requirements: [...requirements, automationRequirement],
    reason: autoPermitted
      ? `Every requirement passed and "${input.automationLevel}" permits automatic submission.`
      : `Every requirement passed. Submission needs your approval at the "${input.automationLevel}" automation level.`,
    requiresOwnerApproval: !autoPermitted,
  }
}
