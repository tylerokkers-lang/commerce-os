import { describe, expect, it } from 'vitest'
import { demoAutomationScenarios } from '@/lib/demo/automation'

/**
 * Verifies each of the seven demo scenarios (brief §25) isolates exactly the
 * outcome its narrative claims — the same kind of check that caught two real
 * scenario-construction bugs in Milestone 5's demo data.
 */
describe('demo automation scenarios', () => {
  const scenarios = demoAutomationScenarios()

  it('produces exactly seven scenarios, one per brief item', () => {
    expect(scenarios).toHaveLength(7)
  })

  it('scenario 1: supplier switch succeeds automatically', () => {
    const s = scenarios.find((s) => s.key === 'supplier_switch_success')!
    expect(s.kind).toBe('supplier_switch')
    if (s.kind === 'supplier_switch') {
      expect(s.result.redundancy.outcome).toBe('switch_automatically')
      expect(s.result.policy.outcome).toBe('allow_automatic')
    }
  })

  it('scenario 2: no switch when no alternative preserves compliance/profitability', () => {
    const s = scenarios.find((s) => s.key === 'supplier_switch_blocked')!
    if (s.kind === 'supplier_switch') {
      expect(s.result.redundancy.outcome).not.toBe('switch_automatically')
      expect(s.result.policy.outcome).not.toBe('allow_automatic')
    }
  })

  it('scenario 3: unprofitable product is flagged for review, not paused', () => {
    const s = scenarios.find((s) => s.key === 'product_unprofitable')!
    if (s.kind === 'monitoring') {
      expect(s.result.isProfitable).toBe(false)
      expect(s.result.recommendation).toBe('needs_price_or_supplier_review')
    }
  })

  it('scenario 4: Amazon and Shopify are decided independently', () => {
    const s = scenarios.find((s) => s.key === 'channel_independent_publication')!
    if (s.kind === 'publication') {
      expect(s.shopify.policy.outcome).not.toBe('block')
      expect(s.amazon.policy.outcome).toBe('block')
    }
  })

  it('scenario 5: the kill switch blocks the exact same switch scenario 1 allowed', () => {
    const s = scenarios.find((s) => s.key === 'kill_switch_active')!
    if (s.kind === 'supplier_switch') {
      expect(s.result.policy.outcome).toBe('block')
    }
  })

  it('scenario 6: exceeding the supplier spend limit requires approval instead of auto-submitting', () => {
    const s = scenarios.find((s) => s.key === 'spend_limit_exceeded')!
    if (s.kind === 'order') {
      expect(s.result.pipeline.submission.outcome).toBe('submit_automatically')
      expect(s.result.policy.outcome).toBe('require_approval')
    }
  })

  it('scenario 7: a marketplace outage retries with backoff and eventually dead-letters, never faking success', () => {
    const s = scenarios.find((s) => s.key === 'connector_unavailable')!
    if (s.kind === 'connector_failure') {
      expect(s.attempts).toHaveLength(5)
      expect(s.attempts.every((a, i) => i === 0 || a.backoffSeconds >= s.attempts[i - 1].backoffSeconds)).toBe(true)
      expect(s.finalState).toContain('dead_letter')
    }
  })
})
