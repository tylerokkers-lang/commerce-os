import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Supplier operational intelligence (Milestone 8.5 §5) — dispatch time,
 * delivery performance, cancellation rate, and connector feed health.
 * Deliberately a separate monitor from `supplierMonitor.ts` (stock/price):
 * different facts, different cadence, and a different fact source
 * (`loadSupplierOperationalFacts`, not `loadSupplierFactsForProduct`).
 *
 * Feeds `docs/PRINCIPLES.md`'s existing supplier-scoring architecture only
 * by surfacing real facts for a human (or, later, the automation policy
 * engine) to act on — it never recomputes `scoreSupplier`'s weighted total
 * itself, and never assumes a cheaper supplier is better because its price
 * looks good in isolation.
 */

export interface SupplierOperationsSubject {
  supplierId: string
}

const MONITOR_KEY = 'supplier_operations'

export const supplierOperationsMonitor: Monitor<SupplierOperationsSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Supplier operations', category: 'supplier', defaultIntervalMinutes: 6 * 60 },

  async run(ctx: MonitorContext, subjects: readonly SupplierOperationsSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let observationsCreated = 0
    let eventsCreated = 0
    let eventsDeduplicated = 0

    const dispatchDelayThresholdDays = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:dispatch_delay_days`, 5)
    const deliveryDelayThresholdDays = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:delivery_delay_days`, 14)
    const cancellationRateThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:cancellation_rate_threshold_pct`, 5)
    const reliabilityFloorPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:fulfilment_reliability_floor_pct`, 90)

    for (const subject of subjects) {
      try {
        const facts = await ctx.facts.loadSupplierOperationalFacts(ctx.orgId, subject.supplierId)
        const previous = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'supplier', subject.supplierId)

        // Connector feed health, distinguishing "never observed" (unknown),
        // "no longer answering" (unavailable) and "answering, but ageing"
        // (stale) — never conflated with each other or with the operational
        // figures below.
        const feedFreshness = facts.connectorStatus.freshness
        if (feedFreshness === 'unavailable') {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_FEED_FAILED', subjectType: 'supplier', subjectId: subject.supplierId,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
            facts: { reason: 'No supplier connector run has ever been observed for this supplier.' }, dedupeKey: `supplier_ops:${subject.supplierId}:feed_failed`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
        } else if (feedFreshness === 'stale') {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_FEED_STALE', subjectType: 'supplier', subjectId: subject.supplierId,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
            facts: { asOf: facts.connectorStatus.asOf }, dedupeKey: `supplier_ops:${subject.supplierId}:feed_stale`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
        } else if (previous?.value.feedWasDown === true) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_FEED_RECOVERED', subjectType: 'supplier', subjectId: subject.supplierId,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'info', dedupeKey: null,
          })
          if (!result.deduplicated) eventsCreated++
        }

        await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'supplier', subject.supplierId, {
          status: feedFreshness === 'unavailable' ? 'unavailable' : feedFreshness === 'unknown' ? 'unknown' : 'ok',
          value: { feedWasDown: feedFreshness === 'unavailable' || feedFreshness === 'stale' },
          lastCheckedAt: ctx.now.toISOString(),
        })
        observationsCreated++

        // A down/stale feed is exactly the case where the operational
        // figures below cannot be trusted either — they would be the same
        // ageing numbers a live check would refuse to certify as current.
        if (feedFreshness === 'unavailable' || feedFreshness === 'stale') continue

        if (facts.dispatchDaysMax.value !== null && facts.dispatchDaysMax.value > dispatchDelayThresholdDays) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_DISPATCH_DELAYED', subjectType: 'supplier', subjectId: subject.supplierId,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
            currentValue: { dispatchDaysMax: facts.dispatchDaysMax.value }, facts: { thresholdDays: dispatchDelayThresholdDays },
            dedupeKey: `supplier_ops:${subject.supplierId}:dispatch_delayed`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
        }

        if (facts.observedDeliveryDays.value !== null && facts.observedDeliveryDays.value > deliveryDelayThresholdDays) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_DELIVERY_DELAYED', subjectType: 'supplier', subjectId: subject.supplierId,
            source: 'internal', severity: 'warning',
            currentValue: { observedDeliveryDays: facts.observedDeliveryDays.value }, facts: { thresholdDays: deliveryDelayThresholdDays, basis: 'Average of the supplier\'s most recent completed shipments (shipped_at to delivered_at).' },
            dedupeKey: `supplier_ops:${subject.supplierId}:delivery_delayed`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
        }

        if (facts.cancellationRatePct.value !== null && facts.cancellationRatePct.value > cancellationRateThresholdPct) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_CANCELLATION_RATE_INCREASED', subjectType: 'supplier', subjectId: subject.supplierId,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
            currentValue: { cancellationRatePct: facts.cancellationRatePct.value }, facts: { thresholdPct: cancellationRateThresholdPct },
            dedupeKey: `supplier_ops:${subject.supplierId}:cancellation_rate`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
        }

        if (facts.fulfilmentSuccessRatePct.value !== null) {
          const previousReliability = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'supplier', `${subject.supplierId}:reliability`)
          const belowFloor = facts.fulfilmentSuccessRatePct.value < reliabilityFloorPct
          const wasBelowFloor = previousReliability?.value.reliabilityBelowFloor === true
          if (belowFloor && !wasBelowFloor) {
            const result = await ctx.events.createEvent({
              orgId: ctx.orgId, eventType: 'SUPPLIER_FULFILMENT_RELIABILITY_DETERIORATED', subjectType: 'supplier', subjectId: subject.supplierId,
              source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
              currentValue: { fulfilmentSuccessRatePct: facts.fulfilmentSuccessRatePct.value }, facts: { floorPct: reliabilityFloorPct },
              dedupeKey: `supplier_ops:${subject.supplierId}:reliability_deteriorated`,
            })
            eventsCreated += result.deduplicated ? 0 : 1
            eventsDeduplicated += result.deduplicated ? 1 : 0
          } else if (!belowFloor && wasBelowFloor) {
            const result = await ctx.events.createEvent({
              orgId: ctx.orgId, eventType: 'SUPPLIER_FULFILMENT_RELIABILITY_RECOVERED', subjectType: 'supplier', subjectId: subject.supplierId,
              source: 'external', sourceConnectorKey: subject.supplierId, severity: 'info',
              currentValue: { fulfilmentSuccessRatePct: facts.fulfilmentSuccessRatePct.value }, dedupeKey: null,
            })
            if (!result.deduplicated) eventsCreated++
          }

          await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'supplier', `${subject.supplierId}:reliability`, {
            status: 'ok', value: { reliabilityBelowFloor: belowFloor }, lastCheckedAt: ctx.now.toISOString(),
          })
          observationsCreated++
        }
      } catch (error) {
        errors.push(`${subject.supplierId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
