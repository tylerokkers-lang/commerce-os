import 'server-only'

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server'
import type { SessionContext } from '@/lib/security/session'
import { DEMO_AUTOMATION_SETTINGS, type AutomationSettings } from './settingsTypes'
import type { AutomationCategory } from './types'

export type { AutomationSettings } from './settingsTypes'
export { isCategoryPaused } from './settingsTypes'

const SETTINGS_COLUMNS =
  'automation_level, automation_paused, automation_paused_at, automation_paused_reason, automation_paused_categories, max_auto_purchase_minor, max_auto_price_change_pct, max_price_movement_per_day_pct, max_auto_refund_minor, max_daily_auto_refund_minor, max_refunds_per_order, max_daily_auto_supplier_spend_minor, max_auto_supplier_switch_cost_increase_pct, min_net_margin_pct'

interface SettingsRow {
  automation_level: AutomationSettings['automationLevel']
  automation_paused: boolean
  automation_paused_at: string | null
  automation_paused_reason: string | null
  automation_paused_categories: string[] | null
  max_auto_purchase_minor: number
  max_auto_price_change_pct: number | string
  max_price_movement_per_day_pct: number | string
  max_auto_refund_minor: number
  max_daily_auto_refund_minor: number
  max_refunds_per_order: number
  max_daily_auto_supplier_spend_minor: number
  max_auto_supplier_switch_cost_increase_pct: number | string
  min_net_margin_pct: number | string
}

function mapSettingsRow(data: SettingsRow): AutomationSettings {
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

/** For request-scoped reads on behalf of a signed-in user (pages, server actions). */
export async function getAutomationSettings(session: SessionContext): Promise<AutomationSettings> {
  if (session.isDemo) return DEMO_AUTOMATION_SETTINGS

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('business_settings').select(SETTINGS_COLUMNS).eq('org_id', session.orgId).maybeSingle()

  if (error) throw new Error(`Could not load automation settings: ${error.message}`)
  if (!data) return DEMO_AUTOMATION_SETTINGS

  return mapSettingsRow(data)
}

/**
 * For the job worker, which has no user session — it must always read the
 * *current* kill-switch and limit state at execution time (not whatever was
 * true when a job was enqueued), so a pause applied while a job is queued
 * still takes effect before that job runs.
 */
export async function getAutomationSettingsForOrg(orgId: string): Promise<AutomationSettings> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.from('business_settings').select(SETTINGS_COLUMNS).eq('org_id', orgId).maybeSingle()

  if (error) throw new Error(`Could not load automation settings: ${error.message}`)
  if (!data) return DEMO_AUTOMATION_SETTINGS

  return mapSettingsRow(data)
}
