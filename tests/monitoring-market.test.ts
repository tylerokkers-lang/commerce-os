import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { createInMemoryFxStore } from '@/lib/fx/inMemoryFxStore'
import { createInMemorySupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFacts'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { marketMonitor, type MarketMonitorSubject } from '@/lib/monitoring/monitors/marketMonitor'
import { getMarket } from '@/lib/markets/catalog'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'
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

function makeSubject(overrides: Partial<MarketMonitorSubject> = {}): MarketMonitorSubject {
  return {
    productId: 'prod-1', supplierId: 'sup-1', market: getMarket('amazon_uk')!,
    complianceContext: cleanContext,
    profitabilityInput: { sellingPriceNative: fromMajor(30, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 },
    ...overrides,
  }
}

function makeCtx() {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader()
  const fxStore = createInMemoryFxStore()
  const supplierMarketFacts = createInMemorySupplierMarketFactsLoader({
    'sup-1:GB': { canShip: true, shippingCostMinor: 200, shippingCurrency: 'GBP', deliveryDaysMin: 2, deliveryDaysMax: 4, cancellationRatePct: 1, lastVerifiedAt: new Date().toISOString() },
  })
  const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore, supplierMarketFacts }
  return { ctx, store, events, fxStore, supplierMarketFacts }
}

describe('market monitor', () => {
  it('a first-ever observation establishes a baseline silently — no event on first look', async () => {
    const { ctx, events } = makeCtx()
    const outcome = await marketMonitor.run(ctx, [makeSubject()])
    expect(outcome.eventsCreated).toBe(0)
    expect(events.getState().events).toHaveLength(0)
  })

  it('profitability flipping from passing to failing creates MARKET_PROFITABILITY_DETERIORATED and enqueues market_recheck', async () => {
    const { ctx, events, store } = makeCtx()
    await marketMonitor.run(ctx, [makeSubject()]) // Baseline: healthy £30 price passes.

    // The same market re-evaluated with a much lower price — profitability now fails.
    const worse = makeSubject({ profitabilityInput: { sellingPriceNative: fromMajor(10, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 } })
    const outcome = await marketMonitor.run(ctx, [worse])

    expect(outcome.eventsCreated).toBeGreaterThan(0)
    expect(events.getState().events.some((e) => e.eventType === 'MARKET_PROFITABILITY_DETERIORATED')).toBe(true)
    expect(store.getState().jobs.some((j) => j.jobType === 'market_recheck')).toBe(true)
  })

  it('supplier capability flipping from can-ship to cannot-ship creates MARKET_SUPPLIER_CAPABILITY_CHANGED', async () => {
    const { ctx, events } = makeCtx()
    await marketMonitor.run(ctx, [makeSubject()]) // Baseline: can ship.

    const brokenSupplierFacts = createInMemorySupplierMarketFactsLoader({ 'sup-1:GB': { canShip: false, shippingCostMinor: null, shippingCurrency: null, deliveryDaysMin: null, deliveryDaysMax: null, cancellationRatePct: null, lastVerifiedAt: new Date().toISOString() } })
    const outcome = await marketMonitor.run({ ...ctx, supplierMarketFacts: brokenSupplierFacts }, [makeSubject()])

    expect(outcome.eventsCreated).toBeGreaterThan(0)
    expect(events.getState().events.some((e) => e.eventType === 'MARKET_SUPPLIER_CAPABILITY_CHANGED')).toBe(true)
  })

  it('a market becoming viable after previously being blocked creates MARKET_BECAME_VIABLE', async () => {
    const { ctx, events } = makeCtx()
    const blockedContext: ComplianceContext = { ...cleanContext, blockedCategories: ['Kitchen'] }
    await marketMonitor.run(ctx, [makeSubject({ complianceContext: blockedContext })]) // Baseline: blocked.

    const outcome = await marketMonitor.run(ctx, [makeSubject()]) // Category no longer blocked.
    expect(outcome.eventsCreated).toBeGreaterThan(0)
    expect(events.getState().events.some((e) => e.eventType === 'MARKET_BECAME_VIABLE')).toBe(true)
  })

  it('repeated runs against an unchanged condition deduplicate — no flood of identical events', async () => {
    const { ctx, events } = makeCtx()
    await marketMonitor.run(ctx, [makeSubject()])
    const worse = makeSubject({ profitabilityInput: { sellingPriceNative: fromMajor(10, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 } })
    await marketMonitor.run(ctx, [worse])
    await marketMonitor.run(ctx, [worse])
    await marketMonitor.run(ctx, [worse])

    const deteriorated = events.getState().events.filter((e) => e.eventType === 'MARKET_PROFITABILITY_DETERIORATED' && e.status === 'open')
    expect(deteriorated).toHaveLength(1)
  })

  it('a fact-loading error for one subject does not stop the run for another (partial success)', async () => {
    const { ctx } = makeCtx()
    const brokenFacts = { loadSupplierMarketCapability: async () => { throw new Error('boom') } }
    const outcome = await marketMonitor.run({ ...ctx, supplierMarketFacts: brokenFacts }, [makeSubject(), makeSubject({ productId: 'prod-2' })])
    expect(outcome.errors).toHaveLength(2)
    expect(outcome.subjectsChecked).toBe(2)
  })

  it('market isolation: a UK observation never leaks into a Germany observation for the same product', async () => {
    const { ctx, events } = makeCtx()
    const ukSubject = makeSubject()
    const deSubject = makeSubject({ market: getMarket('amazon_de')! })

    await marketMonitor.run(ctx, [ukSubject]) // UK baseline: passes.
    await marketMonitor.run(ctx, [deSubject]) // Germany baseline: no ruleset -> insufficient_facts, never "pass".

    const worseUk = makeSubject({ profitabilityInput: { sellingPriceNative: fromMajor(10, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 } })
    await marketMonitor.run(ctx, [worseUk])

    // The UK deterioration must never be attributed to the Germany subject key.
    const deEvents = events.getState().events.filter((e) => e.subjectId === `prod-1:${getMarket('amazon_de')!.marketKey}`)
    expect(deEvents).toHaveLength(0)
  })
})
