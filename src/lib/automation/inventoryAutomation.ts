import { evaluateAutomationPolicy } from './policyEngine'
import type { AutomationSettings } from './settingsTypes'
import type { AutomationLevel, PolicyResult } from './types'

/**
 * Automatic inventory management (brief §9).
 *
 * Deliberately does not touch stock numbers itself — overselling, negative
 * inventory and race conditions are already guarded against by
 * `inventory/reservation.ts` (Milestone 5). This module answers a narrower
 * question: given a stock level that reservation module already reported,
 * what should the automation engine *do* about it — warn, look for another
 * supplier, or pause the listing so it can never oversell in the first place.
 */

export type InventoryAlertLevel = 'ok' | 'low' | 'out_of_stock'

export function assessStockLevel(availableUnits: number, lowStockThreshold: number): InventoryAlertLevel {
  if (availableUnits <= 0) return 'out_of_stock'
  if (availableUnits <= lowStockThreshold) return 'low'
  return 'ok'
}

export type InventoryActionDecision =
  | { action: 'none'; reason: string }
  | { action: 'warn'; reason: string }
  | { action: 'evaluate_alternative_supplier'; reason: string }
  | { action: 'pause_listing'; policy: PolicyResult }
  | { action: 'resume_listing'; policy: PolicyResult }

export interface StockShortfallInput {
  productTitle: string
  alertLevel: InventoryAlertLevel
  hasCompliantAlternativeSupplier: boolean
  automationLevel: AutomationLevel
  settings: AutomationSettings
}

/**
 * "Marketplace inventory must never exceed reliable supplier availability" —
 * out of stock with no compliant alternative always at least *proposes*
 * pausing, because the alternative (an oversold listing) is worse than a
 * paused one. Whether it pauses automatically or waits for approval is still
 * governed by automation level and the kill switch, same as every other
 * action.
 */
export function decideStockShortfallAction(input: StockShortfallInput): InventoryActionDecision {
  if (input.alertLevel === 'ok') {
    return { action: 'none', reason: `${input.productTitle}: stock is healthy.` }
  }

  if (input.alertLevel === 'low') {
    return { action: 'warn', reason: `${input.productTitle}: stock is running low.` }
  }

  if (input.hasCompliantAlternativeSupplier) {
    return {
      action: 'evaluate_alternative_supplier',
      reason: `${input.productTitle}: out of stock with the current supplier, but a compliant alternative exists — evaluating a supplier switch instead of pausing.`,
    }
  }

  const levelPermitsAuto = input.automationLevel === 'supervised' || input.automationLevel === 'autonomous'
  const policy = evaluateAutomationPolicy({
    actionType: 'pause_product',
    settings: input.settings,
    domainOutcome: levelPermitsAuto ? 'auto_permitted' : 'pending_approval',
    domainReason: `${input.productTitle}: out of stock with no compliant alternative supplier on file. Pausing prevents overselling; the product's history and settings are kept, not deleted.`,
    domainRequirements: [
      {
        key: 'no_compliant_alternative',
        label: 'No compliant alternative supplier available',
        satisfied: true,
        detail: 'Every alternative supplier considered failed compliance, profitability, or does not exist.',
      },
    ],
    riskLevel: 'medium',
  })

  return { action: 'pause_listing', policy }
}

export interface StockRestoredInput {
  productTitle: string
  wasPausedForStock: boolean
  automationLevel: AutomationLevel
  settings: AutomationSettings
}

/** Resuming is never automatic below `autonomous` — a returning supplier does not by itself re-clear the other gates that got the product paused. */
export function decideResumeAfterRestock(input: StockRestoredInput): InventoryActionDecision {
  if (!input.wasPausedForStock) {
    return { action: 'none', reason: `${input.productTitle}: was not paused for a stock reason, so restocking does not trigger a resume.` }
  }

  const policy = evaluateAutomationPolicy({
    actionType: 'resume_product',
    settings: input.settings,
    domainOutcome: input.automationLevel === 'autonomous' ? 'auto_permitted' : 'pending_approval',
    domainReason: `${input.productTitle}: supplier stock has returned. Recommend re-evaluating and resuming the listing.`,
    domainRequirements: [
      { key: 'stock_returned', label: 'Supplier stock returned', satisfied: true, detail: 'The previously out-of-stock supplier now reports available stock.' },
    ],
    riskLevel: 'low',
  })

  return { action: 'resume_listing', policy }
}
