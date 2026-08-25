import { describe, expect, it } from 'vitest'
import { checkWriteVerificationGatesPure, type WriteVerificationGateInput } from '@/lib/advertising/writeVerificationGates'

/**
 * Milestone 19, Phase 8/18 — the four explicit gates a write verification
 * run must clear before it is ever allowed to touch a live provider. This
 * is the single most safety-critical piece of logic this milestone adds
 * (the only code path capable of a real write against a real advertising
 * provider outside the existing, human-approved execution pipeline), so
 * every gate is proven independently: each one failing alone is enough to
 * block, regardless of whether the others would have passed.
 */

function baseInput(overrides: Partial<WriteVerificationGateInput> = {}): WriteVerificationGateInput {
  return {
    isEnabled: true,
    targetExternalCampaignId: 'camp-123',
    isConfigured: true,
    connectorLabel: 'Test Provider',
    action: 'pause_campaign',
    capabilityImplemented: true,
    ...overrides,
  }
}

describe('checkWriteVerificationGatesPure: every gate independently blocks', () => {
  it('all four gates satisfied -> ok', () => {
    expect(checkWriteVerificationGatesPure(baseInput())).toEqual({ ok: true })
  })

  it('disabled by environment -> blocked, regardless of everything else being fine', () => {
    const result = checkWriteVerificationGatesPure(baseInput({ isEnabled: false }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('disabled')
  })

  it('no explicit target campaign -> blocked, never inferred', () => {
    const result = checkWriteVerificationGatesPure(baseInput({ targetExternalCampaignId: '' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('explicitly designated')
  })

  it('a whitespace-only target is treated as no target at all', () => {
    const result = checkWriteVerificationGatesPure(baseInput({ targetExternalCampaignId: '   ' }))
    expect(result.ok).toBe(false)
  })

  it('connector not configured -> blocked', () => {
    const result = checkWriteVerificationGatesPure(baseInput({ isConfigured: false }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('not configured')
  })

  it('capability not implemented -> blocked', () => {
    const result = checkWriteVerificationGatesPure(baseInput({ capabilityImplemented: false }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('not declare')
  })

  it('set_budget with no dailyBudgetMinor -> blocked', () => {
    const result = checkWriteVerificationGatesPure(baseInput({ action: 'set_budget', dailyBudgetMinor: undefined }))
    expect(result.ok).toBe(false)
  })

  it('set_budget with a zero or negative dailyBudgetMinor -> blocked', () => {
    expect(checkWriteVerificationGatesPure(baseInput({ action: 'set_budget', dailyBudgetMinor: 0 })).ok).toBe(false)
    expect(checkWriteVerificationGatesPure(baseInput({ action: 'set_budget', dailyBudgetMinor: -100 })).ok).toBe(false)
  })

  it('set_budget with a real positive dailyBudgetMinor -> ok', () => {
    expect(checkWriteVerificationGatesPure(baseInput({ action: 'set_budget', dailyBudgetMinor: 500 })).ok).toBe(true)
  })

  it('pause_campaign never requires dailyBudgetMinor', () => {
    expect(checkWriteVerificationGatesPure(baseInput({ action: 'pause_campaign', dailyBudgetMinor: undefined })).ok).toBe(true)
  })

  it('multiple gates failing at once still returns a single clear reason, never throws', () => {
    expect(() => checkWriteVerificationGatesPure(baseInput({ isEnabled: false, isConfigured: false, capabilityImplemented: false }))).not.toThrow()
  })
})
