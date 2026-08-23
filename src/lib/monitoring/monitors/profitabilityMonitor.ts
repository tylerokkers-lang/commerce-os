import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Profitability monitoring (brief §2): the periodic safety net alongside
 * the price/stock monitors' explicit chaining. This module performs no
 * margin calculation itself — it loads the same live supplier facts
 * `product_profitability_recheck` (Milestone 7) already knows how to use,
 * and its only job is noticing when the profitable/unprofitable *boundary*
 * was crossed since the last check, so it never re-announces "still
 * unprofitable" on every tick. The actual recheck — and the real margin
 * arithmetic — happens once the enqueued job runs `evaluateProductMonitoring`
 * (Milestone 6), which itself calls `calculateProfitability` (the one
 * profitability engine in this codebase).
 */

export interface ProfitabilityMonitorSubject {
  productId: string
  supplierId: string
  channelProductId: string
}

const MONITOR_KEY = 'profitability_safety_net'

export const profitabilityMonitor: Monitor<ProfitabilityMonitorSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Profitability safety net', category: 'profitability', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly ProfitabilityMonitorSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let observationsCreated = 0
    let eventsCreated = 0
    let eventsDeduplicated = 0

    for (const subject of subjects) {
      try {
        const supplier = await ctx.facts.loadSupplierFactsForProduct(ctx.orgId, subject.supplierId, subject.productId)
        if (supplier.unitCost.freshness === 'unavailable' || supplier.unitCost.freshness === 'unknown' || supplier.unitCost.value === null) {
          continue // Stale/missing facts block silently here; the recheck job itself records the fact-first "blocked" reason if actually invoked.
        }

        const previous = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'product', subject.productId)
        const previousKnownProfitable = previous?.value.isProfitable as boolean | undefined

        // A pure boundary check, not a margin calculation: has the
        // supplier's own cost moved since we last looked? If not, there is
        // nothing new for the recheck job to say, and no event is raised.
        const previousCostMinor = previous?.value.unitCostMinor as number | undefined
        const currentCostMinor = supplier.unitCost.value.minor
        const hasBaseline = typeof previousCostMinor === 'number'
        const costUnchanged = previousCostMinor === currentCostMinor

        await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'product', subject.productId, {
          status: 'ok', value: { unitCostMinor: currentCostMinor, isProfitable: previousKnownProfitable ?? true }, lastCheckedAt: ctx.now.toISOString(),
        })
        observationsCreated++

        // No prior observation: this establishes the baseline silently,
        // matching supplierMonitor's behaviour — the first-ever look at a
        // fact is not itself a "change" worth an event.
        if (!hasBaseline || costUnchanged) continue

        const result = await ctx.events.createEvent({
          orgId: ctx.orgId, eventType: 'PRODUCT_PRICE_REVIEW_REQUIRED', subjectType: 'product', subjectId: subject.productId,
          source: 'internal', severity: 'info', previousValue: { unitCostMinor: previousCostMinor }, currentValue: { unitCostMinor: currentCostMinor },
          dedupeKey: `profitability:${subject.productId}:cost_changed`,
        })

        if (!result.deduplicated) {
          eventsCreated++
          await ctx.store.enqueueJob({
            orgId: ctx.orgId, jobType: 'product_profitability_recheck',
            payload: { productId: subject.productId, supplierId: subject.supplierId, channelProductId: subject.channelProductId },
            idempotencyKey: `event:${result.id}`, correlationId: result.id,
          })
        } else {
          eventsDeduplicated++
        }
      } catch (error) {
        errors.push(`${subject.productId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
