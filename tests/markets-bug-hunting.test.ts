import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { createInMemoryFxStore } from '@/lib/fx/inMemoryFxStore'
import { createInMemorySupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFacts'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { fxMonitor, type FxPairSubject } from '@/lib/monitoring/monitors/fxMonitor'
import { marketMonitor, type MarketMonitorSubject } from '@/lib/monitoring/monitors/marketMonitor'
import { runDueMonitors, type SubjectProvider } from '@/lib/monitoring/runner'
import { getMarket } from '@/lib/markets/catalog'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'
import type { ComplianceContext } from '@/lib/compliance/rules'
import type { IdentifierRecord } from '@/lib/products/identifiers'
import type { ExchangeRateFact } from '@/lib/fx/types'

const ORG_A = 'org-a'
const validEan: IdentifierRecord = { idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }
const cleanContext: ComplianceContext = {
  title: 'Solid Oak Chopping Board', description: 'Hardwood chopping board.', category: 'Kitchen', brand: null,
  identifiers: [validEan], supplierCapability: 'approved', supplierCapabilityReasons: ['Meets every requirement.'],
  supplierName: 'Meridian Housewares Ltd', documents: [], blockedCategories: [],
  ipInput: { title: 'Solid Oak Chopping Board', brand: null, ownBrands: [], category: 'Kitchen', imagesFromSupplier: false, hasBrandAuthorisation: false },
}

describe('deliberate bug-hunting: concurrent evaluation', () => {
  it('simultaneous fxMonitor runs for the same new rate cannot create duplicate FX_RATE_SIGNIFICANT_MOVEMENT events or duplicate fx_recheck jobs', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'fx_rates:movement_threshold_pct': 3 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const fxStore = createInMemoryFxStore()
    const rate = (r: number): ExchangeRateFact => ({ base: 'USD', quote: 'GBP', rate: r, source: 'demo', observedAt: new Date().toISOString(), retrievedAt: new Date().toISOString() })
    await fxStore.recordRate(ORG_A, rate(1.00))

    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore }
    const subject: FxPairSubject = { base: 'USD', quote: 'GBP' }
    await fxMonitor.run(ctx, [subject]) // Baseline.

    await fxStore.recordRate(ORG_A, rate(1.10)) // A single genuine movement.

    // Ten workers race to notice the same movement at once.
    await Promise.all(Array.from({ length: 10 }, () => fxMonitor.run(ctx, [subject])))

    const movementEvents = events.getState().events.filter((e) => e.eventType === 'FX_RATE_SIGNIFICANT_MOVEMENT')
    expect(movementEvents).toHaveLength(1) // Exactly one event for the one genuine movement, never ten.
    expect(store.getState().jobs.filter((j) => j.jobType === 'fx_recheck')).toHaveLength(1)
  })

  it('simultaneous marketMonitor runs for the same product/market pair cannot create duplicate MARKET_PROFITABILITY_DETERIORATED events or duplicate market_recheck jobs', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const facts = createInMemoryFactsLoader()
    const fxStore = createInMemoryFxStore()
    const supplierMarketFacts = createInMemorySupplierMarketFactsLoader({
      'sup-1:GB': { canShip: true, shippingCostMinor: 200, shippingCurrency: 'GBP', deliveryDaysMin: 2, deliveryDaysMax: 4, cancellationRatePct: 1, lastVerifiedAt: new Date().toISOString() },
    })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore, supplierMarketFacts }

    const healthySubject: MarketMonitorSubject = {
      productId: 'prod-1', supplierId: 'sup-1', market: getMarket('amazon_uk')!, complianceContext: cleanContext,
      profitabilityInput: { sellingPriceNative: fromMajor(35, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 },
    }
    await marketMonitor.run(ctx, [healthySubject]) // Baseline: passes.

    const worseSubject: MarketMonitorSubject = { ...healthySubject, profitabilityInput: { sellingPriceNative: fromMajor(10, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 } }

    await Promise.all(Array.from({ length: 10 }, () => marketMonitor.run(ctx, [worseSubject])))

    const deteriorated = events.getState().events.filter((e) => e.eventType === 'MARKET_PROFITABILITY_DETERIORATED')
    expect(deteriorated).toHaveLength(1)
    expect(store.getState().jobs.filter((j) => j.jobType === 'market_recheck')).toHaveLength(1)
  })
})

describe('deliberate bug-hunting: partial discovery failure', () => {
  it('one monitor\'s subject discovery failing does not prevent another monitor from running in the same sweep', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore({ scheduleMinutesByKey: { fx_rates: 0, market_expansion: 0 } })
    const facts = createInMemoryFactsLoader()
    const fxStore = createInMemoryFxStore()
    const supplierMarketFacts = createInMemorySupplierMarketFactsLoader({
      'sup-1:GB': { canShip: true, shippingCostMinor: 200, shippingCurrency: 'GBP', deliveryDaysMin: 2, deliveryDaysMax: 4, cancellationRatePct: 1, lastVerifiedAt: new Date().toISOString() },
    })

    const marketSubject: MarketMonitorSubject = {
      productId: 'prod-1', supplierId: 'sup-1', market: getMarket('amazon_uk')!, complianceContext: cleanContext,
      profitabilityInput: { sellingPriceNative: fromMajor(35, 'GBP'), productCostForeign: fromMajor(9, 'GBP'), supplierShippingForeign: fromMajor(1, 'GBP'), returnRatePct: 3 },
    }

    const subjectsFor: SubjectProvider = async (_orgId, monitorKey) => {
      if (monitorKey === 'fx_rates') return { subjects: [], errors: ['fx feed unreachable'] } // fx_rates discovery fails entirely.
      if (monitorKey === 'market_expansion') return { subjects: [marketSubject], errors: [] } // market_expansion discovery succeeds.
      return { subjects: [], errors: [] }
    }

    const summaries = await runDueMonitors({
      orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS,
      subjectsFor, monitorKeys: ['fx_rates', 'market_expansion'], fxStore, supplierMarketFacts,
    })

    const fxSummary = summaries.find((s) => s.monitorKey === 'fx_rates')!
    const marketSummary = summaries.find((s) => s.monitorKey === 'market_expansion')!

    expect(fxSummary.errors).toContain('fx feed unreachable') // The failure is visible, never silently swallowed.

    const run = await events.getLastMonitorRun(ORG_A, 'fx_rates')
    expect(run?.status).toBe('failed') // 0 subjects, 1 error -> failed, never a false success.

    // market_expansion ran successfully in the SAME sweep, unaffected by fx_rates' failure.
    expect(marketSummary.ran).toBe(true)
    expect(marketSummary.errors).toHaveLength(0)
    const marketRun = await events.getLastMonitorRun(ORG_A, 'market_expansion')
    expect(marketRun?.status).toBe('success')
  })
})
