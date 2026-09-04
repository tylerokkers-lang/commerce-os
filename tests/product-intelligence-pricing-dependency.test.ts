import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Static regression guard for a real circular dependency found live
 * testing the CJdropshipping pipeline: `assemble.ts` computed `pricing`
 * (via `recommendPricing`) only when `profitability` was already
 * non-null — but `profitability` itself required an existing channel
 * price, which nothing could ever set for a freshly-imported product.
 * `assemble.ts` is `server-only` (imports `next/headers`'s `cookies()`
 * transitively via `createServerSupabase`), so it cannot be imported
 * directly here — this is a source-level check, the same technique
 * `product-server-actions-shape.test.ts` uses for the equally
 * un-importable Server Actions files, standing in for a live exercise
 * this suite cannot perform.
 *
 * Updated for the follow-up currency fix: pricing/profitability are now
 * gated on `landedCost?.available` (channel-currency-converted economics)
 * rather than the raw `supplierOfferFacts` presence check — a stricter,
 * still-correct condition, since a supplier offer in a currency with no
 * usable exchange rate must also block pricing rather than silently
 * conflating currencies. This still guards against the original bug
 * (pricing gated on `profitability`) returning.
 */

const ASSEMBLE_PATH = 'src/lib/products/intelligence/assemble.ts'

describe('assemble.ts: pricing is never re-gated behind an existing price (the fixed circular dependency)', () => {
  const source = readFileSync(ASSEMBLE_PATH, 'utf8')

  it('recommendPricing is gated on the currency-converted landed cost being available, never additionally on profitability', () => {
    const pricingCallSite = source.match(/const pricing =\s*\n\s*(.+)\n\s*\?\s*recommendPricing/)
    expect(pricingCallSite).not.toBeNull()
    // `&& shopifyProfile` was added alongside the ad-spend/fee-parity fix
    // (Shopify's own fee/fulfilment profile, computed once and shared with
    // the profitability call below) — still never re-gated on
    // `profitability` itself, which is what this test actually guards.
    expect(pricingCallSite![1].trim()).toBe('landedCost?.available && shopifyProfile')
  })

  it('the pricing computation appears before the profitability computation (pricing -> profitability, never the reverse)', () => {
    const pricingIndex = source.indexOf('const pricing =')
    const profitabilityIndex = source.indexOf('let profitability: ReturnType<typeof calculateProfitability>')
    expect(pricingIndex).toBeGreaterThan(-1)
    expect(profitabilityIndex).toBeGreaterThan(-1)
    expect(pricingIndex).toBeLessThan(profitabilityIndex)
  })

  it('profitability is computed from an effective price that falls back to the pricing engine\'s own recommendation, not only an existing channel price', () => {
    expect(source).toContain('const effectivePriceMinor = priceMinor ?? pricing.recommendedPriceMinor')
    expect(source).toContain('if (effectivePriceMinor !== null && landedCost?.available && shopifyProfile)')
  })

  it('the currency conversion happens before pricing, so pricing/profitability are never fed raw cross-currency supplier figures', () => {
    const landedCostIndex = source.indexOf('const landedCost = supplierOfferFacts')
    const pricingIndex = source.indexOf('const pricing =')
    expect(landedCostIndex).toBeGreaterThan(-1)
    expect(landedCostIndex).toBeLessThan(pricingIndex)
  })

  it('the recommended price is never written back to channel_products.price_minor as a side effect of this file', () => {
    // Persisting only ever targets product_intelligence's own columns.
    expect(source).toMatch(/recommended_price_minor:\s*pricing\.recommendedPriceMinor/)
    expect(source).not.toMatch(/channel_products['")\].]*\s*\.\s*update\([^)]*price_minor/)
  })

  it('Shopify\'s fee/fulfilment profile is computed exactly once and reused by both pricing and profitability, not recomputed per field or per call', () => {
    const shopifyProfileDeclarations = source.match(/const shopifyProfile = buildChannelProfiles/g) ?? []
    expect(shopifyProfileDeclarations).toHaveLength(1)
    const shopifyProfileIndex = source.indexOf('const shopifyProfile = buildChannelProfiles')
    const pricingIndex = source.indexOf('const pricing =')
    expect(shopifyProfileIndex).toBeGreaterThan(-1)
    expect(shopifyProfileIndex).toBeLessThan(pricingIndex)
  })

  it('recommendPricing is called with the org-configured advertisingAllowancePct, never a fixed or hardcoded ad-spend figure', () => {
    const recommendPricingCall = source.match(/recommendPricing\(([\s\S]*?)\n\s*\)/)
    expect(recommendPricingCall).not.toBeNull()
    expect(recommendPricingCall![1]).toContain('settings.advertisingAllowancePct')
    expect(recommendPricingCall![1]).not.toMatch(/adSpendPerUnit/)
  })
})
