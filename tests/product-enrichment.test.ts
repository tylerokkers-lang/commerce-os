import { describe, expect, it } from 'vitest'
import { parseWeightToGrams, normalizeProduct, known } from '@/lib/products/intelligence/enrichment'

describe('parseWeightToGrams — the brief\'s own "0.5 kg / 500g / 500 g" example', () => {
  it('parses "0.5kg" to 500 grams', () => {
    expect(parseWeightToGrams('0.5kg')).toBe(500)
  })
  it('parses "0.5 kg" (with a space) to 500 grams', () => {
    expect(parseWeightToGrams('0.5 kg')).toBe(500)
  })
  it('parses "500g" to 500 grams', () => {
    expect(parseWeightToGrams('500g')).toBe(500)
  })
  it('parses "500 g" (with a space) to 500 grams', () => {
    expect(parseWeightToGrams('500 g')).toBe(500)
  })
  it('parses a bare number as grams', () => {
    expect(parseWeightToGrams('500')).toBe(500)
  })
  it('returns null for unparseable input rather than guessing', () => {
    expect(parseWeightToGrams('heavy')).toBeNull()
  })
})

describe('known()', () => {
  it('marks a real value as known', () => {
    expect(known('a title')).toEqual({ value: 'a title', source: 'known' })
  })
  it('marks null/undefined as unknown, never coerced into a fake value', () => {
    expect(known(null)).toEqual({ value: null, source: 'unknown' })
    expect(known(undefined)).toEqual({ value: null, source: 'unknown' })
  })
})

describe('normalizeProduct', () => {
  const product = { title: 'A Product', description: 'From products table', category: 'Home', weight_grams: 300, length_mm: 100, width_mm: 50, height_mm: 20 }

  it('prefers Storefront data over the local products row when both exist', () => {
    const result = normalizeProduct(
      product,
      { description: 'Richer Shopify description', imageCount: 3, variantCount: 2, hasMeaningfulVariants: true, tags: ['new'], vendor: 'Acme' },
      null,
    )
    expect(result.description).toEqual({ value: 'Richer Shopify description', source: 'known' })
    expect(result.imageCount).toEqual({ value: 3, source: 'known' })
  })

  it('falls back to the products row description when no Storefront data exists', () => {
    const result = normalizeProduct(product, null, null)
    expect(result.description.value).toBe('From products table')
    expect(result.imageCount.source).toBe('unknown')
  })

  it('dimensions are only reported known when all three (length/width/height) are present', () => {
    const partial = normalizeProduct({ ...product, height_mm: null }, null, null)
    expect(partial.dimensionsMm.source).toBe('unknown')

    const complete = normalizeProduct(product, null, null)
    expect(complete.dimensionsMm).toEqual({ value: { length: 100, width: 50, height: 20 }, source: 'known' })
  })

  it('supplier facts are honestly unknown when no supplier offer exists', () => {
    const result = normalizeProduct(product, null, null)
    expect(result.supplierCostMinor.source).toBe('unknown')
    expect(result.supplierInStock.source).toBe('unknown')
  })

  it('supplier facts are known when a real offer is passed', () => {
    const result = normalizeProduct(product, null, { unitCostMinor: 400, shippingCostMinor: 200, leadTimeDays: 7, stockQty: 50, inStock: true })
    expect(result.supplierCostMinor).toEqual({ value: 400, source: 'known' })
    expect(result.supplierInStock).toEqual({ value: true, source: 'known' })
  })
})
