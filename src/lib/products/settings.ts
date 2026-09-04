import 'server-only'

import { z } from 'zod'

/**
 * Business settings validation.
 *
 * Lives beside the settings action rather than in the page so the same schema
 * can be reused by the API and by tests. Every limit here is a control on what
 * automation is allowed to do without asking, so the bounds are deliberately
 * conservative and none of them are optional.
 */

/**
 * A required percentage/count field that genuinely rejects a blank
 * submission — found auditing the economic-model cost-completeness
 * milestone: plain `z.coerce.number()` silently turns both `''` and
 * `null` into `0` (JavaScript's own `Number('')`/`Number(null) === 0`),
 * so a required field with no HTML `required` attribute enforcing
 * non-empty submission could previously be left blank and would still
 * validate as an explicit, confirmed "0" — exactly the "unknown became
 * zero" failure mode this milestone exists to close. Preprocessing blank
 * input to `undefined` first makes `Number(undefined) === NaN`, which
 * zod's own number validation genuinely rejects, forcing a real value.
 * Applied to the new returns/refunds/chargebacks/duty fields below, which
 * must never repeat this gap even though several older fields on this
 * schema still have it (see HANDOVER.md for that pre-existing, separately
 * tracked issue).
 */
function requiredPercent(max = 100) {
  return z.preprocess((val) => (val === '' || val === null || val === undefined ? undefined : val), z.coerce.number().min(0).max(max))
}
export const businessSettingsSchema = z.object({
  legal_name: z.string().trim().min(1, 'Legal name is required for invoices').max(200),
  trading_name: z.string().trim().max(200).optional().or(z.literal('')),
  address_line1: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  postcode: z.string().trim().max(20).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email address').or(z.literal('')),
  company_number: z.string().trim().max(20).optional().or(z.literal('')),

  vat_registered: z.boolean(),
  vat_number: z.string().trim().max(20).optional().or(z.literal('')),
  // Nullable, not defaulted — see migration 0045. Left blank means
  // genuinely not configured, never coerced to 0% or a guessed UK
  // standard rate; the .refine below requires a real value only once the
  // business has actually said it is VAT registered.
  vat_rate_pct: z.coerce.number().min(0).max(100).nullable(),

  automation_level: z.enum(['manual', 'assisted', 'supervised', 'autonomous']),
  min_gross_margin_pct: z.coerce.number().min(0).max(95),
  min_net_margin_pct: z.coerce.number().min(0).max(95),
  min_opportunity_score: z.coerce.number().int().min(0).max(100),
  max_auto_purchase_minor: z.coerce.number().int().min(0),
  max_auto_price_change_pct: z.coerce.number().min(0).max(50),
  max_daily_ad_spend_minor: z.coerce.number().int().min(0),
  min_roas: z.coerce.number().min(0).max(50),
  max_auto_ad_increase_pct: z.coerce.number().min(0).max(200),
  max_delivery_days: z.coerce.number().int().min(1).max(60),
  max_return_rate_pct: z.coerce.number().min(0).max(100),

  // Product intelligence (Phase 4) — see migration 0037 for why the three
  // capital fields are nullable rather than defaulted.
  min_quality_score: z.coerce.number().int().min(0).max(100),
  max_risk_score: z.coerce.number().int().min(0).max(100),
  target_net_margin_pct: z.coerce.number().min(0).max(95),
  advertising_allowance_pct: z.coerce.number().min(0).max(100),
  available_operating_capital_minor: z.coerce.number().int().min(0).nullable(),
  cash_buffer_minor: z.coerce.number().int().min(0).nullable(),
  max_supplier_cost_minor: z.coerce.number().int().min(0).nullable(),

  // Economic-model cost completeness (0047). Packaging is the one
  // OPTIONAL field of the group — dropshipping's normal case is that the
  // supplier packages the item directly, so leaving it blank is a
  // legitimate, common choice, never treated as £0 in the meantime (see
  // `resolveBusinessConfiguration`). Returns/refunds/chargebacks/duty are
  // real, material assumptions a business cannot honestly omit, so — like
  // every margin/threshold above — none of them are optional; 0 remains a
  // perfectly legitimate explicit answer ("duty does not apply to this
  // business").
  packaging_cost_minor: z.coerce.number().int().min(0).nullable(),
  return_rate_pct: requiredPercent(),
  return_loss_pct: requiredPercent(),
  refund_rate_pct: requiredPercent(),
  chargeback_rate_pct: requiredPercent(),
  chargeback_fee_minor: z.preprocess((val) => (val === '' || val === null || val === undefined ? undefined : val), z.coerce.number().int().min(0)),
  import_duty_pct: requiredPercent(),

  // Supplier discovery (Phase 5) — bounds a single discovery pass and how
  // many candidates may sit awaiting review at once. Quality over
  // catalogue size, per the brief.
  max_candidates_per_discovery_run: z.coerce.number().int().min(1).max(500),
  max_products_pending_review: z.coerce.number().int().min(1).max(2000),

  // Controlled Shopify publication (Phase 6).
  min_product_images: z.coerce.number().int().min(0).max(20),

  // Product media intelligence (Phase 7).
  min_image_width_px: z.coerce.number().int().min(1).max(20000),
  min_image_height_px: z.coerce.number().int().min(1).max(20000),
  max_image_file_size_bytes: z.coerce.number().int().min(1),
  allowed_image_formats: z.array(z.enum(['jpeg', 'png', 'webp', 'avif'])).min(1, 'At least one image format must be allowed'),
})
  .refine((data) => !data.vat_number || data.vat_registered, {
    message: 'A VAT number cannot be recorded unless the business is VAT registered',
    path: ['vat_number'],
  })
  .refine((data) => !data.vat_registered || data.vat_rate_pct !== null, {
    message: 'A VAT rate is required once the business is VAT registered — leave both blank if not registered',
    path: ['vat_rate_pct'],
  })
  .refine((data) => data.vat_registered || data.vat_rate_pct === null, {
    message: 'A VAT rate cannot be recorded unless the business is VAT registered',
    path: ['vat_rate_pct'],
  })
  .refine((data) => data.min_net_margin_pct <= data.min_gross_margin_pct, {
    message: 'Minimum net margin cannot exceed minimum gross margin',
    path: ['min_net_margin_pct'],
  })
  .refine((data) => data.target_net_margin_pct >= data.min_net_margin_pct, {
    message: 'Target net margin cannot be below the minimum net margin',
    path: ['target_net_margin_pct'],
  })
  .refine(
    (data) =>
      data.cash_buffer_minor === null ||
      data.available_operating_capital_minor === null ||
      data.cash_buffer_minor <= data.available_operating_capital_minor,
    {
      message: 'The cash buffer cannot exceed total available operating capital',
      path: ['cash_buffer_minor'],
    },
  )

export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>
