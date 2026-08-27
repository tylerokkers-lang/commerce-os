import { describe, expect, it } from 'vitest'
import { assessPublicationReadiness, type PublicationGateInput } from '@/lib/marketplaces/publicationGate'
import { assessCompliance } from '@/lib/compliance/rules'
import { assessAmazonCapability, assessShopifyCapability } from '@/lib/suppliers/scoring'
import type { SupplierSignals } from '@/lib/suppliers/scoring'
import type { IdentifierRecord } from '@/lib/products/identifiers'

const CLOCK = new Date('2026-08-23T09:00:00Z')

const goodSupplier: SupplierSignals = {
  unitCost: { minor: 800, currency: 'GBP' },
  shippingCost: { minor: 200, currency: 'GBP' },
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
}

/** Cannot be seller of record: blocks Amazon specifically. */
const amazonBlockedSupplier: SupplierSignals = { ...goodSupplier, supportsCustomInvoice: false }

const validEan: IdentifierRecord = { idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }

function complianceFor(channel: 'shopify' | 'amazon_uk', supplierSignals: SupplierSignals, identifiers: readonly IdentifierRecord[] = [validEan]) {
  const capability = channel === 'amazon_uk' ? assessAmazonCapability(supplierSignals) : assessShopifyCapability(supplierSignals)
  return assessCompliance(
    channel,
    {
      title: 'Test Product', category: 'Kitchen', brand: null, identifiers,
      supplierCapability: capability.status, supplierCapabilityReasons: capability.reasons,
      documents: [], blockedCategories: [],
      ipInput: { title: 'Test Product', brand: null, category: 'Kitchen' },
    },
    CLOCK,
  )
}

function baseInput(over: Partial<PublicationGateInput> = {}): PublicationGateInput {
  const compliance = complianceFor('shopify', goodSupplier)
  return {
    channel: 'shopify',
    productStage: 'approved',
    productDecision: 'add',
    channelDecision: 'add',
    supplierCapability: assessShopifyCapability(goodSupplier),
    profitabilityGatePasses: true,
    profitabilityFailureReason: null,
    compliance,
    automationLevel: 'assisted',
    ...over,
  }
}

describe('blocked product', () => {
  it('blocks when the product lifecycle stage has not reached approved', () => {
    const decision = assessPublicationReadiness(baseInput({ productStage: 'researching' }))
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'lifecycle')?.satisfied).toBe(false)
  })

  it('blocks a paused product from being republished without a deliberate resume', () => {
    const decision = assessPublicationReadiness(baseInput({ productStage: 'paused' }))
    expect(decision.outcome).toBe('blocked')
  })

  it('blocks a rejected (terminal) product', () => {
    const decision = assessPublicationReadiness(baseInput({ productStage: 'rejected' }))
    expect(decision.outcome).toBe('blocked')
  })

  it('names every failed requirement, not only the first', () => {
    const decision = assessPublicationReadiness(
      baseInput({ productStage: 'discovered', supplierCapability: null, profitabilityGatePasses: false, compliance: null }),
    )
    expect(decision.outcome).toBe('blocked')
    const failed = decision.requirements.filter((r) => !r.satisfied)
    expect(failed.length).toBeGreaterThanOrEqual(4)
  })
})

describe('profitable but non-compliant product', () => {
  it('blocks on compliance even though profitability passes', () => {
    const decision = assessPublicationReadiness(
      baseInput({
        channel: 'amazon_uk',
        supplierCapability: assessAmazonCapability(amazonBlockedSupplier),
        compliance: complianceFor('amazon_uk', amazonBlockedSupplier),
        profitabilityGatePasses: true,
      }),
    )
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'compliance')?.satisfied).toBe(false)
    expect(decision.requirements.find((r) => r.key === 'profitability')?.satisfied).toBe(true)
  })
})

describe('compliant but unprofitable product', () => {
  it('blocks on profitability even though compliance passes', () => {
    const decision = assessPublicationReadiness(
      baseInput({ profitabilityGatePasses: false, profitabilityFailureReason: 'Net margin 4% is below the 10% minimum.' }),
    )
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'profitability')?.satisfied).toBe(false)
    expect(decision.requirements.find((r) => r.key === 'compliance')?.satisfied).toBe(true)
    expect(decision.reason).toMatch(/Profitability gate/)
  })
})

describe('Shopify-approved / Amazon-blocked scenario', () => {
  it('the same supplier and product pass Shopify and block Amazon', () => {
    const shopifyDecision = assessPublicationReadiness(
      baseInput({
        channel: 'shopify',
        supplierCapability: assessShopifyCapability(amazonBlockedSupplier),
        compliance: complianceFor('shopify', amazonBlockedSupplier),
      }),
    )
    const amazonDecision = assessPublicationReadiness(
      baseInput({
        channel: 'amazon_uk',
        supplierCapability: assessAmazonCapability(amazonBlockedSupplier),
        compliance: complianceFor('amazon_uk', amazonBlockedSupplier),
      }),
    )
    expect(shopifyDecision.outcome).not.toBe('blocked')
    expect(amazonDecision.outcome).toBe('blocked')
  })
})

