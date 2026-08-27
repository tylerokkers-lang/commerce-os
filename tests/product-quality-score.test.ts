import { describe, expect, it } from 'vitest'
import { scoreProductQuality } from '@/lib/products/intelligence/qualityScore'

describe('Product Quality Score', () => {
  it('scores a complete product highly', () => {
    const result = scoreProductQuality({
      imageCount: 6,
      descriptionLength: 500,
      hasMeaningfulVariants: true,
      variantCount: 3,
      hasDimensions: true,
      hasWeight: true,
      supplierAssigned: true,
      supplierHasCost: true,
      supplierHasLeadTime: true,
      supplierHasStockFigure: true,
    })
    expect(result.total).toBeGreaterThanOrEqual(85)
    expect(result.band).toBe('excellent')
    expect(result.missing).toHaveLength(0)
  })

  it('scores an incomplete product with no supplier assigned poorly', () => {
    const result = scoreProductQuality({
      supplierAssigned: false,
    })
    expect(result.total).toBeLessThan(40)
    expect(result.band).toBe('poor')
  })

  it('missing images excludes the component rather than scoring it zero', () => {
    const withoutImages = scoreProductQuality({
      descriptionLength: 300,
      hasDimensions: true,
      hasWeight: true,
      supplierAssigned: false,
    })
    const imagesComponent = withoutImages.components.find((c) => c.key === 'images')
    expect(imagesComponent?.score).toBeNull()
    expect(withoutImages.missing).toContain('Images')
  })

  it('missing specifications (no dimensions/weight data at all) excludes rather than defaults', () => {
    const result = scoreProductQuality({
      imageCount: 4,
      descriptionLength: 300,
      supplierAssigned: false,
    })
    const specs = result.components.find((c) => c.key === 'specifications')
    expect(specs?.score).toBeNull()
  })

  it('zero images genuinely scores zero for that component, distinct from missing data', () => {
    const result = scoreProductQuality({
      imageCount: 0,
      supplierAssigned: false,
    })
    const imagesComponent = result.components.find((c) => c.key === 'images')
    expect(imagesComponent?.score).toBe(0)
  })

  it('a single-variant product is not penalised for lacking variant options', () => {
    const result = scoreProductQuality({
      hasMeaningfulVariants: false,
      supplierAssigned: false,
    })
    const variants = result.components.find((c) => c.key === 'variants')
    expect(variants?.score).toBeGreaterThan(50)
  })

  it('renormalises across whatever is actually available — total stays 0-100 regardless of coverage', () => {
    const sparse = scoreProductQuality({ imageCount: 4, supplierAssigned: false })
    expect(sparse.total).toBeGreaterThanOrEqual(0)
    expect(sparse.total).toBeLessThanOrEqual(100)
    expect(sparse.coverage).toBeLessThan(1)
  })
})
