import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import type { SessionContext } from '@/lib/security/session'
import { DEMO_AUTOMATION_SETTINGS, type AutomationSettings } from './settingsTypes'
import type { AutomationCategory } from './types'

export type { AutomationSettings } from './settingsTypes'
export { isCategoryPaused } from './settingsTypes'

export async function getAutomationSettings(session: SessionContext): Promise<AutomationSettings> {
  if (session.isDemo) return DEMO_AUTOMATION_SETTINGS

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('business_settings')
    .select('automation_level, automation_paused, automation_paused_at, automation_paused_reason, automation_paused_categories, max_auto_purchase_minor, max_auto_price_change_pct, max_price_movement_per_day_pct, max_auto_refund_minor, max_daily_auto_refund_minor, max_refunds_per_order, max_daily_auto_supplier_spend_minor, max_auto_supplier_switch_cost_increase_pct, min_net_margin_pct')
    .eq('org_id', session.orgId)
    .maybeSingle()

  if (error) throw new Error(`Could not load automation settings: ${error.message}`)
  if (!data) return DEMO_AUTOMATION_SETTINGS

  return {
    automationLevel: data.automation_level,
    automationPaused: data.automation_paused,
    automationPausedAt: data.automation_paused_at,
    automationPausedReason: data.automation_paused_reason,
    automationPausedCategories: (data.automation_paused_categories ?? []) as AutomationCategory[],
    maxAutoPurchaseMinor: data.max_auto_purchase_minor,
    maxAutoPriceChangePct: Number(data.max_auto_price_change_pct),
    maxPriceMovementPerDayPct: Number(data.max_price_movement_per_day_pct),
    maxAutoRefundMinor: data.max_auto_refund_minor,
    maxDailyAutoRefundMinor: data.max_daily_auto_refund_minor,
    maxRefundsPerOrder: data.max_refunds_per_order,
    maxDailyAutoSupplierSpendMinor: data.max_daily_auto_supplier_spend_minor,
    maxAutoSupplierSwitchCostIncreasePct: Number(data.max_auto_supplier_switch_cost_increase_pct),
    minNetMarginPct: Number(data.min_net_margin_pct),
  }
}
