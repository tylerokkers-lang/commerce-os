import { describe, expect, it } from 'vitest'
import { assessStockLevel, decideStockShortfallAction, decideResumeAfterRestock } from '@/lib/automation/inventoryAutomation'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'

describe('stock level assessment', () => {
  it('classifies zero or negative available units as out of stock', () => {
    expect(assessStockLevel(0, 10)).toBe('out_of_stock')
    expect(assessStockLevel(-2, 10)).toBe('out_of_stock')
  })
  it('classifies at-or-under the threshold as low', () => {
    expect(assessStockLevel(10, 10)).toBe('low')
    expect(assessStockLevel(3, 10)).toBe('low')
  })
  it('classifies comfortably above the threshold as ok', () => {
    expect(assessStockLevel(50, 10)).toBe('ok')
  })
})

describe('stock shortfall decision', () => {
  it('only warns on low stock', () => {
    const result = decideStockShortfallAction({
      productTitle: 'Widget', alertLevel: 'low', hasCompliantAlternativeSupplier: false, automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS,
    })
    expect(result.action).toBe('warn')
  })

  it('recommends evaluating an alternative supplier when one exists, instead of pausing', () => {
    const result = decideStockShortfallAction({
      productTitle: 'Widget', alertLevel: 'out_of_stock', hasCompliantAlternativeSupplier: true, automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS,
    })
    expect(result.action).toBe('evaluate_alternative_supplier')
  })

  it('pauses automatically at supervised/autonomous when out of stock with no alternative', () => {
    const result = decideStockShortfallAction({
      productTitle: 'Widget', alertLevel: 'out_of_stock', hasCompliantAlternativeSupplier: false, automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS,
    })
    expect(result.action).toBe('pause_listing')
    if (result.action === 'pause_listing') expect(result.policy.outcome).toBe('allow_automatic')
  })

  it('requires approval to pause at manual/assisted', () => {
    const result = decideStockShortfallAction({
      productTitle: 'Widget', alertLevel: 'out_of_stock', hasCompliantAlternativeSupplier: false, automationLevel: 'assisted', settings: DEMO_AUTOMATION_SETTINGS,
    })
    expect(result.action).toBe('pause_listing')
    if (result.action === 'pause_listing') expect(result.policy.outcome).toBe('require_approval')
  })

  it('the kill switch blocks an automatic pause outright', () => {
    const paused = { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true }
    const result = decideStockShortfallAction({
      productTitle: 'Widget', alertLevel: 'out_of_stock', hasCompliantAlternativeSupplier: false, automationLevel: 'autonomous', settings: paused,
    })
    if (result.action === 'pause_listing') expect(result.policy.outcome).toBe('block')
  })
})

describe('resume after restock', () => {
  it('does nothing when the product was not paused for stock', () => {
    const result = decideResumeAfterRestock({ productTitle: 'Widget', wasPausedForStock: false, automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS })
    expect(result.action).toBe('none')
  })

  it('only resumes automatically at autonomous', () => {
    const supervised = decideResumeAfterRestock({ productTitle: 'Widget', wasPausedForStock: true, automationLevel: 'supervised', settings: DEMO_AUTOMATION_SETTINGS })
    expect(supervised.action).toBe('resume_listing')
    if (supervised.action === 'resume_listing') expect(supervised.policy.outcome).toBe('require_approval')

    const autonomous = decideResumeAfterRestock({ productTitle: 'Widget', wasPausedForStock: true, automationLevel: 'autonomous', settings: DEMO_AUTOMATION_SETTINGS })
    if (autonomous.action === 'resume_listing') expect(autonomous.policy.outcome).toBe('allow_automatic')
  })
})
