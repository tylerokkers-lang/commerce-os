import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { EVENT_TO_JOB_MAPPING } from '@/lib/monitoring/registry'
import { supplierMonitor, type SupplierMonitorSubject } from '@/lib/monitoring/monitors/supplierMonitor'
import { complianceMonitor, type ComplianceMonitorSubject } from '@/lib/monitoring/monitors/complianceMonitor'
import { profitabilityMonitor, type ProfitabilityMonitorSubject } from '@/lib/monitoring/monitors/profitabilityMonitor'
import { performanceMonitor, type PerformanceMonitorSubject, type PerformanceWindow } from '@/lib/monitoring/monitors/performanceMonitor'
import { marketplaceListingMonitor, type MarketplaceListingSubject } from '@/lib/monitoring/monitors/marketplaceMonitor'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'

/**
 * Consistency check for the brief's "explicit, inspectable, auditable
 * event -> automation-job-type mapping" requirement: `EVENT_TO_JOB_MAPPING`
 * (registry.ts) must not silently drift from what the monitors actually do.
 * Each enqueued job carries `correlationId === <the event's id>` (every
 * monitor's own convention), which lets this test verify, for real events
 * produced by real monitor runs, that the job type enqueued (or the absence
 * of one) agrees with the declared mapping — rather than trusting the two
 * to stay in sync by hand.
 */
function assertMappingHonoured(events: readonly { id: string; eventType: string }[], jobs: readonly { jobType: string; correlationId: string | null }[]) {
  for (const event of events) {
    const mapped = EVENT_TO_JOB_MAPPING[event.eventType]
    const job = jobs.find((j) => j.correlationId === event.id)
    if (mapped === null || mapped === undefined) {
      expect(job, `event ${event.eventType} is mapped to no job, but one was enqueued`).toBeUndefined()
    } else {
      expect(job?.jobType, `event ${event.eventType} should enqueue "${mapped}"`).toBe(mapped)
    }
  }
}

describe('EVENT_TO_JOB_MAPPING consistency with real monitor behaviour', () => {
  it('supplier monitor: out-of-stock and price-change events agree with the mapping', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const facts1 = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts: facts1, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    const subject: SupplierMonitorSubject = { supplierId: 'sup-1', productId: 'prod-1', channelProductId: 'cp-1', entityId: 'prod-1' }
    await supplierMonitor.run(ctx, [subject]) // Baseline.

    const facts2 = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(10.76), shippingCost: fromMajor(2), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })
    await supplierMonitor.run({ ...ctx, facts: facts2 }, [subject])

    assertMappingHonoured(events.getState().events, store.getState().jobs)
  })

  it('compliance monitor: stale-assessment and recheck-required events agree with the mapping', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const facts = createInMemoryFactsLoader()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    const staleSubject: ComplianceMonitorSubject = {
      channelProductId: 'cp-1', productId: 'prod-1', channel: 'amazon_uk', supplierId: 'sup-1',
      context: { approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-2', daysSinceLastAssessment: 120, productDetailsChangedSinceApproval: false },
      complianceContext: {},
    }
    await complianceMonitor.run(ctx, [staleSubject])
    assertMappingHonoured(events.getState().events, store.getState().jobs)
  })

  it('profitability monitor: price-review events agree with the mapping', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const subject: ProfitabilityMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1' }
    const factsBefore = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts: factsBefore, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    await profitabilityMonitor.run(ctx, [subject])

    const factsAfter = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(10.76), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    await profitabilityMonitor.run({ ...ctx, facts: factsAfter }, [subject])

    assertMappingHonoured(events.getState().events, store.getState().jobs)
  })

  it('profitability monitor: real margin-crossing events (Milestone 10) agree with the mapping, including the rich product_price_review payload', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const subject: ProfitabilityMonitorSubject = { productId: 'prod-margin', supplierId: 'sup-1', channelProductId: 'cp-margin', channel: 'shopify', connectorKey: 'shopify' }
    const seedFor = (unitCostMajor: number) => createInMemoryFactsLoader({
      channelProducts: { 'cp-margin': { status: 'live', priceMinor: 3000, fulfilmentSupplierId: 'sup-1', externalId: 'shopify-ext-1', lastSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
      products: { 'prod-margin': { title: 'Margin Test Product', category: null, stage: 'live', updatedAt: new Date().toISOString() } },
      offers: { 'sup-1:prod-margin': { unitCost: fromMajor(unitCostMajor), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } },
    })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts: seedFor(9), connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    await profitabilityMonitor.run(ctx, [subject]) // Baseline: profitable.
    await profitabilityMonitor.run({ ...ctx, facts: seedFor(20) }, [subject]) // Crosses to unprofitable.

    expect(events.getState().events.some((e) => e.eventType === 'PRODUCT_NO_LONGER_PROFITABLE')).toBe(true)
    assertMappingHonoured(events.getState().events, store.getState().jobs)
  })

  it('performance monitor: surge, decline, return-rate and ad-spend events agree with the mapping', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const facts = createInMemoryFactsLoader()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    const window = (unitsSold: number, returnsCount = 0, adSpendMinor = 0): PerformanceWindow => ({
      unitsSold, revenueMinor: unitsSold * 1000, returnsCount, refundsCount: 0, adSpendMinor, windowStart: '2026-08-16', windowEnd: '2026-08-23',
    })
    const subjects: PerformanceMonitorSubject[] = [
      { productId: 'prod-surge', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(100), previousWindow: window(40), adSpendLimitMinor: null },
      { productId: 'prod-decline', supplierId: 'sup-1', channelProductId: 'cp-2', currentWindow: window(20), previousWindow: window(100), adSpendLimitMinor: null },
      { productId: 'prod-returns', supplierId: 'sup-1', channelProductId: 'cp-3', currentWindow: window(100, 20), previousWindow: window(100, 5), adSpendLimitMinor: null },
      { productId: 'prod-adspend', supplierId: 'sup-1', channelProductId: 'cp-4', currentWindow: window(100, 0, 10000), previousWindow: window(100), adSpendLimitMinor: 5000 },
    ]
    await performanceMonitor.run(ctx, subjects)
    assertMappingHonoured(events.getState().events, store.getState().jobs)
  })

  it('marketplace monitor: out-of-sync events agree with the mapping', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const facts = createInMemoryFactsLoader()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: (key) => (key === 'shopify_demo' ? shopifyDemoConnector : undefined), settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    const subject: MarketplaceListingSubject = { connectorKey: 'shopify_demo', ours: { channelProductRef: 'CMO-1001', priceMinor: 999999, status: 'active', recordedAt: new Date().toISOString() } }
    await marketplaceListingMonitor.run(ctx, [subject])
    assertMappingHonoured(events.getState().events, store.getState().jobs)
  })

  it('every EVENT_TO_JOB_MAPPING entry names a job type that is either null or a real, registered job type', async () => {
    const { HANDLERS } = await import('@/lib/automation/worker')
    for (const [eventType, jobType] of Object.entries(EVENT_TO_JOB_MAPPING)) {
      if (jobType === null) continue
      expect(Object.keys(HANDLERS), `"${eventType}" maps to unregistered job type "${jobType}"`).toContain(jobType)
    }
  })
})
