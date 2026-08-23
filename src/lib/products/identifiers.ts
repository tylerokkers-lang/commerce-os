import type { Enums } from '@/lib/supabase/database.types'

/**
 * Product identifiers (§17).
 *
 * This module validates identifiers. It does not create them, and there is
 * deliberately no function here that could. A GTIN, EAN or UPC identifies a
 * product to a global registry; a number that merely passes a check digit but
 * was invented is a fabricated claim about a real registry entry, so the only
 * legitimate sources are the manufacturer, the supplier, GS1, or a recorded
 * exemption.
 */

export type IdentifierType = Enums<'identifier_type'>
export type IdentifierSource = Enums<'identifier_source'>
export type ValidationState = Enums<'identifier_validation'>

export interface IdentifierValidation {
  state: ValidationState
  /** Plain-English explanation, shown in the UI beside the identifier. */
  note: string
  /** The normalised value to store, when normalisation is safe and lossless. */
  normalised: string
}

/** Digit counts the GS1 standards define. Anything else is not a GTIN. */
const GTIN_LENGTHS = [8, 12, 13, 14] as const

/**
 * The GS1 check digit.
 *
 * Weights alternate 3 and 1 from the rightmost digit before the check digit.
 * The check digit is whatever brings the weighted sum up to a multiple of ten.
 */
export function gs1CheckDigit(digitsWithoutCheck: string): number {
  let sum = 0
  // Walk right to left so the weighting does not depend on total length.
  for (let i = digitsWithoutCheck.length - 1, position = 0; i >= 0; i -= 1, position += 1) {
    const digit = digitsWithoutCheck.charCodeAt(i) - 48
    sum += position % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

export function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value)) return false
  if (!(GTIN_LENGTHS as readonly number[]).includes(value.length)) return false
  const body = value.slice(0, -1)
  const check = value.charCodeAt(value.length - 1) - 48
  return gs1CheckDigit(body) === check
}

/** ISBN-10 uses a modulo 11 check, where an X stands for a check value of 10. */
export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false
  let sum = 0
  for (let i = 0; i < 9; i += 1) {
    sum += (value.charCodeAt(i) - 48) * (10 - i)
  }
  const last = value[9]
  sum += last === 'X' ? 10 : last.charCodeAt(0) - 48
  return sum % 11 === 0
}

const strip = (value: string): string => value.replace(/[\s-]/g, '').toUpperCase()

/**
 * Validates an identifier against the rules of its own standard.
 *
 * Never returns `valid` on a guess. Where a standard has no check digit
 * (SKU, MPN, supplier SKU, ASIN) the result is `unverified`, because format
 * alone proves nothing about whether the identifier refers to a real product.
 */
