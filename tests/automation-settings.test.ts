import { describe, expect, it } from 'vitest'
import { isCategoryPaused, resolveBusinessConfiguration, DEMO_AUTOMATION_SETTINGS, type AutomationSettings } from '@/lib/automation/settingsTypes'

describe('isCategoryPaused', () => {
  it('is false when nothing is paused', () => {
    expect(isCategoryPaused(DEMO_AUTOMATION_SETTINGS, 'pricing')).toBe(false)
  })

  it('a global pause blocks every category, including null (no category)', () => {
    const settings: AutomationSettings = { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true }
    expect(isCategoryPaused(settings, 'pricing')).toBe(true)
    expect(isCategoryPaused(settings, null)).toBe(true)
  })

  it('a category pause only blocks that category', () => {
    const settings: AutomationSettings = { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['refunds'] }
    expect(isCategoryPaused(settings, 'refunds')).toBe(true)
    expect(isCategoryPaused(settings, 'pricing')).toBe(false)
  })

  it('null category (an action with no pausable category) is never blocked by a category pause', () => {
    const settings: AutomationSettings = { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['refunds', 'pricing'] }
    expect(isCategoryPaused(settings, null)).toBe(false)
  })
})

/**
 * Milestone: business-settings configuration layer. `resolveBusinessConfiguration`
 * is the one place that decides whether `assemble.ts`'s recommendation may
 * treat margin/quality/opportunity/risk/VAT thresholds as a real business
 * decision — every case a real organisation can actually be in.
 */
// Milestone: economic-model cost completeness (0047). Every field
// `resolveBusinessConfiguration` treats as *required* for a trustworthy
// recommendation, set to real (if arbitrary-for-the-test) values — the
// baseline a genuinely fully-configured organisation looks like. Tests
// below null out one field at a time to prove each one independently
// gates `configured`.
const FULLY_CONFIGURED: AutomationSettings = {
  ...DEMO_AUTOMATION_SETTINGS,
  businessSettingsConfigured: true,
  vatRegistered: false,
  vatRatePct: null,
  returnRatePct: 5,
  returnLossPct: 70,
  refundRatePct: 1,
  chargebackRatePct: 0.5,
  chargebackFeeMinor: 1500,
  importDutyPct: 0,
}

describe('resolveBusinessConfiguration', () => {
  it('DEMO_AUTOMATION_SETTINGS (no business_settings row, or a demo session) is never configured', () => {
    const result = resolveBusinessConfiguration(DEMO_AUTOMATION_SETTINGS)
    expect(result.configured).toBe(false)
  })

  it('a real business_settings row with every required field set, not VAT registered, is fully configured, and VAT is genuinely 0% (a confirmed fact, not a guess)', () => {
    const result = resolveBusinessConfiguration(FULLY_CONFIGURED)
    expect(result.configured).toBe(true)
    expect(result.missingRequired).toEqual([])
    expect(result.effectiveVatRatePct).toBe(0)
  })

  it('a real business_settings row that is VAT registered with a real rate set is fully configured, and that rate is used', () => {
    const settings: AutomationSettings = { ...FULLY_CONFIGURED, vatRegistered: true, vatRatePct: 20 }
    const result = resolveBusinessConfiguration(settings)
    expect(result.configured).toBe(true)
    expect(result.effectiveVatRatePct).toBe(20)
  })

  it('VAT missing is never treated as VAT zero: a real row that is VAT registered but has no rate set is NOT configured, even though every other field is real', () => {
    const settings: AutomationSettings = { ...FULLY_CONFIGURED, vatRegistered: true, vatRatePct: null }
    const result = resolveBusinessConfiguration(settings)
    expect(result.configured).toBe(false)
    expect(result.missingRequired.some((m) => m.toLowerCase().includes('vat'))).toBe(true)
    // The calculation engines still get a real number to compute an
    // informative figure with — 0 here is a placeholder for "not yet
    // known", never presented as a confirmed 0% because `configured` is false.
    expect(result.effectiveVatRatePct).toBe(0)
  })

  it('no business_settings row at all overrides everything else, even if the placeholder VAT fields happen to look complete', () => {
    const settings: AutomationSettings = { ...DEMO_AUTOMATION_SETTINGS, businessSettingsConfigured: false, vatRegistered: false, vatRatePct: null }
    expect(resolveBusinessConfiguration(settings).configured).toBe(false)
  })

  it('a missing return rate alone blocks configured, even though every other required field is real', () => {
    const settings: AutomationSettings = { ...FULLY_CONFIGURED, returnRatePct: null }
    const result = resolveBusinessConfiguration(settings)
    expect(result.configured).toBe(false)
    expect(result.missingRequired.some((m) => m.toLowerCase().includes('return rate'))).toBe(true)
    expect(result.effectiveReturnRatePct).toBe(0) // still a real number for the engine to compute with, never presented as final
  })

  it('an explicitly configured return rate of 0% is genuinely configured — a real business decision, not "missing"', () => {
    const settings: AutomationSettings = { ...FULLY_CONFIGURED, returnRatePct: 0 }
    const result = resolveBusinessConfiguration(settings)
    expect(result.configured).toBe(true)
    expect(result.effectiveReturnRatePct).toBe(0)
  })

  it('a missing chargeback rate or fee alone blocks configured', () => {
    expect(resolveBusinessConfiguration({ ...FULLY_CONFIGURED, chargebackRatePct: null }).configured).toBe(false)
    expect(resolveBusinessConfiguration({ ...FULLY_CONFIGURED, chargebackFeeMinor: null }).configured).toBe(false)
  })

  it('a missing import duty assumption alone blocks configured', () => {
    const result = resolveBusinessConfiguration({ ...FULLY_CONFIGURED, importDutyPct: null })
    expect(result.configured).toBe(false)
    expect(result.missingRequired.some((m) => m.toLowerCase().includes('duty'))).toBe(true)
  })

  it('an explicitly configured import duty of 0% (duty does not apply) is genuinely configured', () => {
    const result = resolveBusinessConfiguration({ ...FULLY_CONFIGURED, importDutyPct: 0 })
    expect(result.configured).toBe(true)
    expect(result.effectiveImportDutyPct).toBe(0)
  })

  it('packaging is the one OPTIONAL cost: leaving it null never blocks configured, but packagingConfigured stays false and the effective figure is still a placeholder 0', () => {
    const settings: AutomationSettings = { ...FULLY_CONFIGURED, packagingCostMinor: null }
    const result = resolveBusinessConfiguration(settings)
    expect(result.configured).toBe(true)
    expect(result.packagingConfigured).toBe(false)
    expect(result.effectivePackagingCostMinor).toBe(0)
  })

  it('an explicitly configured packaging cost of £0 (free packaging) is genuinely configured — distinct from leaving it unset', () => {
    const settings: AutomationSettings = { ...FULLY_CONFIGURED, packagingCostMinor: 0 }
    const result = resolveBusinessConfiguration(settings)
    expect(result.packagingConfigured).toBe(true)
    expect(result.effectivePackagingCostMinor).toBe(0)
  })

  it('a configured non-zero packaging cost is used as-is', () => {
    const settings: AutomationSettings = { ...FULLY_CONFIGURED, packagingCostMinor: 45 }
    const result = resolveBusinessConfiguration(settings)
    expect(result.packagingConfigured).toBe(true)
    expect(result.effectivePackagingCostMinor).toBe(45)
  })
})
