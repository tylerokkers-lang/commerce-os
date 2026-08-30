import { describe, expect, it } from 'vitest'
import { assessShopifyEligibility, type ShopifyEligibilityInputs } from '@/lib/marketplaces/shopify/eligibility'
import type { PublicationDecision } from '@/lib/marketplaces/publicationGate'

const PASSING_CORE: PublicationDecision = {
  channel: 'shopify',
  outcome: 'auto_publish_permitted',
  requirements: [
    { key: 'product_decision', label: 'Product decision', satisfied: true, detail: 'Decision is add.' },
    { key: 'profitability', label: 'Profitability', satisfied: true, detail: 'Clears the minimum margin.' },
    { key: 'compliance', label: 'Compliance', satisfied: true, detail: 'Passed.' },
  ],
  reason: 'All requirements satisfied.',
  requiresOwnerApproval: false,
}

const FAILING_CORE: PublicationDecision = {
  ...PASSING_CORE,
  outcome: 'blocked',
  requirements: [
    { key: 'profitability', label: 'Profitability', satisfied: false, detail: 'Net profit is negative.' },
  ],
  reason: 'Profitability gate fails.',
}

const BASE: ShopifyEligibilityInputs = {
  corePublication: PASSING_CORE,
  hasTitle: true,
  hasDescription: true,
  imageCount: 3,
  minImageCount: 1,
  selectedPriceMinor: 1999,
  variantsValid: true,
  variantIssue: null,
  isDuplicateCandidate: false,
}

describe('Shopify publication eligibility', () => {
  it('a complete, fully passing product is ELIGIBLE', () => {
    const result = assessShopifyEligibility(BASE)
    expect(result.eligible).toBe(true)
    expect(result.blockingReasons).toHaveLength(0)
  })

  it('a missing title blocks eligibility with a specific reason', () => {
    const result = assessShopifyEligibility({ ...BASE, hasTitle: false })
    expect(result.eligible).toBe(false)
    expect(result.blockingReasons.some((r) => r.includes('title'))).toBe(true)
  })

  it('missing images blocks eligibility — the brief\'s own "Missing product images" example', () => {
    const result = assessShopifyEligibility({ ...BASE, imageCount: 0, minImageCount: 1 })
    expect(result.eligible).toBe(false)
    expect(result.blockingReasons.some((r) => r.includes('Missing product images'))).toBe(true)
  })

  it('no selling price selected blocks eligibility', () => {
    const result = assessShopifyEligibility({ ...BASE, selectedPriceMinor: null })
    expect(result.eligible).toBe(false)
  })

  it('a zero selling price is not treated as a real selection', () => {
    const result = assessShopifyEligibility({ ...BASE, selectedPriceMinor: 0 })
    expect(result.eligible).toBe(false)
  })

  it('a failed core publication gate (profitability) blocks eligibility even when all Shopify-specific content is complete', () => {
    const result = assessShopifyEligibility({ ...BASE, corePublication: FAILING_CORE })
    expect(result.eligible).toBe(false)
    expect(result.blockingReasons.some((r) => r.includes('negative'))).toBe(true)
  })

  it('a flagged duplicate candidate blocks eligibility, with an explicit reason', () => {
    const result = assessShopifyEligibility({ ...BASE, isDuplicateCandidate: true })
    expect(result.eligible).toBe(false)
    expect(result.blockingReasons.some((r) => r.toLowerCase().includes('duplicate'))).toBe(true)
  })

  it('invalid variant data blocks eligibility with the specific issue text', () => {
    const result = assessShopifyEligibility({ ...BASE, variantsValid: false, variantIssue: 'Two variants share the same SKU.' })
    expect(result.eligible).toBe(false)
    expect(result.blockingReasons).toContain('Two variants share the same SKU.')
  })

  it('pending_approval on the core gate surfaces as a warning, not a block', () => {
    const result = assessShopifyEligibility({ ...BASE, corePublication: { ...PASSING_CORE, outcome: 'pending_approval' } })
    expect(result.eligible).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('every requirement from the core gate is preserved verbatim alongside the Shopify-specific ones — never dropped', () => {
    const result = assessShopifyEligibility(BASE)
    const keys = result.requirements.map((r) => r.key)
    expect(keys).toContain('product_decision')
    expect(keys).toContain('profitability')
    expect(keys).toContain('compliance')
    expect(keys).toContain('images')
    expect(keys).toContain('selling_price')
  })

  it('exactly meeting the minimum image count is sufficient, not a block', () => {
    const result = assessShopifyEligibility({ ...BASE, imageCount: 1, minImageCount: 1 })
    const imagesReq = result.requirements.find((r) => r.key === 'images')
    expect(imagesReq?.satisfied).toBe(true)
  })
})
