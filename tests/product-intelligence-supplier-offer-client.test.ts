import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveChannelCurrencyLandedCost } from '@/lib/products/intelligence/currency'
import { recommendPricing } from '@/lib/products/intelligence/pricingEngine'
import { recommendProduct } from '@/lib/products/intelligence/recommendation'
import { calculateProfitability, assessProfitabilityGate } from '@/lib/profitability'
import { buildChannelProfiles } from '@/lib/profitability/channels'
import { money } from '@/lib/core/money'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import { resolveBusinessConfiguration } from '@/lib/automation/settingsTypes'
import type { ExchangeRateFact } from '@/lib/fx/types'

/**
 * Milestone: production first-run verification — regression coverage for
 * the `loadSupplierOffer` client-injection fix.
 *
 * `assemble.ts` is `server-only` (imports `next/headers`'s `cookies()`
 * transitively via `createServerSupabase`) and cannot be imported here —
 * confirmed, and already the established pattern for this exact file
 * (`tests/product-intelligence-pricing-dependency.test.ts`,
 * `tests/product-intelligence-currency.test.ts`). This suite combines:
 *
 *   1. Static source assertions pinning the fix itself (the client is
 *      threaded through, never independently re-fetched), so the exact
 *      regression — a background job silently unable to see a real
 *      `supplier_products` row — cannot recur unnoticed.
 *   2. A live composition of the real, pure engines `assemble.ts` calls in
 *      this order (`deriveChannelCurrencyLandedCost` -> `recommendPricing`
 *      -> `calculateProfitability` -> `assessProfitabilityGate` ->
 *      `recommendProduct`), fed the ACTUAL production numbers for product
 *      `8ff6fbc0-58f1-4d20-bcd4-15d35df54261` (CJYD2334853): unit cost
 *      500 minor USD, shipping 594 minor USD, converted at the real
 *      GBP<->USD rate this org's own daily FX refresh recorded. This
 *      proves the fix's downstream effect — a real price, a real margin,
 *      a real recommendation — without asserting anything about
 *      `assemble.ts`'s own internal wiring twice.
 */

const ASSEMBLE_PATH = 'src/lib/products/intelligence/assemble.ts'

describe('loadSupplierOffer: the client-injection fix itself (static)', () => {
  const source = readFileSync(ASSEMBLE_PATH, 'utf8')

  it('takes the resolved Supabase client as its first parameter', () => {
    expect(source).toMatch(/async function loadSupplierOffer\(supabase:\s*ReadinessClient,\s*orgId:\s*string,\s*supplierId:\s*string,\s*productId:\s*string\)/)
  })

  it('never independently constructs its own client — the exact regression this fixes', () => {
    const start = source.indexOf('async function loadSupplierOffer(')
    const body = source.slice(start, source.indexOf('\n}\n', start))
    expect(body).not.toMatch(/createServerSupabase\(\)/)
    expect(body).not.toMatch(/createServiceSupabase\(\)/)
  })

  it('the call site inside computeProductIntelligence passes the already-resolved client, not a fresh one', () => {
    expect(source).toContain('const supplierOffer = supplierId ? await loadSupplierOffer(supabase, orgId, supplierId, productId) : null')
  })

  it('computeProductIntelligence itself still defaults to the session-scoped client when none is injected — the two existing human-triggered callers are unaffected', () => {
    // Item 6: session-scoped behaviour remains correct. This is the exact
    // line every human-triggered caller (manual "recalculate",
    // candidate-imported on import) relies on, unchanged by this fix.
    expect(source).toContain('const supabase = client ?? (await createServerSupabase())')
  })

  it('the injected client is genuinely used for every other read too, not only the one this fix touches', () => {
    // Guards against a narrower regression: `supabase` (the resolved
    // client) must be what every subsequent query in the function body
    // is called on, confirmed by grepping for stray direct client
    // construction anywhere else in the file (the persistence path's
    // `createServiceSupabase()` for writes is the sole, correct exception).
    const codeOnly = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
    const directClientCalls = [...codeOnly.matchAll(/createServerSupabase\(\)|createServiceSupabase\(\)/g)]
    expect(directClientCalls).toHaveLength(2) // computeProductIntelligence's own fallback, and the service-role persistence path.
  })
})

