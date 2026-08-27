import { describe, expect, it } from 'vitest'
import { scoreProductRisk } from '@/lib/products/intelligence/riskScore'

describe('Product Risk Score', () => {
  it('a reliable supplier, fast shipping and passing compliance scores low risk', () => {
    const result = scoreProductRisk({
      supplierReliabilityScore: 92,
      deliveryDaysMax: 3,
      worstComplianceVerdict: 'pass',
      qualityScore: 90,
      supplierInStock: true,
      supplierStockFigureKnown: true,
    })
    expect(result.total).toBeLessThan(30)
    expect(result.band).toBe('low')
  })

  it('long delivery time (high shipping risk) pushes the score up', () => {
    const fast = scoreProductRisk({ deliveryDaysMax: 3 })
    const slow = scoreProductRisk({ deliveryDaysMax: 28 })
    expect(slow.total).toBeGreaterThan(fast.total)
  })

  it('an unreliable supplier (high supplier risk) pushes the score up', () => {
    const reliable = scoreProductRisk({ supplierReliabilityScore: 90 })
    const unreliable = scoreProductRisk({ supplierReliabilityScore: 25 })
    expect(unreliable.total).toBeGreaterThan(reliable.total)
  })

  it('a high capital-exposure ratio (a high-value product relative to available capital) raises risk', () => {
    const low = scoreProductRisk({ capitalExposureRatio: 0.01 })
    const high = scoreProductRisk({ capitalExposureRatio: 0.6 })
    expect(high.total).toBeGreaterThan(low.total)
  })

  it('a failed compliance verdict is a severe, top-listed concern', () => {
    const result = scoreProductRisk({ worstComplianceVerdict: 'fail' })
    expect(result.total).toBeGreaterThanOrEqual(90)
    expect(result.topConcerns[0]).toMatch(/compliance/i)
  })

  it('compliance not yet assessed is treated as a meaningful risk, not as safe', () => {
    const passed = scoreProductRisk({ worstComplianceVerdict: 'pass' })
    const unassessed = scoreProductRisk({ worstComplianceVerdict: 'not_assessed' })
    expect(unassessed.total).toBeGreaterThan(passed.total)
  })

  it('an unavailable signal is excluded, never defaulted to a mid-range guess', () => {
    const result = scoreProductRisk({})
    expect(result.components.every((c) => c.score === null)).toBe(true)
    expect(result.total).toBe(0)
    expect(result.coverage).toBe(0)
  })

  it('unknown stock figure scores as more volatile than a known, in-stock figure', () => {
    const known = scoreProductRisk({ supplierStockFigureKnown: true, supplierInStock: true })
    const unknown = scoreProductRisk({ supplierStockFigureKnown: false })
    expect(unknown.total).toBeGreaterThan(known.total)
  })
})
