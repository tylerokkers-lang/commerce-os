import { describe, expect, it } from 'vitest'
import { validateCandidateInput, generateCandidateSku } from '@/lib/suppliers/discovery/validation'

const VALID = {
  candidateTitle: 'Aluminium Laptop Riser',
  currency: 'GBP',
  unitCostMinor: 450,
  shippingCostMinor: 200,
  deliveryDaysMin: 5,
  deliveryDaysMax: 10,
}

describe('Supplier discovery — candidate validation', () => {
  it('accepts a genuinely valid candidate', () => {
    expect(validateCandidateInput(VALID)).toBeNull()
  })

  it('a missing title is rejected', () => {
    expect(validateCandidateInput({ ...VALID, candidateTitle: '' })).toMatch(/title is required/)
    expect(validateCandidateInput({ ...VALID, candidateTitle: '   ' })).toMatch(/title is required/)
  })

  it('a candidate with no cost yet is still valid to capture — missing cost is a real, expected state, not an error', () => {
    expect(validateCandidateInput({ ...VALID, unitCostMinor: null })).toBeNull()
  })

  it('a negative cost is rejected', () => {
    expect(validateCandidateInput({ ...VALID, unitCostMinor: -100 })).toMatch(/cannot be negative/)
  })

  it('a negative shipping cost is rejected', () => {
    expect(validateCandidateInput({ ...VALID, shippingCostMinor: -50 })).toMatch(/cannot be negative/)
  })

  it('an unsupported (non-3-letter) currency is rejected', () => {
    expect(validateCandidateInput({ ...VALID, currency: 'POUNDS' })).toMatch(/not a valid 3-letter currency code/)
    expect(validateCandidateInput({ ...VALID, currency: '$' })).toMatch(/not a valid 3-letter currency code/)
  })

  it('a real 3-letter currency code is accepted regardless of case', () => {
    expect(validateCandidateInput({ ...VALID, currency: 'usd' })).toBeNull()
  })

  it('malformed delivery range (min after max) is rejected', () => {
    expect(validateCandidateInput({ ...VALID, deliveryDaysMin: 15, deliveryDaysMax: 5 })).toMatch(/cannot exceed/)
  })

  it('an unset delivery range is valid — genuinely unknown, not malformed', () => {
    expect(validateCandidateInput({ ...VALID, deliveryDaysMin: null, deliveryDaysMax: null })).toBeNull()
  })
})

describe('generateCandidateSku', () => {
  it('produces a SKU prefixed CAND- so an imported-from-discovery product is always identifiable', () => {
    expect(generateCandidateSku('11111111-2222-3333-4444-555555555555', null)).toMatch(/^CAND-/)
  })

  it('incorporates the supplier SKU when one exists', () => {
    const sku = generateCandidateSku('11111111-2222-3333-4444-555555555555', 'XYZ-123')
    expect(sku).toContain('XYZ123')
  })

  it('is deterministic for the same inputs', () => {
    const a = generateCandidateSku('11111111-2222-3333-4444-555555555555', 'XYZ-123')
    const b = generateCandidateSku('11111111-2222-3333-4444-555555555555', 'XYZ-123')
    expect(a).toBe(b)
  })

  it('differs for different candidate ids even with the same supplier SKU', () => {
    const a = generateCandidateSku('11111111-2222-3333-4444-555555555555', 'XYZ-123')
    const b = generateCandidateSku('99999999-8888-7777-6666-555555555555', 'XYZ-123')
    expect(a).not.toBe(b)
  })
})
