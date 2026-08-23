import { calculateProfitability, type CostInputs, type Profitability } from '@/lib/profitability'
import { assessStockLevel, decideStockShortfallAction, type InventoryActionDecision, type InventoryAlertLevel } from './inventoryAutomation'
import type { AutomationSettings } from './settingsTypes'
import type { AutomationLevel } from './types'

/**
 * Automated product monitoring (brief §7).
 *
 * The fourteen-step checklist in the brief splits cleanly across engines
 * that already exist, so this function does not re-implement any of them —
 * it runs the two channel-independent checks (supplier/stock health,
 * profitability) in the documented order and hands back one consolidated
 * recommendation. Channel-specific compliance and publication eligibility
 * (steps 6-7, 11-12 of the brief's list) are evaluated separately, per
 * channel, by `publicationAutomation.ts` — folding them in here would
 * violate `docs/PRINCIPLES.md` §3 ("channel-aware, never globally
 * approved"), since a product can be healthy on this check and still
 * blocked on one specific channel.
 *
 * If a product becomes unprofitable, this deliberately does **not** decide
 * to delete or even pause it — the brief is explicit that price adjustment,
 * supplier substitution, or an owner decision to pause all come before
 * deletion, and none of those is chosen automatically here. It is
 * surfaced so a human, or a more specific automation (`priceAutomation.ts`,
 * `supplierSwitching.ts`), can act on it.
 */

export interface ProductMonitoringInput {
  productTitle: string
  automationLevel: AutomationLevel
  settings: AutomationSettings
  supplierAvailable: boolean
  stockAvailableUnits: number
  lowStockThreshold: number
  hasCompliantAlternativeSupplier: boolean
  costInputs: CostInputs
  minNetMarginPct: number
}

export type MonitoringRecommendation =
  | 'none' | 'monitor_stock' | 'evaluate_supplier' | 'pause_listing' | 'needs_price_or_supplier_review'

export interface ProductMonitoringResult {
  stockAlert: InventoryAlertLevel
  inventoryAction: InventoryActionDecision | null
  profitability: Profitability
  isProfitable: boolean
  recommendation: MonitoringRecommendation
  summary: string
}

export function evaluateProductMonitoring(input: ProductMonitoringInput): ProductMonitoringResult {
  const profitability = calculateProfitability(input.costInputs)
  const isProfitable = (profitability.netMarginPct ?? -Infinity) >= input.minNetMarginPct

  const stockAlert = assessStockLevel(input.stockAvailableUnits, input.lowStockThreshold)
  const effectiveAlert: InventoryAlertLevel = input.supplierAvailable ? stockAlert : 'out_of_stock'

  const inventoryAction =
    effectiveAlert === 'ok'
      ? null
      : decideStockShortfallAction({
          productTitle: input.productTitle,
          alertLevel: effectiveAlert,
          hasCompliantAlternativeSupplier: input.hasCompliantAlternativeSupplier,
          automationLevel: input.automationLevel,
          settings: input.settings,
        })

  if (!isProfitable) {
    return {
      stockAlert: effectiveAlert,
      inventoryAction,
      profitability,
      isProfitable,
      recommendation: 'needs_price_or_supplier_review',
      summary: `${input.productTitle}: net margin is ${(profitability.netMarginPct ?? 0).toFixed(1)}%, below the configured minimum of ${input.minNetMarginPct}%. Recommend evaluating a price adjustment or supplier substitution; not paused automatically.`,
    }
  }

  if (inventoryAction && inventoryAction.action !== 'none') {
    const recommendation: MonitoringRecommendation =
      inventoryAction.action === 'pause_listing'
        ? 'pause_listing'
        : inventoryAction.action === 'evaluate_alternative_supplier'
          ? 'evaluate_supplier'
          : 'monitor_stock'

    return {
      stockAlert: effectiveAlert,
      inventoryAction,
      profitability,
      isProfitable,
      recommendation,
      summary: inventoryAction.action === 'warn' || inventoryAction.action === 'evaluate_alternative_supplier'
        ? inventoryAction.reason
        : inventoryAction.policy.reason,
    }
  }

  return {
    stockAlert: effectiveAlert,
    inventoryAction: null,
    profitability,
    isProfitable,
    recommendation: 'none',
    summary: `${input.productTitle}: supplier, stock and profitability are all healthy.`,
  }
}
