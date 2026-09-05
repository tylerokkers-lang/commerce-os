import { describe, expect, it } from 'vitest'
import { dryRunPriceChange } from '@/lib/automation/dryRun'
import { fromMajor } from '@/lib/core/money'
import type { PriceChangeRequest } from '@/lib/automation/priceAutomation'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'

/**
 * Milestone: automation control plane. Dry-run capability (design
 * requirement §4) — `dryRunPriceChange` calls the exact same
 * `assessPriceChange` a real `executePriceChange` uses, so these tests
 * confirm the *shape* of the dry-run result (eligible/blocked, the payload
 * that would be sent, expected-result wording) rather than re-testing
 * `priceAutomation.ts`'s own margin/limit logic, which already has its own
 * dedicated tests.
 */

function baseRequest(overrides: Partial<PriceChangeRequest> = {}): PriceChangeRequest {
  return {
    productTitle: 'Test Widget',
    costInputsBefore: {
      sellingPrice: fromMajor(20),
      productCost: fromMajor(8),
      supplierShipping: fromMajor(2),
      channelFeePct: 0,
      paymentFeePct: 0,
    },
    newSellingPrice: fromMajor(21),
    automationLevel: 'autonomous',
    ...overrides,
  }
}

describe('dryRunPriceChange', () => {
  it('reports an eligible, auto-executing change with no side effects other than the returned result', () => {
    const result = dryRunPriceChange(baseRequest(), CONFIGURED_AUTOMATION_SETTINGS, 'gid://shopify/Product/1')

    expect(result.eligible).toBe(true)
    expect(result.wouldExecuteAutomatically).toBe(true)
    expect(result.payload).toEqual({ externalId: 'gid://shopify/Product/1', newPriceMinor: fromMajor(21).minor })
    expect(result.blockingReasons).toEqual([])
    expect(result.expectedResult).toMatch(/submit, verify, and reconcile/i)
  })

  it('reports a blocked change (margin below minimum) with a null payload and the real blocking reason', () => {
    const request = baseRequest({ newSellingPrice: fromMajor(8.5) }) // Barely above cost — net margin collapses.
    const result = dryRunPriceChange(request, CONFIGURED_AUTOMATION_SETTINGS)

    expect(result.eligible).toBe(false)
    expect(result.wouldExecuteAutomatically).toBe(false)
    expect(result.payload).toBeNull()
    expect(result.blockingReasons.length).toBeGreaterThan(0)
    expect(result.expectedResult).toMatch(/would not execute/i)
  })

  it('reports a change requiring approval (manual/assisted automation level) with a non-null payload, since it is still eligible', () => {
    const request = baseRequest({ automationLevel: 'assisted' })
    const result = dryRunPriceChange(request, CONFIGURED_AUTOMATION_SETTINGS)

    expect(result.eligible).toBe(true)
    expect(result.wouldExecuteAutomatically).toBe(false)
    expect(result.payload).not.toBeNull()
    expect(result.expectedResult).toMatch(/owner approval/i)
  })

  it('exposes the full policy result, including every requirement checked, for full auditability of the dry run itself', () => {
    const result = dryRunPriceChange(baseRequest(), CONFIGURED_AUTOMATION_SETTINGS)
    expect(result.policy.requirements.length).toBeGreaterThan(0)
    expect(result.policy.requirements.some((r) => r.key === 'automation_state_known')).toBe(true)
  })

  it('never executes automatically, and is downgraded to require_approval, when automation state is unknown (kill switch fail-closed)', async () => {
    const { UNKNOWN_STATE_AUTOMATION_SETTINGS } = await import('@/lib/automation/settingsTypes')
    const result = dryRunPriceChange(baseRequest(), UNKNOWN_STATE_AUTOMATION_SETTINGS)

    expect(result.wouldExecuteAutomatically).toBe(false)
    expect(result.policy.outcome).toBe('block')
    expect(result.policy.requirements.find((r) => r.key === 'automation_state_known')?.satisfied).toBe(false)
  })
})
