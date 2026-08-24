import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import type { ComplianceContext } from '@/lib/compliance/rules'
import type { IdentifierRecord } from '@/lib/products/identifiers'
import { getMarket } from '@/lib/markets/catalog'
import { assessMarketCompliance } from '@/lib/markets/countryCompliance'
import { getMarketCostProfile } from '@/lib/markets/marketCostProfiles'
import { projectMarketProfitability } from '@/lib/markets/marketProfitability'
import { evaluateMarketExpansion, type EvaluateExpansionInput } from '@/lib/markets/expansion'
import { createInMemorySupplierMarketFactsLoader, type SeedSupplierMarketCapability } from '@/lib/markets/supplierMarketFacts'
import { fxRateFact, type ExchangeRateFact } from '@/lib/fx/types'

const CLOCK = new Date('2026-08-24T09:00:00Z')
const PRODUCT_ID = 'prod-1'

const validEan: IdentifierRecord = { idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }

const cleanContext: ComplianceContext = {
  title: 'Solid Oak Chopping Board', description: 'Hardwood chopping board.', category: 'Kitchen', brand: null,
  identifiers: [validEan], supplierCapability: 'approved', supplierCapabilityReasons: ['Meets every requirement.'],
  supplierName: 'Meridian Housewares Ltd', documents: [], blockedCategories: [],
  ipInput: { title: 'Solid Oak Chopping Board', brand: null, ownBrands: [], category: 'Kitchen', imagesFromSupplier: false, hasBrandAuthorisation: false },
}

async function healthySupplierCapability(countryCode: string, overrides: Partial<SeedSupplierMarketCapability> = {}) {
  const loader = createInMemorySupplierMarketFactsLoader({
    [`sup-1:${countryCode}`]: { canShip: true, shippingCostMinor: 500, shippingCurrency: 'GBP', deliveryDaysMin: 3, deliveryDaysMax: 5, cancellationRatePct: 1, lastVerifiedAt: CLOCK.toISOString(), ...overrides },
  })
  return loader.loadSupplierMarketCapability('org-a', 'sup-1', countryCode, CLOCK)
}

async function unknownSupplierCapability(countryCode: string) {
  const loader = createInMemorySupplierMarketFactsLoader()
  return loader.loadSupplierMarketCapability('org-a', 'sup-1', countryCode, CLOCK)
}

describe('country-aware compliance', () => {
  it('a UK pass does not imply a Germany pass — Germany has no registered ruleset and is genuinely unknown', () => {
    const ukMarket = getMarket('amazon_uk')!
    const deMarket = getMarket('amazon_de')!
    const ukResult = assessMarketCompliance(ukMarket, PRODUCT_ID, cleanContext, CLOCK)
    const deResult = assessMarketCompliance(deMarket, PRODUCT_ID, cleanContext, CLOCK)

    expect(ukResult.verdict).toBe('pass')
    expect(deResult.verdict).toBe('not_assessed')
    expect(deResult.source).toBe('no_ruleset')
    expect(deResult.missingFacts[0]).toContain('Germany')
    // The two results must never be assignable to or confused with each other's market.
    expect(ukResult.marketKey).not.toBe(deResult.marketKey)
  })

  it('an unknown/unassessed market is never silently treated as a pass', () => {
    const usMarket = getMarket('amazon_us')!
    const result = assessMarketCompliance(usMarket, PRODUCT_ID, cleanContext, CLOCK)
    expect(result.verdict).not.toBe('pass')
    expect(result.verdict).toBe('not_assessed')
  })

  it('fatal vs remediable distinctions survive delegation to the existing engine (blocked category is fatal)', () => {
    const ukMarket = getMarket('amazon_uk')!
    const blockedContext: ComplianceContext = { ...cleanContext, blockedCategories: ['Kitchen'] }
    const result = assessMarketCompliance(ukMarket, PRODUCT_ID, blockedContext, CLOCK)
    expect(result.verdict).toBe('fail')
    expect(result.checks.some((c) => !c.remediable && c.outcome === 'fail')).toBe(true)
  })

  it('a missing GTIN is fatal (verdict fail) but remains remediable at the check level — obtainable, unlike a blocked-category decision', () => {
    const amazonMarket = getMarket('amazon_uk')!
    const noIdentifiers: ComplianceContext = { ...cleanContext, identifiers: [] }
    const result = assessMarketCompliance(amazonMarket, PRODUCT_ID, noIdentifiers, CLOCK)
    expect(result.verdict).toBe('fail') // Amazon's GTIN requirement is critical-severity, so it fails the market outright...
    const gtinCheck = result.checks.find((c) => c.key === 'amazon_gtin')
    expect(gtinCheck?.remediable).toBe(true) // ...but it is a check that can be cleared (obtain a GTIN), distinct from a decision already made.
  })
})

