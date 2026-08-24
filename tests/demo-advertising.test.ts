import { describe, expect, it } from 'vitest'
import { demoAdvertisingScenarios } from '@/lib/demo/advertising'

/**
 * Milestone 14's demo scenarios are computed through the real
 * `buildCampaignFact`/`classifyCampaign` functions (matching
 * `demo/analytics.ts`/`demo/ceo.ts`'s established discipline) — these
 * tests confirm each scenario's own label is actually what the real
 * engine concludes, not just narrative prose asserting it.
 */
describe('demoAdvertisingScenarios', () => {
  const scenarios = demoAdvertisingScenarios()

  it('produces one scenario per documented classification, never throwing', () => {
    expect(scenarios.map((s) => s.key).sort()).toEqual(
      ['declining_performance', 'healthy', 'high_acos_low_roas', 'insufficient_data', 'poor_profitability', 'scale_opportunity', 'wasted_spend'].sort(),
    )
  })

  it('every scenario\'s narrative actually reaches the classification its key promises', () => {
    for (const s of scenarios) {
      expect(s.narrative[0].toUpperCase()).toContain(s.key.toUpperCase())
    }
  })

  it('every scenario has a non-empty description and narrative', () => {
    for (const s of scenarios) {
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.narrative.length).toBeGreaterThan(0)
    }
  })
})
