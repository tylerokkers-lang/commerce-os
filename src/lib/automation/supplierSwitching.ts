import { evaluateSupplierRedundancy, type RedundancyDecision, type RedundancyRequest } from '@/lib/suppliers/redundancy'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import type { AutomationSettings } from './settingsTypes'
import type { PolicyResult } from './types'

/**
 * Automatic supplier switching (brief §8).
 *
 * Uses `suppliers/redundancy.ts` exactly as it stands — Milestone 3's
 * evaluator already ranks alternatives on the composite supplier score
 * (never price alone), re-runs profitability and channel capability for
 * each, and applies its own automation-level gate. This module adds only
 * what that evaluator does not already check: the kill switch, the
 * "supplier_switching" category pause, and a cost-increase ceiling — none of
 * which belong inside a pure supplier-scoring function.
 */

export interface SupplierSwitchAutomationInput {
  request: RedundancyRequest
  /** The unavailable supplier's unit cost + shipping, to size the cost-increase check. */
  previousUnitCostPlusShippingMinor: number
  settings: AutomationSettings
}

export interface SupplierSwitchAutomationResult {
  redundancy: RedundancyDecision
  policy: PolicyResult
}

export function evaluateSupplierSwitchAutomation(
  input: SupplierSwitchAutomationInput,
): SupplierSwitchAutomationResult {
  const redundancy = evaluateSupplierRedundancy(input.request)

  const domainOutcome: DomainOutcome =
    redundancy.outcome === 'switch_automatically' ? 'auto_permitted' : 'pending_approval'

  const percentageChecks = []
  if (redundancy.recommended) {
    const newCostMinor =
      redundancy.recommended.candidate.signals.unitCost.minor +
      redundancy.recommended.candidate.signals.shippingCost.minor
    const actualPct =
      input.previousUnitCostPlusShippingMinor > 0
        ? ((newCostMinor - input.previousUnitCostPlusShippingMinor) / input.previousUnitCostPlusShippingMinor) * 100
        : 0
    percentageChecks.push({
      label: 'Maximum automatic supplier-switch cost increase',
      actualPct,
      limitPct: input.settings.maxAutoSupplierSwitchCostIncreasePct,
    })
  }

  const policy = evaluateAutomationPolicy({
    actionType: 'switch_supplier',
    settings: input.settings,
    domainOutcome,
    domainReason: redundancy.reason,
    domainRequirements: [
      {
        key: 'redundancy_evaluation',
        label: 'Supplier redundancy evaluation',
        satisfied: redundancy.outcome === 'switch_automatically',
        detail: redundancy.reason,
      },
    ],
    percentageChecks,
    riskLevel: redundancy.outcome === 'switch_automatically' ? 'low' : 'medium',
  })

  return { redundancy, policy }
}