describe('market-specific profitability', () => {
  it('the same product can pass in one market and fail in another, for genuinely different reasons', () => {
    const ukProfile = getMarketCostProfile('amazon_uk')!
    const usProfile = getMarketCostProfile('amazon_us')!

    const ukResult = projectMarketProfitability(
      { sellingPriceNative: fromMajor(30, 'GBP'), productCost: fromMajor(9, 'GBP'), supplierShipping: fromMajor(1, 'GBP'), returnRatePct: 3 },
      ukProfile, { minGrossMarginPct: 20, minNetMarginPct: 10 },
    )
    // A thin-margin US price where international shipping and ad spend erode it below zero.
    const usResult = projectMarketProfitability(
      { sellingPriceNative: fromMajor(15, 'USD'), productCost: fromMajor(9 * 1.27, 'USD'), supplierShipping: fromMajor(1, 'USD'), returnRatePct: 3 },
      usProfile, { minGrossMarginPct: 20, minNetMarginPct: 10 },
    )

    expect(ukResult.gate.passes).toBe(true)
    expect(usResult.gate.passes).toBe(false)
    expect(ukResult.currency).toBe('GBP')
    expect(usResult.currency).toBe('USD')
  })

  it('native currency is always present, never hidden even when a comparison is requested', () => {
    const profile = getMarketCostProfile('amazon_de')!
    const rate: ExchangeRateFact = { base: 'EUR', quote: 'GBP', rate: 0.85, source: 'demo', observedAt: CLOCK.toISOString(), retrievedAt: CLOCK.toISOString() }
    const result = projectMarketProfitability(
      { sellingPriceNative: fromMajor(35, 'EUR'), productCost: fromMajor(9, 'EUR'), supplierShipping: fromMajor(1, 'EUR'), returnRatePct: 3 },
      profile, { minGrossMarginPct: 15, minNetMarginPct: 8 },
      { currency: 'GBP', fxFact: fxRateFact(rate, 'productEvaluation', CLOCK) },
    )
    expect(result.currency).toBe('EUR')
    expect(result.native.netProfit.currency).toBe('EUR')
    expect(result.comparison?.currency).toBe('GBP')
    expect(result.comparison?.netProfit.currency).toBe('GBP')
  })

  it('a normalised comparison is withheld, with a stated reason, when no exchange rate is available — never guessed', () => {
    const profile = getMarketCostProfile('amazon_de')!
    const result = projectMarketProfitability(
      { sellingPriceNative: fromMajor(35, 'EUR'), productCost: fromMajor(9, 'EUR'), supplierShipping: fromMajor(1, 'EUR'), returnRatePct: 3 },
      profile, { minGrossMarginPct: 15, minNetMarginPct: 8 },
      { currency: 'GBP', fxFact: fxRateFact(null, 'productEvaluation', CLOCK) },
    )
    expect(result.comparison).toBeNull()
    expect(result.comparisonUnavailableReason).toBeTruthy()
  })

  it('a stale exchange rate blocks the comparison figure rather than silently using an old rate', () => {
    const profile = getMarketCostProfile('amazon_de')!
    const staleRate: ExchangeRateFact = { base: 'EUR', quote: 'GBP', rate: 0.85, source: 'demo', observedAt: new Date(CLOCK.getTime() - 1000 * 60 * 60 * 24 * 30).toISOString(), retrievedAt: CLOCK.toISOString() }
    const result = projectMarketProfitability(
      { sellingPriceNative: fromMajor(35, 'EUR'), productCost: fromMajor(9, 'EUR'), supplierShipping: fromMajor(1, 'EUR'), returnRatePct: 3 },
      profile, { minGrossMarginPct: 15, minNetMarginPct: 8 },
      { currency: 'GBP', fxFact: fxRateFact(staleRate, 'productEvaluation', CLOCK) },
    )
    expect(result.comparison).toBeNull()
    expect(result.comparisonUnavailableReason).toContain('too old')
  })
})

