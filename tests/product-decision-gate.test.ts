import { describe, expect, it, vi } from 'vitest'

// Milestone: execution reliability. `priceExecution.ts` now imports the
// circuit-breaker gate (`marketplaces/connectors/executionGate.ts`), which
// is `server-only` — same technique every other server-only-adjacent test
// file in this repo already uses.
vi.mock('server-only', () => ({}))

import { decisionPermitsExecution, decisionBlocksExecution, decisionBlockReason, EXECUTION_PERMITTED_DECISIONS } from '@/lib/products/decisionGate'
import { assessPublicationReadiness, type PublicationGateInput } from '@/lib/marketplaces/publicationGate'
import { assessCompliance } from '@/lib/compliance/rules'
import { assessShopifyCapability } from '@/lib/suppliers/scoring'
import type { SupplierSignals } from '@/lib/suppliers/scoring'
import type { ProductDecision } from '@/lib/core/domain'
import type { IdentifierRecord } from '@/lib/products/identifiers'

const goodSupplier: SupplierSignals = {
  unitCost: { minor: 800, currency: 'GBP' }, shippingCost: { minor: 200, currency: 'GBP' },
  deliveryDaysMin: 2, deliveryDaysMax: 3, ordersPlaced: 100, ordersLate: 2, ordersDefective: 1,
  qualityRating: 4.6, communicationRating: 4.5, handlesReturns: true, returnsWindowDays: 45,
  acceptsFaultyReturns: true, providesTracking: true, supportsBlindShipping: true,
  supportsCustomInvoice: true, supportsCustomPackaging: true, supportsOwnBranding: true, documentCount: 2,
}
const validEan: IdentifierRecord = { idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }
const CLOCK = new Date('2026-08-23T09:00:00Z')

function compliance() {
  const capability = assessShopifyCapability(goodSupplier)
  return assessCompliance(
    'shopify',
    {
      title: 'Test Product', category: 'Kitchen', brand: null, identifiers: [validEan],
      supplierCapability: capability.status, supplierCapabilityReasons: capability.reasons,
      documents: [], blockedCategories: [], ipInput: { title: 'Test Product', brand: null, category: 'Kitchen' },
    },
    CLOCK,
  )
}

function gateInput(over: Partial<PublicationGateInput> = {}): PublicationGateInput {
  return {
    channel: 'shopify',
    productStage: 'approved',
    productDecision: 'add',
    channelDecision: 'add',
    supplierCapability: assessShopifyCapability(goodSupplier),
    profitabilityGatePasses: true,
    profitabilityFailureReason: null,
    compliance: compliance(),
    automationLevel: 'assisted',
    ...over,
  }
}

describe('decisionGate (single source of truth for execution permission)', () => {
  it('only add and test permit execution', () => {
    expect(EXECUTION_PERMITTED_DECISIONS).toEqual(new Set(['add', 'test']))
    expect(decisionPermitsExecution('add')).toBe(true)
    expect(decisionPermitsExecution('test')).toBe(true)
    for (const d of ['watch', 'hold', 'block', 'remove', 'review'] as ProductDecision[]) {
      expect(decisionPermitsExecution(d)).toBe(false)
      expect(decisionBlocksExecution(d)).toBe(true)
    }
  })

  it('the block reason names the actual decision', () => {
    expect(decisionBlockReason('block')).toContain('"block"')
    expect(decisionBlockReason('hold')).toContain('"hold"')
  })
})

describe('publicationGate: product decision is the outermost requirement', () => {
  it.each(['watch', 'hold', 'block', 'remove', 'review'] as ProductDecision[])(
    'a "%s" product is blocked from listing regardless of every other requirement passing',
    (decision) => {
      const result = assessPublicationReadiness(gateInput({ productDecision: decision }))
      expect(result.outcome).toBe('blocked')
      const req = result.requirements.find((r) => r.key === 'product_decision')
      expect(req?.satisfied).toBe(false)
      expect(req?.detail).toContain(decision)
    },
  )

  it.each(['add', 'test'] as ProductDecision[])('a "%s" product is NOT blocked by the decision gate — still subject to the other five requirements', (decision) => {
    const result = assessPublicationReadiness(gateInput({ productDecision: decision }))
    const req = result.requirements.find((r) => r.key === 'product_decision')
    expect(req?.satisfied).toBe(true)
    // ADD does not bypass profitability/compliance/supplier — proven by
    // still failing when those fail, even though the decision passes.
    const stillBlocked = assessPublicationReadiness(gateInput({ productDecision: decision, profitabilityGatePasses: false, profitabilityFailureReason: 'Margin too thin.' }))
    expect(stillBlocked.outcome).toBe('blocked')
    expect(stillBlocked.requirements.find((r) => r.key === 'profitability')?.satisfied).toBe(false)
  })

  it('a blocked decision names ONLY itself when it is the sole failure, never masking or being masked by other requirements', () => {
    const result = assessPublicationReadiness(gateInput({ productDecision: 'block' }))
    const failed = result.requirements.filter((r) => !r.satisfied)
    expect(failed.map((r) => r.key)).toEqual(['product_decision'])
  })
})

