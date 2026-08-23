import { describe, expect, it } from 'vitest'
import { computeBackoffSeconds } from '@/lib/automation/backoff'

describe('job retry backoff', () => {
  it('increases with each attempt', () => {
    const first = computeBackoffSeconds(1)
    const second = computeBackoffSeconds(2)
    const third = computeBackoffSeconds(3)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  it('is deterministic for the same attempt count', () => {
    expect(computeBackoffSeconds(3)).toBe(computeBackoffSeconds(3))
  })

  it('caps at one hour no matter how many attempts', () => {
    expect(computeBackoffSeconds(20)).toBe(3600)
    expect(computeBackoffSeconds(100)).toBe(3600)
  })

  it('never returns a negative or zero backoff, even for a zero or negative attempt count', () => {
    expect(computeBackoffSeconds(0)).toBeGreaterThan(0)
    expect(computeBackoffSeconds(-5)).toBeGreaterThan(0)
  })
})
