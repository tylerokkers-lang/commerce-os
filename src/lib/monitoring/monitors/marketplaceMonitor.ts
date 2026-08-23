import { reconcileListings, type OurListingRecord, type OurInventoryRecord } from '@/lib/marketplaces/reconciliation'
import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Marketplace monitoring (brief §4): composes the existing
 * `reconciliation.ts` (Milestone 4) — never a second comparison
 * implementation. `ours` is deliberately whatever our own database
 * currently says (kept in sync by `priceExecution.ts`/
 * `supplierSwitchExecution.ts`'s own writes) — this is exactly what
 * prevents the automation-loop the brief warns about: a price change *we*
 * made updates `channel_products` via `reconcileChannelProduct` at the same
 * moment, so the next marketplace check compares the connector's fresh
 * read against a local record that already matches it, and reports
 * nothing. Only a genuine external divergence — something changed on the
 * marketplace that our own writes did not cause — produces an event.
 */

export interface MarketplaceListingSubject {
  connectorKey: string
  ours: OurListingRecord
}

const MONITOR_KEY = 'marketplace_listing_sync'

export const marketplaceListingMonitor: Monitor<MarketplaceListingSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Marketplace listing sync', category: 'marketplace', defaultIntervalMinutes: 60 },

  async run(ctx: MonitorContext, subjects: readonly MarketplaceListingSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let observationsCreated = 0
    let eventsCreated = 0
    let eventsDeduplicated = 0

    // Group by connector so each is fetched once, not once per subject.
    const byConnector = new Map<string, MarketplaceListingSubject[]>()
    for (const s of subjects) {
      const list = byConnector.get(s.connectorKey) ?? []
      list.push(s)
      byConnector.set(s.connectorKey, list)
    }

    for (const [connectorKey, group] of byConnector) {
      const connector = ctx.connectors(connectorKey)
      if (!connector) {
        errors.push(`No connector registered for "${connectorKey}".`)
        continue
      }

      const fetched = await connector.fetchListings({ limit: 250 })
      if (!fetched.ok) {
        // A failed fetch is UNAVAILABLE, not "listing missing" — never
        // inferred as a marketplace-side change.
        const result = await ctx.events.createEvent({
          orgId: ctx.orgId, eventType: 'EXTERNAL_ACTION_FAILED', subjectType: 'channel', subjectId: connectorKey,
          source: 'external', sourceConnectorKey: connectorKey, severity: 'warning', facts: { reason: fetched.error },
          dedupeKey: `marketplace_sync:${connectorKey}:fetch_failed`,
        })
        eventsCreated += result.deduplicated ? 0 : 1
        eventsDeduplicated += result.deduplicated ? 1 : 0
        continue
      }

      const discrepancies = reconcileListings(group.map((s) => s.ours), fetched.value.records)
      observationsCreated += group.length

      for (const discrepancy of discrepancies) {
        const dedupeKey = `marketplace_sync:${connectorKey}:${discrepancy.channelProductRef}:${discrepancy.field}`
        const eventType = discrepancy.field === 'price' ? 'LISTING_PRICE_CHANGED_EXTERNALLY' : discrepancy.field === 'listing_status' ? 'LISTING_STATUS_CHANGED_EXTERNALLY' : 'LISTING_OUT_OF_SYNC'

        const result = await ctx.events.createEvent({
          orgId: ctx.orgId, eventType, subjectType: 'channel_product', subjectId: discrepancy.channelProductRef,
          source: 'external', sourceConnectorKey: connectorKey, severity: 'warning',
          previousValue: { field: discrepancy.field, value: discrepancy.ourValue }, currentValue: { field: discrepancy.field, value: discrepancy.marketplaceValue },
          facts: { ourRecordedAt: discrepancy.ourRecordedAt, marketplaceReportedAt: discrepancy.marketplaceReportedAt }, dedupeKey,
        })

        if (!result.deduplicated) {
          eventsCreated++
          await ctx.store.enqueueJob({
            orgId: ctx.orgId, jobType: 'marketplace_reconciliation',
            payload: { connectorKey, ourInventory: group.map((s) => ({ channelProductRef: s.ours.channelProductRef, stockQty: 0, recordedAt: s.ours.recordedAt }) as OurInventoryRecord) },
            idempotencyKey: `event:${result.id}`, correlationId: result.id,
          })
        } else {
          eventsDeduplicated++
        }
      }

      // Resolve any previously-open LISTING_OUT_OF_SYNC events for subjects
      // that no longer disagree — an event does not just disappear; it is
      // explicitly superseded, keeping the audit trail intact.
      const stillDiscrepantRefs = new Set(discrepancies.map((d) => d.channelProductRef))
      for (const subject of group) {
        if (stillDiscrepantRefs.has(subject.ours.channelProductRef)) continue
        await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'channel_product', subject.ours.channelProductRef, {
          status: 'ok', value: { matched: true }, lastCheckedAt: ctx.now.toISOString(),
        })
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