export function validateIdentifier(type: IdentifierType, rawValue: string): IdentifierValidation {
  const value = strip(rawValue)

  if (value.length === 0) {
    return { state: 'invalid_format', note: 'Empty identifier.', normalised: '' }
  }

  switch (type) {
    case 'gtin':
    case 'ean':
    case 'upc': {
      if (!/^\d+$/.test(value)) {
        return {
          state: 'invalid_format',
          note: `A ${type.toUpperCase()} contains digits only. This value contains other characters.`,
          normalised: value,
        }
      }

      // UPC-A is 12 digits and EAN-13 is 13. A UPC padded with a leading zero
      // is a valid EAN-13, so length is checked against the specific type
      // rather than treating them as interchangeable.
      const expected: Record<'gtin' | 'ean' | 'upc', readonly number[]> = {
        gtin: GTIN_LENGTHS,
        ean: [8, 13],
        upc: [12],
      }
      if (!expected[type].includes(value.length)) {
        return {
          state: 'invalid_format',
          note: `A ${type.toUpperCase()} is ${expected[type].join(' or ')} digits. This value is ${value.length}.`,
          normalised: value,
        }
      }
      if (!isValidGtin(value)) {
        const body = value.slice(0, -1)
        return {
          state: 'invalid_check_digit',
          note: `The check digit does not match. Expected ${gs1CheckDigit(body)}, found ${value.slice(-1)}. This is usually a transcription error, not a different product.`,
          normalised: value,
        }
      }
      return {
        state: 'valid',
        note: `Format and GS1 check digit both correct. This confirms the number is well formed; it does not confirm the supplier is entitled to use it.`,
        normalised: value,
      }
    }

    case 'isbn': {
      if (value.length === 10) {
        return isValidIsbn10(value)
          ? { state: 'valid', note: 'Valid ISBN-10 check digit.', normalised: value }
          : { state: 'invalid_check_digit', note: 'ISBN-10 check digit does not match.', normalised: value }
      }
      if (value.length === 13) {
        return isValidGtin(value)
          ? { state: 'valid', note: 'Valid ISBN-13 (GS1) check digit.', normalised: value }
          : { state: 'invalid_check_digit', note: 'ISBN-13 check digit does not match.', normalised: value }
      }
      return { state: 'invalid_format', note: 'An ISBN is 10 or 13 characters.', normalised: value }
    }

    case 'asin': {
      // Amazon-assigned ASINs are 10 characters. Legacy book ASINs are the
      // ISBN-10. There is no check digit, so this can only ever confirm shape.
      if (!/^[A-Z0-9]{10}$/.test(value)) {
        return {
          state: 'invalid_format',
          note: 'An ASIN is exactly 10 uppercase letters and digits.',
          normalised: value,
        }
      }
      return {
        state: 'unverified',
        note: 'Correct shape for an ASIN. ASINs carry no check digit, so this can only be confirmed against the Amazon catalogue once the SP-API is connected.',
        normalised: value,
      }
    }

    case 'mpn':
    case 'sku':
    case 'supplier_sku': {
      if (value.length > 64) {
        return { state: 'invalid_format', note: 'Longer than 64 characters.', normalised: value }
      }
      if (!/^[A-Z0-9._\-/]+$/.test(value)) {
        return {
          state: 'invalid_format',
          note: 'Use letters, digits, dots, dashes, underscores and slashes only.',
          normalised: value,
        }
      }
      return {
        state: 'unverified',
        note: 'Free-form identifier with no standard to check against. Treated as unverified by design.',
        normalised: value,
      }
    }
  }
}

/**
 * Whether a listing can proceed on Amazon given what identifiers exist.
 *
 * Amazon requires a GTIN for most categories. The only two lawful answers when
 * one does not exist are a genuine, evidenced exemption or a blocked listing.
 * There is no third option, and specifically no option that involves this
 * system producing a number.
 */
export interface IdentifierRecord {
  idType: IdentifierType
  value: string
  source: IdentifierSource
  validation: ValidationState
}

export interface GtinEligibility {
  eligible: boolean
  reason: string
  requiresExemption: boolean
}

export function assessGtinEligibility(identifiers: readonly IdentifierRecord[]): GtinEligibility {
  const gtinLike = identifiers.filter((i) => i.idType === 'gtin' || i.idType === 'ean' || i.idType === 'upc')

  const exempt = identifiers.find((i) => i.source === 'gtin_exemption' || i.validation === 'exempt')
  if (exempt) {
    return {
      eligible: true,
      reason: 'A GTIN exemption is recorded for this product. Amazon must have granted it; this system only stores the evidence.',
      requiresExemption: true,
    }
  }

  if (gtinLike.length === 0) {
    return {
      eligible: false,
      reason: 'No GTIN, EAN or UPC has been supplied. Obtain one from the manufacturer or brand owner, or apply to Amazon for a GTIN exemption. This system will not generate one.',
      requiresExemption: true,
    }
  }

  const valid = gtinLike.find((i) => i.validation === 'valid')
  if (!valid) {
    const states = [...new Set(gtinLike.map((i) => i.validation))].join(', ')
    return {
      eligible: false,
      reason: `A GTIN is recorded but does not validate (${states}). Check the value against the manufacturer's own documentation before listing.`,
      requiresExemption: false,
    }
  }

  if (valid.source === 'owner_supplied') {
    return {
      eligible: false,
      reason: 'The only valid GTIN was entered by hand with no stated origin. Record where it came from (manufacturer, supplier or GS1) before it is used on a listing.',
      requiresExemption: false,
    }
  }

  return {
    eligible: true,
    reason: `A valid ${valid.idType.toUpperCase()} from the ${valid.source.replace('_', ' ')} is on file.`,
    requiresExemption: false,
  }
}
