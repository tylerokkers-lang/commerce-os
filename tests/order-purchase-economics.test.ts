import { describe, expect, it } from 'vitest'
import { calculatePurchaseVariance } from '@/lib/orders/purchaseEconomics'

describe('actual-vs-estimated purchase economics', () => {
  it('no estimate available (no supplier was ever resolved): UNKNOWN variance, never fabricated', () => {
    const result = calculatePurchaseVariance({ estimatedCostMinor: null, actualCostMinor: 1200 })
    expect(result.varianceMinor).toBeNull()
    expect(result.variancePct).toBeNull()
    expect(result.actualCostMinor).toBe(1200)
  })

  it('actual cost higher than estimated: positive variance', () => {
    const result = calculatePurchaseVariance({ estimatedCostMinor: 1000, actualCostMinor: 1200 })
    expect(result.varianceMinor).toBe(200)
    expect(result.variancePct).toBe(20)
  })

  it('actual cost lower than estimated: negative variance', () => {
    const result = calculatePurchaseVariance({ estimatedCostMinor: 1000, actualCostMinor: 900 })
    expect(result.varianceMinor).toBe(-100)
    expect(result.variancePct).toBe(-10)
  })

  it('actual cost exactly matches estimate: zero variance', () => {
    const result = calculatePurchaseVariance({ estimatedCostMinor: 1000, actualCostMinor: 1000 })
    expect(result.varianceMinor).toBe(0)
    expect(result.variancePct).toBe(0)
  })

  it('a zero estimate never causes a division by zero — percentage is null, not Infinity/NaN', () => {
    const result = calculatePurchaseVariance({ estimatedCostMinor: 0, actualCostMinor: 500 })
    expect(result.varianceMinor).toBe(500)
    expect(result.variancePct).toBeNull()
  })

  it('rounds the percentage to 2 decimal places', () => {
    const result = calculatePurchaseVariance({ estimatedCostMinor: 300, actualCostMinor: 310 })
    expect(result.variancePct).toBeCloseTo(3.33, 2)
  })
})
