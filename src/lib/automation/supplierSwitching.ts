import { evaluateSupplierRedundancy, type RedundancyDecision, type RedundancyRequest } from '@/lib/suppliers/redundancy'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import { classifyActionRisk } from './riskClassification'
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
  let costIncreasePct: number | null = null
  if (redundancy.recommended) {
    const newCostMinor =
      redundancy.recommended.candidate.signals.unitCost.minor +
      redundancy.recommended.candidate.signals.shippingCost.minor
    costIncreasePct =
      input.previousUnitCostPlusShippingMinor > 0
        ? ((newCostMinor - input.previousUnitCostPlusShippingMinor) / input.previousUnitCostPlusShippingMinor) * 100
        : 0
    percentageChecks.push({
      label: 'Maximum automatic supplier-switch cost increase',
      actualPct: costIncreasePct,
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
    // Milestone: autonomous decision & capability layer. Was
    // `outcome === 'switch_automatically' ? 'low' : 'medium'` — circular:
    // risk was derived from the very verdict it should help inform, never
    // from the actual cost-increase magnitude the percentage check above
    // already computes. Migrated to the shared classifier against that
    // same real magnitude; `'unknown'` (never a guessed default) when no
    // candidate was found to size at all. Never changes whether a switch
    // executes — `percentageChecks` above already independently forces
    // `require_approval` once the configured cost-increase ceiling is
    // exceeded, and a non-`switch_automatically` outcome already routes to
    // approval via `domainOutcome` regardless of risk label.
    riskLevel: costIncreasePct !== null
      ? classifyActionRisk({ actionType: 'switch_supplier', magnitude: { kind: 'percentage', actualPct: costIncreasePct, limitPct: input.settings.maxAutoSupplierSwitchCostIncreasePct } })
      : classifyActionRisk({ actionType: 'switch_supplier' }),
  })

  return { redundancy, policy }
}
