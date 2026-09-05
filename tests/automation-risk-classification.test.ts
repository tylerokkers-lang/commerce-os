import { describe, expect, it } from 'vitest'
import { classifyActionRisk } from '@/lib/automation/riskClassification'

/**
 * Milestone: automation control plane. `AutomationRiskLevel` has always had
 * four real database values (`'low' | 'medium' | 'high' | 'unknown'`,
 * `0019_automation_engine.sql`), but until this module, no code path ever
 * produced `'high'` or `'unknown'` — every domain engine's own bespoke
 * ternary topped out at `'medium'`. These tests exercise the new shared
 * classifier directly; they do not change or re-test any of the seven
 * existing domain engines' own risk computations, which are untouched.
 */
describe('classifyActionRisk', () => {
  it('classifies an action with no pausable category as low, regardless of magnitude', () => {
    expect(classifyActionRisk({ actionType: 'reconcile_marketplace' })).toBe('low')
    expect(classifyActionRisk({ actionType: 'request_approval' })).toBe('low')
  })

  it('classifies a category-bearing action with no supplied magnitude as unknown, never assumed low', () => {
    expect(classifyActionRisk({ actionType: 'update_price' })).toBe('unknown')
    expect(classifyActionRisk({ actionType: 'process_refund' })).toBe('unknown')
  })

  it('classifies a percentage move well within its limit as low', () => {
    expect(classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: 2, limitPct: 5 } })).toBe('low')
  })

  it('classifies a percentage move that exceeds its limit but not by double as medium', () => {
    expect(classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: 7, limitPct: 5 } })).toBe('medium')
  })

  it('classifies a percentage move more than double its limit as high', () => {
    expect(classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: 11, limitPct: 5 } })).toBe('high')
  })

  it('uses the absolute value of a negative percentage move', () => {
    expect(classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: -11, limitPct: 5 } })).toBe('high')
  })

  it('classifies an amount well within its limit as low', () => {
    expect(classifyActionRisk({ actionType: 'process_refund', magnitude: { kind: 'amount', amountMinor: 100, limitMinor: 5000 } })).toBe('low')
  })

  it('classifies an amount that exceeds its limit but not by double as medium', () => {
    expect(classifyActionRisk({ actionType: 'process_refund', magnitude: { kind: 'amount', amountMinor: 6000, limitMinor: 5000 } })).toBe('medium')
  })

  it('classifies an amount more than double its limit as high', () => {
    expect(classifyActionRisk({ actionType: 'process_refund', magnitude: { kind: 'amount', amountMinor: 12000, limitMinor: 5000 } })).toBe('high')
  })

  it('treats a zero or negative configured limit as high risk (nothing to safely compare against), never low', () => {
    expect(classifyActionRisk({ actionType: 'process_refund', magnitude: { kind: 'amount', amountMinor: 100, limitMinor: 0 } })).toBe('high')
    expect(classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: 1, limitPct: 0 } })).toBe('high')
  })

  it('classifies an action exactly at its limit as low, and the first unit past it as medium', () => {
    expect(classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: 5, limitPct: 5 } })).toBe('low')
    expect(classifyActionRisk({ actionType: 'update_price', magnitude: { kind: 'percentage', actualPct: 5.01, limitPct: 5 } })).toBe('medium')
  })
})
