import { describe, expect, it } from 'vitest'
import { evaluateAutomationPolicy } from '@/lib/automation/policyEngine'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { AutomationSettings } from '@/lib/automation/settingsTypes'

const PASS_REQUIREMENT = { key: 'domain', label: 'Domain check', satisfied: true, detail: 'ok' }

describe('the central automation policy engine', () => {
  it('allows automatically when the domain permits it and nothing else blocks', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'switch_supplier',
      settings: DEMO_AUTOMATION_SETTINGS,
      domainOutcome: 'auto_permitted',
      domainReason: 'Everything passed.',
      domainRequirements: [PASS_REQUIREMENT],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('allow_automatic')
  })

  it('defers to a domain-blocked verdict without ever allowing execution', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'publish_product',
      settings: DEMO_AUTOMATION_SETTINGS,
      domainOutcome: 'blocked',
      domainReason: 'Compliance failed.',
      domainRequirements: [{ key: 'compliance', label: 'Compliance', satisfied: false, detail: 'Blocked category.' }],
      riskLevel: 'high',
    })
    expect(result.outcome).toBe('block')
  })

  it('defers to a domain pending_approval verdict as require_approval', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'update_price',
      settings: DEMO_AUTOMATION_SETTINGS,
      domainOutcome: 'pending_approval',
      domainReason: 'Automation level requires approval.',
      domainRequirements: [PASS_REQUIREMENT],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('require_approval')
  })

  it('the kill switch blocks an otherwise fully-permitted action', () => {
    const paused: AutomationSettings = { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true }
    const result = evaluateAutomationPolicy({
      actionType: 'switch_supplier',
      settings: paused,
      domainOutcome: 'auto_permitted',
      domainReason: 'Everything passed.',
      domainRequirements: [PASS_REQUIREMENT],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('block')
    expect(result.requirements.find((r) => r.key === 'automation_not_paused')?.satisfied).toBe(false)
  })

  it('a category-level pause blocks only actions in that category', () => {
    const categoryPaused: AutomationSettings = { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['pricing'] }

    const pricingResult = evaluateAutomationPolicy({
      actionType: 'update_price',
      settings: categoryPaused,
      domainOutcome: 'auto_permitted',
      domainReason: 'ok',
      domainRequirements: [PASS_REQUIREMENT],
      riskLevel: 'low',
    })
    expect(pricingResult.outcome).toBe('block')

    const refundResult = evaluateAutomationPolicy({
      actionType: 'process_refund',
      settings: categoryPaused,
      domainOutcome: 'auto_permitted',
      domainReason: 'ok',
      domainRequirements: [PASS_REQUIREMENT],
      riskLevel: 'low',
    })
    expect(refundResult.outcome).toBe('allow_automatic')
  })

  it('an action type with no category (e.g. reconciliation) is never affected by a category pause', () => {
    const categoryPaused: AutomationSettings = { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['pricing', 'refunds', 'fulfilment', 'publishing', 'supplier_switching', 'supplier_ordering'] }
    const result = evaluateAutomationPolicy({
      actionType: 'reconcile_marketplace',
      settings: categoryPaused,
      domainOutcome: 'auto_permitted',
      domainReason: 'ok',
      domainRequirements: [PASS_REQUIREMENT],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('allow_automatic')
  })

  it('exceeding a financial limit requires approval, never a silent block or a silent pass', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'process_refund',
      settings: DEMO_AUTOMATION_SETTINGS,
      domainOutcome: 'auto_permitted',
      domainReason: 'ok',
      domainRequirements: [PASS_REQUIREMENT],
      financialChecks: [{ label: 'Maximum daily automatic refund total', amountMinor: 999999, limitMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAutoRefundMinor }],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('require_approval')
  })

  it('a financial limit within bounds does not block', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'process_refund',
      settings: DEMO_AUTOMATION_SETTINGS,
      domainOutcome: 'auto_permitted',
      domainReason: 'ok',
      domainRequirements: [PASS_REQUIREMENT],
      financialChecks: [{ label: 'Maximum daily automatic refund total', amountMinor: 100, limitMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAutoRefundMinor }],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('allow_automatic')
  })

  it('exceeding a percentage limit requires approval', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'update_price',
      settings: DEMO_AUTOMATION_SETTINGS,
      domainOutcome: 'auto_permitted',
      domainReason: 'ok',
      domainRequirements: [PASS_REQUIREMENT],
      percentageChecks: [{ label: 'Maximum price change per action', actualPct: 25, limitPct: DEMO_AUTOMATION_SETTINGS.maxAutoPriceChangePct }],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('require_approval')
  })

  it('never widens a domain-blocked outcome even when every financial check passes', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'process_refund',
      settings: DEMO_AUTOMATION_SETTINGS,
      domainOutcome: 'blocked',
      domainReason: 'Refund exceeds remaining order balance.',
      domainRequirements: [{ key: 'balance', label: 'Refund within balance', satisfied: false, detail: 'Exceeds balance.' }],
      financialChecks: [{ label: 'Maximum daily automatic refund total', amountMinor: 1, limitMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAutoRefundMinor }],
      riskLevel: 'low',
    })
    expect(result.outcome).toBe('block')
  })
})
