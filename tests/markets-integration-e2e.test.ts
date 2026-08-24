import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { createInMemoryFxStore } from '@/lib/fx/inMemoryFxStore'
import { createInMemorySupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFacts'
import { createInMemoryMarketRepository } from '@/lib/markets/inMemoryMarketRepository'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { runDueMonitors, type SubjectProvider } from '@/lib/monitoring/runner'
import { runWorkerBatch } from '@/lib/automation/worker'
import { getMarket } from '@/lib/markets/catalog'
import type { MarketMonitorSubject } from '@/lib/monitoring/monitors/marketMonitor'
import type { FxPairSubject } from '@/lib/monitoring/monitors/fxMonitor'
import type { ComplianceContext } from '@/lib/compliance/rules'
import type { IdentifierRecord } from '@/lib/products/identifiers'
import type { ExchangeRateFact } from '@/lib/fx/types'
import type { MarketRecheckPayload } from '@/lib/automation/handlers/marketHandlers'

const ORG_A = 'org-a'
const PRODUCT_ID = 'prod-1'
const SUPPLIER_ID = 'sup-1'
const UK_MARKET = getMarket('amazon_uk')!

const validEan: IdentifierRecord = { idType: 'ean', value: '4006381333931', source: 'manufacturer', validation: 'valid' }
const cleanContext: ComplianceContext = {
  title: 'Solid Oak Chopping Board', description: 'Hardwood chopping board.', category: 'Kitchen', brand: null,
  identifiers: [validEan], supplierCapability: 'approved', supplierCapabilityReasons: ['Meets every requirement.'],
  supplierName: 'Meridian Housewares Ltd', documents: [], blockedCategories: [],
  ipInput: { title: 'Solid Oak Chopping Board', brand: null, ownBrands: [], category: 'Kitchen', imagesFromSupplier: false, hasBrandAuthorisation: false },
}

/**
 * The Milestone 9 flagship acceptance test (brief's demo Scenario 2):
 * "A product is profitable at one FX rate. A significant currency
 * movement then causes PASS -> FAIL", driven end to end through the real
 * entry points only —
 *
 *   runDueMonitors (fxMonitor)
 *     -> FX_RATE_SIGNIFICANT_MOVEMENT event -> fx_recheck job
 *   runWorkerBatch
 *     -> handleFxRecheck -> finds the affected market assessment -> chains market_recheck
 *     -> handleMarketRecheck -> resolveMarketProjectionInput (FX normalisation)
 *        -> projectMarketProfitability (the one profitability engine)
 *        -> evaluateMarketExpansion -> persisted as the next version in
 *           market_expansion_assessments
 *
 * A US-based supplier quotes this product's cost in USD even though it
 * sells on Amazon UK in GBP — a real, unremarkable cross-border sourcing
 * arrangement — so a USD/GBP rate move genuinely changes the cost side of
 * a GBP-denominated calculation without the selling price moving at all.
 */
describe('Milestone 9 flagship: FX movement -> monitor -> event -> job -> worker -> FX normalisation -> profitability engine -> expansion assessment', () => {
  it('a significant USD->GBP movement flips a real market assessment from profitable to loss-making', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore({ scheduleMinutesByKey: { fx_rates: 0, market_expansion: 0 }, configNumbersByKey: { 'fx_rates:movement_threshold_pct': 3 } })
    const fxStore = createInMemoryFxStore()
    const supplierMarketFacts = createInMemorySupplierMarketFactsLoader({
      'sup-1:GB': { canShip: true, shippingCostMinor: 200, shippingCurrency: 'GBP', deliveryDaysMin: 2, deliveryDaysMax: 4, cancellationRatePct: 1, lastVerifiedAt: new Date().toISOString() },
    })
    const marketRepository = createInMemoryMarketRepository()
    const facts = createInMemoryFactsLoader()

    const profitabilityInput = {
      sellingPriceNative: fromMajor(35, 'GBP'),
      productCostForeign: fromMajor(20, 'USD'),
      supplierShippingForeign: fromMajor(1, 'USD'),
      returnRatePct: 3,
    }
    const initialPayload: MarketRecheckPayload = {
      productId: PRODUCT_ID, marketKey: UK_MARKET.marketKey, supplierId: SUPPLIER_ID,
      complianceContext: cleanContext, profitabilityInput,
    }

    const rate = (r: number): ExchangeRateFact => ({ base: 'USD', quote: 'GBP', rate: r, source: 'demo', observedAt: new Date().toISOString(), retrievedAt: new Date().toISOString() })
    await fxStore.recordRate(ORG_A, rate(0.70)) // A favourable rate: $20 costs £14.

    // Step 1: an initial evaluation is requested (the real trigger for a
    // brand-new market — nothing about ongoing monitoring can exist before
    // a first assessment does). Enqueued directly, exactly the shape the
    // monitor itself would produce.
    await store.enqueueJob({ orgId: ORG_A, jobType: 'market_recheck', payload: initialPayload as unknown as Record<string, unknown> })
    const marketDeps = { supplierMarketFacts, fxStore, marketRepository }
    const initialBatch = await runWorkerBatch(store, facts, () => undefined, 'worker-1', 10, marketDeps)
    expect(initialBatch.succeeded).toBe(1)

    const initialAssessment = await marketRepository.getLatestAssessment(ORG_A, PRODUCT_ID, UK_MARKET.marketKey)
    expect(initialAssessment).not.toBeNull()
    expect(initialAssessment!.nativeMarginPct).not.toBeNull()
    expect((initialAssessment!.nativeMarginPct as number)).toBeGreaterThan(0) // Genuinely profitable at the favourable rate.
    expect(initialAssessment!.blockers).not.toContain(expect.stringContaining('loses money'))

    // Step 2: the marketMonitor and fxMonitor establish their own
    // baselines (first-ever observation — no event yet), matching the
    // "first look establishes a baseline silently" rule every monitor in
    // this codebase follows.
    const marketSubject: MarketMonitorSubject = { productId: PRODUCT_ID, supplierId: SUPPLIER_ID, market: UK_MARKET, complianceContext: cleanContext, profitabilityInput }
    const fxSubject: FxPairSubject = { base: 'USD', quote: 'GBP' }
    const subjectsFor: SubjectProvider = async (_orgId, monitorKey) => ({
      subjects: monitorKey === 'market_expansion' ? [marketSubject] : monitorKey === 'fx_rates' ? [fxSubject] : [],
      errors: [],
    })
    await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['market_expansion', 'fx_rates'], fxStore, supplierMarketFacts })

    // Step 3: the USD/GBP rate moves dramatically against this business —
    // the FX monitor's own real check, not a fabricated event.
    await fxStore.recordRate(ORG_A, rate(1.30)) // Now $20 costs £26.
    const fxSummaries = await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['fx_rates'], fxStore, supplierMarketFacts })
    expect(fxSummaries[0].eventsCreated).toBe(1)
    expect(events.getState().events.some((e) => e.eventType === 'FX_RATE_SIGNIFICANT_MOVEMENT')).toBe(true)
    expect(store.getState().jobs.some((j) => j.jobType === 'fx_recheck')).toBe(true)

    // Step 4: the worker claims fx_recheck, which finds the affected
    // market assessment (via marketRepository, never a second discovery
    // mechanism) and chains a real market_recheck — both claimed in the
    // same batch, exactly like the M8.5 flagship test proved for its own
    // chained job.
    const finalBatch = await runWorkerBatch(store, facts, () => undefined, 'worker-1', 10, marketDeps)
    expect(finalBatch.claimed).toBeGreaterThanOrEqual(2) // fx_recheck + at least one chained market_recheck.
    expect(finalBatch.succeeded).toBe(finalBatch.claimed)

    // Step 5: the real consequence. Never asserted by calling
    // `projectMarketProfitability` or `evaluateMarketExpansion` directly —
    // this reads the actual persisted result the chain produced.
    const finalAssessment = await marketRepository.getLatestAssessment(ORG_A, PRODUCT_ID, UK_MARKET.marketKey)
    expect(finalAssessment).not.toBeNull()
    expect(finalAssessment!.nativeProfitMinor).not.toBeNull()
    expect((finalAssessment!.nativeProfitMinor as number)).toBeLessThan(0) // PASS -> FAIL, driven purely by the FX movement — nothing else changed.
    expect(finalAssessment!.recommendation).toBe('blocked')
    expect(finalAssessment!.blockers.length).toBeGreaterThan(0)

    // And the divergence from the initial, favourable-rate assessment is
    // real and stored, not overwritten — both versions are still readable.
    expect(finalAssessment!.assessedAt).not.toBe(initialAssessment!.assessedAt)
  })
})
