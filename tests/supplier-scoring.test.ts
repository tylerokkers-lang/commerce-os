import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import {
  SUPPLIER_WEIGHTS,
  assessAmazonCapability,
  assessShopifyCapability,
  rankSuppliers,
  scoreSupplier,
  type SupplierSignals,
} from '@/lib/suppliers/scoring'

const CLOCK = new Date('2026-08-22T09:00:00Z')

/** A good UK supplier with real history. */
const excellent: SupplierSignals = {
  unitCost: fromMajor(9),
  shippingCost: fromMajor(2),
  bestAvailableUnitCost: fromMajor(9),
  deliveryDaysMin: 2,
  deliveryDaysMax: 3,
  ordersPlaced: 200,
  ordersLate: 6,
  ordersDefective: 2,
  qualityRating: 4.7,
  communicationRating: 4.6,
  handlesReturns: true,
  returnsWindowDays: 60,
  acceptsFaultyReturns: true,
  providesTracking: true,
  supportsBlindShipping: true,
  supportsCustomInvoice: true,
  supportsCustomPackaging: true,
  supportsOwnBranding: true,
  documentCount: 3,
}

/** Cheapest on paper and unusable in practice. */
const cheapAndSlow: SupplierSignals = {
  unitCost: fromMajor(5),
  shippingCost: fromMajor(1),
  bestAvailableUnitCost: fromMajor(5),
  deliveryDaysMin: 18,
  deliveryDaysMax: 26,
  ordersPlaced: 12,
  ordersLate: 6,
  ordersDefective: 3,
  qualityRating: 2.6,
  communicationRating: 2.2,
  handlesReturns: false,
  returnsWindowDays: 0,
  acceptsFaultyReturns: false,
  providesTracking: false,
  supportsBlindShipping: false,
  supportsCustomInvoice: false,
  supportsCustomPackaging: false,
  supportsOwnBranding: false,
  documentCount: 0,
}

