import { describe, expect, it } from 'vitest'
import { buildShopifyProductPayload, type PayloadBuilderInput } from '@/lib/marketplaces/shopify/payloadBuilder'

const BASE: PayloadBuilderInput = {
  productId: 'prod-123',
  idempotencyKey: 'draft-prod-123',
  title: 'Aluminium Laptop Riser',
  descriptionHtml: '<p>A sturdy laptop riser.</p>',
  productType: 'Home Office',
  vendor: null,
  tags: ['ergonomic'],
  productSku: 'CMO-1001',
  currency: 'GBP',
  selectedPriceMinor: 2999,
  compareAtPriceMinor: null,
  weightGrams: 800,
  images: [],
  variants: [],
  seoTitle: null,
  seoDescription: null,
}

describe('Shopify product payload builder', () => {
  it('a simple, single-variant product gets one implicit default variant using the product SKU and selected price', () => {
    const payload = buildShopifyProductPayload(BASE)
    expect(payload.variants).toHaveLength(1)
    expect(payload.variants[0].sku).toBe('CMO-1001')
    expect(payload.variants[0].priceMinor).toBe(2999)
    expect(payload.variants[0].options).toHaveLength(0)
  })

  it('real variants are passed through untouched, never replaced by the implicit default', () => {
    const payload = buildShopifyProductPayload({
      ...BASE,
      variants: [
        { sku: 'CMO-1001-S', priceMinor: 2999, options: [{ name: 'Size', value: 'Small' }], weightGrams: 700 },
        { sku: 'CMO-1001-L', priceMinor: 3299, options: [{ name: 'Size', value: 'Large' }], weightGrams: 900 },
      ],
    })
    expect(payload.variants).toHaveLength(2)
    expect(payload.variants.map((v) => v.sku)).toEqual(['CMO-1001-S', 'CMO-1001-L'])
  })

  it('images are passed through untouched', () => {
    const payload = buildShopifyProductPayload({ ...BASE, images: [{ url: 'https://example.com/a.jpg', altText: 'Front view' }] })
    expect(payload.images).toHaveLength(1)
    expect(payload.images[0].url).toBe('https://example.com/a.jpg')
  })

  it('tags include the original tags plus a traceability tag carrying the internal product id', () => {
    const payload = buildShopifyProductPayload(BASE)
    expect(payload.tags).toContain('ergonomic')
    expect(payload.tags.some((t) => t.includes('prod-123'))).toBe(true)
  })

  it('SEO fields are passed through when present, and omitted (null) when absent', () => {
    const withSeo = buildShopifyProductPayload({ ...BASE, seoTitle: 'Best Laptop Riser', seoDescription: 'Buy the best laptop riser.' })
    expect(withSeo.seoTitle).toBe('Best Laptop Riser')

    const withoutSeo = buildShopifyProductPayload(BASE)
    expect(withoutSeo.seoTitle).toBeNull()
    expect(withoutSeo.seoDescription).toBeNull()
  })

  it('missing optional data (no images, no variants, no SEO, null compare-at) produces a valid payload, never an error', () => {
    const payload = buildShopifyProductPayload(BASE)
    expect(payload.images).toHaveLength(0)
    expect(payload.compareAtPriceMinor).toBeNull()
    expect(payload.title).toBe('Aluminium Laptop Riser')
  })

  it('status is always draft — never a caller-settable option', () => {
    const payload = buildShopifyProductPayload(BASE)
    expect(payload.status).toBe('draft')
  })

  it('the currency is passed through exactly as given, never assumed', () => {
    const payload = buildShopifyProductPayload({ ...BASE, currency: 'USD' })
    expect(payload.currency).toBe('USD')
  })
})
