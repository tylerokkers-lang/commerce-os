import { describe, expect, it } from 'vitest'
import { comparePeriods } from '@/lib/core/compare'

describe('comparePeriods', () => {
  it('computes absolute and percentage change with direction', () => {
    const result = comparePeriods(125, 100)
    expect(result).toEqual({ current: 125, previous: 100, absoluteChange: 25, percentChange: 25, direction: 'up' })
  })

  it('reports a decline as negative percentChange with direction "down"', () => {
    const result = comparePeriods(60, 100)
    expect(result.absoluteChange).toBe(-40)
    expect(result.percentChange).toBe(-40)
    expect(result.direction).toBe('down')
  })

  it('reports zero change as direction "flat"', () => {
    const result = comparePeriods(100, 100)
    expect(result.absoluteChange).toBe(0)
    expect(result.percentChange).toBe(0)
    expect(result.direction).toBe('flat')
  })

  it('zero previous and zero current is a real flat 0%, not null', () => {
    const result = comparePeriods(0, 0)
    expect(result.percentChange).toBe(0)
    expect(result.direction).toBe('flat')
  })

  it('zero previous with a nonzero current cannot be expressed as a percentage — null, not Infinity', () => {
    const result = comparePeriods(50, 0)
    expect(result.percentChange).toBeNull()
    expect(result.absoluteChange).toBe(50)
    expect(result.direction).toBe('up')
    expect(Number.isFinite(result.percentChange as unknown as number)).toBe(false)
  })

  it('rounds percentChange to two decimal places', () => {
    const result = comparePeriods(1, 3)
    expect(result.percentChange).toBe(-66.67)
  })
})
