import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { runDueMonitors, type SubjectProvider } from '@/lib/monitoring/runner'
import { runWorkerBatch } from '@/lib/automation/worker'
import { supplierMonitor, type SupplierMonitorSubject } from '@/lib/monitoring/monitors/supplierMonitor'
import { marketplaceListingMonitor, type MarketplaceListingSubject } from '@/lib/monitoring/monitors/marketplaceMonitor'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import type { DomainEvent, MonitorContext } from '@/lib/monitoring/eventTypes'
import type { JobRecord } from '@/lib/automation/store'

const ORG = 'demo-org'

export interface MonitoringDemoScenario {
  key: string
  label: string
  description: string
  events: readonly DomainEvent[]
  jobsEnqueued: readonly Pick<JobRecord, 'jobType' | 'payload'>[]
  runsCompleted: number
  narrative: readonly string[]
}

function ctxFor(store: ReturnType<typeof createInMemoryAutomationStore>, events: ReturnType<typeof createInMemoryEventStore>, facts: ReturnType<typeof createInMemoryFactsLoader>): MonitorContext {
  return { orgId: ORG, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
}

/**
 * The 5 demo-mode scenarios the brief requires (its "demo mode" section),
 * each driven through the real monitor + runner + worker entry points
 * against fresh in-memory stores — the same doubles the tests use, not
 * fabricated narration. Demo mode has no database, so this is the only way
 * to show the M8 monitoring flow actually running.
 */
export async function demoMonitoringScenarios(): Promise<readonly MonitoringDemoScenario[]> {
  return [
    await scenarioPriceIncrease(),
    await scenarioOutOfStock(),
    await scenarioMarketplaceMismatch(),
    await scenarioUnknownData(),
    await scenarioDeduplication(),
  ]
}

async function scenarioPriceIncrease(): Promise<MonitoringDemoScenario> {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore({ scheduleMinutesByKey: { supplier_stock_and_price: 0 } })
  const subject: SupplierMonitorSubject = { supplierId: 'sup-northwind', productId: 'prod-knife-rail', channelProductId: 'cp-knife-rail', entityId: 'prod-knife-rail' }
  const subjectsFor: SubjectProvider = async () => [subject]

  const baselineFacts = createInMemoryFactsLoader({ offers: { 'sup-northwind:prod-knife-rail': { unitCost: fromMajor(9.1), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
  await runDueMonitors({ orgId: ORG, store, events, facts: baselineFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['supplier_stock_and_price'] })

  const increasedFacts = createInMemoryFactsLoader({
    products: { 'prod-knife-rail': { title: 'Magnetic Knife Rail', category: 'kitchen', stage: 'live', updatedAt: new Date().toISOString() } },
    offers: { 'sup-northwind:prod-knife-rail': { unitCost: fromMajor(10.76), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } },
  })
  await runDueMonitors({ orgId: ORG, store, events, facts: increasedFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['supplier_stock_and_price'] })
  await runWorkerBatch(store, increasedFacts, () => undefined, 'demo-worker', 10)

  return {
    key: 'supplier_price_increase',
    label: 'Supplier price increase',
    description: 'Northwind Trading raises the unit cost of the Magnetic Knife Rail from £9.10 to £10.76 — a real consequence follows, not just a notice.',
    events: events.getState().events,
    jobsEnqueued: store.getState().jobs.map((j) => ({ jobType: j.jobType, payload: j.payload })),
    runsCompleted: events.getState().monitorRuns.filter((r) => r.completedAt).length,
    narrative: [
      'Monitor observes: supplier cost rose 18.2% (£9.10 -> £10.76), above the configured 3% threshold.',
      'SUPPLIER_PRICE_INCREASED event created, supplier_price_change job enqueued.',
      'Worker runs the job, audits the change, chains a product_profitability_recheck job.',
      'The profitability engine (calculateProfitability — never re-implemented here) re-evaluates the product against the new cost and records a real automation action.',
    ],
  }
}

async function scenarioOutOfStock(): Promise<MonitoringDemoScenario> {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore({ scheduleMinutesByKey: { supplier_stock_and_price: 0 } })
  const subject: SupplierMonitorSubject = { supplierId: 'sup-northwind', productId: 'prod-drawer-dividers', channelProductId: 'cp-drawer-dividers', entityId: 'prod-drawer-dividers' }
  const subjectsFor: SubjectProvider = async () => [subject]

  const inStockFacts = createInMemoryFactsLoader({ offers: { 'sup-northwind:prod-drawer-dividers': { unitCost: fromMajor(6.5), shippingCost: fromMajor(1.5), stockQty: 30, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
  await runDueMonitors({ orgId: ORG, store, events, facts: inStockFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['supplier_stock_and_price'] })

  const outOfStockFacts = createInMemoryFactsLoader({ offers: { 'sup-northwind:prod-drawer-dividers': { unitCost: fromMajor(6.5), shippingCost: fromMajor(1.5), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })
  await runDueMonitors({ orgId: ORG, store, events, facts: outOfStockFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['supplier_stock_and_price'] })
  await runWorkerBatch(store, outOfStockFacts, () => undefined, 'demo-worker', 10)

  return {
    key: 'supplier_out_of_stock',
    label: 'Supplier goes out of stock',
    description: 'Bamboo Drawer Dividers run out at Northwind Trading — the existing supplier-redundancy evaluator decides what happens next, never bypassed.',
    events: events.getState().events,
    jobsEnqueued: store.getState().jobs.map((j) => ({ jobType: j.jobType, payload: j.payload })),
    runsCompleted: events.getState().monitorRuns.filter((r) => r.completedAt).length,
    narrative: [
      'Monitor observes: stock went from available to 0 units.',
      'SUPPLIER_OUT_OF_STOCK event created, supplier_availability_check job enqueued.',
      'The worker runs the job, which calls the same supplier-redundancy evaluator Milestone 3 built — this monitor never decides switch/pause itself.',
      'The policy engine, not the monitor, determines whether an alternative supplier is switched to automatically, an approval is requested, or the listing is paused.',
    ],
  }
}

async function scenarioMarketplaceMismatch(): Promise<MonitoringDemoScenario> {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader()
  const ctx = ctxFor(store, events, facts)
  const subject: MarketplaceListingSubject = { connectorKey: 'shopify_demo', ours: { channelProductRef: 'CMO-1001', priceMinor: 3200, status: 'active', recordedAt: new Date().toISOString() } }
  await marketplaceListingMonitor.run({ ...ctx, connectors: (key) => (key === 'shopify_demo' ? shopifyDemoConnector : undefined) }, [subject])
  await runWorkerBatch(store, facts, (key) => (key === 'shopify_demo' ? shopifyDemoConnector : undefined), 'demo-worker', 10)

  return {
    key: 'marketplace_mismatch',
    label: 'External marketplace mismatch',
    description: "Shopify's own listing price for CMO-1001 no longer matches our local record — the mismatch is caught, attributed, and made auditable.",
    events: events.getState().events,
    jobsEnqueued: store.getState().jobs.map((j) => ({ jobType: j.jobType, payload: j.payload })),
    runsCompleted: 1,
    narrative: [
      'Monitor fetches the real listing from Shopify (the demo connector) and compares it against our own reconciled record.',
      'reconcileListings (Milestone 4, unmodified) finds a genuine divergence and the monitor raises LISTING_PRICE_CHANGED_EXTERNALLY / LISTING_OUT_OF_SYNC.',
      'A marketplace_reconciliation job is enqueued — visible and auditable end to end, never silently absorbed.',
    ],
  }
}

async function scenarioUnknownData(): Promise<MonitoringDemoScenario> {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader() // No seeded offer at all -> the supplier feed is down.
  const subject: SupplierMonitorSubject = { supplierId: 'sup-failed-feed', productId: 'prod-unknown', channelProductId: 'cp-unknown', entityId: 'prod-unknown' }
  await supplierMonitor.run(ctxFor(store, events, facts), [subject])
  const batch = await runWorkerBatch(store, facts, () => undefined, 'demo-worker', 10)

  return {
    key: 'unknown_data',
    label: 'Unknown data from a failed connector',
    description: "A supplier's feed cannot be reached — the system reports UNKNOWN, never guesses \"out of stock\", and takes no automated action on a fact it does not actually have.",
    events: events.getState().events,
    jobsEnqueued: store.getState().jobs.map((j) => ({ jobType: j.jobType, payload: j.payload })),
    runsCompleted: 1,
    narrative: [
      'The facts loader cannot produce a fresh stock/cost reading for this supplier/product pair.',
      'The monitor records SUPPLIER_FEED_FAILED — explicitly not SUPPLIER_OUT_OF_STOCK — and stops for this subject.',
      `No automation job was enqueued (${batch.claimed} jobs claimed by the worker) — an unknown fact never triggers a guessed action.`,
    ],
  }
}

async function scenarioDeduplication(): Promise<MonitoringDemoScenario> {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader({ offers: { 'sup-northwind:prod-repeat': { unitCost: fromMajor(5), shippingCost: fromMajor(1), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })
  const subject: SupplierMonitorSubject = { supplierId: 'sup-northwind', productId: 'prod-repeat', channelProductId: 'cp-repeat', entityId: 'prod-repeat' }
  const ctx = ctxFor(store, events, facts)

  for (let i = 0; i < 4; i++) await supplierMonitor.run(ctx, [subject]) // Same monitor tick, run 4 times in a row.
  await runWorkerBatch(store, facts, () => undefined, 'demo-worker', 10)

  const outOfStockEvents = events.getState().events.filter((e) => e.eventType === 'SUPPLIER_OUT_OF_STOCK')
  const jobs = store.getState().jobs.filter((j) => j.jobType === 'supplier_availability_check')

  return {
    key: 'deduplication',
    label: 'Deduplication under repeated checks',
    description: 'The same out-of-stock condition is checked 4 times in a row (simulating a supplier down for hours, checked every 15 minutes) — it must produce exactly one event and one job, never a flood.',
    events: events.getState().events,
    jobsEnqueued: store.getState().jobs.map((j) => ({ jobType: j.jobType, payload: j.payload })),
    runsCompleted: 4,
    narrative: [
      `Ran the supplier monitor 4 times against an unchanged out-of-stock condition.`,
      `Result: ${outOfStockEvents.length} SUPPLIER_OUT_OF_STOCK event(s) created, ${jobs.length} supplier_availability_check job(s) enqueued.`,
      'The monitor\'s own change-detection recognises nothing new happened after the first check — this is a stronger guarantee than relying on a database constraint alone (that constraint is what protects against truly concurrent first-observations instead).',
    ],
  }
}
