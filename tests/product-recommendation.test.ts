import { describe, expect, it } from 'vitest'
import { recommendProduct, type RecommendationInputs } from '@/lib/products/intelligence/recommendation'

const BASE: RecommendationInputs = {
  profitabilityGatePasses: true,
  profitabilityFailureReason: null,
  supplierAssigned: true,
  worstComplianceVerdict: 'pass',
  qualityScore: 80,
  minQualityScore: 60,
  riskScore: 30,
  maxRiskScore: 70,
  capitalStatus: 'sufficient',
  capitalEfficiencyScore: 70,
  opportunityScore: 85,
  minOpportunityScore: 70,
  strongOpportunityScore: 80,
}

describe('Product Intelligence recommendation ladder', () => {
  it('a failed profitability gate is always DO_NOT_SELL, regardless of everything else', () => {
    const result = recommendProduct({ ...BASE, profitabilityGatePasses: false, profitabilityFailureReason: 'Net profit is negative.' })
    expect(result.recommendation).toBe('do_not_sell')
    expect(result.reason).toContain('negative')
  })

  it('no supplier assigned is DO_NOT_SELL even when everything else passes', () => {
    const result = recommendProduct({ ...BASE, supplierAssigned: false })
    expect(result.recommendation).toBe('do_not_sell')
  })

  it('profitability failing takes precedence over a missing supplier (stated order)', () => {
    const result = recommendProduct({ ...BASE, profitabilityGatePasses: false, profitabilityFailureReason: 'Loses money.', supplierAssigned: false })
    expect(result.recommendation).toBe('do_not_sell')
    expect(result.reason).toContain('Loses money')
  })

  it('a failed compliance verdict is REVIEW_REQUIRED, not DO_NOT_SELL', () => {
    const result = recommendProduct({ ...BASE, worstComplianceVerdict: 'fail' })
    expect(result.recommendation).toBe('review_required')
  })

  it('compliance not yet assessed is REVIEW_REQUIRED', () => {
    const result = recommendProduct({ ...BASE, worstComplianceVerdict: null })
    expect(result.recommendation).toBe('review_required')
  })

  it('quality below the configured minimum is REVIEW_REQUIRED', () => {
    const result = recommendProduct({ ...BASE, qualityScore: 40 })
    expect(result.recommendation).toBe('review_required')
  })

  it('risk above the configured maximum is REVIEW_REQUIRED', () => {
    const result = recommendProduct({ ...BASE, riskScore: 85 })
    expect(result.recommendation).toBe('review_required')
  })

  it('insufficient capital is LOW_PRIORITY, not DO_NOT_SELL', () => {
    const result = recommendProduct({ ...BASE, capitalStatus: 'insufficient_capital' })
    expect(result.recommendation).toBe('low_priority')
  })

  it('poor capital efficiency is LOW_PRIORITY', () => {
    const result = recommendProduct({ ...BASE, capitalEfficiencyScore: 10 })
    expect(result.recommendation).toBe('low_priority')
  })

  it('opportunity score below the minimum is LOW_PRIORITY', () => {
    const result = recommendProduct({ ...BASE, opportunityScore: 50 })
    expect(result.recommendation).toBe('low_priority')
  })

  it('everything passes and opportunity clears the strong threshold: STRONG_CANDIDATE', () => {
    const result = recommendProduct(BASE)
    expect(result.recommendation).toBe('strong_candidate')
  })

  it('everything passes but opportunity is only above the minimum, not the strong threshold: CANDIDATE', () => {
    const result = recommendProduct({ ...BASE, opportunityScore: 74 })
    expect(result.recommendation).toBe('candidate')
  })

  it('capital not configured does not block the ladder — falls through to the opportunity checks', () => {
    const result = recommendProduct({ ...BASE, capitalStatus: 'not_configured', capitalEfficiencyScore: null })
    expect(result.recommendation).toBe('strong_candidate')
  })
})
