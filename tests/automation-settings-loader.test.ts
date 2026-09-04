import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Milestone: business-settings configuration layer. `settings.ts` is the
 * ONE authoritative place `business_settings` is ever read (confirmed by
 * audit — no competing settings source exists) — these tests cover the
 * three things that actually matter here: real rows map correctly
 * (including the new `businessSettingsConfigured`/`vatRegistered`/
 * `vatRatePct` fields), a missing row falls back to
 * `DEMO_AUTOMATION_SETTINGS` (never a silently-assembled partial), and the
 * read is genuinely scoped to the requested org. `server-only`, so
 * exercised through a minimal Supabase stub — same technique
 * `tests/product-facts-backfill.test.ts` already uses.
 */

vi.mock('server-only', () => ({}))

const createServiceSupabaseMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: () => createServiceSupabaseMock(),
  createServerSupabase: () => Promise.resolve(createServiceSupabaseMock()),
}))

function buildSelectStub(row: unknown) {
  const calls: { org_id?: string }[] = []
  const chain: Record<string, unknown> = {}
  chain.eq = (column: string, value: string) => {
    if (column === 'org_id') calls.push({ org_id: value })
    return chain
  }
  chain.maybeSingle = () => Promise.resolve({ data: row, error: null })
  const stub = { from: () => ({ select: () => chain }) }
  return { stub, calls }
}

describe('getAutomationSettingsForOrg', () => {
  beforeEach(() => {
    createServiceSupabaseMock.mockReset()
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('a real business_settings row maps businessSettingsConfigured: true and the real VAT fields', async () => {
    const { stub } = buildSelectStub({
      automation_level: 'assisted',
      automation_paused: false,
      automation_paused_at: null,
      automation_paused_reason: null,
      automation_paused_categories: [],
      max_auto_purchase_minor: 20000,
      max_auto_price_change_pct: '5.00',
      max_price_movement_per_day_pct: '10.00',
      max_auto_refund_minor: 5000,
      max_daily_auto_refund_minor: 20000,
      max_refunds_per_order: 3,
      max_daily_auto_supplier_spend_minor: 100000,
      max_auto_supplier_switch_cost_increase_pct: '10.00',
      min_net_margin_pct: '12.00',
      max_daily_ad_spend_minor: 5000,
      min_roas: '3.00',
      max_auto_ad_increase_pct: '20.00',
      min_gross_margin_pct: '28.00',
      min_opportunity_score: 65,
      min_quality_score: 55,
      max_risk_score: 65,
      target_net_margin_pct: '32.00',
      advertising_allowance_pct: '18.00',
      available_operating_capital_minor: 500000,
      cash_buffer_minor: 50000,
      max_supplier_cost_minor: null,
      max_candidates_per_discovery_run: 20,
      max_products_pending_review: 50,
      min_product_images: 1,
      min_image_width_px: 800,
      min_image_height_px: 800,
      max_image_file_size_bytes: 5242880,
      allowed_image_formats: ['jpeg', 'png', 'webp'],
      max_delivery_days: 7,
      vat_registered: true,
      vat_rate_pct: '20.00',
      packaging_cost_minor: 45,
      return_rate_pct: '5.00',
      return_loss_pct: '70.00',
      refund_rate_pct: '1.00',
      chargeback_rate_pct: '0.50',
      chargeback_fee_minor: 1500,
      import_duty_pct: '0.00',
    })
    createServiceSupabaseMock.mockReturnValue(stub)

    const { getAutomationSettingsForOrg } = await import('@/lib/automation/settings')
    const settings = await getAutomationSettingsForOrg('org-real')

    expect(settings.businessSettingsConfigured).toBe(true)
    expect(settings.vatRegistered).toBe(true)
    expect(settings.vatRatePct).toBe(20)
    expect(settings.minNetMarginPct).toBe(12)
    expect(settings.targetNetMarginPct).toBe(32)
    expect(settings.packagingCostMinor).toBe(45)
    expect(settings.returnRatePct).toBe(5)
    expect(settings.returnLossPct).toBe(70)
    expect(settings.refundRatePct).toBe(1)
    expect(settings.chargebackRatePct).toBe(0.5)
    expect(settings.chargebackFeeMinor).toBe(1500)
    expect(settings.importDutyPct).toBe(0)
  })

  it('no row at all falls back to DEMO_AUTOMATION_SETTINGS, never a partially-assembled object', async () => {
    const { stub } = buildSelectStub(null)
    createServiceSupabaseMock.mockReturnValue(stub)

    const { getAutomationSettingsForOrg } = await import('@/lib/automation/settings')
    const { DEMO_AUTOMATION_SETTINGS } = await import('@/lib/automation/settingsTypes')
    const settings = await getAutomationSettingsForOrg('org-unconfigured')

    expect(settings).toEqual(DEMO_AUTOMATION_SETTINGS)
    expect(settings.businessSettingsConfigured).toBe(false)
  })

  it('the read is scoped to the exact org requested, never a different or global row', async () => {
    const { stub, calls } = buildSelectStub(null)
    createServiceSupabaseMock.mockReturnValue(stub)

    const { getAutomationSettingsForOrg } = await import('@/lib/automation/settings')
    await getAutomationSettingsForOrg('org-specific-id')

    expect(calls).toContainEqual({ org_id: 'org-specific-id' })
  })

  it('a VAT-registered row with a null rate still maps honestly (vatRatePct null), leaving resolveBusinessConfiguration to treat it as unconfigured', async () => {
    const { stub } = buildSelectStub({
      automation_level: 'assisted',
      automation_paused: false,
      automation_paused_at: null,
      automation_paused_reason: null,
      automation_paused_categories: [],
      max_auto_purchase_minor: 20000,
      max_auto_price_change_pct: '5.00',
      max_price_movement_per_day_pct: '10.00',
      max_auto_refund_minor: 5000,
      max_daily_auto_refund_minor: 20000,
      max_refunds_per_order: 3,
      max_daily_auto_supplier_spend_minor: 100000,
      max_auto_supplier_switch_cost_increase_pct: '10.00',
      min_net_margin_pct: '10.00',
      max_daily_ad_spend_minor: 5000,
      min_roas: '3.00',
      max_auto_ad_increase_pct: '20.00',
      min_gross_margin_pct: '25.00',
      min_opportunity_score: 70,
      min_quality_score: 60,
      max_risk_score: 70,
      target_net_margin_pct: '35.00',
      advertising_allowance_pct: '15.00',
      available_operating_capital_minor: null,
      cash_buffer_minor: null,
      max_supplier_cost_minor: null,
      max_candidates_per_discovery_run: 20,
      max_products_pending_review: 50,
      min_product_images: 1,
      min_image_width_px: 800,
      min_image_height_px: 800,
      max_image_file_size_bytes: 5242880,
      allowed_image_formats: ['jpeg', 'png', 'webp'],
      max_delivery_days: 7,
      vat_registered: true,
      vat_rate_pct: null,
    })
    createServiceSupabaseMock.mockReturnValue(stub)

    const { getAutomationSettingsForOrg } = await import('@/lib/automation/settings')
    const { resolveBusinessConfiguration } = await import('@/lib/automation/settingsTypes')
    const settings = await getAutomationSettingsForOrg('org-incomplete-vat')

    expect(settings.businessSettingsConfigured).toBe(true) // the row itself is real
    expect(settings.vatRatePct).toBeNull() // but the rate genuinely wasn't set
    expect(resolveBusinessConfiguration(settings).configured).toBe(false) // so the combined status is honestly incomplete
  })
})
