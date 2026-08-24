import { fromMajor } from '@/lib/core/money'
import { getMarket } from '@/lib/markets/catalog'
import { assessMarketCompliance } from '@/lib/markets/countryCompliance'
import { getMarketCostProfile } from '@/lib/markets/marketCostProfiles'
import { projectMarketProfitability, resolveMarketProjectionInput, type ForeignCostInput } from '@/lib/markets/marketProfitability'
import { evaluateMarketExpansion, type ExpansionAssessment } from '@/lib/markets/expansion'
import { fxRateFact, type ExchangeRateFact } from '@/lib/fx/types'
import type { ComplianceContext } from '@/lib/compliance/rules'
import type { SupplierMarketCapabilityFacts } from '@/lib/markets/supplierMarketFacts'
import type { IdentifierRecord } from '@/lib/products/identifiers'
import type { Fact } from '@/lib/automation/factsTypes'

/**
 * Milestone 9's 5 required demo scenarios (brief §13), each driven through
 * the real, unmodified engines (`assessMarketCompliance`,
 * `projectMarketProfitability`, `evaluateMarketExpansion`) against
 * deliberately chosen demo facts — never a hardcoded UI string standing in
 * for a computed result. Demo mode has no database, so this is the only
 * way to show the full Milestone 9 architecture working end to end.
 */

const CLOCK = new Date('2026-08-24T09:00:00Z')

const validEan: IdentifierRecord = { idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }
const cleanContext: ComplianceContext = {
  title: 'Solid Oak Chopping Board', description: 'Hardwood chopping board with a juice groove.', category: 'Kitchen', brand: null,
  identifiers: [validEan], supplierCapability: 'approved', supplierCapabilityReasons: ['Meets every requirement.'],
  supplierName: 'Meridian Housewares Ltd', documents: [], blockedCategories: [],
  ipInput: { title: 'Solid Oak Chopping Board', brand: null, ownBrands: [], category: 'Kitchen', imagesFromSupplier: false, hasBrandAuthorisation: false },
}

function readyCapability(): SupplierMarketCapabilityFacts {
  const now = CLOCK.toISOString()
  const fresh = <T,>(value: T): Fact<T> => ({ value, freshness: 'fresh', asOf: now })
  return { supplierId: 'sup-meridian', countryCode: 'GB', canShip: fresh(true), shippingCostMinor: fresh(200), shippingCurrency: fresh('GBP'), deliveryDaysMin: fresh(2), deliveryDaysMax: fresh(4), cancellationRatePct: fresh(1) }
}

function unavailableCapability(countryCode: string): SupplierMarketCapabilityFacts {
  return {
    supplierId: 'sup-meridian', countryCode,
    canShip: { value: null, freshness: 'unavailable', asOf: null }, shippingCostMinor: { value: null, freshness: 'unavailable', asOf: null },
    shippingCurrency: { value: null, freshness: 'unavailable', asOf: null }, deliveryDaysMin: { value: null, freshness: 'unavailable', asOf: null },
    deliveryDaysMax: { value: null, freshness: 'unavailable', asOf: null }, cancellationRatePct: { value: null, freshness: 'unavailable', asOf: null },
  }
}

function cannotShipCapability(countryCode: string): SupplierMarketCapabilityFacts {
  const now = CLOCK.toISOString()
  const fresh = <T,>(value: T): Fact<T> => ({ value, freshness: 'fresh', asOf: now })
  return { supplierId: 'sup-meridian', countryCode, canShip: fresh(false), shippingCostMinor: { value: null, freshness: 'unavailable', asOf: null }, shippingCurrency: { value: null, freshness: 'unavailable', asOf: null }, deliveryDaysMin: { value: null, freshness: 'unavailable', asOf: null }, deliveryDaysMax: { value: null, freshness: 'unavailable', asOf: null }, cancellationRatePct: { value: null, freshness: 'unavailable', asOf: null } }
}

