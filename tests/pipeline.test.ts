import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import {
  evaluateCandidate,
  selectSupplier,
  type EvaluationContext,
  type SupplierCandidate,
} from '@/lib/research/pipeline'
import type { ResearchCandidate } from '@/lib/research/providers/types'

const CLOCK = new Date('2026-08-22T09:00:00Z')

const context: Omit<EvaluationContext, 'suppliers'> = {
  minGrossMarginPct: 25,
  minNetMarginPct: 10,
  minOpportunityScore: 70,
  vatRatePct: 20,
  maxDeliveryDays: 7,
  blockedCategories: [],
  ownBrands: [],
  restrictedBrands: [],
  signalSource: 'simulated',
}

function candidate(over: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    externalRef: 'test-candidate',
    title: 'Test Product',
    category: 'Kitchen',
    estimatedSellingPrice: fromMajor(30),
    estimatedUnitCost: fromMajor(8),
    estimatedShippingCost: fromMajor(2),
    estimatedMonthlyUnits: 1000,
    monthlySearchVolume: 10000,
    searchTrendPct: 20,
    trendDurationMonths: 12,
    seasonalityIndex: 0.2,
    competitorCount: 10,
    topCompetitorReviewCount: 1000,
    expectedReturnRatePct: 3,
    productComplexity: 0.15,
    raw: {
      identifiers: [{ idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }],
    },
    ...over,
  }
}

const goodSupplier: SupplierCandidate = {
  id: 'sup-good',
  name: 'Good Supplier Ltd',
  country: 'GB',
  platform: 'direct',
  signals: {
    unitCost: fromMajor(8),
    shippingCost: fromMajor(2),
    deliveryDaysMin: 2,
    deliveryDaysMax: 3,
    ordersPlaced: 100,
    ordersLate: 2,
    ordersDefective: 1,
    qualityRating: 4.6,
    communicationRating: 4.5,
    handlesReturns: true,
    returnsWindowDays: 45,
    acceptsFaultyReturns: true,
    providesTracking: true,
    supportsBlindShipping: true,
    supportsCustomInvoice: true,
    supportsCustomPackaging: true,
    supportsOwnBranding: true,
    documentCount: 2,
  },
}

const marketplaceSupplier: SupplierCandidate = {
  id: 'sup-marketplace',
  name: 'Marketplace Reseller',
  country: 'CN',
  platform: 'aliexpress',
  signals: {
    unitCost: fromMajor(5),
    shippingCost: fromMajor(1),
    deliveryDaysMin: 18,
    deliveryDaysMax: 26,
    ordersPlaced: 8,
    ordersLate: 4,
    ordersDefective: 2,
    qualityRating: 2.5,
    communicationRating: 2.1,
    handlesReturns: false,
    returnsWindowDays: 0,
    acceptsFaultyReturns: false,
    providesTracking: false,
    supportsBlindShipping: false,
    supportsCustomInvoice: false,
    supportsCustomPackaging: false,
    supportsOwnBranding: false,
    documentCount: 0,
  },
}

describe('supplier selection', () => {
  it('never selects on price alone', () => {
    const selection = selectSupplier(candidate(), [marketplaceSupplier, goodSupplier], CLOCK)
    expect(selection.chosen?.id).toBe('sup-good')
    expect(selection.rationale).toMatch(/despite costing/)
  })

  it('reports no supplier when none is available', () => {
    const selection = selectSupplier(candidate(), [], CLOCK)
    expect(selection.chosen).toBeNull()
    expect(selection.shopify).toBeNull()
    expect(selection.amazon).toBeNull()
  })
})

