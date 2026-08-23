import { calculateProfitability, type CostInputs, type Profitability } from '@/lib/profitability'
import { formatMoney } from '@/lib/core/money'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import type { AutomationSettings } from './settingsTypes'
import type { AutomationLevel, PolicyResult } from './types'

/**
 * Guarded price automation (brief §10).
 *
 * There is no separate margin formula here — `calculateProfitability` is
 * called with the proposed price exactly as it is called everywhere else in
 * this codebase, so "never allow a price change to bypass the profitability
 * engine" is true by construction rather than by promise. Automation level
 * gating mirrors `fulfilment/submission.ts`: `manual`/`assisted` may only
 * recommend a price change, `supervised`/`autonomous` may apply one that
 * clears every guard below.
 */

export interface PriceChangeRequest {
  productTitle: string
  /** The product's current cost inputs, using its current selling price. */
  costInputsBefore: CostInputs
  newSellingPrice: CostInputs['sellingPrice']
  automationLevel: AutomationLevel
  /** Sum of any other price changes already applied to this product today, as a percentage. */
  priorChangeTodayPct?: number
}

export interface PriceChangeAssessment {
  before: Profitability
  after: Profitability
  pctChange: number
  policy: PolicyResult
}

function levelPermitsAutoApply(level: AutomationLevel): boolean {
  return level === 'supervised' || level === 'autonomous'
}

export function assessPriceChange(request: PriceChangeRequest, settings: AutomationSettings): PriceChangeAssessment {
  const before = calculateProfitability(request.costInputsBefore)
  const after = calculateProfitability({ ...request.costInputsBefore, sellingPrice: request.newSellingPrice })

  const oldMinor = request.costInputsBefore.sellingPrice.minor
  const pctChange = oldMinor === 0 ? 0 : ((request.newSellingPrice.minor - oldMinor) / oldMinor) * 100

  const marginSatisfied = (after.netMarginPct ?? -Infinity) >= settings.minNetMarginPct

  const marginRequirement = {
    key: 'minimum_net_margin',
    label: 'Minimum net margin after change',
    satisfied: marginSatisfied,
    detail: `Net margin would move from ${(before.netMarginPct ?? 0).toFixed(1)}% to ${(after.netMarginPct ?? 0).toFixed(1)}%, against a configured minimum of ${settings.minNetMarginPct}%.`,
  }

  const domainOutcome: DomainOutcome = !marginSatisfied
    ? 'blocked'
    : levelPermitsAutoApply(request.automationLevel)
      ? 'auto_permitted'
      : 'pending_approval'

  const domainReason = !marginSatisfied
    ? `Blocked: ${request.productTitle}'s net margin would fall to ${(after.netMarginPct ?? 0).toFixed(1)}%, below the configured minimum of ${settings.minNetMarginPct}%.`
    : `${request.productTitle}: ${formatMoney(request.costInputsBefore.sellingPrice)} -> ${formatMoney(request.newSellingPrice)}. Net margin ${(before.netMarginPct ?? 0).toFixed(1)}% -> ${(after.netMarginPct ?? 0).toFixed(1)}%.`

  const cumulativePct = (request.priorChangeTodayPct ?? 0) + pctChange

  const policy = evaluateAutomationPolicy({
    actionType: 'update_price',
    settings,
    domainOutcome,
    domainReason,
    domainRequirements: [marginRequirement],
    percentageChecks: [
      { label: 'Maximum price change per action', actualPct: pctChange, limitPct: settings.maxAutoPriceChangePct },
      { label: 'Maximum price movement per day', actualPct: cumulativePct, limitPct: settings.maxPriceMovementPerDayPct },
    ],
    riskLevel: Math.abs(pctChange) > settings.maxAutoPriceChangePct ? 'medium' : 'low',
  })

  return { before, after, pctChange, policy }
}
