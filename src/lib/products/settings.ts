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
})
  .refine((data) => !data.vat_number || data.vat_registered, {
    message: 'A VAT number cannot be recorded unless the business is VAT registered',
    path: ['vat_number'],
  })
  .refine((data) => data.min_net_margin_pct <= data.min_gross_margin_pct, {
    message: 'Minimum net margin cannot exceed minimum gross margin',
    path: ['min_net_margin_pct'],
  })

export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>
