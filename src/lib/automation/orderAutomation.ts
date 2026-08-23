import { runOrderPipeline, type OrderPipelineInput, type OrderPipelineResult } from '@/lib/orders/pipeline'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import type { AutomationSettings } from './settingsTypes'
import type { PolicyResult } from './types'

/**
 * Order automation (brief §12).
 *
 * Threads straight into Milestone 5's `runOrderPipeline` — no separate
 * fulfilment calculation exists here or ever should. This module's only
 * addition is the automation-engine layer the pipeline itself does not know
 * about: the kill switch (both the "fulfilment" and "supplier_ordering"
 * categories can gate an order, since submitting a fulfilment usually also
 * means placing or drawing down a supplier order) and the daily automatic
 * supplier-spend ceiling.
 */

export interface OrderAutomationResult {
  pipeline: OrderPipelineResult
  policy: PolicyResult
}

export function evaluateOrderAutomation(
  input: OrderPipelineInput,
  settings: AutomationSettings,
  supplierSpendAlreadyTodayMinor: number,
): OrderAutomationResult {
  const pipeline = runOrderPipeline(input)

  const domainOutcome: DomainOutcome =
    pipeline.submission.outcome === 'blocked'
      ? 'blocked'
      : pipeline.submission.outcome === 'submit_automatically'
        ? 'auto_permitted'
        : 'pending_approval'

  const estimatedOrderCostMinor =
    (input.lineEconomics.supplierUnitCost.minor + input.lineEconomics.supplierShipping.minor) *
    input.lineEconomics.quantity

  const policy = evaluateAutomationPolicy({
    actionType: 'submit_supplier_order',
    settings,
    domainOutcome,
    domainReason: pipeline.submission.reason,
    domainRequirements: pipeline.submission.requirements,
    financialChecks: [
      {
        label: "Maximum daily automatic supplier spend",
        amountMinor: supplierSpendAlreadyTodayMinor + estimatedOrderCostMinor,
        limitMinor: settings.maxDailyAutoSupplierSpendMinor,
      },
    ],
    riskLevel: 'medium',
  })

  return { pipeline, policy }
}
