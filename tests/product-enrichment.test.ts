import { describe, expect, it } from 'vitest'
import { parseWeightToGrams, normalizeProduct, known } from '@/lib/products/intelligence/enrichment'
import { scoreProductQuality, type QualitySignals } from '@/lib/products/intelligence/qualityScore'

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
    const result = normalizeProduct(product, null, { unitCostMinor: 400, shippingCostMinor: 200, currency: 'GBP', leadTimeDays: 7, stockQty: 50, inStock: true })
    expect(result.supplierCostMinor).toEqual({ value: 400, source: 'known' })
    expect(result.supplierInStock).toEqual({ value: true, source: 'known' })
  })
})

/**
 * Milestone: CJ import data-persistence fix. `assemble.ts` (server-only,
 * untestable directly) builds `QualitySignals` from exactly these two
 * sources — `normalizeProduct`'s output plus the raw `product`/
 * `supplierOffer` rows. This proves the real, previously-broken chain end
 * to end: a persisted description/dimensions/weight/lead-time genuinely
 * reaches the existing quality scorer as a non-null signal, and their
 * absence stays an excluded "unknown" component, never a false positive.
 */
describe('normalizeProduct -> scoreProductQuality: the real persisted-facts chain', () => {
  const productRowWithRealFacts = { title: 'A Product', description: 'A real, 1796-character supplier description.', category: 'Home', weight_grams: 420, length_mm: 300, width_mm: 200, height_mm: 50 }

  function qualitySignalsFrom(
    product: { description: string | null; weight_grams: number | null; length_mm: number | null; width_mm: number | null; height_mm: number | null },
    supplierOffer: { unitCostMinor: number; shippingCostMinor: number; currency: 'GBP'; leadTimeDays: number | null; stockQty: number | null; inStock: boolean } | null,
  ): QualitySignals {
    const normalized = normalizeProduct(product as never, null, supplierOffer)
    // Mirrors assemble.ts's own qualitySignals construction exactly.
    return {
      imageCount: normalized.imageCount.value ?? undefined,
      descriptionLength: normalized.description.value?.length,
      hasMeaningfulVariants: normalized.hasMeaningfulVariants.value ?? undefined,
      variantCount: normalized.variantCount.value ?? undefined,
      hasDimensions: product.length_mm !== null && product.width_mm !== null && product.height_mm !== null,
      hasWeight: product.weight_grams !== null,
      supplierAssigned: supplierOffer !== null,
      supplierHasCost: supplierOffer ? true : false,
      supplierHasLeadTime: supplierOffer ? supplierOffer.leadTimeDays !== null : undefined,
      supplierHasStockFigure: supplierOffer ? supplierOffer.stockQty !== null : undefined,
    }
  }

  it('a persisted description reaches the description component as a real, non-null score — not excluded as missing', () => {
    const signals = qualitySignalsFrom(productRowWithRealFacts, null)
    const quality = scoreProductQuality(signals)
    const description = quality.components.find((c) => c.key === 'description')
    expect(description?.score).not.toBeNull()
    expect(description?.score).toBeGreaterThan(0)
  })

  it('persisted weight/dimensions reach the specifications component as fully known, not excluded', () => {
    const signals = qualitySignalsFrom(productRowWithRealFacts, null)
    const quality = scoreProductQuality(signals)
    const specs = quality.components.find((c) => c.key === 'specifications')
    expect(specs?.score).toBe(100)
  })

  it('a persisted supplier lead time reaches the shipping-data component as satisfied, not excluded', () => {
    const signals = qualitySignalsFrom(productRowWithRealFacts, { unitCostMinor: 3814, shippingCostMinor: 594, currency: 'GBP', leadTimeDays: 7, stockQty: null, inStock: true })
    const quality = scoreProductQuality(signals)
    const shipping = quality.components.find((c) => c.key === 'shippingData')
    expect(shipping?.score).toBe(100)
  })

  it('a genuinely absent description is excluded (unknown, never a false positive); genuinely-checked-and-absent specs/lead-time correctly score zero, since the product/supplier row is real and definitively says "no data on file" rather than "never checked"', () => {
    const signals = qualitySignalsFrom(
      { description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      { unitCostMinor: 3814, shippingCostMinor: 594, currency: 'GBP', leadTimeDays: null, stockQty: null, inStock: true },
    )
    const quality = scoreProductQuality(signals)
    // No products row description at all -> descriptionLength is undefined -> excluded.
    expect(quality.components.find((c) => c.key === 'description')?.score).toBeNull()
    // A real products row with every dimension/weight column null -> a definite "no", not "never checked" -> 0, not excluded.
    expect(quality.components.find((c) => c.key === 'specifications')?.score).toBe(0)
    // A real, assigned supplier offer with a null lead_time_days -> a definite "no", not "never checked" -> 0, not excluded.
    expect(quality.components.find((c) => c.key === 'shippingData')?.score).toBe(0)
  })
})
