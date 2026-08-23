'use server'

import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { requireWriteAccess } from '@/lib/security/session'
import { supplierSchema } from '@/lib/suppliers/validation'
import {
  assessAmazonCapability,
  assessShopifyCapability,
  scoreSupplier,
  type SupplierSignals,
} from '@/lib/suppliers/scoring'
import { createServerSupabase } from '@/lib/supabase/server'
import { money } from '@/lib/core/money'
import type { SupplierFormState } from './state'

/**
 * Creates or updates a supplier.
 *
 * Two things happen here beyond persistence, and both matter:
 *
 *   1. The channel statuses are recomputed from the capability flags rather
 *      than being editable directly. A supplier cannot be marked "approved for
 *      Amazon" by hand while lacking seller-of-record support.
 *
 *   2. Any change of channel status is audited separately from the edit, so
 *      the reason a supplier became eligible or ineligible is recoverable.
 */
export async function saveSupplier(
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const session = await requireWriteAccess()

  const checkbox = (name: string) => formData.get(name) === 'on'
  const numberOrUndefined = (name: string) => {
    const raw = formData.get(name)
    return raw === null || String(raw).trim() === '' ? undefined : raw
  }

  const parsed = supplierSchema.safeParse({
    name: formData.get('name'),
    company_name: formData.get('company_name'),
    website: formData.get('website'),
    contact_email: formData.get('contact_email'),
    contact_phone: formData.get('contact_phone'),
    country: formData.get('country'),
    platform: formData.get('platform'),
    notes: formData.get('notes'),
    typical_delivery_days_min: formData.get('typical_delivery_days_min'),
    typical_delivery_days_max: formData.get('typical_delivery_days_max'),
    supports_blind_shipping: checkbox('supports_blind_shipping'),
    supports_custom_packaging: checkbox('supports_custom_packaging'),
    supports_custom_invoice: checkbox('supports_custom_invoice'),
    supports_own_branding: checkbox('supports_own_branding'),
    provides_tracking: checkbox('provides_tracking'),
    handles_returns: checkbox('handles_returns'),
    accepts_faulty_returns: checkbox('accepts_faulty_returns'),
    returns_policy: formData.get('returns_policy'),
    returns_window_days: formData.get('returns_window_days'),
    // The form collects pounds; the database stores pence.
    min_order_value_minor: Math.round(Number(formData.get('min_order_value_major') ?? 0) * 100),
    orders_placed: formData.get('orders_placed'),
    orders_late: formData.get('orders_late'),
    orders_defective: formData.get('orders_defective'),
    quality_rating: numberOrUndefined('quality_rating'),
    communication_rating: numberOrUndefined('communication_rating'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form')
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { status: 'error', message: 'Some values need correcting.', fieldErrors }
  }

  const values = parsed.data

  // The capability flags decide eligibility, so the statuses are derived here
  // using the same engine the assessment pages use.
  const signals: SupplierSignals = {
    unitCost: money(0, 'GBP'),
    shippingCost: money(0, 'GBP'),
    deliveryDaysMin: values.typical_delivery_days_min,
    deliveryDaysMax: values.typical_delivery_days_max,
    ordersPlaced: values.orders_placed,
    ordersLate: values.orders_late,
    ordersDefective: values.orders_defective,
    qualityRating: values.quality_rating,
    communicationRating: values.communication_rating,
    handlesReturns: values.handles_returns,
    returnsWindowDays: values.returns_window_days,
    acceptsFaultyReturns: values.accepts_faulty_returns,
    providesTracking: values.provides_tracking,
    supportsBlindShipping: values.supports_blind_shipping,
    supportsCustomInvoice: values.supports_custom_invoice,
    supportsCustomPackaging: values.supports_custom_packaging,
    supportsOwnBranding: values.supports_own_branding,
    documentCount: 0,
  }

  const shopify = assessShopifyCapability(signals)
  const amazon = assessAmazonCapability(signals)
  const score = scoreSupplier(signals)

  if (session.isDemo) {
    return {
      status: 'error',
      message:
        'Demo mode has no database, so suppliers cannot be saved. The validation, scoring and channel assessment above all ran for real: ' +
        `Shopify would be ${shopify.status.replace('_', ' ')}, Amazon would be ${amazon.status.replace('_', ' ')}.`,
      fieldErrors: {},
    }
  }

  const supabase = await createServerSupabase()
  const id = String(formData.get('id') ?? '').trim()

  const row = {
    org_id: session.orgId,
    name: values.name,
    company_name: values.company_name || null,
    website: values.website || null,
    contact_email: values.contact_email || null,
    contact_phone: values.contact_phone || null,
    country: values.country || null,
    platform: values.platform || null,
    notes: values.notes || null,
    typical_delivery_days_min: values.typical_delivery_days_min,
    typical_delivery_days_max: values.typical_delivery_days_max,
    supports_blind_shipping: values.supports_blind_shipping,
    supports_custom_packaging: values.supports_custom_packaging,
    supports_custom_invoice: values.supports_custom_invoice,
    supports_own_branding: values.supports_own_branding,
    provides_tracking: values.provides_tracking,
    handles_returns: values.handles_returns,
    accepts_faulty_returns: values.accepts_faulty_returns,
    returns_policy: values.returns_policy || null,
    returns_window_days: values.returns_window_days,
    min_order_value_minor: values.min_order_value_minor,
    orders_placed: values.orders_placed,
    orders_late: values.orders_late,
    orders_defective: values.orders_defective,
    quality_rating: values.quality_rating ?? null,
    communication_rating: values.communication_rating ?? null,
    shopify_status: shopify.status,
    amazon_status: amazon.status,
    status_reason: (amazon.status === 'approved' ? shopify.reasons : amazon.reasons).join(' '),
    last_assessed_at: new Date().toISOString(),
    current_score: score.total,
    current_score_at: new Date().toISOString(),
  }

  const existing = id
    ? (await supabase.from('suppliers').select('*').eq('id', id).eq('org_id', session.orgId).maybeSingle()).data
    : null

  const { data: saved, error } = id
    ? await supabase.from('suppliers').update(row).eq('id', id).eq('org_id', session.orgId).select('id').single()
    : await supabase.from('suppliers').insert(row).select('id').single()

  if (error) {
    return { status: 'error', message: `Could not save: ${error.message}`, fieldErrors: {} }
  }

  // The score is versioned rather than overwritten, so a past sourcing
  // decision can be replayed against the score that informed it.
  await supabase.from('supplier_scores').insert({
    org_id: session.orgId,
    supplier_id: saved.id,
    total_score: score.total,
    components: score.components as never,
    weights_version: score.weightsVersion,
    rationale: score.strengths.concat(score.weaknesses).join(' '),
  })

  await recordAudit({
    orgId: session.orgId,
    action: existing ? 'SUPPLIER_UPDATED' : 'SUPPLIER_ADDED',
    entityType: 'supplier',
    entityId: saved.id,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
    previousValue: existing ?? null,
    newValue: row,
    reason: existing ? 'Supplier edited from the suppliers page' : 'Supplier created from the suppliers page',
  })

  if (existing && (existing.shopify_status !== shopify.status || existing.amazon_status !== amazon.status)) {
    await recordAudit({
      orgId: session.orgId,
      action: 'SUPPLIER_STATUS_CHANGED',
      entityType: 'supplier',
      entityId: saved.id,
      actorType: 'system',
      actorLabel: 'Supplier capability assessment',
      previousValue: { shopify: existing.shopify_status, amazon: existing.amazon_status },
      newValue: { shopify: shopify.status, amazon: amazon.status },
      reason: `Recomputed from capability flags. ${(amazon.status === 'approved' ? shopify.reasons : amazon.reasons).join(' ')}`,
    })
  }

  revalidatePath('/suppliers')
  revalidatePath(`/suppliers/${saved.id}`)

  return { status: 'saved', message: 'Supplier saved.', fieldErrors: {}, savedId: saved.id }
}