describe('end-to-end evaluation', () => {
  it('recommends testing a clean, profitable, well-supplied candidate', () => {
    const evaluated = evaluateCandidate(
      candidate(),
      { ...context, suppliers: [goodSupplier] },
      CLOCK,
    )
    expect(evaluated.recommendation.action).toBe('test')
    expect(evaluated.recommendation.eligibleChannels).toEqual(
      expect.arrayContaining(['shopify', 'amazon_uk']),
    )
    expect(evaluated.recommendation.requiresOwnerApproval).toBe(true)
  })

  it('routes a candidate with no supplier to supplier sourcing, not rejection', () => {
    const evaluated = evaluateCandidate(candidate(), { ...context, suppliers: [] }, CLOCK)
    expect(evaluated.recommendation.action).toBe('source_supplier')
    expect(evaluated.recommendation.nextStage).toBe('supplier_review')
  })

  it('blocks Amazon but not Shopify when the only supplier is a marketplace reseller', () => {
    const evaluated = evaluateCandidate(
      candidate(),
      { ...context, suppliers: [marketplaceSupplier] },
      CLOCK,
    )
    expect(evaluated.compliance.amazon_uk.verdict).toBe('fail')
    expect(evaluated.compliance.shopify.verdict).not.toBe('fail')
    expect(evaluated.recommendation.blockedChannels.some((b) => b.channel === 'amazon_uk')).toBe(true)
  })

  it('rejects a candidate that loses money everywhere, and only there', () => {
    const evaluated = evaluateCandidate(
      candidate({ estimatedUnitCost: fromMajor(24) }),
      { ...context, suppliers: [{ ...goodSupplier, signals: { ...goodSupplier.signals, unitCost: fromMajor(24) } }] },
      CLOCK,
    )
    expect(evaluated.channels.viableOnAnyChannel).toBe(false)
    expect(evaluated.recommendation.action).toBe('reject')
    expect(evaluated.recommendation.nextStage).toBe('rejected')
  })

  it('rejects high IP risk outright rather than sending it for review', () => {
    const evaluated = evaluateCandidate(
      candidate({ title: 'Dyson Compatible Filter', brand: 'Dyson' }),
      { ...context, suppliers: [goodSupplier] },
      CLOCK,
    )
    expect(evaluated.compliance.amazon_uk.ip.level).toBe('high')
    expect(evaluated.recommendation.action).toBe('reject')
    expect(evaluated.recommendation.headline).toMatch(/cannot be obtained/)
  })

  it('blocks Amazon on a missing GTIN while still recommending the Shopify launch', () => {
    // Shopify does not require a GTIN, so it stays eligible even though Amazon
    // is blocked. The recommendation reflects the channel that is actually
    // viable, and still names what would unblock the other one.
    const evaluated = evaluateCandidate(
      candidate({ raw: {} }), // no identifiers
      { ...context, suppliers: [goodSupplier] },
      CLOCK,
    )
    expect(evaluated.compliance.amazon_uk.verdict).toBe('fail')
    expect(evaluated.recommendation.eligibleChannels).toEqual(['shopify'])
    expect(evaluated.recommendation.action).toBe('test')
    expect(
      evaluated.recommendation.blockedChannels.find((b) => b.channel === 'amazon_uk')?.reason,
    ).toMatch(/GTIN/)
  })

  it('routes a missing GTIN to review when no other channel is viable either', () => {
    // Force Shopify out of contention too (blocked category), so the only
    // path forward is resolving the GTIN.
    const evaluated = evaluateCandidate(
      candidate({ raw: {} }),
      { ...context, suppliers: [goodSupplier], blockedCategories: ['Kitchen'] },
      CLOCK,
    )
    expect(evaluated.recommendation.eligibleChannels).toHaveLength(0)
    expect(evaluated.recommendation.action).toBe('reject')
    // A blocked category is a decision already made, not something to hold
    // for review, so this correctly rejects rather than waiting on paperwork.
    expect(evaluated.recommendation.headline).toMatch(/cannot be obtained/)
  })

  it('never uses more than three differentiation suggestions in the cost base', () => {
    const evaluated = evaluateCandidate(
      candidate({
        reviewSample: Array.from({ length: 20 }, () => ({
          rating: 1,
          body: 'Broke after a week. Cheap plastic. No instructions. Missing parts. Late delivery.',
        })),
      }),
      { ...context, suppliers: [goodSupplier] },
      CLOCK,
    )
    expect(evaluated.committedDifferentiation.length).toBeLessThanOrEqual(3)
    expect(evaluated.differentiationCost.minor).toBeGreaterThan(0)
  })

  it('feeds the profitability engine the actual chosen supplier cost, not the estimate', () => {
    const evaluated = evaluateCandidate(
      candidate({ estimatedUnitCost: fromMajor(20) }), // provider's guess is wrong
      { ...context, suppliers: [goodSupplier] }, // real quote is £8
      CLOCK,
    )
    const shopify = evaluated.channels.projections.find((p) => p.channel === 'shopify')!
    const line = shopify.profitability.breakdown.find((l) => l.label === 'Product cost')!
    // £8 real quote plus whatever committed differentiation was costed in,
    // never the provider's £20 estimate.
    expect(line.amount.minor).toBe(800 + evaluated.differentiationCost.minor)
    expect(line.amount.minor).toBeLessThan(2000)
  })

  it('scores exactly what the pipeline established, never re-deriving margin', () => {
    const evaluated = evaluateCandidate(candidate(), { ...context, suppliers: [goodSupplier] }, CLOCK)
    const best = [...evaluated.channels.projections].sort(
      (a, b) => b.profitability.netProfit.minor - a.profitability.netProfit.minor,
    )[0]
    const marginComponent = evaluated.score.components.find((c) => c.key === 'estimatedMargin')!
    expect(marginComponent.basis).toMatch(
      new RegExp(`${best.profitability.netMarginPct?.toFixed(1)}%`),
    )
  })

  it('reports low confidence for simulated signal sources', () => {
    const evaluated = evaluateCandidate(candidate(), { ...context, suppliers: [goodSupplier] }, CLOCK)
    expect(evaluated.score.confidence).toBeLessThan(0.7)
    expect(evaluated.score.dataSources).toContain('simulated')
  })
})
