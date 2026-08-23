import { formatMoney, money } from '@/lib/core/money'
import { ACTION_CATEGORY, type AutomationActionType, type PolicyRequirement, type PolicyResult } from './types'
import { isCategoryPaused, type AutomationSettings } from './settingsTypes'

/**
 * The central automation policy engine (brief §3).
 *
 * This is deliberately the *only* place the kill switch and financial spend
 * limits are checked. It does not re-decide whether an action is a good
 * idea — that is what the domain engines already built in Milestones 2-5
 * do (`suppliers/redundancy.ts`, `marketplaces/publicationGate.ts`,
 * `fulfilment/submission.ts`, `orders/refunds.ts`, and this milestone's own
 * `priceAutomation.ts` / `inventoryAutomation.ts`). Every one of those
 * produces a `domainOutcome` — its own considered verdict on whether the
 * action is fatally blocked, needs a human, or may proceed automatically —
 * and passes it in here as the final step before anything executes. This
 * function only ever *narrows* that verdict (an approved action can still be
 * held back by the kill switch or a spending limit); it never widens it
 * (nothing here can turn a domain-blocked action into an allowed one).
 */

export type DomainOutcome = 'blocked' | 'pending_approval' | 'auto_permitted'

export interface FinancialLimitCheck {
  label: string
  amountMinor: number
  limitMinor: number
}

export interface PercentageLimitCheck {
  label: string
  actualPct: number
  limitPct: number
}

export interface PolicyCheckInput {
  actionType: AutomationActionType
  settings: AutomationSettings
  domainOutcome: DomainOutcome
  domainReason: string
  domainRequirements: readonly PolicyRequirement[]
  financialChecks?: readonly FinancialLimitCheck[]
  percentageChecks?: readonly PercentageLimitCheck[]
  riskLevel: PolicyResult['riskLevel']
}

function limitRequirement(check: FinancialLimitCheck): PolicyRequirement {
  const satisfied = check.amountMinor <= check.limitMinor
  return {
    key: `limit_${check.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    label: check.label,
    satisfied,
    detail: `${formatMoney(money(check.amountMinor, 'GBP'))} against a configured limit of ${formatMoney(money(check.limitMinor, 'GBP'))}.`,
  }
}

function percentageRequirement(check: PercentageLimitCheck): PolicyRequirement {
  const satisfied = Math.abs(check.actualPct) <= check.limitPct
  return {
    key: `limit_${check.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    label: check.label,
    satisfied,
    detail: `${check.actualPct.toFixed(1)}% against a configured limit of ${check.limitPct.toFixed(1)}%.`,
  }
}

export function evaluateAutomationPolicy(input: PolicyCheckInput): PolicyResult {
  const category = ACTION_CATEGORY[input.actionType]
  const paused = isCategoryPaused(input.settings, category)
  const financialChecks = input.financialChecks ?? []
  const percentageChecks = input.percentageChecks ?? []

  const requirements: PolicyRequirement[] = [
    ...input.domainRequirements,
    {
      key: 'automation_not_paused',
      label: 'Automation not paused',
      satisfied: !paused,
      detail: !paused
        ? 'Automation is running.'
        : input.settings.automationPaused
          ? `All automation is paused${input.settings.automationPausedReason ? ` (${input.settings.automationPausedReason})` : ''}.`
          : `Automation is paused for the "${category}" category.`,
    },
    ...financialChecks.map(limitRequirement),
    ...percentageChecks.map(percentageRequirement),
  ]

  // The domain engine's own verdict is authoritative when it did not permit
  // automatic execution: a fatal domain failure stays blocked, and anything
  // the domain already routed to a human stays there. Nothing below this
  // point can turn either of those into an automatic execution.
  if (input.domainOutcome !== 'auto_permitted') {
    return {
      outcome: input.domainOutcome === 'blocked' ? 'block' : 'require_approval',
      requirements,
      reason: input.domainReason,
      riskLevel: input.riskLevel,
    }
  }

  if (paused) {
    return {
      outcome: 'block',
      requirements,
      reason: `Blocked: automation is paused${category ? ` for the "${category}" category` : ''}.`,
      riskLevel: input.riskLevel,
    }
  }

  const exceeded = financialChecks.find((c) => c.amountMinor > c.limitMinor)
  if (exceeded) {
    return {
      outcome: 'require_approval',
      requirements,
      reason: `Requires approval: exceeds the configured ${exceeded.label.toLowerCase()}.`,
      riskLevel: input.riskLevel,
    }
  }

  const exceededPct = percentageChecks.find((c) => Math.abs(c.actualPct) > c.limitPct)
  if (exceededPct) {
    return {
      outcome: 'require_approval',
      requirements,
      reason: `Requires approval: exceeds the configured ${exceededPct.label.toLowerCase()}.`,
      riskLevel: input.riskLevel,
    }
  }

  return {
    outcome: 'allow_automatic',
    requirements,
    reason: input.domainReason,
    riskLevel: input.riskLevel,
  }
}
