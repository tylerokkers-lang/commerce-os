import { calculateProfitability, type CostInputs, type Profitability } from '@/lib/profitability'
import { formatMoney } from '@/lib/core/money'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import { classifyActionRisk } from './riskClassification'
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

/**
 * The margin/policy decision, taking already-computed `Profitability` for
 * "before" and "after" rather than raw `CostInputs` — split out from
 * `assessPriceChange` (Milestone 13) so a caller that already has real
 * per-product profitability from elsewhere (`analytics/profitAnalytics.ts`'s
 * `buildProductChannelProfitAnalytics`, which itself resolves the correct
 * per-channel fee profile via `profitability/channels.ts`) can reuse this
 * exact decision logic without reconstructing `CostInputs` by hand — which
 * would risk silently drifting from the real channel-fee assumptions
 * `channels.ts` owns. `assessPriceChange` below is now a thin wrapper that
 * calls `calculateProfitability` itself and delegates here; its behaviour
 * and signature are unchanged.
 */
export interface PriceChangePolicyInput {
  productTitle: string
  before: Profitability
  after: Profitability
  oldPriceMinor: number
  newPriceMinor: number
  automationLevel: AutomationLevel
  /** Sum of any other price changes already applied to this product today, as a percentage. */
  priorChangeTodayPct?: number
}

export function assessPriceChangePolicy(input: PriceChangePolicyInput, settings: AutomationSettings): PriceChangeAssessment {
  const { before, after } = input
  const pctChange = input.oldPriceMinor === 0 ? 0 : ((input.newPriceMinor - input.oldPriceMinor) / input.oldPriceMinor) * 100

  const marginSatisfied = (after.netMarginPct ?? -Infinity) >= settings.minNetMarginPct

  const marginRequirement = {
    key: 'minimum_net_margin',
    label: 'Minimum net margin after change',
    satisfied: marginSatisfied,
    detail: `Net margin would move from ${(before.netMarginPct ?? 0).toFixed(1)}% to ${(after.netMarginPct ?? 0).toFixed(1)}%, against a configured minimum of ${settings.minNetMarginPct}%.`,
  }

  const domainOutcome: DomainOutcome = !marginSatisfied
    ? 'blocked'
    : levelPermitsAutoApply(input.automationLevel)
      ? 'auto_permitted'
      : 'pending_approval'

  const domainReason = !marginSatisfied
    ? `Blocked: ${input.productTitle}'s net margin would fall to ${(after.netMarginPct ?? 0).toFixed(1)}%, below the configured minimum of ${settings.minNetMarginPct}%.`
    : `${input.productTitle}: ${formatMoney({ minor: input.oldPriceMinor, currency: before.currency })} -> ${formatMoney({ minor: input.newPriceMinor, currency: after.currency })}. Net margin ${(before.netMarginPct ?? 0).toFixed(1)}% -> ${(after.netMarginPct ?? 0).toFixed(1)}%.`

  const cumulativePct = (input.priorChangeTodayPct ?? 0) + pctChange

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
    // Milestone: autonomous decision & capability layer. Migrated to the
    // shared classifier (`riskClassification.ts`) — identical output to the
    // old inline ternary for every change within double the configured
    // limit (both agree: at-or-under -> low, over-but-not-double ->
    // medium), and now honestly reports `'high'` for a change more than
    // double the limit, which the old ternary silently flattened to
    // `'medium'`. This never changes whether the change executes — an
    // over-limit change was already forced to `require_approval` by the
    // `percentageChecks` entry below regardless of its risk label; only the
    // audit-trail label for an extreme, already-blocked case is more honest.
    riskLevel: classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: pctChange, limitPct: settings.maxAutoPriceChangePct } }),
  })

  return { before, after, pctChange, policy }
}

export function assessPriceChange(request: PriceChangeRequest, settings: AutomationSettings): PriceChangeAssessment {
  const before = calculateProfitability(request.costInputsBefore)
  const after = calculateProfitability({ ...request.costInputsBefore, sellingPrice: request.newSellingPrice })

  return assessPriceChangePolicy({
    productTitle: request.productTitle,
    before, after,
    oldPriceMinor: request.costInputsBefore.sellingPrice.minor,
    newPriceMinor: request.newSellingPrice.minor,
    automationLevel: request.automationLevel,
    priorChangeTodayPct: request.priorChangeTodayPct,
  }, settings)
}
