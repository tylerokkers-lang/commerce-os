'use server'

import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { businessSettingsSchema } from '@/lib/products/settings'
import { requireWriteAccess } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'
import type { SettingsFormState } from './state'

/** An empty string means "not set" for these fields — never coerced to 0, which would mean something entirely different (zero capital, not unknown capital). */
function majorToMinorOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null
  const pounds = Number(value)
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : null
}

/**
 * Saves business settings.
 *
 * Server Actions are reachable by direct POST, not only through this form, so
 * authentication and role are checked here rather than relying on the page
 * having rendered.
 */
export async function saveBusinessSettings(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const session = await requireWriteAccess()

  const parsed = businessSettingsSchema.safeParse({
    legal_name: formData.get('legal_name'),
    trading_name: formData.get('trading_name'),
    address_line1: formData.get('address_line1'),
    city: formData.get('city'),
    postcode: formData.get('postcode'),
    email: formData.get('email'),
    company_number: formData.get('company_number'),
    vat_registered: formData.get('vat_registered') === 'on',
    vat_number: formData.get('vat_number'),
    automation_level: formData.get('automation_level'),
    min_gross_margin_pct: formData.get('min_gross_margin_pct'),
    min_net_margin_pct: formData.get('min_net_margin_pct'),
    min_opportunity_score: formData.get('min_opportunity_score'),
    // The form collects pounds; the database stores pence.
    max_auto_purchase_minor: Math.round(Number(formData.get('max_auto_purchase_major') ?? 0) * 100),
    max_auto_price_change_pct: formData.get('max_auto_price_change_pct'),
    max_daily_ad_spend_minor: Math.round(Number(formData.get('max_daily_ad_spend_major') ?? 0) * 100),
    min_roas: formData.get('min_roas'),
    max_auto_ad_increase_pct: formData.get('max_auto_ad_increase_pct'),
    max_delivery_days: formData.get('max_delivery_days'),
    max_return_rate_pct: formData.get('max_return_rate_pct'),
    min_quality_score: formData.get('min_quality_score'),
    max_risk_score: formData.get('max_risk_score'),
    target_net_margin_pct: formData.get('target_net_margin_pct'),
    advertising_allowance_pct: formData.get('advertising_allowance_pct'),
    // Pounds in the form, pence in the database, and — unlike every other
    // money field on this page — genuinely absent rather than zero when the
    // owner hasn't set a real figure yet (an empty string, not "0").
    available_operating_capital_minor: majorToMinorOrNull(formData.get('available_operating_capital_major')),
    cash_buffer_minor: majorToMinorOrNull(formData.get('cash_buffer_major')),
    max_supplier_cost_minor: majorToMinorOrNull(formData.get('max_supplier_cost_major')),
    max_candidates_per_discovery_run: formData.get('max_candidates_per_discovery_run'),
    max_products_pending_review: formData.get('max_products_pending_review'),
    min_product_images: formData.get('min_product_images'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form')
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { status: 'error', message: 'Some values need correcting.', fieldErrors }
  }

  if (session.isDemo) {
    return {
      status: 'error',
      message:
        'Demo mode does not write to a database. Connect Supabase and set COMMERCE_OS_MODE=live to save real settings.',
      fieldErrors: {},
    }
  }

  const supabase = await createServerSupabase()

  const { data: existing } = await supabase
    .from('business_settings')
    .select('*')
    .eq('org_id', session.orgId)
    .maybeSingle()

  const values = {
    ...parsed.data,
    trading_name: parsed.data.trading_name || null,
    address_line1: parsed.data.address_line1 || null,
    city: parsed.data.city || null,
    postcode: parsed.data.postcode || null,
    email: parsed.data.email || null,
    company_number: parsed.data.company_number || null,
    // The database enforces this too, but stripping it here means a
    // deregistered business cannot leave a stale number behind.
    vat_number: parsed.data.vat_registered ? parsed.data.vat_number || null : null,
  }

  const { error } = await supabase
    .from('business_settings')
    .upsert({ org_id: session.orgId, ...values }, { onConflict: 'org_id' })

  if (error) {
    return { status: 'error', message: `Could not save: ${error.message}`, fieldErrors: {} }
  }

  await recordAudit({
    orgId: session.orgId,
    action: 'SETTINGS_UPDATED',
    entityType: 'business_settings',
    entityId: session.orgId,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
    previousValue: existing ?? null,
    newValue: values,
    reason: 'Business settings updated from the settings page',
  })

  if (existing && existing.automation_level !== parsed.data.automation_level) {
    await recordAudit({
      orgId: session.orgId,
      action: 'AUTOMATION_LEVEL_CHANGED',
      entityType: 'business_settings',
      entityId: session.orgId,
      actorType: 'user',
      actorUserId: session.userId,
      actorLabel: session.email,
      previousValue: existing.automation_level,
      newValue: parsed.data.automation_level,
      reason: 'Changed by the owner',
    })
  }

  revalidatePath('/settings')
  return { status: 'saved', message: 'Settings saved.', fieldErrors: {} }
}
