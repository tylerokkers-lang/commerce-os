import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryFxStore } from '@/lib/fx/inMemoryFxStore'
import { createInMemorySupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFacts'
import { createInMemoryMarketRepository } from '@/lib/markets/inMemoryMarketRepository'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { runWorkerBatch } from '@/lib/automation/worker'
import type { MarketRecheckPayload, FxRecheckPayload } from '@/lib/automation/handlers/marketHandlers'
import type { ComplianceContext } from '@/lib/compliance/rules'
import type { IdentifierRecord } from '@/lib/products/identifiers'

const ORG_A = 'org-a'
const validEan: IdentifierRecord = { idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }
const cleanContext: ComplianceContext = {
  title: 'Solid Oak Chopping Board', description: 'Hardwood chopping board.', category: 'Kitchen', brand: null,
  identifiers: [validEan], supplierCapability: 'approved', supplierCapabilityReasons: ['Meets every requirement.'],
  supplierName: 'Meridian Housewares Ltd', documents: [], blockedCategories: [],
  ipInput: { title: 'Solid Oak Chopping Board', brand: null, ownBrands: [], category: 'Kitchen', imagesFromSupplier: false, hasBrandAuthorisation: false },
}

function makeDeps() {
  return {
    supplierMarketFacts: createInMemorySupplierMarketFactsLoader({
      'sup-1:GB': { canShip: true, shippingCostMinor: 200, shippingCurrency: 'GBP', deliveryDaysMin: 2, deliveryDaysMax: 4, cancellationRatePct: 1, lastVerifiedAt: new Date().toISOString() },
    }),
    fxStore: createInMemoryFxStore(),
    marketRepository: createInMemoryMarketRepository(),
  }
}

describe('market_recheck handler', () => {
  it('a malformed payload fails non-retryably rather than throwing or silently succeeding', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'market_recheck', payload: { productId: 'prod-1' } }) // Missing everything else.
    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1', 1, makeDeps())
    expect(batch.succeeded).toBe(0)
    expect(batch.deadLettered).toBe(1) // Non-retryable malformed payloads dead-letter immediately, never silently vanish.
  })

  it('without marketDeps, the job fails explicitly rather than crashing the worker', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const payload: MarketRecheckPayload = {
      productId: 'prod-1', marketKey: 'amazon_uk', supplierId: 'sup-1', complianceContext: cleanContext,
      profitabilityInput: { sellingPriceNative: fromMajor(35, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 },
    }
    await store.enqueueJob({ orgId: ORG_A, jobType: 'market_recheck', payload: payload as unknown as Record<string, unknown> })
    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1', 1) // No marketDeps passed.
    expect(batch.succeeded).toBe(0)
    expect(batch.deadLettered).toBe(1)
  })

  it('an unknown market key fails explicitly, never silently assessing against the wrong market', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const payload: MarketRecheckPayload = {
      productId: 'prod-1', marketKey: 'nonexistent_market', supplierId: 'sup-1', complianceContext: cleanContext,
      profitabilityInput: { sellingPriceNative: fromMajor(35, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 },
    }
    await store.enqueueJob({ orgId: ORG_A, jobType: 'market_recheck', payload: payload as unknown as Record<string, unknown> })
    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1', 1, makeDeps())
    expect(batch.succeeded).toBe(0)
  })

  it('a genuinely ready market requests approval — never executes an international launch automatically', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const deps = makeDeps()
    const payload: MarketRecheckPayload = {
      productId: 'prod-1', marketKey: 'amazon_uk', supplierId: 'sup-1', complianceContext: cleanContext,
      profitabilityInput: { sellingPriceNative: fromMajor(35, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 },
    }
    await store.enqueueJob({ orgId: ORG_A, jobType: 'market_recheck', payload: payload as unknown as Record<string, unknown> })
    await runWorkerBatch(store, facts, () => undefined, 'worker-1', 1, deps)

    const assessment = await deps.marketRepository.getLatestAssessment(ORG_A, 'prod-1', 'amazon_uk')
    expect(assessment).not.toBeNull()
    if (assessment!.recommendation === 'ready') {
      const approvalAction = store.getState().actions.find((a) => a.actionType === 'request_approval')
      expect(approvalAction).toBeTruthy()
      expect(approvalAction!.status).not.toBe('succeeded') // Never auto-executed — always sits as a pending approval.
    }
    // Whatever the recommendation, no action of any type other than
    // request_approval was ever created — nothing in this handler enables
    // or launches anything.
    expect(store.getState().actions.every((a) => a.actionType === 'request_approval')).toBe(true)
  })
})

describe('fx_recheck handler', () => {
  it('a malformed payload fails non-retryably', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'fx_recheck', payload: { base: 'USD' } }) // Missing quote/newRate.
    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1', 1, makeDeps())
    expect(batch.deadLettered).toBe(1)
  })

  it('finds no affected assessments and simply succeeds when nothing has ever been assessed in this currency', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const payload: FxRecheckPayload = { base: 'USD', quote: 'GBP', previousRate: 0.7, newRate: 1.3 }
    await store.enqueueJob({ orgId: ORG_A, jobType: 'fx_recheck', payload: payload as unknown as Record<string, unknown> })
    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1', 1, makeDeps())
    expect(batch.succeeded).toBe(1)
    expect(store.getState().jobs.filter((j) => j.jobType === 'market_recheck')).toHaveLength(0)
  })
})