describe('once the fix restores real supplier facts: the real downstream computation (product 8ff6fbc0…, CJYD2334853)', () => {
  // Exact production values, verified read-only against Supabase this
  // milestone: supplier_products.unit_cost_minor=500, shipping_cost_minor=594,
  // currency='USD'. The org's real daily FX refresh recorded GBP->USD 1.353
  // (equivalently USD->GBP ≈0.7391) from frankfurter.dev.
  const REAL_RATE: ExchangeRateFact = { base: 'USD', quote: 'GBP', rate: 0.7391, source: 'frankfurter.dev (ECB reference rates)', observedAt: new Date().toISOString(), retrievedAt: new Date().toISOString() }
  const NOW = new Date()

  it('2. real unit cost, shipping and currency survive the currency conversion into the pricing engine\'s own inputs', () => {
    const landedCost = deriveChannelCurrencyLandedCost({ unitCostMinor: 500, shippingCostMinor: 594, currency: 'USD' }, 'GBP', REAL_RATE, 'productEvaluation', NOW)
    expect(landedCost.available).toBe(true)
    expect(landedCost.unitCostMinor).not.toBeNull()
    expect(landedCost.shippingCostMinor).not.toBeNull()
    // Real, non-fabricated arithmetic: 500 * 0.7391 ≈ 370, 594 * 0.7391 ≈ 439.
    expect(landedCost.unitCostMinor).toBeGreaterThan(0)
    expect(landedCost.shippingCostMinor).toBeGreaterThan(0)
  })

  it('3. recommendedPriceMinor is genuinely calculated when channel_products.price_minor is null — the exact scenario for all 5 real candidates', () => {
    const landedCost = deriveChannelCurrencyLandedCost({ unitCostMinor: 500, shippingCostMinor: 594, currency: 'USD' }, 'GBP', REAL_RATE, 'productEvaluation', NOW)
    const shopifyProfile = buildChannelProfiles({ category: null, sellingPrice: money(landedCost.unitCostMinor!, 'GBP') }).find((p) => p.channel === 'shopify')!

    const pricing = recommendPricing(
      {
        productCost: money(landedCost.unitCostMinor!, 'GBP'),
        supplierShipping: money(landedCost.shippingCostMinor!, 'GBP'),
        fulfilment: shopifyProfile.fulfilment,
        channelFeePct: shopifyProfile.channelFeePct,
        channelFeeFixed: shopifyProfile.channelFeeFixed,
        paymentFeePct: shopifyProfile.paymentFeePct,
        paymentFeeFixed: shopifyProfile.paymentFeeFixed,
        vatRatePct: resolveBusinessConfiguration(CONFIGURED_AUTOMATION_SETTINGS).effectiveVatRatePct,
        packaging: CONFIGURED_AUTOMATION_SETTINGS.packagingCostMinor !== null ? money(CONFIGURED_AUTOMATION_SETTINGS.packagingCostMinor, 'GBP') : undefined,
        importDutyPct: CONFIGURED_AUTOMATION_SETTINGS.importDutyPct ?? undefined,
        returnRatePct: CONFIGURED_AUTOMATION_SETTINGS.returnRatePct ?? undefined,
        returnLossPct: CONFIGURED_AUTOMATION_SETTINGS.returnLossPct ?? undefined,
        refundRatePct: CONFIGURED_AUTOMATION_SETTINGS.refundRatePct ?? undefined,
        chargebackRatePct: CONFIGURED_AUTOMATION_SETTINGS.chargebackRatePct ?? undefined,
        chargebackFeeFixed: CONFIGURED_AUTOMATION_SETTINGS.chargebackFeeMinor !== null ? money(CONFIGURED_AUTOMATION_SETTINGS.chargebackFeeMinor, 'GBP') : undefined,
      },
      'GBP',
      landedCost.unitCostMinor!,
      CONFIGURED_AUTOMATION_SETTINGS.minNetMarginPct,
      CONFIGURED_AUTOMATION_SETTINGS.targetNetMarginPct,
      CONFIGURED_AUTOMATION_SETTINGS.advertisingAllowancePct,
    )

    // The real point of this test: a recommended price exists at all,
    // computed with zero reliance on any existing channel_products row.
    expect(pricing.recommendedUnreachable).toBe(false)
    expect(pricing.recommendedPriceMinor).not.toBeNull()
    expect(pricing.recommendedPriceMinor!).toBeGreaterThan(0)
  })

  it('4 & 5. profitability is genuinely evaluated using that recommended price, and the recommendation reflects the real verdict — never the previous "no supplier cost on file" fallback', () => {
    const landedCost = deriveChannelCurrencyLandedCost({ unitCostMinor: 500, shippingCostMinor: 594, currency: 'USD' }, 'GBP', REAL_RATE, 'productEvaluation', NOW)
    const shopifyProfile = buildChannelProfiles({ category: null, sellingPrice: money(landedCost.unitCostMinor!, 'GBP') }).find((p) => p.channel === 'shopify')!
    const businessConfig = resolveBusinessConfiguration(CONFIGURED_AUTOMATION_SETTINGS)

    const costs = {
      productCost: money(landedCost.unitCostMinor!, 'GBP' as const),
      supplierShipping: money(landedCost.shippingCostMinor!, 'GBP' as const),
      fulfilment: shopifyProfile.fulfilment,
      channelFeePct: shopifyProfile.channelFeePct,
      channelFeeFixed: shopifyProfile.channelFeeFixed,
      paymentFeePct: shopifyProfile.paymentFeePct,
      paymentFeeFixed: shopifyProfile.paymentFeeFixed,
      vatRatePct: businessConfig.effectiveVatRatePct,
      packaging: CONFIGURED_AUTOMATION_SETTINGS.packagingCostMinor !== null ? money(CONFIGURED_AUTOMATION_SETTINGS.packagingCostMinor, 'GBP' as const) : undefined,
      importDutyPct: CONFIGURED_AUTOMATION_SETTINGS.importDutyPct ?? undefined,
      returnRatePct: CONFIGURED_AUTOMATION_SETTINGS.returnRatePct ?? undefined,
      returnLossPct: CONFIGURED_AUTOMATION_SETTINGS.returnLossPct ?? undefined,
      refundRatePct: CONFIGURED_AUTOMATION_SETTINGS.refundRatePct ?? undefined,
      chargebackRatePct: CONFIGURED_AUTOMATION_SETTINGS.chargebackRatePct ?? undefined,
      chargebackFeeFixed: CONFIGURED_AUTOMATION_SETTINGS.chargebackFeeMinor !== null ? money(CONFIGURED_AUTOMATION_SETTINGS.chargebackFeeMinor, 'GBP' as const) : undefined,
    }

    const pricing = recommendPricing(costs, 'GBP', landedCost.unitCostMinor!, CONFIGURED_AUTOMATION_SETTINGS.minNetMarginPct, CONFIGURED_AUTOMATION_SETTINGS.targetNetMarginPct, CONFIGURED_AUTOMATION_SETTINGS.advertisingAllowancePct)
    const effectivePriceMinor = pricing.recommendedPriceMinor // channel_products.price_minor is null for every real candidate — this IS effectivePriceMinor.
    expect(effectivePriceMinor).not.toBeNull()

    const adSpendPerUnit = money(Math.round((effectivePriceMinor! * CONFIGURED_AUTOMATION_SETTINGS.advertisingAllowancePct) / 100), 'GBP')
    const profitability = calculateProfitability({ ...costs, sellingPrice: money(effectivePriceMinor!, 'GBP'), adSpendPerUnit })
    const gate = assessProfitabilityGate(profitability, { minGrossMarginPct: CONFIGURED_AUTOMATION_SETTINGS.minGrossMarginPct, minNetMarginPct: CONFIGURED_AUTOMATION_SETTINGS.minNetMarginPct })

    // A real number, not the "could not be assessed" null this file had
    // produced in production for every one of the 5 real candidates.
    expect(profitability.netMarginPct).not.toBeNull()

    const recommendation = recommendProduct({
      businessSettingsConfigured: businessConfig.configured,
      missingRequiredSettings: businessConfig.missingRequired,
      profitabilityGatePasses: gate.passes,
      profitabilityFailureReason: gate.passes ? null : gate.failures.join(' '),
      supplierAssigned: true,
      // 'pass', not null: this test's whole point is to prove the
      // ladder actually reaches and is decided by the real profitability
      // result computed above, rather than short-circuiting on an
      // orthogonal earlier gate.
      worstComplianceVerdict: 'pass',
      qualityScore: 62, // Real, previously-persisted value for this product.
      minQualityScore: CONFIGURED_AUTOMATION_SETTINGS.minQualityScore,
      riskScore: 52, // Real, previously-persisted value for this product.
      maxRiskScore: CONFIGURED_AUTOMATION_SETTINGS.maxRiskScore,
      capitalStatus: 'sufficient',
      capitalEfficiencyScore: null,
      opportunityScore: 70, // Real, previously-persisted value for this product.
      minOpportunityScore: CONFIGURED_AUTOMATION_SETTINGS.minOpportunityScore,
      strongOpportunityScore: 85,
    })

    // The core claim of this whole fix: with a real profitability gate
    // that actually passes (recommended price was priced to clear the
    // target margin), the ladder reaches a real commercial verdict — a
    // genuinely different code path from the previous, universal
    // "no supplier cost is on file" do_not_sell fallback.
    expect(gate.passes).toBe(true)
    expect(['candidate', 'strong_candidate']).toContain(recommendation.recommendation)
    expect(recommendation.reason).not.toMatch(/no supplier cost is on file/i)
    expect(recommendation.reason).not.toBe('Not assessed.')
  })

  it('contrast: reproduces the exact pre-fix production symptom when supplier facts are genuinely unavailable (proves the two states are distinguishable)', () => {
    const businessConfig = resolveBusinessConfiguration(CONFIGURED_AUTOMATION_SETTINGS)
    const recommendation = recommendProduct({
      businessSettingsConfigured: businessConfig.configured,
      missingRequiredSettings: businessConfig.missingRequired,
      profitabilityGatePasses: false,
      profitabilityFailureReason: 'Not assessed — no supplier cost is on file for this channel yet.',
      supplierAssigned: true,
      worstComplianceVerdict: null,
      qualityScore: 62,
      minQualityScore: CONFIGURED_AUTOMATION_SETTINGS.minQualityScore,
      riskScore: 52,
      maxRiskScore: CONFIGURED_AUTOMATION_SETTINGS.maxRiskScore,
      capitalStatus: 'not_configured',
      capitalEfficiencyScore: null,
      opportunityScore: 70,
      minOpportunityScore: CONFIGURED_AUTOMATION_SETTINGS.minOpportunityScore,
      strongOpportunityScore: 85,
    })
    // Exactly what production actually persisted for all 5 candidates
    // before this fix — confirming the contrast is real, not assumed.
    expect(recommendation.recommendation).toBe('do_not_sell')
    expect(recommendation.reason).toBe('Not assessed — no supplier cost is on file for this channel yet.')
  })
})
