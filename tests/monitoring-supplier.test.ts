import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { supplierMonitor, type SupplierMonitorSubject } from '@/lib/monitoring/monitors/supplierMonitor'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'

function makeCtx(overrides: Partial<{ offers: Record<string, { unitCost: ReturnType<typeof fromMajor>; shippingCost: ReturnType<typeof fromMajor>; stockQty: number | null; inStock: boolean; lastVerifiedAt: string | null }> }> = {}) {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader({ offers: overrides.offers })
  const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
  return { ctx, store, events, facts }
}

const SUBJECT: SupplierMonitorSubject = { supplierId: 'sup-1', productId: 'prod-1', channelProductId: 'cp-1', entityId: 'prod-1' }

describe('supplier monitor', () => {
  it('a genuine out-of-stock transition creates an event and enqueues supplier_availability_check', async () => {
    const { ctx, store, events } = makeCtx({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })
    const outcome = await supplierMonitor.run(ctx, [SUBJECT])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('SUPPLIER_OUT_OF_STOCK')
    expect(store.getState().jobs.some((j) => j.jobType === 'supplier_availability_check')).toBe(true)
  })

  it('running the same unchanged out-of-stock condition again does not create a second event or job (deduplication)', async () => {
    const { ctx, store, events } = makeCtx({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })

    await supplierMonitor.run(ctx, [SUBJECT])
    const second = await supplierMonitor.run(ctx, [SUBJECT])

    // No new event and no new job: the monitor's own change-detection
    // (comparing against `monitor_observations`) already recognises
    // nothing changed, so it never even attempts a second `createEvent`
    // call — a stronger guarantee than relying on the database's dedupe
    // constraint alone. `tests/monitoring-concurrency.test.ts` covers the
    // case that constraint actually exists for: two *simultaneous* first
    // observations of the same new condition.
    expect(second.eventsCreated).toBe(0)
    expect(events.getState().events.filter((e) => e.eventType === 'SUPPLIER_OUT_OF_STOCK')).toHaveLength(1)
    expect(store.getState().jobs.filter((j) => j.jobType === 'supplier_availability_check')).toHaveLength(1)
  })

  it('running the monitor five times against an unchanged condition still creates exactly one event (brief scenario 5)', async () => {
    const { ctx, events } = makeCtx({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })
    for (let i = 0; i < 5; i++) await supplierMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events.filter((e) => e.eventType === 'SUPPLIER_OUT_OF_STOCK')).toHaveLength(1)
  })

  it('coming back into stock creates SUPPLIER_BACK_IN_STOCK relating to the same condition', async () => {
    const { ctx, facts, events } = makeCtx({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })
    await supplierMonitor.run(ctx, [SUBJECT])

    // Simulate stock returning by pointing the facts loader at a new seed.
    const recoveredFacts = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const ctx2 = { ...ctx, facts: recoveredFacts }
    const outcome = await supplierMonitor.run(ctx2, [SUBJECT])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_BACK_IN_STOCK')).toBe(true)
    void facts
  })

  it('a supplier price change above the configured threshold creates an event and chains a profitability recheck', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'supplier_stock_and_price:price_threshold_pct': 3 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts1 = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts: facts1, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    await supplierMonitor.run(ctx, [SUBJECT]) // Establishes the baseline observation.

    const facts2 = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(10.76), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const outcome = await supplierMonitor.run({ ...ctx, facts: facts2 }, [SUBJECT])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_PRICE_INCREASED')).toBe(true)
    expect(store.getState().jobs.some((j) => j.jobType === 'supplier_price_change')).toBe(true)
  })

  it('a price change below the configured threshold never creates an event', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'supplier_stock_and_price:price_threshold_pct': 5 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts1 = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(10), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts: facts1, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    await supplierMonitor.run(ctx, [SUBJECT])

    const facts2 = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(10.01), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } }) // £10.00 -> £10.01
    const outcome = await supplierMonitor.run({ ...ctx, facts: facts2 }, [SUBJECT])

    expect(outcome.eventsCreated).toBe(0)
  })

  it('an unavailable supplier fact (connector failure) creates SUPPLIER_FEED_FAILED, never an out-of-stock assumption', async () => {
    const { ctx, events } = makeCtx() // No seeded offer at all -> unavailable.
    const outcome = await supplierMonitor.run(ctx, [SUBJECT])

    expect(outcome.eventsCreated).toBe(1)
    const event = events.getState().events[0]
    expect(event.eventType).toBe('SUPPLIER_FEED_FAILED')
    expect(event.eventType).not.toBe('SUPPLIER_OUT_OF_STOCK')
  })

  it('recovering from a feed failure creates SUPPLIER_FEED_RECOVERED', async () => {
    const { ctx, events } = makeCtx() // Unavailable first.
    await supplierMonitor.run(ctx, [SUBJECT])

    const recoveredFacts = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    await supplierMonitor.run({ ...ctx, facts: recoveredFacts }, [SUBJECT])

    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_FEED_RECOVERED')).toBe(true)
  })

  it('a connector error during one subject does not stop the whole run (partial success)', async () => {
    const { ctx } = makeCtx({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const brokenFacts = { ...ctx.facts, loadSupplierFactsForProduct: async () => { throw new Error('boom') } }
    const outcome = await supplierMonitor.run({ ...ctx, facts: brokenFacts }, [SUBJECT, { ...SUBJECT, productId: 'prod-2', channelProductId: 'cp-2' }])
    expect(outcome.errors).toHaveLength(2)
    expect(outcome.subjectsChecked).toBe(2)
  })
})
