import type { AutomationCategory, AutomationLevel } from './types'

/**
 * The automation policy engine's configuration, read from `business_settings`
 * (extended in migration 0019). Kept in its own file with no `server-only`
 * import — unlike the database read in `settings.ts` — specifically so
 * `policyEngine.ts` and its unit tests can use `isCategoryPaused` without
 * pulling in a module that only works inside a server request.
 */
export interface AutomationSettings {
  automationLevel: AutomationLevel
  automationPaused: boolean
  automationPausedAt: string | null
  automationPausedReason: string | null
  automationPausedCategories: readonly AutomationCategory[]
  maxAutoPurchaseMinor: number
  maxAutoPriceChangePct: number
  maxPriceMovementPerDayPct: number
  maxAutoRefundMinor: number
  maxDailyAutoRefundMinor: number
  maxRefundsPerOrder: number
  maxDailyAutoSupplierSpendMinor: number
  maxAutoSupplierSwitchCostIncreasePct: number
  minNetMarginPct: number
}

/**
 * Cautious starting values for a new business — deliberately conservative,
 * matching the migration's own column defaults and `settings/page.tsx`'s
 * `DEMO_DEFAULTS` where the field overlaps.
 */
export const DEMO_AUTOMATION_SETTINGS: AutomationSettings = {
  automationLevel: 'assisted',
  automationPaused: false,
  automationPausedAt: null,
  automationPausedReason: null,
  automationPausedCategories: [],
  maxAutoPurchaseMinor: 20000,
  maxAutoPriceChangePct: 5,
  maxPriceMovementPerDayPct: 10,
  maxAutoRefundMinor: 5000,
  maxDailyAutoRefundMinor: 20000,
  maxRefundsPerOrder: 3,
  maxDailyAutoSupplierSpendMinor: 100000,
  maxAutoSupplierSwitchCostIncreasePct: 10,
  minNetMarginPct: 10,
}

/** Whether the kill switch (global or category-specific) currently blocks an action. */
export function isCategoryPaused(settings: AutomationSettings, category: AutomationCategory | null): boolean {
  if (settings.automationPaused) return true
  if (category === null) return false
  return settings.automationPausedCategories.includes(category)
}
