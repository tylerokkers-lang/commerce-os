import { planRefund, type RefundDecision, type RefundRequest } from '@/lib/orders/refunds'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import { classifyActionRisk } from './riskClassification'
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
    // Milestone: autonomous decision & capability layer. Was
    // `isFullRefund ? 'medium' : 'low'` — a real inconsistency: a large
    // *partial* refund (e.g. 95% of a big order) was classified lower risk
    // than a *full* refund of a trivial amount, purely because of the
    // boolean, never the actual sum at risk. Migrated to the shared
    // classifier against the same single-refund ceiling
    // (`maxAutoRefundMinor`) the domain engine's own `planRefund` already
    // enforces. Never changes whether the refund executes — `financialChecks`
    // above independently forces `require_approval` once the daily ceiling
    // is exceeded, and `planRefund` itself gates the single-refund ceiling.
    riskLevel: classifyActionRisk({ actionType: 'process_refund', magnitude: { kind: 'amount', amountMinor: input.request.requestedAmount.minor, limitMinor: input.settings.maxAutoRefundMinor } }),
  })

  return { decision, policy }
}
