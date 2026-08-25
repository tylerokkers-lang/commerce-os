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
  /**
   * Milestone 14 — `business_settings.max_daily_ad_spend_minor`/`min_roas`
   * have existed since Milestone 1 (the Settings page already edits them,
   * `products/settings.ts`'s `businessSettingsSchema` already validates
   * them) but were never read by any analysis code until now — wired in
   * here rather than a second settings read, matching how every other
   * threshold in this file is already read once, in one place.
   */
  maxDailyAdSpendMinor: number
  minRoas: number
  /**
   * Milestone 15 — `business_settings.max_auto_ad_increase_pct` has existed
   * since Milestone 1 (reserved for exactly this) but was never read
   * anywhere until now. Bounds the *magnitude* of an automatic campaign
   * budget change symmetrically — the same `Math.abs(actualPct) <=
   * limitPct` rule `policyEngine.ts`'s `percentageRequirement` already
   * applies to `maxAutoPriceChangePct`, reused unchanged rather than a
   * second, decrease-specific column: a budget decrease is the inherently
   * safer direction, so the one configured magnitude limit is what needs
   * enforcing on both directions, not a fabricated second threshold.
   */
  maxAutoAdIncreasePct: number
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
  maxDailyAdSpendMinor: 5000, // Matches business_settings' own column default (£50).
  minRoas: 3,
  maxAutoAdIncreasePct: 20,
}

/** Whether the kill switch (global or category-specific) currently blocks an action. */
export function isCategoryPaused(settings: AutomationSettings, category: AutomationCategory | null): boolean {
  if (settings.automationPaused) return true
  if (category === null) return false
  return settings.automationPausedCategories.includes(category)
}
