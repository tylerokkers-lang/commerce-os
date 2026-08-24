import { describe, expect, it } from 'vitest'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader, type SeedSupplierOperations } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { supplierOperationsMonitor, type SupplierOperationsSubject } from '@/lib/monitoring/monitors/supplierOperationsMonitor'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'
const SUBJECT: SupplierOperationsSubject = { supplierId: 'sup-1' }

function makeCtx(ops?: Record<string, SeedSupplierOperations>) {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader({ supplierOperations: ops })
  const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
  return { ctx, events }
}

const HEALTHY: SeedSupplierOperations = {
  dispatchDaysMin: 1, dispatchDaysMax: 2, cancellationRatePct: 1, fulfilmentSuccessRatePct: 98,
  observedDeliveryDays: 3, connectorStatus: 'healthy', asOf: new Date().toISOString(),
}

describe('supplier operations monitor', () => {
  it('healthy operational data creates no event', async () => {
    const { ctx, events } = makeCtx({ 'sup-1': HEALTHY })
    await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events).toHaveLength(0)
  })

  it('dispatch time beyond the threshold creates SUPPLIER_DISPATCH_DELAYED', async () => {
    const { ctx, events } = makeCtx({ 'sup-1': { ...HEALTHY, dispatchDaysMax: 10 } })
    const outcome = await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('SUPPLIER_DISPATCH_DELAYED')
  })

  it('observed delivery time beyond the threshold creates SUPPLIER_DELIVERY_DELAYED, distinct from the quoted dispatch estimate', async () => {
    const { ctx, events } = makeCtx({ 'sup-1': { ...HEALTHY, observedDeliveryDays: 25 } })
    await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_DELIVERY_DELAYED')).toBe(true)
  })

  it('cancellation rate beyond the threshold creates SUPPLIER_CANCELLATION_RATE_INCREASED', async () => {
    const { ctx, events } = makeCtx({ 'sup-1': { ...HEALTHY, cancellationRatePct: 15 } })
    await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_CANCELLATION_RATE_INCREASED')).toBe(true)
  })

  it('fulfilment reliability dropping below the floor creates SUPPLIER_FULFILMENT_RELIABILITY_DETERIORATED, and recovering resolves with RECOVERED', async () => {
    const { ctx, events } = makeCtx({ 'sup-1': { ...HEALTHY, fulfilmentSuccessRatePct: 70 } })
    await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_FULFILMENT_RELIABILITY_DETERIORATED')).toBe(true)

    const facts2 = createInMemoryFactsLoader({ supplierOperations: { 'sup-1': { ...HEALTHY, fulfilmentSuccessRatePct: 96 } } })
    await supplierOperationsMonitor.run({ ...ctx, facts: facts2 }, [SUBJECT])
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_FULFILMENT_RELIABILITY_RECOVERED')).toBe(true)
  })

  it('a supplier whose connector has never run reports SUPPLIER_FEED_FAILED, never a false-healthy reading', async () => {
    const { ctx, events } = makeCtx() // No seeded operational data at all.
    const outcome = await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('SUPPLIER_FEED_FAILED')
  })

  it('a stale (aged) feed reports SUPPLIER_FEED_STALE, distinct from a never-observed feed, and never triggers dispatch/cancellation events off aged numbers', async () => {
    const oldAsOf = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString() // 10 days old, connector run — clearly stale.
    const { ctx, events } = makeCtx({ 'sup-1': { ...HEALTHY, dispatchDaysMax: 30, asOf: oldAsOf } })
    const outcome = await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_FEED_STALE')).toBe(true)
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_DISPATCH_DELAYED')).toBe(false) // Never trusts stale figures for an operational verdict.
    expect(outcome.eventsCreated).toBe(1)
  })

  it('recovering from a feed failure creates SUPPLIER_FEED_RECOVERED', async () => {
    const { ctx, events } = makeCtx() // Unavailable first.
    await supplierOperationsMonitor.run(ctx, [SUBJECT])

    const facts2 = createInMemoryFactsLoader({ supplierOperations: { 'sup-1': HEALTHY } })
    await supplierOperationsMonitor.run({ ...ctx, facts: facts2 }, [SUBJECT])
    expect(events.getState().events.some((e) => e.eventType === 'SUPPLIER_FEED_RECOVERED')).toBe(true)
  })

  it('repeated runs against an unchanged dispatch-delay condition deduplicate to one open event', async () => {
    const { ctx, events } = makeCtx({ 'sup-1': { ...HEALTHY, dispatchDaysMax: 10 } })
    await supplierOperationsMonitor.run(ctx, [SUBJECT])
    await supplierOperationsMonitor.run(ctx, [SUBJECT])
    await supplierOperationsMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events.filter((e) => e.eventType === 'SUPPLIER_DISPATCH_DELAYED' && e.status === 'open')).toHaveLength(1)
  })

  it('a fact-loader error for one supplier does not stop the run for another (partial success)', async () => {
    const { ctx } = makeCtx({ 'sup-1': HEALTHY })
    const brokenFacts = { ...ctx.facts, loadSupplierOperationalFacts: async () => { throw new Error('boom') } }
    const outcome = await supplierOperationsMonitor.run({ ...ctx, facts: brokenFacts }, [SUBJECT, { supplierId: 'sup-2' }])
    expect(outcome.errors).toHaveLength(2)
    expect(outcome.subjectsChecked).toBe(2)
  })
})