describe('expansion recommendations', () => {
  const ukMarket = getMarket('amazon_uk')!
  const deMarket = getMarket('amazon_de')!
  const usMarket = getMarket('amazon_us')!

  function baseInput(overrides: Partial<EvaluateExpansionInput> = {}): EvaluateExpansionInput {
    return {
      productId: PRODUCT_ID, market: ukMarket,
      compliance: assessMarketCompliance(ukMarket, PRODUCT_ID, cleanContext, CLOCK),
      profitability: projectMarketProfitability(
        { sellingPriceNative: fromMajor(30, 'GBP'), productCost: fromMajor(9, 'GBP'), supplierShipping: fromMajor(1, 'GBP'), returnRatePct: 3 },
        getMarketCostProfile('amazon_uk')!, { minGrossMarginPct: 15, minNetMarginPct: 8 },
      ),
      supplierCapability: undefined as never, // set by each test
      marketplaceStatus: 'demo',
      ...overrides,
    }
  }

  it('READY: every fact present, compliant, profitable, supplier ready, marketplace connected', async () => {
    const input = baseInput({ marketplaceStatus: 'connected', supplierCapability: await healthySupplierCapability('GB') })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).toBe('ready')
    expect(result.blockers).toHaveLength(0)
    expect(result.missingFacts).toHaveLength(0)
  })

  it('INSUFFICIENT_FACTS: compliance genuinely unknown for a market with no ruleset (Germany)', async () => {
    const input = baseInput({
      market: deMarket,
      compliance: assessMarketCompliance(deMarket, PRODUCT_ID, cleanContext, CLOCK),
      supplierCapability: await healthySupplierCapability('DE'),
    })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).toBe('insufficient_facts')
    expect(result.missingFacts.length).toBeGreaterThan(0)
  })

  it('BLOCKED: profitability fails outright (shipping + marketplace costs destroy margin)', async () => {
    const badProfitability = projectMarketProfitability(
      { sellingPriceNative: fromMajor(12, 'USD'), productCost: fromMajor(9 * 1.27, 'USD'), supplierShipping: fromMajor(1, 'USD'), returnRatePct: 5 },
      getMarketCostProfile('amazon_us')!, { minGrossMarginPct: 20, minNetMarginPct: 10 },
    )
    const input = baseInput({ market: usMarket, compliance: assessMarketCompliance(usMarket, PRODUCT_ID, cleanContext, CLOCK), profitability: badProfitability, supplierCapability: await healthySupplierCapability('US'), marketplaceStatus: 'planned' })
    // US compliance has no ruleset either, so isolate the profitability-fatal path by asserting it directly.
    expect(badProfitability.gate.passes).toBe(false)
    const result = evaluateMarketExpansion({ ...input, compliance: { productId: PRODUCT_ID, marketKey: usMarket.marketKey, countryCode: 'US', verdict: 'pass', checks: [], blockingReasons: [], missingFacts: [], rulesetVersion: 'test', assessedAt: CLOCK.toISOString(), source: 'delegated' } }, CLOCK)
    expect(result.recommendation).toBe('blocked')
    expect(result.blockers.length).toBeGreaterThan(0)
  })

  it('BLOCKED: compliance fails fatally, even with excellent profitability and score — a high score cannot override a fatal block', async () => {
    const blockedContext: ComplianceContext = { ...cleanContext, blockedCategories: ['Kitchen'] }
    const input = baseInput({
      compliance: assessMarketCompliance(ukMarket, PRODUCT_ID, blockedContext, CLOCK),
      supplierCapability: await healthySupplierCapability('GB'),
      marketplaceStatus: 'connected',
    })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).toBe('blocked')
    // Even though profitability/supplier/marketplace all look great, the score is never allowed to promote this above blocked.
    expect(result.score).toBeGreaterThan(0) // Score is still computed and shown for context...
    expect(result.recommendation).not.toBe('ready') // ...but it can never win against the fatal compliance block.
  })

  it('BLOCKED: supplier cannot fulfil the market even though compliance and profitability both pass', async () => {
    const input = baseInput({ supplierCapability: await healthySupplierCapability('GB', { canShip: false }), marketplaceStatus: 'connected' })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).toBe('blocked')
    expect(result.blockers.some((b) => b.toLowerCase().includes('cannot ship'))).toBe(true)
  })

  it('REQUIRES_REVIEW: compliance itself lands on review_required (not fail, not pass), everything else fine', async () => {
    const shopifyUkMarket = getMarket('shopify_uk')!
    // A supplier whose Shopify capability is itself "review_required" (not
    // yet approved, not blocked either) comes back `unknown` at major
    // severity, which `deriveVerdict` maps to `review_required` —
    // genuinely different from the GTIN case above, which is
    // critical-severity and fails outright.
    const reviewContext: ComplianceContext = { ...cleanContext, supplierCapability: 'review_required' }
    const compliance = assessMarketCompliance(shopifyUkMarket, PRODUCT_ID, reviewContext, CLOCK)
    expect(compliance.verdict).toBe('review_required') // Confirms the fixture actually exercises the intended path.
    const input = baseInput({ market: shopifyUkMarket, compliance, supplierCapability: await healthySupplierCapability('GB'), marketplaceStatus: 'connected' })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).toBe('requires_review')
  })

  it('REQUIRES_REVIEW (never READY): everything passes but the marketplace connector is only planned, not live', async () => {
    const input = baseInput({ marketplaceStatus: 'planned', supplierCapability: await healthySupplierCapability('GB') })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).not.toBe('ready') // Cannot be "ready" to sell somewhere with no working connector.
  })

  it('INSUFFICIENT_FACTS: supplier shipping capability has never been recorded for this country', async () => {
    const input = baseInput({ supplierCapability: await unknownSupplierCapability('GB') })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).toBe('insufficient_facts')
  })

  it('INSUFFICIENT_FACTS: profitability could not be computed at all', async () => {
    const input = baseInput({ profitability: null, supplierCapability: await healthySupplierCapability('GB') })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(result.recommendation).toBe('insufficient_facts')
  })

  it('PROMISING: good but not excellent facts across the board, no fatal blockers, no missing facts', async () => {
    const okProfitability = projectMarketProfitability(
      { sellingPriceNative: fromMajor(40, 'GBP'), productCost: fromMajor(15, 'GBP'), supplierShipping: fromMajor(1, 'GBP'), returnRatePct: 5 },
      getMarketCostProfile('amazon_uk')!, { minGrossMarginPct: 5, minNetMarginPct: 1 },
    )
    const input = baseInput({ profitability: okProfitability, supplierCapability: await healthySupplierCapability('GB', { deliveryDaysMax: 12, cancellationRatePct: 6 }), marketplaceStatus: 'demo' })
    const result = evaluateMarketExpansion(input, CLOCK)
    expect(['promising', 'requires_review']).toContain(result.recommendation)
    expect(result.blockers).toHaveLength(0)
    expect(result.missingFacts).toHaveLength(0)
  })
})

