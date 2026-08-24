import { describe, expect, it } from 'vitest'
import { demoMarketExpansionScenarios } from '@/lib/demo/marketExpansion'

describe('demo market expansion scenarios (Milestone 9 §13)', () => {
  const scenarios = demoMarketExpansionScenarios()

  it('produces all 5 required scenarios', () => {
    expect(scenarios).toHaveLength(5)
    expect(scenarios.map((s) => s.key)).toEqual(['ready_uk_only', 'currency_movement', 'divergent_markets', 'compliance_unknown_blocks', 'supplier_cannot_fulfil'])
  })

  it('scenario 1: UK ready, Germany insufficient facts, US blocked — three genuinely different reasons', () => {
    const scenario = scenarios.find((s) => s.key === 'ready_uk_only')!
    const [uk, de, us] = scenario.results
    expect(uk.recommendation).toBe('ready')
    expect(de.recommendation).toBe('insufficient_facts')
    expect(us.recommendation).toBe('blocked')
    // Each has a distinct blocker/missing-fact reason, not the same text three times.
    expect(de.missingFacts[0]).not.toBe(us.blockers[0])
  })

  it('scenario 2: an identical product genuinely flips from viable to loss-making purely from FX', () => {
    const scenario = scenarios.find((s) => s.key === 'currency_movement')!
    expect(scenario.results).toHaveLength(2)
    const [before, after] = scenario.results
    expect(before.profitability?.gate.passes).toBe(true)
    expect(after.profitability?.gate.passes).toBe(false)
    expect(before.profitability?.native.netProfit.minor).toBeGreaterThan(0)
    expect(after.profitability?.native.netProfit.minor).toBeLessThan(0)
  })

  it('scenario 3: markets diverge for genuinely different fee/shipping/advertising reasons', () => {
    const scenario = scenarios.find((s) => s.key === 'divergent_markets')!
    const recommendations = scenario.results.map((r) => r.recommendation)
    expect(new Set(recommendations).size).toBeGreaterThan(1) // Not all three identical.
  })

  it('scenario 4: excellent profitability never promotes a compliance-unknown market to ready', () => {
    const scenario = scenarios.find((s) => s.key === 'compliance_unknown_blocks')!
    const [assessment] = scenario.results
    expect(assessment.profitability?.gate.passes).toBe(true)
    expect(assessment.compliance.verdict).toBe('not_assessed')
    expect(assessment.recommendation).not.toBe('ready')
    expect(assessment.recommendation).not.toBe('promising')
  })

  it('scenario 5: a supplier that cannot ship blocks expansion even with real compliance and profitability passes', () => {
    const scenario = scenarios.find((s) => s.key === 'supplier_cannot_fulfil')!
    const [assessment] = scenario.results
    expect(assessment.compliance.verdict).toBe('pass')
    expect(assessment.profitability?.gate.passes).toBe(true)
    expect(assessment.supplierCapability.canShip.value).toBe(false)
    expect(assessment.recommendation).toBe('blocked')
  })
})