describe('publicationGate: channel decision is checked second, immediately after the product decision', () => {
  it.each(['watch', 'hold', 'block', 'remove', 'review'] as ProductDecision[])(
    'a "%s" channel decision blocks listing on that channel even though the product decision itself is "add"',
    (decision) => {
      const result = assessPublicationReadiness(gateInput({ productDecision: 'add', channelDecision: decision }))
      expect(result.outcome).toBe('blocked')
      const req = result.requirements.find((r) => r.key === 'channel_decision')
      expect(req?.satisfied).toBe(false)
      expect(req?.detail).toContain(decision)
      // The product-level requirement itself still passes — the two gates
      // are independent, never one overriding the other.
      expect(result.requirements.find((r) => r.key === 'product_decision')?.satisfied).toBe(true)
    },
  )

  it('a product ADD overall with an independently BLOCKed channel is exactly the shape this milestone exists for', () => {
    const result = assessPublicationReadiness(gateInput({ channel: 'amazon_uk', productDecision: 'add', channelDecision: 'block' }))
    expect(result.outcome).toBe('blocked')
    expect(result.requirements.find((r) => r.key === 'channel_decision')?.detail).toContain('amazon_uk')
  })

  it('null channelDecision (never set) defaults to "review" behaviour — blocked, never an implicit pass', () => {
    const result = assessPublicationReadiness(gateInput({ channelDecision: null }))
    expect(result.outcome).toBe('blocked')
    const req = result.requirements.find((r) => r.key === 'channel_decision')
    expect(req?.satisfied).toBe(false)
    expect(req?.detail).toContain('review')
  })

  it.each(['add', 'test'] as ProductDecision[])('a "%s" channel decision is NOT blocked by the channel gate — still subject to the other requirements', (decision) => {
    const result = assessPublicationReadiness(gateInput({ channelDecision: decision }))
    const req = result.requirements.find((r) => r.key === 'channel_decision')
    expect(req?.satisfied).toBe(true)
  })
})

describe('priceExecution: blocked decisions never reach profitability assessment', () => {
  it('executePriceChange never calls assessPriceChange when the product decision blocks execution', async () => {
    const priceAutomation = await import('@/lib/automation/priceAutomation')
    const spy = vi.spyOn(priceAutomation, 'assessPriceChange')

    const { executePriceChange } = await import('@/lib/automation/priceExecution')
    const { createInMemoryAutomationStore } = await import('@/lib/automation/inMemoryStore')
    const { DEMO_AUTOMATION_SETTINGS } = await import('@/lib/automation/settingsTypes')
    const { fromMajor } = await import('@/lib/core/money')
    const { shopifyDemoConnector } = await import('@/lib/marketplaces/connectors/shopifyDemo')

    const store = createInMemoryAutomationStore({ settingsByOrg: { 'org-1': DEMO_AUTOMATION_SETTINGS } })

    const result = await executePriceChange(
      {
        orgId: 'org-1',
        channelProductId: 'cp-1',
        externalId: 'shopify-1',
        request: {
          productTitle: 'Test',
          costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
          newSellingPrice: fromMajor(30.5),
          automationLevel: 'autonomous',
        },
        connector: shopifyDemoConnector,
        productDecision: 'hold',
        idempotencyKey: 'gate-test-1',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(spy).not.toHaveBeenCalled()
    expect(result.executed).toBe(false)
    expect(result.policyOutcome).toBe('block')
    spy.mockRestore()
  })

  it('executePriceChange DOES call assessPriceChange when the product decision permits execution (add/test)', async () => {
    const priceAutomation = await import('@/lib/automation/priceAutomation')
    const spy = vi.spyOn(priceAutomation, 'assessPriceChange')

    const { executePriceChange } = await import('@/lib/automation/priceExecution')
    const { createInMemoryAutomationStore } = await import('@/lib/automation/inMemoryStore')
    const { DEMO_AUTOMATION_SETTINGS } = await import('@/lib/automation/settingsTypes')
    const { fromMajor } = await import('@/lib/core/money')
    const { shopifyDemoConnector } = await import('@/lib/marketplaces/connectors/shopifyDemo')

    const store = createInMemoryAutomationStore({ settingsByOrg: { 'org-1': DEMO_AUTOMATION_SETTINGS } })

    await executePriceChange(
      {
        orgId: 'org-1',
        channelProductId: 'cp-2',
        externalId: 'shopify-2',
        request: {
          productTitle: 'Test',
          costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
          newSellingPrice: fromMajor(30.5),
          automationLevel: 'autonomous',
        },
        connector: shopifyDemoConnector,
        productDecision: 'add',
        idempotencyKey: 'gate-test-2',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