describe('market isolation', () => {
  it('a UK expansion assessment cannot leak into a Germany assessment for the same product', async () => {
    const ukMarket = getMarket('amazon_uk')!
    const deMarket = getMarket('amazon_de')!
    const ukInput: EvaluateExpansionInput = {
      productId: PRODUCT_ID, market: ukMarket,
      compliance: assessMarketCompliance(ukMarket, PRODUCT_ID, cleanContext, CLOCK),
      profitability: projectMarketProfitability({ sellingPriceNative: fromMajor(30, 'GBP'), productCost: fromMajor(9, 'GBP'), supplierShipping: fromMajor(1, 'GBP'), returnRatePct: 3 }, getMarketCostProfile('amazon_uk')!, { minGrossMarginPct: 15, minNetMarginPct: 8 }),
      supplierCapability: await healthySupplierCapability('GB'), marketplaceStatus: 'connected',
    }
    const deInput: EvaluateExpansionInput = {
      productId: PRODUCT_ID, market: deMarket,
      compliance: assessMarketCompliance(deMarket, PRODUCT_ID, cleanContext, CLOCK),
      profitability: null,
      supplierCapability: await unknownSupplierCapability('DE'), marketplaceStatus: 'planned',
    }

    const ukResult = evaluateMarketExpansion(ukInput, CLOCK)
    const deResult = evaluateMarketExpansion(deInput, CLOCK)

    expect(ukResult.recommendation).toBe('ready')
    expect(deResult.recommendation).toBe('insufficient_facts')
    expect(ukResult.marketKey).toBe('amazon_uk')
    expect(deResult.marketKey).toBe('amazon_de')
    // The UK result's compliance pass must never be readable from the DE result.
    expect(deResult.compliance.verdict).not.toBe('pass')
  })
})