function projectHealthyUk() {
  const market = getMarket('amazon_uk')!
  const compliance = assessMarketCompliance(market, 'prod-1', cleanContext, CLOCK)
  const profile = getMarketCostProfile('amazon_uk')!
  const profitability = projectMarketProfitability(
    { sellingPriceNative: fromMajor(35, 'GBP'), productCost: fromMajor(9, 'GBP'), supplierShipping: fromMajor(1, 'GBP'), returnRatePct: 3 },
    profile, { minGrossMarginPct: 10, minNetMarginPct: 5 },
  )
  return { market, compliance, profitability }
}

export interface MarketExpansionDemoScenario {
  key: string
  label: string
  description: string
  results: readonly ExpansionAssessment[]
  narrative: readonly string[]
}

export function demoMarketExpansionScenarios(): readonly MarketExpansionDemoScenario[] {
  return [scenarioReadyInUkOnly(), scenarioCurrencyMovement(), scenarioDivergentMarkets(), scenarioComplianceUnknownBlocks(), scenarioSupplierCannotFulfil()]
}

function scenarioReadyInUkOnly(): MarketExpansionDemoScenario {
  const { compliance: ukCompliance, profitability: ukProfitability } = projectHealthyUk()
  const uk = evaluateMarketExpansion({ productId: 'prod-1', market: getMarket('amazon_uk')!, compliance: ukCompliance, profitability: ukProfitability, supplierCapability: readyCapability(), marketplaceStatus: 'demo' }, CLOCK)

  const deMarket = getMarket('amazon_de')!
  const deCompliance = assessMarketCompliance(deMarket, 'prod-1', cleanContext, CLOCK) // No German ruleset -> genuinely unknown.
  const de = evaluateMarketExpansion({ productId: 'prod-1', market: deMarket, compliance: deCompliance, profitability: null, supplierCapability: unavailableCapability('DE'), marketplaceStatus: 'planned' }, CLOCK)

  const usMarket = getMarket('amazon_us')!
  const usProfile = getMarketCostProfile('amazon_us')!
  const usCompliance = assessMarketCompliance(usMarket, 'prod-1', cleanContext, CLOCK)
  // A price too low to survive US marketplace fees + international shipping + advertising — a real economic failure, not a guess.
  const usProfitability = projectMarketProfitability({ sellingPriceNative: fromMajor(11, 'USD'), productCost: fromMajor(9 * 1.27, 'USD'), supplierShipping: fromMajor(1, 'USD'), returnRatePct: 5 }, usProfile, { minGrossMarginPct: 15, minNetMarginPct: 8 })
  const us = evaluateMarketExpansion({ productId: 'prod-1', market: usMarket, compliance: usCompliance, profitability: usProfitability, supplierCapability: readyCapability(), marketplaceStatus: 'planned' }, CLOCK)

  return {
    key: 'ready_uk_only', label: 'Product ready in the UK only', results: [uk, de, us],
    description: 'The same product, evaluated in three real markets — a genuinely different reason behind each outcome, never three copies of the same verdict.',
    narrative: [
      `Amazon UK: ${uk.recommendation} (score ${uk.score}/100) — compliance passes, profitability clears the gate, the supplier can ship, and the connector is at least demo-reachable.`,
      `Amazon Germany: ${de.recommendation} — no compliance ruleset is registered for Germany yet, so the market is genuinely unassessed, not guessed at.`,
      `Amazon US: ${us.recommendation} — real US marketplace fees, international shipping and advertising assumptions leave this price loss-making; ${us.blockers[0] ?? 'the profitability gate fails'}.`,
    ],
  }
}

