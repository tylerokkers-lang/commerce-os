import { planRefund, type RefundDecision, type RefundRequest } from '@/lib/orders/refunds'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import type { AutomationSettings } from './settingsTypes'
import type { AutomationLevel, PolicyResult } from './types'

/**
 * Refund automation (brief §13).
 *
 * `orders/refunds.ts` (Milestone 5) already enforces the per-order
 * remaining-balance check and the single-refund automatic ceiling. What it
 * cannot know, because it only ever sees one refund request at a time, is
 * the *daily total* already issued and how many refunds this order has
 * already had — both are genuine cross-cutting policy limits, so they live
 * here rather than being bolted onto the pure per-request function.
 */

export interface RefundAutomationInput {
  request: RefundRequest
  settings: AutomationSettings
  refundsAlreadyIssuedTodayMinor: number
  refundsAlreadyIssuedOnOrder: number
}

export interface RefundAutomationResult {
  decision: RefundDecision
  policy: PolicyResult
}

export function evaluateRefundAutomation(
  input: RefundAutomationInput,
  automationLevel: AutomationLevel,
): RefundAutomationResult {
  const decision = planRefund(input.request, input.settings.maxAutoRefundMinor, automationLevel)
  return finishRefundAutomation(input, decision)
}

function finishRefundAutomation(input: RefundAutomationInput, decision: RefundDecision): RefundAutomationResult {
  const domainOutcome: DomainOutcome =
    decision.outcome === 'blocked' ? 'blocked' : decision.outcome === 'approve_automatically' ? 'auto_permitted' : 'pending_approval'

  const requirements = [
    {
      key: 'refund_request_valid',
      label: 'Refund request valid and within order balance',
      satisfied: decision.outcome !== 'blocked',
      detail: decision.reason,
    },
    {
      key: 'refunds_per_order_limit',
      label: 'Maximum refunds per order',
      satisfied: input.refundsAlreadyIssuedOnOrder < input.settings.maxRefundsPerOrder,
      detail: `${input.refundsAlreadyIssuedOnOrder} of a maximum ${input.settings.maxRefundsPerOrder} refunds already issued on ${input.request.orderId}.`,
    },
  ]

  const perOrderLimitExceeded = input.refundsAlreadyIssuedOnOrder >= input.settings.maxRefundsPerOrder

  const policy = evaluateAutomationPolicy({
    actionType: 'process_refund',
    settings: input.settings,
    domainOutcome: perOrderLimitExceeded && domainOutcome === 'auto_permitted' ? 'pending_approval' : domainOutcome,
    domainReason: decision.reason,
    domainRequirements: requirements,
    financialChecks: [
      {
        label: 'Maximum daily automatic refund total',
        amountMinor: input.refundsAlreadyIssuedTodayMinor + input.request.requestedAmount.minor,
        limitMinor: input.settings.maxDailyAutoRefundMinor,
      },
    ],
    riskLevel: decision.isFullRefund ? 'medium' : 'low',
  })

  return { decision, policy }
}
