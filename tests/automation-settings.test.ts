import { describe, expect, it } from 'vitest'
import { isCategoryPaused, DEMO_AUTOMATION_SETTINGS, type AutomationSettings } from '@/lib/automation/settingsTypes'

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