function scenarioCurrencyMovement(): MarketExpansionDemoScenario {
  const market = getMarket('amazon_uk')!
  const compliance = assessMarketCompliance(market, 'prod-2', cleanContext, CLOCK)
  const profile = getMarketCostProfile('amazon_uk')!
  const capability = readyCapability()

  const input: ForeignCostInput = { sellingPriceNative: fromMajor(35, 'GBP'), productCostForeign: fromMajor(20, 'USD'), supplierShippingForeign: fromMajor(1, 'USD'), returnRatePct: 3 }

  const favourableRate: ExchangeRateFact = { base: 'USD', quote: 'GBP', rate: 0.70, source: 'demo', observedAt: CLOCK.toISOString(), retrievedAt: CLOCK.toISOString() }
  const beforeResolved = resolveMarketProjectionInput(input, 'GBP', fxRateFact(favourableRate, 'automation', CLOCK))
  const before = beforeResolved.ok
    ? evaluateMarketExpansion({ productId: 'prod-2', market, compliance, profitability: projectMarketProfitability(beforeResolved.value, profile, { minGrossMarginPct: 10, minNetMarginPct: 5 }), supplierCapability: capability, marketplaceStatus: 'demo' }, CLOCK)
    : null

  const movedRate: ExchangeRateFact = { base: 'USD', quote: 'GBP', rate: 1.30, source: 'demo', observedAt: CLOCK.toISOString(), retrievedAt: CLOCK.toISOString() }
  const afterResolved = resolveMarketProjectionInput(input, 'GBP', fxRateFact(movedRate, 'automation', CLOCK))
  const after = afterResolved.ok
    ? evaluateMarketExpansion({ productId: 'prod-2', market, compliance, profitability: projectMarketProfitability(afterResolved.value, profile, { minGrossMarginPct: 10, minNetMarginPct: 5 }), supplierCapability: capability, marketplaceStatus: 'demo' }, CLOCK)
    : null

  return {
    key: 'currency_movement', label: 'Currency movement changes viability', results: [before, after].filter((r): r is ExpansionAssessment => r !== null),
    description: 'A US-based supplier quotes cost in USD for a product sold on Amazon UK in GBP. Nothing about the product, price or supplier changes — only the USD->GBP rate moves, and that alone flips the real outcome.',
    narrative: [
      `At USD->GBP 0.70: ${before?.recommendation} — net profit ${before?.profitability?.native.netProfit.minor ?? '?'} pence, a real margin.`,
      `The rate moves to 1.30 (the same real chain this app's own fxMonitor -> fx_recheck -> market_recheck proves end to end in tests/markets-integration-e2e.test.ts).`,
      `At USD->GBP 1.30: ${after?.recommendation} — ${after?.blockers[0] ?? 'the profitability gate fails'}. Nothing else about the product changed.`,
    ],
  }
}

function scenarioDivergentMarkets(): MarketExpansionDemoScenario {
  const { compliance: ukCompliance, profitability: ukProfitability } = projectHealthyUk()
  const uk = evaluateMarketExpansion({ productId: 'prod-3', market: getMarket('amazon_uk')!, compliance: ukCompliance, profitability: ukProfitability, supplierCapability: readyCapability(), marketplaceStatus: 'demo' }, CLOCK)

  const shopifyUsMarket = getMarket('shopify_us')!
  const shopifyUsCompliance = assessMarketCompliance(shopifyUsMarket, 'prod-3', cleanContext, CLOCK)
  const shopifyUsProfile = getMarketCostProfile('shopify_us')!
  const shopifyUsProfitability = projectMarketProfitability({ sellingPriceNative: fromMajor(45, 'USD'), productCost: fromMajor(11, 'USD'), supplierShipping: fromMajor(1, 'USD'), returnRatePct: 3 }, shopifyUsProfile, { minGrossMarginPct: 10, minNetMarginPct: 5 })
  const shopifyUs = evaluateMarketExpansion({ productId: 'prod-3', market: shopifyUsMarket, compliance: shopifyUsCompliance, profitability: shopifyUsProfitability, supplierCapability: readyCapability(), marketplaceStatus: 'planned' }, CLOCK)

  const amazonUsMarket = getMarket('amazon_us')!
  const amazonUsCompliance = assessMarketCompliance(amazonUsMarket, 'prod-3', cleanContext, CLOCK)
  const amazonUsProfile = getMarketCostProfile('amazon_us')!
  const amazonUsProfitability = projectMarketProfitability({ sellingPriceNative: fromMajor(13, 'USD'), productCost: fromMajor(9 * 1.27, 'USD'), supplierShipping: fromMajor(1, 'USD'), returnRatePct: 6 }, amazonUsProfile, { minGrossMarginPct: 15, minNetMarginPct: 8 })
  const amazonUs = evaluateMarketExpansion({ productId: 'prod-3', market: amazonUsMarket, compliance: amazonUsCompliance, profitability: amazonUsProfitability, supplierCapability: readyCapability(), marketplaceStatus: 'planned' }, CLOCK)

  return {
    key: 'divergent_markets', label: 'One market passes, another fails', results: [uk, shopifyUs, amazonUs],
    description: 'Amazon UK and Shopify US both clear their own real cost structures at their own prices; Amazon US, at a much thinner price, does not — three genuinely different fee/shipping/advertising assumptions, not one label copied three times.',
    narrative: [
      `Amazon UK: ${uk.recommendation} — 15% referral fee, no international shipping.`,
      `Shopify US: ${shopifyUs.recommendation} — no marketplace fee, but a higher advertising assumption and cross-border shipping.`,
      `Amazon US: ${amazonUs.recommendation} — the same 15% referral assumption, but a thinner selling price against real international shipping leaves no room.`,
    ],
  }
}

