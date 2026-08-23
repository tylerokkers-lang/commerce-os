import { z } from 'zod'

/**
 * Supplier input validation.
 *
 * The capability flags are the important part. They are what the Amazon
 * assessment reads, so they are booleans with no "unknown" state on the form:
 * the owner is being asked to state what the supplier has actually committed
 * to, and an unticked box means "has not committed", which is the safe reading.
 */

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

export const supplierSchema = z
  .object({
    name: z.string().trim().min(2, 'Supplier name is required').max(200),
    company_name: optionalText(200),
    website: z.string().trim().url('Enter a valid URL').max(300).optional().or(z.literal('')),
    contact_email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
    contact_phone: optionalText(40),
    country: z
      .string()
      .trim()
      .length(2, 'Use a two-letter country code, such as GB')
      .toUpperCase()
      .optional()
      .or(z.literal('')),
    platform: optionalText(60),
    notes: optionalText(2000),

    typical_delivery_days_min: z.coerce.number().int().min(0).max(120),
    typical_delivery_days_max: z.coerce.number().int().min(0).max(120),

    // Capability flags that drive channel eligibility.
    supports_blind_shipping: z.boolean(),
    supports_custom_packaging: z.boolean(),
    supports_custom_invoice: z.boolean(),
    supports_own_branding: z.boolean(),
    provides_tracking: z.boolean(),
    handles_returns: z.boolean(),
    accepts_faulty_returns: z.boolean(),

    returns_policy: optionalText(1000),
    returns_window_days: z.coerce.number().int().min(0).max(365),
    min_order_value_minor: z.coerce.number().int().min(0),

    // Observed history. Kept separate from claims, and validated against
    // each other so the counts cannot contradict themselves.
    orders_placed: z.coerce.number().int().min(0),
    orders_late: z.coerce.number().int().min(0),
    orders_defective: z.coerce.number().int().min(0),
    quality_rating: z.coerce.number().min(1).max(5).optional(),
    communication_rating: z.coerce.number().min(1).max(5).optional(),
  })
  .refine((d) => d.typical_delivery_days_max >= d.typical_delivery_days_min, {
    message: 'Maximum delivery time cannot be shorter than the minimum',
    path: ['typical_delivery_days_max'],
  })
  .refine((d) => d.orders_late <= d.orders_placed, {
    message: 'Late orders cannot exceed orders placed',
    path: ['orders_late'],
  })
  .refine((d) => d.orders_defective <= d.orders_placed, {
    message: 'Defective orders cannot exceed orders placed',
    path: ['orders_defective'],
  })

export type SupplierInput = z.infer<typeof supplierSchema>
