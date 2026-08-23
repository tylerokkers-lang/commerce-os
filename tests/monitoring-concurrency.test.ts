import { describe, expect, it } from 'vitest'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { fromMajor } from '@/lib/core/money'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { supplierMonitor, type SupplierMonitorSubject } from '@/lib/monitoring/monitors/supplierMonitor'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'

describe('event deduplication under real concurrency', () => {
  it('two concurrent createEvent calls for the same new condition produce exactly one open event', async () => {
    const store = createInMemoryEventStore()
    const [a, b] = await Promise.all([
      store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' }),
      store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' }),
    ])

    expect(a.id).toBe(b.id) // Both calls resolve to the same single event.
    expect([a.deduplicated, b.deduplicated].filter(Boolean)).toHaveLength(1) // Exactly one of the two lost the race.
    expect(store.getState().events.filter((e) => e.dedupeKey === 'stock:cp-1')).toHaveLength(1)
  })

  it('ten concurrent createEvent calls for the same condition still produce exactly one open event', async () => {
    const store = createInMemoryEventStore()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })),
    )
    const uniqueIds = new Set(results.map((r) => r.id))
    expect(uniqueIds.size).toBe(1)
    expect(results.filter((r) => r.deduplicated)).toHaveLength(9)
    expect(store.getState().events).toHaveLength(1)
  })

  it('two concurrent monitor runs checking the same supplier cannot both enqueue a duplicate automation job', async () => {
    const events = createInMemoryEventStore()
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 0, inStock: false, lastVerifiedAt: new Date().toISOString() } } })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    const subject: SupplierMonitorSubject = { supplierId: 'sup-1', productId: 'prod-1', channelProductId: 'cp-1', entityId: 'prod-1' }

    await Promise.all([supplierMonitor.run(ctx, [subject]), supplierMonitor.run(ctx, [subject])])

    expect(events.getState().events.filter((e) => e.eventType === 'SUPPLIER_OUT_OF_STOCK')).toHaveLength(1)
    expect(store.getState().jobs.filter((j) => j.jobType === 'supplier_availability_check')).toHaveLength(1)
  })
})