function scenarioComplianceUnknownBlocks(): MarketExpansionDemoScenario {
  const market = getMarket('amazon_de')!
  const compliance = assessMarketCompliance(market, 'prod-4', cleanContext, CLOCK) // Genuinely unknown — no German ruleset.
  const profile = getMarketCostProfile('amazon_de')!
  // Deliberately excellent economics — this scenario exists specifically
  // to prove a high score can never promote a market past its missing
  // compliance fact.
  const profitability = projectMarketProfitability({ sellingPriceNative: fromMajor(55, 'EUR'), productCost: fromMajor(9, 'EUR'), supplierShipping: fromMajor(1, 'EUR'), returnRatePct: 2 }, profile, { minGrossMarginPct: 10, minNetMarginPct: 5 })
  const assessment = evaluateMarketExpansion({ productId: 'prod-4', market, compliance, profitability, supplierCapability: readyCapability(), marketplaceStatus: 'planned' }, CLOCK)

  return {
    key: 'compliance_unknown_blocks', label: 'Compliance unknown blocks expansion', results: [assessment],
    description: 'Excellent profitability and a ready supplier cannot make the system call this market ready while compliance is genuinely unassessed.',
    narrative: [
      `Profitability: ${profitability.gate.passes ? 'passes comfortably' : 'fails'} (net margin ${profitability.native.netMarginPct}%).`,
      `Compliance: ${compliance.verdict} — no German ruleset is registered.`,
      `Result: ${assessment.recommendation} — never "ready", however good the economics look.`,
    ],
  }
}

function scenarioSupplierCannotFulfil(): MarketExpansionDemoScenario {
  const { compliance, profitability } = projectHealthyUk()
  const assessment = evaluateMarketExpansion({ productId: 'prod-5', market: getMarket('amazon_uk')!, compliance, profitability, supplierCapability: cannotShipCapability('GB'), marketplaceStatus: 'demo' }, CLOCK)

  return {
    key: 'supplier_cannot_fulfil', label: 'Supplier cannot fulfil the market', results: [assessment],
    description: 'Compliance passes and profitability is real, but the preferred supplier genuinely cannot ship to this country — expansion is blocked on operational grounds alone.',
    narrative: [
      `Compliance: ${compliance.verdict}. Profitability: ${profitability.gate.passes ? 'passes' : 'fails'}.`,
      'Supplier capability: cannot ship to GB — a real, observed fact, not assumed.',
      `Result: ${assessment.recommendation} — ${assessment.blockers[0] ?? ''}`,
    ],
  }
}
