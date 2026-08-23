import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Sales and performance monitoring (brief §5).
 *
 * Honest scope boundary: no live sales/order aggregation repository exists
 * in this codebase yet (that is Milestone 8 in the *original* roadmap —
 * "Analytics and business intelligence" — renumbered to Milestone 8 when
 * this monitoring milestone was inserted ahead of it; see
 * `docs/MILESTONES.md`). This monitor's comparison logic is real and
 * tested, but the windowed sales figures it compares are supplied by the
 * caller rather than queried live from `orders`/`order_items` — exactly
 * the same "the decision logic is real, the live enumeration is a
 * following pass" pattern `docs/MILESTONES.md` already documents for
 * `FactsLoader` (Milestone 7). Never pretends popularity data exists where
 * it does not: a subject with no window data is skipped, not guessed at.
 */

export interface PerformanceWindow {
  unitsSold: number
  revenueMinor: number
  returnsCount: number
  refundsCount: number
  adSpendMinor: number
  /** ISO start/end so the comparison basis is stored, not just the conclusion. */
  windowStart: string
  windowEnd: string
}

export interface PerformanceMonitorSubject {
  productId: string
  /** Needed only to enqueue `product_profitability_recheck` on a sales decline — never read for the performance comparison itself. */
  supplierId: string
  channelProductId: string
  currentWindow: PerformanceWindow
  previousWindow: PerformanceWindow | null
  adSpendLimitMinor: number | null
}

const MONITOR_KEY = 'sales_performance'

function pctChange(previous: number, current: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null // Cannot express "from zero" as a percentage — reported as a fact, not guessed.
  return ((current - previous) / previous) * 100
}

export const performanceMonitor: Monitor<PerformanceMonitorSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Sales & performance', category: 'performance', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly PerformanceMonitorSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let eventsCreated = 0
    let eventsDeduplicated = 0

    const surgeThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:surge_threshold_pct`, 50)
    const declineThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:decline_threshold_pct`, -30)
    const returnRateThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:return_rate_increase_pct`, 50)

    for (const subject of subjects) {
      try {
        if (!subject.previousWindow) continue // No prior window: nothing to compare against, so no conclusion is drawn.

        const unitsChangePct = pctChange(subject.previousWindow.unitsSold, subject.currentWindow.unitsSold)
        const basis = {
          previousUnits: subject.previousWindow.unitsSold, currentUnits: subject.currentWindow.unitsSold,
          previousWindow: `${subject.previousWindow.windowStart}..${subject.previousWindow.windowEnd}`,
          currentWindow: `${subject.currentWindow.windowStart}..${subject.currentWindow.windowEnd}`,
        }

        if (unitsChangePct !== null && unitsChangePct >= surgeThresholdPct) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'PRODUCT_SALES_SURGING', subjectType: 'product', subjectId: subject.productId,
            source: 'internal', severity: 'info', facts: { ...basis, changePct: unitsChangePct }, dedupeKey: `performance:${subject.productId}:surging`,
          })
          if (!result.deduplicated) eventsCreated++
          else eventsDeduplicated++
        } else if (unitsChangePct !== null && unitsChangePct <= declineThresholdPct) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'PRODUCT_SALES_DECLINING', subjectType: 'product', subjectId: subject.productId,
            source: 'internal', severity: 'warning', facts: { ...basis, changePct: unitsChangePct }, dedupeKey: `performance:${subject.productId}:declining`,
          })
          if (!result.deduplicated) {
            eventsCreated++
            // Matches EVENT_TO_JOB_MAPPING in registry.ts: a sharp sales
            // decline is worth re-running the profitability check (pricing
            // may be part of the cause), not an automatic price or listing
            // change.
            await ctx.store.enqueueJob({
              orgId: ctx.orgId, jobType: 'product_profitability_recheck',
              payload: { productId: subject.productId, supplierId: subject.supplierId, channelProductId: subject.channelProductId },
              idempotencyKey: `event:${result.id}`, correlationId: result.id,
            })
          } else {
            eventsDeduplicated++
          }
        }

        const previousReturnRate = subject.previousWindow.unitsSold > 0 ? (subject.previousWindow.returnsCount / subject.previousWindow.unitsSold) * 100 : 0
        const currentReturnRate = subject.currentWindow.unitsSold > 0 ? (subject.currentWindow.returnsCount / subject.currentWindow.unitsSold) * 100 : 0
        const returnRateChangePct = pctChange(previousReturnRate, currentReturnRate)
        if (returnRateChangePct !== null && returnRateChangePct >= returnRateThresholdPct && currentReturnRate > previousReturnRate) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'PRODUCT_RETURN_RATE_INCREASED', subjectType: 'product', subjectId: subject.productId,
            source: 'internal', severity: 'warning', facts: { previousReturnRatePct: previousReturnRate, currentReturnRatePct: currentReturnRate }, dedupeKey: `performance:${subject.productId}:return_rate`,
          })
          if (!result.deduplicated) eventsCreated++
          else eventsDeduplicated++
        }

        if (subject.adSpendLimitMinor !== null && subject.currentWindow.adSpendMinor > subject.adSpendLimitMinor) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'AD_SPEND_EXCEEDED', subjectType: 'product', subjectId: subject.productId,
            source: 'internal', severity: 'warning', facts: { adSpendMinor: subject.currentWindow.adSpendMinor, limitMinor: subject.adSpendLimitMinor }, dedupeKey: `performance:${subject.productId}:ad_spend`,
          })
          if (!result.deduplicated) eventsCreated++
          else eventsDeduplicated++
        }
      } catch (error) {
        errors.push(`${subject.productId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated: 0, eventsCreated, eventsDeduplicated, errors }
  },
}
