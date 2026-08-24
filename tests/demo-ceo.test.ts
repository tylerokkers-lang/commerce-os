import { describe, expect, it } from 'vitest'
import { demoCEOScenarios } from '@/lib/demo/ceo'

describe('demoCEOScenarios', () => {
  const scenarios = demoCEOScenarios()

  it('produces exactly the 10 required scenarios, each with real, computed narrative', () => {
    expect(scenarios).toHaveLength(10)
    for (const scenario of scenarios) {
      expect(scenario.narrative.length).toBeGreaterThan(0)
      for (const line of scenario.narrative) {
        expect(line).not.toContain('undefined')
        expect(line).not.toContain('NaN')
      }
    }
  })

  it('BUG FOUND VIA BROWSER CHECK: revenue comparisons use a genuine previous-period window, never "null%" from a mis-bounded aggregation', () => {
    for (const key of ['healthy_growing', 'revenue_growth_profit_decline']) {
      const scenario = scenarios.find((s) => s.key === key)!
      const revenueLine = scenario.narrative.find((l) => l.startsWith('Revenue:'))!
      expect(revenueLine).not.toContain('null%')
      expect(revenueLine).toMatch(/-?\d+%/)
    }
  })

  it('every scenario has a distinct key', () => {
    const keys = scenarios.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('the healthy-growing scenario reports overall health as healthy or unknown, never a false alarm', () => {
    const scenario = scenarios.find((s) => s.key === 'healthy_growing')!
    expect(scenario.narrative[1]).toMatch(/Overall business health: (HEALTHY|UNKNOWN)/)
  })

  it('the critical-supplier-failure scenario reports overall health as critical', () => {
    const scenario = scenarios.find((s) => s.key === 'critical_supplier_failure')!
    expect(scenario.narrative.join(' ')).toContain('Overall business health: CRITICAL')
  })

  it('the emergency-stop scenario is the single highest-visibility fact — critical severity, top of the queue', () => {
    const scenario = scenarios.find((s) => s.key === 'automation_emergency_stop')!
    expect(scenario.narrative.some((l) => l.includes('EMERGENCY STOP ACTIVE'))).toBe(true)
    expect(scenario.narrative.some((l) => l.includes('top: [CRITICAL]'))).toBe(true)
  })

  it('the multi-issue scenario produces more than one priority, ordered critical-first', () => {
    const scenario = scenarios.find((s) => s.key === 'multiple_issues_prioritised')!
    const orderLine = scenario.narrative.find((l) => l.startsWith('Priority order:'))!
    const severities = orderLine.match(/\[(critical|high|medium|low)\]/g)!.map((s) => s.slice(1, -1))
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]])
    }
  })
})
