import 'server-only'

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server'
import type { SessionContext } from '@/lib/security/session'
import { DEMO_AUTOMATION_SETTINGS, type AutomationSettings } from './settingsTypes'
import type { AutomationCategory } from './types'

export type { AutomationSettings } from './settingsTypes'
export { isCategoryPaused } from './settingsTypes'

const SETTINGS_COLUMNS =
  'automation_level, automation_paused, automation_paused_at, automation_paused_reason, automation_paused_categories, max_auto_purchase_minor, max_auto_price_change_pct, max_price_movement_per_day_pct, max_auto_refund_minor, max_daily_auto_refund_minor, max_refunds_per_order, max_daily_auto_supplier_spend_minor, max_auto_supplier_switch_cost_increase_pct, min_net_margin_pct, max_daily_ad_spend_minor, min_roas, max_auto_ad_increase_pct, min_gross_margin_pct, min_opportunity_score, min_quality_score, max_risk_score, target_net_margin_pct, advertising_allowance_pct, available_operating_capital_minor, cash_buffer_minor, max_supplier_cost_minor, max_candidates_per_discovery_run, max_products_pending_review, min_product_images, min_image_width_px, min_image_height_px, max_image_file_size_bytes, allowed_image_formats, max_delivery_days, vat_registered, vat_rate_pct, packaging_cost_minor, return_rate_pct, return_loss_pct, refund_rate_pct, chargeback_rate_pct, chargeback_fee_minor, import_duty_pct'

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
  max_daily_ad_spend_minor: number
  min_roas: number | string
  max_auto_ad_increase_pct: number | string
  min_gross_margin_pct: number | string
  min_opportunity_score: number
  min_quality_score: number
  max_risk_score: number
  target_net_margin_pct: number | string
  advertising_allowance_pct: number | string
  available_operating_capital_minor: number | null
  cash_buffer_minor: number | null
  max_supplier_cost_minor: number | null
  max_candidates_per_discovery_run: number
  max_products_pending_review: number
  min_product_images: number
  min_image_width_px: number
  min_image_height_px: number
  max_image_file_size_bytes: number
  allowed_image_formats: string[] | null
  max_delivery_days: number
  vat_registered: boolean
  vat_rate_pct: number | string | null
  packaging_cost_minor: number | null
  return_rate_pct: number | string | null
  return_loss_pct: number | string | null
  refund_rate_pct: number | string | null
  chargeback_rate_pct: number | string | null
  chargeback_fee_minor: number | null
  import_duty_pct: number | string | null
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
    maxDailyAdSpendMinor: data.max_daily_ad_spend_minor,
    minRoas: Number(data.min_roas),
    maxAutoAdIncreasePct: Number(data.max_auto_ad_increase_pct),
    minGrossMarginPct: Number(data.min_gross_margin_pct),
    minOpportunityScore: data.min_opportunity_score,
    minQualityScore: data.min_quality_score,
    maxRiskScore: data.max_risk_score,
    targetNetMarginPct: Number(data.target_net_margin_pct),
    advertisingAllowancePct: Number(data.advertising_allowance_pct),
    availableOperatingCapitalMinor: data.available_operating_capital_minor,
    cashBufferMinor: data.cash_buffer_minor,
    maxSupplierCostMinor: data.max_supplier_cost_minor,
    maxCandidatesPerDiscoveryRun: data.max_candidates_per_discovery_run,
    maxProductsPendingReview: data.max_products_pending_review,
    minProductImages: data.min_product_images,
    minImageWidthPx: data.min_image_width_px,
    minImageHeightPx: data.min_image_height_px,
    maxImageFileSizeBytes: data.max_image_file_size_bytes,
    allowedImageFormats: data.allowed_image_formats ?? [],
    maxDeliveryDays: data.max_delivery_days,
    // A row was found and mapped, so every field above is a real,
    // operator-saved value — never a silent placeholder.
    businessSettingsConfigured: true,
    vatRegistered: data.vat_registered,
    vatRatePct: data.vat_rate_pct === null ? null : Number(data.vat_rate_pct),
    packagingCostMinor: data.packaging_cost_minor,
    returnRatePct: data.return_rate_pct === null ? null : Number(data.return_rate_pct),
    returnLossPct: data.return_loss_pct === null ? null : Number(data.return_loss_pct),
    refundRatePct: data.refund_rate_pct === null ? null : Number(data.refund_rate_pct),
    chargebackRatePct: data.chargeback_rate_pct === null ? null : Number(data.chargeback_rate_pct),
    chargebackFeeMinor: data.chargeback_fee_minor,
    importDutyPct: data.import_duty_pct === null ? null : Number(data.import_duty_pct),
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
