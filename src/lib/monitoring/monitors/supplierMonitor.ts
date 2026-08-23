import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Supplier monitoring (brief §1): stock availability and cost, per
 * product/supplier pair. Reuses the existing `FactsLoader`
 * (`loadSupplierFactsForProduct`, Milestone 7) — this monitor adds nothing
 * to *how* a supplier fact is read, only to *noticing when it changed* and
 * turning that into a domain event plus, where the existing job handlers
 * already know what to do about it, an automation job.
 *
 * Monitoring observes; it never acts. This module never calls a connector
 * write method, never switches a supplier, never pauses a listing — it
 * enqueues `supplier_availability_check` / `supplier_price_change`
 * (both existing Milestone 7 handlers), and the automation engine decides
 * and acts from there.
 */

export interface SupplierMonitorSubject {
  supplierId: string
  productId: string
  channelProductId: string
  entityId: string
  /** Carried through only so an enqueued job has what it needs — never used to decide anything here. */
  redundancyContext?: Record<string, unknown>
}

const MONITOR_KEY = 'supplier_stock_and_price'

function pctChange(previous: number, current: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100
}

export const supplierMonitor: Monitor<SupplierMonitorSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Supplier stock & price', category: 'supplier', defaultIntervalMinutes: 15 },

  async run(ctx: MonitorContext, subjects: readonly SupplierMonitorSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let observationsCreated = 0
    let eventsCreated = 0
    let eventsDeduplicated = 0

    for (const subject of subjects) {
      try {
        const facts = await ctx.facts.loadSupplierFactsForProduct(ctx.orgId, subject.supplierId, subject.productId)
        const previous = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'supplier_product', `${subject.supplierId}:${subject.productId}`)

        // A connector/data failure is recorded as UNAVAILABLE, never
        // silently treated as "in stock" or "out of stock" — the brief's
        // core distinction.
        const currentStatus = facts.inStock.freshness === 'unavailable' ? 'unavailable' : facts.inStock.freshness === 'unknown' ? 'unknown' : 'ok'
        const currentValue = { inStock: facts.inStock.value, stockQty: facts.stockQty.value, unitCostMinor: facts.unitCost.value?.minor ?? null }

        await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'supplier_product', `${subject.supplierId}:${subject.productId}`, {
          status: currentStatus,
          value: currentValue,
          lastCheckedAt: ctx.now.toISOString(),
        })
        observationsCreated++

        const dedupeBase = `supplier_stock:${subject.supplierId}:${subject.productId}`

        if (currentStatus === 'unavailable') {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_FEED_FAILED', subjectType: 'supplier_product', subjectId: `${subject.supplierId}:${subject.productId}`,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
            facts: { reason: 'Supplier fact could not be observed.' }, dedupeKey: `${dedupeBase}:feed_failed`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
          continue // Never infer stock status from a failed observation.
        }

        // Recovered from a previous feed failure.
        if (previous?.status === 'unavailable') {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_FEED_RECOVERED', subjectType: 'supplier_product', subjectId: `${subject.supplierId}:${subject.productId}`,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'info', dedupeKey: null,
          })
          if (!result.deduplicated) eventsCreated++
        }

        const wasInStock = previous?.value.inStock as boolean | undefined
        const isInStock = facts.inStock.value ?? false

        if (!isInStock && wasInStock !== false) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: subject.channelProductId,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
            previousValue: previous?.value ?? null, currentValue, facts: { supplierId: subject.supplierId, productId: subject.productId },
            dedupeKey: `${dedupeBase}:out_of_stock`,
          })
          if (!result.deduplicated) {
            eventsCreated++
            await ctx.store.enqueueJob({
              orgId: ctx.orgId, jobType: 'supplier_availability_check',
              payload: { entityType: 'channel_product', entityId: subject.channelProductId, request: subject.redundancyContext, previousUnitCostPlusShippingMinor: currentValue.unitCostMinor ?? 0 },
              idempotencyKey: `event:${result.id}`, correlationId: result.id,
            })
          } else {
            eventsDeduplicated++
          }
        } else if (isInStock && wasInStock === false) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'SUPPLIER_BACK_IN_STOCK', subjectType: 'channel_product', subjectId: subject.channelProductId,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'info',
            previousValue: previous?.value ?? null, currentValue, dedupeKey: null,
          })
          if (!result.deduplicated) eventsCreated++
        }

        // Price change, independent of stock — a configurable threshold,
        // never a fixed constant (brief's explicit requirement).
        const previousCostMinor = previous?.value.unitCostMinor as number | null | undefined
        const currentCostMinor = facts.unitCost.value?.minor ?? null
        if (typeof previousCostMinor === 'number' && typeof currentCostMinor === 'number' && previousCostMinor > 0) {
          const change = pctChange(previousCostMinor, currentCostMinor)
          const thresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:price_threshold_pct`, 3)
          if (Math.abs(change) >= thresholdPct) {
            const eventType = change > 0 ? 'SUPPLIER_PRICE_INCREASED' : 'SUPPLIER_PRICE_DECREASED'
            const result = await ctx.events.createEvent({
              orgId: ctx.orgId, eventType, subjectType: 'channel_product', subjectId: subject.channelProductId,
              source: 'external', sourceConnectorKey: subject.supplierId, severity: change > 0 ? 'warning' : 'info',
              previousValue: { unitCostMinor: previousCostMinor }, currentValue: { unitCostMinor: currentCostMinor },
              facts: { changePct: change }, dedupeKey: `${dedupeBase}:price:${Math.sign(change)}`,
            })
            if (!result.deduplicated) {
              eventsCreated++
              await ctx.store.enqueueJob({
                orgId: ctx.orgId, jobType: 'supplier_price_change',
                payload: { productId: subject.productId, supplierId: subject.supplierId, channelProductId: subject.channelProductId, previousUnitCostMinor: previousCostMinor, newUnitCostMinor: currentCostMinor },
                idempotencyKey: `event:${result.id}`, correlationId: result.id,
              })
            } else {
              eventsDeduplicated++
            }
          }
        }
      } catch (error) {
        errors.push(`${subject.supplierId}:${subject.productId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