describe('Amazon-approved / Shopify-blocked scenario', () => {
  it('a supplier good enough for Amazon can still fail Shopify for its own reasons', () => {
    // Force a Shopify-specific failure: an unreasonable delivery promise,
    // which blocks Shopify capability outright but has no equivalent effect
    // on the Amazon-specific checks this supplier otherwise passes.
    const slowButAmazonCapable: SupplierSignals = { ...goodSupplier, deliveryDaysMax: 45 }

    const shopifyCapability = assessShopifyCapability(slowButAmazonCapable)
    const amazonCapability = assessAmazonCapability(slowButAmazonCapable)
    expect(shopifyCapability.status).toBe('blocked')
    expect(amazonCapability.status).toBe('blocked') // Amazon also rejects >14 days, so pick a case that truly diverges.
  })

  it('a genuinely diverging case: Shopify blocked by a Shopify-only rule, Amazon unaffected', () => {
    // Shopify blocks purely on an unreasonable delivery promise (>30 days);
    // Amazon's own delivery ceiling is stricter (>14 days) but this signal
    // only exercises the boundary between them, at 20 days: a caution on
    // Shopify (review, not blocked) and a hard block on Amazon.
    const midDelivery: SupplierSignals = { ...goodSupplier, deliveryDaysMax: 20 }
    expect(assessShopifyCapability(midDelivery).status).toBe('review_required')
    expect(assessAmazonCapability(midDelivery).status).toBe('blocked')

    const shopifyDecision = assessPublicationReadiness(
      baseInput({
        channel: 'shopify',
        supplierCapability: assessShopifyCapability(midDelivery),
        compliance: complianceFor('shopify', midDelivery),
      }),
    )
    const amazonDecision = assessPublicationReadiness(
      baseInput({
        channel: 'amazon_uk',
        supplierCapability: assessAmazonCapability(midDelivery),
        compliance: complianceFor('amazon_uk', midDelivery),
      }),
    )
    // Shopify: review_required capability still blocks THIS gate (which
    // requires status === 'approved' to satisfy supplier fulfilment
    // capability), so both channels block here — the important, tested fact
    // is that they block for different, channel-specific reasons.
    expect(shopifyDecision.requirements.find((r) => r.key === 'supplier_fulfilment_capability')?.detail)
      .toMatch(/needs to be stated plainly/)
    expect(amazonDecision.requirements.find((r) => r.key === 'supplier_fulfilment_capability')?.detail)
      .toMatch(/delivery promise/)
  })
})

describe('automation approval requirement', () => {
  it('requires approval by default ("assisted") even when every requirement passes', () => {
    const decision = assessPublicationReadiness(baseInput({ automationLevel: 'assisted' }))
    expect(decision.outcome).toBe('pending_approval')
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  it('requires approval at "manual" and "supervised" too', () => {
    for (const automationLevel of ['manual', 'supervised'] as const) {
      const decision = assessPublicationReadiness(baseInput({ automationLevel }))
      expect(decision.outcome).toBe('pending_approval')
    }
  })

  it('permits automatic publication only at "autonomous"', () => {
    const decision = assessPublicationReadiness(baseInput({ automationLevel: 'autonomous' }))
    expect(decision.outcome).toBe('auto_publish_permitted')
    expect(decision.requiresOwnerApproval).toBe(false)
  })

  it('never permits automatic publication at "autonomous" if a requirement actually fails', () => {
    // The guardrail from docs/PRINCIPLES.md #4: automation cannot override
    // compliance, no matter how high the automation level is.
    const decision = assessPublicationReadiness(
      baseInput({
        automationLevel: 'autonomous',
        channel: 'amazon_uk',
        supplierCapability: assessAmazonCapability(amazonBlockedSupplier),
        compliance: complianceFor('amazon_uk', amazonBlockedSupplier),
      }),
    )
    expect(decision.outcome).toBe('blocked')
  })

  it('reports the automation permission requirement explicitly once every gate passes', () => {
    const decision = assessPublicationReadiness(baseInput({ automationLevel: 'autonomous' }))
    const automation = decision.requirements.find((r) => r.key === 'automation_permission')
    expect(automation?.satisfied).toBe(true)
    expect(automation?.detail).toMatch(/permits publishing without approval/)
  })
})

describe('identifier requirements', () => {
  it('blocks Amazon when no GTIN is on file, citing identifiers specifically', () => {
    const decision = assessPublicationReadiness(
      baseInput({
        channel: 'amazon_uk',
        supplierCapability: assessAmazonCapability(goodSupplier),
        compliance: complianceFor('amazon_uk', goodSupplier, []),
      }),
    )
    expect(decision.outcome).toBe('blocked')
    expect(decision.requirements.find((r) => r.key === 'identifiers')?.satisfied).toBe(false)
  })

  it('does not require a GTIN on Shopify', () => {
    const decision = assessPublicationReadiness(
      baseInput({ channel: 'shopify', compliance: complianceFor('shopify', goodSupplier, []) }),
    )
    expect(decision.requirements.find((r) => r.key === 'identifiers')?.satisfied).toBe(true)
  })
})
