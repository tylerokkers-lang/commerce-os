import { describe, expect, it } from 'vitest'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { marketplaceListingMonitor, type MarketplaceListingSubject } from '@/lib/monitoring/monitors/marketplaceMonitor'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'

function makeCtx() {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader()
  const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: (key) => (key === 'shopify_demo' ? shopifyDemoConnector : undefined), settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
  return { ctx, store, events }
}

describe('marketplace listing monitor', () => {
  it('a genuine mismatch against the marketplace creates LISTING_OUT_OF_SYNC and enqueues reconciliation', async () => {
    const { ctx, store, events } = makeCtx()
    const subject: MarketplaceListingSubject = { connectorKey: 'shopify_demo', ours: { channelProductRef: 'CMO-1001', priceMinor: 999999, status: 'active', recordedAt: new Date().toISOString() } }
    const outcome = await marketplaceListingMonitor.run(ctx, [subject])

    expect(outcome.eventsCreated).toBeGreaterThan(0)
    expect(events.getState().events.some((e) => e.eventType.startsWith('LISTING_'))).toBe(true)
    expect(store.getState().jobs.some((j) => j.jobType === 'marketplace_reconciliation')).toBe(true)
  })

  it('when our own record already matches the marketplace, nothing is reported (loop prevention)', async () => {
    const { ctx } = makeCtx()
    // The demo connector's real price for CMO-1001 — matching this exactly
    // proves the "our own recent write already reconciled this" case
    // reports nothing, which is what prevents an automation loop.
    const fetched = await shopifyDemoConnector.fetchListings({ limit: 250 })
    if (!fetched.ok) throw new Error('demo connector fetch failed')
    const listing = fetched.value.records.find((l) => l.channelProductRef === 'CMO-1001')!
    const subject: MarketplaceListingSubject = { connectorKey: 'shopify_demo', ours: { channelProductRef: 'CMO-1001', priceMinor: listing.priceMinor, status: 'live', recordedAt: new Date().toISOString() } }
    const outcome = await marketplaceListingMonitor.run(ctx, [subject])

    expect(outcome.eventsCreated).toBe(0)
  })

  it('running the same mismatch repeatedly deduplicates to one open event', async () => {
    const { ctx, events } = makeCtx()
    const subject: MarketplaceListingSubject = { connectorKey: 'shopify_demo', ours: { channelProductRef: 'CMO-1001', priceMinor: 1, status: 'active', recordedAt: new Date().toISOString() } }
    await marketplaceListingMonitor.run(ctx, [subject])
    await marketplaceListingMonitor.run(ctx, [subject])
    await marketplaceListingMonitor.run(ctx, [subject])

    const priceEvents = events.getState().events.filter((e) => e.eventType === 'LISTING_PRICE_CHANGED_EXTERNALLY' && e.status === 'open')
    expect(priceEvents).toHaveLength(1)
  })

  it('a connector fetch failure creates an EXTERNAL_ACTION_FAILED event, never an invented listing state', async () => {
    const { ctx, events } = makeCtx()
    const brokenConnector: typeof shopifyDemoConnector = Object.create(shopifyDemoConnector, {
      fetchListings: { value: async () => ({ ok: false as const, error: 'timeout' }) },
    })
    const ctxWithBrokenConnector = { ...ctx, connectors: () => brokenConnector }
    const subject: MarketplaceListingSubject = { connectorKey: 'shopify_demo', ours: { channelProductRef: 'CMO-1001', priceMinor: 1000, status: 'active', recordedAt: new Date().toISOString() } }
    const outcome = await marketplaceListingMonitor.run(ctxWithBrokenConnector, [subject])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('EXTERNAL_ACTION_FAILED')
  })

  it('an unregistered connector key is reported as an error, not silently ignored', async () => {
    const { ctx } = makeCtx()
    const subject: MarketplaceListingSubject = { connectorKey: 'no_such_connector', ours: { channelProductRef: 'CMO-1001', priceMinor: 1000, status: 'active', recordedAt: new Date().toISOString() } }
    const outcome = await marketplaceListingMonitor.run(ctx, [subject])
    expect(outcome.errors).toHaveLength(1)
  })
})