describe('supplier scoring', () => {
  it('weights sum to 100', () => {
    expect(Object.values(SUPPLIER_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('weights delivery and reliability above cost, together', () => {
    const cost = SUPPLIER_WEIGHTS.cost
    expect(SUPPLIER_WEIGHTS.delivery + SUPPLIER_WEIGHTS.reliability).toBeGreaterThan(cost * 2)
  })

  it('scores a reliable supplier well', () => {
    const score = scoreSupplier(excellent, CLOCK)
    expect(score.total).toBeGreaterThanOrEqual(80)
    expect(score.band).toBe('preferred')
  })

  it('scores a cheap, slow, untracked supplier as unsuitable', () => {
    const score = scoreSupplier(cheapAndSlow, CLOCK)
    expect(score.total).toBeLessThan(40)
    expect(score.band).toBe('unsuitable')
  })

  it('never picks the cheapest supplier on price alone', () => {
    const ranked = rankSuppliers(
      [
        { supplier: { id: 'cheap' }, signals: cheapAndSlow },
        { supplier: { id: 'good' }, signals: excellent },
      ],
      CLOCK,
    )
    expect(ranked[0].supplier.id).toBe('good')
    // And it says so, rather than quietly dropping the cheaper option.
    expect(ranked.find((r) => r.supplier.id === 'cheap')?.cheaperButNotRecommended).toBe(true)
  })

  it('treats a supplier with no order history as unproven, not reliable', () => {
    const unproven = scoreSupplier({ ...excellent, ordersPlaced: 0, ordersLate: 0 }, CLOCK)
    const proven = scoreSupplier(excellent, CLOCK)

    const component = unproven.components.find((c) => c.key === 'reliability')!
    expect(component.score).toBeNull()
    expect(component.basis).toMatch(/unproven, not reliable/)
    expect(unproven.confidence).toBeLessThan(proven.confidence)
  })

  it('scores cost relative to the best available, not in absolute terms', () => {
    const atParity = scoreSupplier({ ...excellent, bestAvailableUnitCost: fromMajor(11) }, CLOCK)
    const expensive = scoreSupplier({ ...excellent, bestAvailableUnitCost: fromMajor(5.5) }, CLOCK)

    const parityCost = atParity.components.find((c) => c.key === 'cost')!
    const expensiveCost = expensive.components.find((c) => c.key === 'cost')!
    expect(parityCost.score!).toBeGreaterThan(expensiveCost.score!)
  })

  it('declines to score cost when there is nothing to compare against', () => {
    const noComparison = { ...excellent }
    delete (noComparison as Partial<SupplierSignals>).bestAvailableUnitCost
    const score = scoreSupplier(noComparison as SupplierSignals, CLOCK)
    const cost = score.components.find((c) => c.key === 'cost')!
    expect(cost.score).toBeNull()
    expect(cost.basis).toMatch(/No competing quote/)
  })

  it('accepts a product-agnostic cost premium as an alternative', () => {
    const base = { ...excellent }
    delete (base as Partial<SupplierSignals>).bestAvailableUnitCost
    const cheapest = scoreSupplier({ ...base, costPremiumRatio: 1 } as SupplierSignals, CLOCK)
    const pricey = scoreSupplier({ ...base, costPremiumRatio: 1.8 } as SupplierSignals, CLOCK)
    expect(cheapest.total).toBeGreaterThan(pricey.total)
  })

  it('stamps the weights version', () => {
    expect(scoreSupplier(excellent, CLOCK).weightsVersion).toBe('supplier-weights@1')
  })
})

describe('Shopify capability', () => {
  it('approves a supplier that delivers, tracks and handles returns', () => {
    expect(assessShopifyCapability(excellent).status).toBe('approved')
  })

  it('asks for review when there is no tracking or returns handling', () => {
    const result = assessShopifyCapability({ ...excellent, providesTracking: false })
    expect(result.status).toBe('review_required')
    expect(result.reasons.join(' ')).toMatch(/No tracking/)
  })

  it('blocks a delivery promise beyond 30 days', () => {
    const result = assessShopifyCapability({ ...excellent, deliveryDaysMax: 45 })
    expect(result.status).toBe('blocked')
  })

  it('tolerates slower delivery than Amazon does', () => {
    // 20 days is a caution on Shopify and a hard block on Amazon.
    expect(assessShopifyCapability({ ...excellent, deliveryDaysMax: 20 }).status).toBe('review_required')
    expect(assessAmazonCapability({ ...excellent, deliveryDaysMax: 20 }).status).toBe('blocked')
  })
})

describe('Amazon capability', () => {
  it('approves only a supplier that meets every requirement', () => {
    expect(assessAmazonCapability(excellent).status).toBe('approved')
  })

  it('blocks a supplier that cannot make us the seller of record', () => {
    const result = assessAmazonCapability({ ...excellent, supportsCustomInvoice: false })
    expect(result.status).toBe('blocked')
    expect(result.reasons.join(' ')).toMatch(/seller of record/)
  })

  it('blocks a supplier that will not ship blind', () => {
    const result = assessAmazonCapability({ ...excellent, supportsBlindShipping: false })
    expect(result.status).toBe('blocked')
    expect(result.reasons.join(' ')).toMatch(/another retailer/)
  })

  it('blocks a supplier that will not handle returns', () => {
    const result = assessAmazonCapability({ ...excellent, handlesReturns: false })
    expect(result.status).toBe('blocked')
    expect(result.reasons.join(' ')).toMatch(/returns/)
  })

  it('blocks a supplier with no tracking', () => {
    expect(assessAmazonCapability({ ...excellent, providesTracking: false }).status).toBe('blocked')
  })

  it('names every failed requirement, not just the first', () => {
    const result = assessAmazonCapability(cheapAndSlow)
    expect(result.status).toBe('blocked')
    expect(result.reasons.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps a typical marketplace dropship supplier blocked for Amazon while allowing Shopify review', () => {
    // The AliExpress case the brief calls out explicitly.
    expect(assessAmazonCapability(cheapAndSlow).status).toBe('blocked')
    expect(assessShopifyCapability(cheapAndSlow).status).toBe('review_required')
  })

  it('the two channel assessments are genuinely independent', () => {
    const shopifyOnly: SupplierSignals = {
      ...excellent,
      supportsCustomInvoice: false, // fatal for Amazon, irrelevant to Shopify
    }
    expect(assessShopifyCapability(shopifyOnly).status).toBe('approved')
    expect(assessAmazonCapability(shopifyOnly).status).toBe('blocked')
  })
})
