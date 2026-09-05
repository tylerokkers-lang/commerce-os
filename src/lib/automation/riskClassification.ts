import { ACTION_CATEGORY, type AutomationActionType, type AutomationRiskLevel } from './types'

/**
 * Deterministic action-risk classification (Milestone: automation control
 * plane).
 *
 * `AutomationRiskLevel` (`types.ts`) has always had four real values —
 * `'low' | 'medium' | 'high' | 'unknown'` — but every domain engine built so
 * far (`priceAutomation.ts`, `inventoryAutomation.ts`, `orderAutomation.ts`,
 * `publicationAutomation.ts`, `refundAutomation.ts`, `supplierSwitching.ts`,
 * `advertisingAutomation.ts`) computes its own risk level inline with its
 * own bespoke ternary, and none of them has ever produced `'high'` or
 * `'unknown'` — both are reachable in the schema but dead in practice.
 *
 * This module does not replace those seven call sites (each one's ternary
 * is already tested, tuned to its own domain, and safe) — it exists so
 * every *new* execution path this milestone adds (dry-run, and any future
 * action type) has one shared, honest place to ask "how risky is this?"
 * rather than inventing an eighth bespoke ternary, and so `'unknown'` is a
 * real, reachable outcome that `policyEngine.ts` already knows never to
 * treat as automatically safe.
 */

export type RiskMagnitude =
  | { kind: 'percentage'; actualPct: number; limitPct: number }
  | { kind: 'amount'; amountMinor: number; limitMinor: number }

export interface RiskClassificationInput {
  actionType: AutomationActionType
  /**
   * The relevant magnitude this action is judged by — a percentage move
   * against a configured limit, or a money amount against a configured cap.
   * Omit only when the action type has no pausable category at all
   * (`ACTION_CATEGORY[actionType] === null`) — e.g. a pure internal
   * reconciliation flag or escalation, which never touches an external
   * system or a pound. Any category-bearing action type without a supplied
   * magnitude is classified `'unknown'`, never assumed low.
   */
  magnitude?: RiskMagnitude
}

function magnitudeRatio(magnitude: RiskMagnitude): number {
  if (magnitude.kind === 'percentage') {
    return magnitude.limitPct <= 0 ? Infinity : Math.abs(magnitude.actualPct) / magnitude.limitPct
  }
  return magnitude.limitMinor <= 0 ? Infinity : magnitude.amountMinor / magnitude.limitMinor
}

export function classifyActionRisk(input: RiskClassificationInput): AutomationRiskLevel {
  const category = ACTION_CATEGORY[input.actionType]
  if (category === null) return 'low'

  if (!input.magnitude) return 'unknown'

  const ratio = magnitudeRatio(input.magnitude)
  if (!Number.isFinite(ratio)) return 'high'
  if (ratio > 2) return 'high'
  if (ratio > 1) return 'medium'
  return 'low'
}
