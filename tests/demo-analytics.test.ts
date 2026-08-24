import { describe, expect, it } from 'vitest'
import { demoAnalyticsScenarios } from '@/lib/demo/analytics'

describe('demoAnalyticsScenarios', () => {
  const scenarios = demoAnalyticsScenarios()

  it('produces exactly the 10 required scenarios, each with real narrative computed from the engines', () => {
    expect(scenarios).toHaveLength(10)
    for (const scenario of scenarios) {
      expect(scenario.narrative.length).toBeGreaterThan(0)
      expect(scenario.description.length).toBeGreaterThan(0)
      for (const line of scenario.narrative) {
        expect(line).not.toContain('undefined')
        expect(line).not.toContain('NaN')
        expect(line).not.toContain('null%')
      }
    }
  })

  it('every scenario has a distinct key', () => {
    const keys = scenarios.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('the strong-growth scenario genuinely shows growth, not a decline', () => {
    const scenario = scenarios.find((s) => s.key === 'strong_growth')!
    expect(scenario.narrative.some((l) => l.includes('%'))).toBe(true)
    expect(scenario.narrative.some((l) => l.startsWith('Unexpected'))).toBe(false)
  })

  it('the revenue-decline scenario actually raises an alert', () => {
    const scenario = scenarios.find((s) => s.key === 'revenue_decline')!
    expect(scenario.narrative.some((l) => l.startsWith('Alert raised'))).toBe(true)
  })

  it('the loss-making scenario shows a real profitability crossing from positive to negative', () => {
    const scenario = scenarios.find((s) => s.key === 'product_becomes_loss_making')!
    const beforeLine = scenario.narrative.find((l) => l.startsWith('Before'))!
    const afterLine = scenario.narrative.find((l) => l.startsWith('After'))!
    expect(beforeLine).toMatch(/£\d/)
    expect(afterLine).toMatch(/£-/)
  })

  it('the advertising scenario reports every figure unavailable, never a number', () => {
    const scenario = scenarios.find((s) => s.key === 'advertising_unavailable')!
    expect(scenario.narrative.join(' ')).toContain('unavailable')
  })
})
