import { describe, expect, it } from 'vitest'
import {
  assessGtinEligibility,
  gs1CheckDigit,
  isValidGtin,
  isValidIsbn10,
  validateIdentifier,
  type IdentifierRecord,
} from '@/lib/products/identifiers'

describe('GS1 check digits', () => {
  it('validates published reference barcodes', () => {
    // Widely published reference values, so the algorithm is checked against
    // an external source rather than against itself.
    expect(isValidGtin('4006381333931')).toBe(true) // EAN-13
    expect(isValidGtin('036000291452')).toBe(true) // UPC-A
    expect(isValidGtin('96385074')).toBe(true) // EAN-8
  })

  it('rejects a single transposed digit', () => {
    expect(isValidGtin('4006381333932')).toBe(false)
  })

  it('computes the check digit that makes a body valid', () => {
    const body = '400638133393'
    expect(gs1CheckDigit(body)).toBe(1)
    expect(isValidGtin(body + gs1CheckDigit(body))).toBe(true)
  })

  it('rejects lengths no GTIN standard defines', () => {
    expect(isValidGtin('12345')).toBe(false)
    expect(isValidGtin('123456789012345')).toBe(false)
  })
})

describe('validateIdentifier', () => {
  it('accepts a well-formed EAN-13 and says what that does and does not prove', () => {
    const result = validateIdentifier('ean', '4006381333931')
    expect(result.state).toBe('valid')
    expect(result.note).toMatch(/does not confirm the supplier is entitled/)
  })

  it('distinguishes a bad check digit from a bad format', () => {
    expect(validateIdentifier('ean', '4006381333932').state).toBe('invalid_check_digit')
    expect(validateIdentifier('ean', '40063813339AB').state).toBe('invalid_format')
  })

  it('names the expected check digit so a typo can be found', () => {
    const result = validateIdentifier('ean', '4006381333932')
    expect(result.note).toMatch(/Expected 1, found 2/)
  })

  it('enforces the length each standard actually defines', () => {
    // A 13-digit value is a valid EAN but is not a UPC.
    expect(validateIdentifier('upc', '4006381333931').state).toBe('invalid_format')
    expect(validateIdentifier('gtin', '4006381333931').state).toBe('valid')
  })

  it('normalises spacing and dashes without changing the value', () => {
    expect(validateIdentifier('ean', '4-006381 333931').normalised).toBe('4006381333931')
    expect(validateIdentifier('ean', '4-006381 333931').state).toBe('valid')
  })

  it('treats an ASIN as unverified because it has no check digit', () => {
    const result = validateIdentifier('asin', 'B08N5WRWNW')
    expect(result.state).toBe('unverified')
    expect(result.note).toMatch(/no check digit/)
  })

  it('rejects an ASIN of the wrong shape', () => {
    expect(validateIdentifier('asin', 'B08N5WRWN').state).toBe('invalid_format')
  })

  it('validates ISBN-10 and ISBN-13 by their own rules', () => {
    expect(isValidIsbn10('0306406152')).toBe(true)
    expect(validateIdentifier('isbn', '0306406152').state).toBe('valid')
    expect(validateIdentifier('isbn', '9780306406157').state).toBe('valid')
    expect(validateIdentifier('isbn', '0306406153').state).toBe('invalid_check_digit')
  })

  it('marks free-form identifiers unverified rather than valid', () => {
    // Format alone proves nothing about whether a SKU refers to anything.
    expect(validateIdentifier('sku', 'CMO-1001').state).toBe('unverified')
    expect(validateIdentifier('mpn', 'ABC/123').state).toBe('unverified')
  })

  it('exports no way to generate an identifier', async () => {
    // The rule is that this system never invents a GTIN. The strongest test of
    // that is that no such function is reachable from the module at all.
    const identifiersModule = await import('@/lib/products/identifiers')
    const suspicious = Object.keys(identifiersModule).filter((name) =>
      /generate|create|mint|issue|make/i.test(name),
    )
    expect(suspicious).toEqual([])
  })
})

describe('assessGtinEligibility', () => {
  const record = (over: Partial<IdentifierRecord>): IdentifierRecord => ({
    idType: 'ean',
    value: '4006381333931',
    source: 'manufacturer',
    validation: 'valid',
    ...over,
  })

  it('blocks when there is no GTIN at all, and says what to do', () => {
    const result = assessGtinEligibility([])
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/will not generate one/)
  })

  it('accepts a valid manufacturer-supplied GTIN', () => {
    expect(assessGtinEligibility([record({})]).eligible).toBe(true)
  })

  it('blocks a GTIN that does not validate', () => {
    const result = assessGtinEligibility([record({ validation: 'invalid_check_digit' })])
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/does not validate/)
  })

  it('blocks a valid GTIN typed in with no stated origin', () => {
    // Provenance matters as much as the number: an owner-supplied value with
    // no source is exactly what an invented one would look like.
    const result = assessGtinEligibility([record({ source: 'owner_supplied' })])
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/entered by hand with no stated origin/)
  })

  it('accepts a recorded exemption without inventing a number', () => {
    const result = assessGtinEligibility([
      record({ source: 'gtin_exemption', validation: 'exempt', value: 'EXEMPT' }),
    ])
    expect(result.eligible).toBe(true)
    expect(result.requiresExemption).toBe(true)
  })
})
