import { describe, expect, it, vi } from 'vitest'
import { businessSettingsSchema } from '@/lib/products/settings'

vi.mock('server-only', () => ({}))

/**
 * Milestone: business-settings configuration layer. The zod schema behind
 * the real settings form (`app/(dashboard)/settings`) is the one place
 * "invalid" is actually enforced before a value ever reaches
 * `business_settings` — these tests are the CONFIGURED / INVALID half of
 * the audit's three-state vocabulary (UNCONFIGURED is a fact about whether
 * a row exists at all, covered by `resolveBusinessConfiguration`).
 */

const VALID = {
  legal_name: 'Informax Ltd',
  trading_name: '',
  address_line1: '',
  city: '',
  postcode: '',
  email: 'owner@informax.example',
  company_number: '',
  vat_registered: false,
  vat_number: '',
  vat_rate_pct: null,
  automation_level: 'assisted' as const,
  min_gross_margin_pct: 25,
  min_net_margin_pct: 10,
  min_opportunity_score: 70,
  max_auto_purchase_minor: 20000,
  max_auto_price_change_pct: 5,
  max_daily_ad_spend_minor: 5000,
  min_roas: 3,
  max_auto_ad_increase_pct: 20,
  max_delivery_days: 7,
  max_return_rate_pct: 5,
  min_quality_score: 60,
  max_risk_score: 70,
  target_net_margin_pct: 35,
  advertising_allowance_pct: 15,
  available_operating_capital_minor: null,
  cash_buffer_minor: null,
  max_supplier_cost_minor: null,
  max_candidates_per_discovery_run: 20,
  max_products_pending_review: 50,
  min_product_images: 1,
  min_image_width_px: 800,
  min_image_height_px: 800,
  max_image_file_size_bytes: 5242880,
  allowed_image_formats: ['jpeg', 'png', 'webp'] as const,
  // Economic-model cost completeness (0047). Packaging is the one
  // optional field of the group; the rest are required, matching margins.
  packaging_cost_minor: null,
  return_rate_pct: 5,
  return_loss_pct: 70,
  refund_rate_pct: 1,
  chargeback_rate_pct: 0.5,
  chargeback_fee_minor: 1500,
  import_duty_pct: 0,
}

describe('businessSettingsSchema', () => {
  it('a fully-specified, self-consistent submission is valid', () => {
    const result = businessSettingsSchema.safeParse(VALID)
    expect(result.success).toBe(true)
  })

  it('VAT registered with no rate given is INVALID — a rate is required once registered', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, vat_registered: true, vat_rate_pct: null })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('vat_rate_pct'))).toBe(true)
    }
  })

  it('VAT registered with a real rate is valid', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, vat_registered: true, vat_rate_pct: 20 })
    expect(result.success).toBe(true)
  })

  it('a VAT rate given while not registered is INVALID — never silently accepted', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, vat_registered: false, vat_rate_pct: 20 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('vat_rate_pct'))).toBe(true)
    }
  })

  it('a VAT rate outside 0-100 is INVALID', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, vat_registered: true, vat_rate_pct: 150 })
    expect(result.success).toBe(false)
  })

  it('target net margin below the minimum net margin is INVALID', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, target_net_margin_pct: 5, min_net_margin_pct: 10 })
    expect(result.success).toBe(false)
  })

  it('a negative margin is INVALID, never silently clamped to zero', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, min_net_margin_pct: -5 })
    expect(result.success).toBe(false)
  })

  it('a cash buffer exceeding available operating capital is INVALID', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, available_operating_capital_minor: 10000, cash_buffer_minor: 20000 })
    expect(result.success).toBe(false)
  })

  it('capital fields left null (genuinely unset) are valid — never coerced to zero', () => {
    const result = businessSettingsSchema.safeParse({ ...VALID, available_operating_capital_minor: null, cash_buffer_minor: null, max_supplier_cost_minor: null })
    expect(result.success).toBe(true)
  })

  // Milestone: economic-model cost completeness (0047).
  describe('packaging (the one OPTIONAL cost)', () => {
    it('left null (genuinely unset) is valid — never coerced to zero', () => {
      expect(businessSettingsSchema.safeParse({ ...VALID, packaging_cost_minor: null }).success).toBe(true)
    })
    it('an explicit £0 (free packaging) is valid', () => {
      expect(businessSettingsSchema.safeParse({ ...VALID, packaging_cost_minor: 0 }).success).toBe(true)
    })
    it('a real positive packaging cost is valid', () => {
      expect(businessSettingsSchema.safeParse({ ...VALID, packaging_cost_minor: 45 }).success).toBe(true)
    })
    it('a negative packaging cost is INVALID', () => {
      expect(businessSettingsSchema.safeParse({ ...VALID, packaging_cost_minor: -1 }).success).toBe(false)
    })
  })

  describe('returns/refunds/chargebacks/import duty (required — a blank submission must not silently become an accepted zero)', () => {
    it('a genuinely blank return rate (empty string, as an untouched form field would submit) is INVALID, not accepted as 0', () => {
      const result = businessSettingsSchema.safeParse({ ...VALID, return_rate_pct: '' })
      expect(result.success).toBe(false)
    })
    it('a genuinely blank chargeback fee (empty string) is INVALID, not accepted as 0', () => {
      const result = businessSettingsSchema.safeParse({ ...VALID, chargeback_fee_minor: '' })
      expect(result.success).toBe(false)
    })
    it('null for any of the six required fields is INVALID — unlike packaging/capital, these have no legitimate "leave blank" state', () => {
      for (const field of ['return_rate_pct', 'return_loss_pct', 'refund_rate_pct', 'chargeback_rate_pct', 'chargeback_fee_minor', 'import_duty_pct']) {
        const result = businessSettingsSchema.safeParse({ ...VALID, [field]: null })
        expect(result.success, `${field} should reject null`).toBe(false)
      }
    })
    it('an explicit 0 for each of the six is valid — a real, confirmed business decision, not "missing"', () => {
      const result = businessSettingsSchema.safeParse({
        ...VALID,
        return_rate_pct: 0,
        return_loss_pct: 0,
        refund_rate_pct: 0,
        chargeback_rate_pct: 0,
        chargeback_fee_minor: 0,
        import_duty_pct: 0,
      })
      expect(result.success).toBe(true)
    })
    it('a real, non-zero value for each of the six is valid', () => {
      const result = businessSettingsSchema.safeParse({
        ...VALID,
        return_rate_pct: 8,
        return_loss_pct: 80,
        refund_rate_pct: 2,
        chargeback_rate_pct: 0.8,
        chargeback_fee_minor: 2000,
        import_duty_pct: 12,
      })
      expect(result.success).toBe(true)
    })
    it('a percentage above 100 is INVALID for any of the four rate fields', () => {
      for (const field of ['return_rate_pct', 'return_loss_pct', 'refund_rate_pct', 'chargeback_rate_pct', 'import_duty_pct']) {
        expect(businessSettingsSchema.safeParse({ ...VALID, [field]: 150 }).success, `${field} should reject 150`).toBe(false)
      }
    })
  })
})
