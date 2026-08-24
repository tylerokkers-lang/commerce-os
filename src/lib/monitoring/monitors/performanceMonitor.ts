import { comparePeriods } from '@/lib/core/compare'
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
  /**
   * Added Milestone 8.5, optional so hand-built windows (existing tests,
   * demo scenarios) remain valid — real discovery (`liveSubjects.ts`, via
   * `orders/salesAggregation.ts`) always supplies them. Events that need
   * these skip themselves rather than guess when they are absent, per the
   * same fact-first rule as everything else in this monitor.
   */
  netRevenueMinor?: number
  salesVelocityPerDay?: number
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

/** `current`/`previous` order matches `comparePeriods(current, previous)` — kept as a local alias so call sites below read the same as before the Milestone 10 refactor into `core/compare.ts`. */
const pctChange = (previous: number, current: number): number | null => comparePeriods(current, previous).percentChange

export const performanceMonitor: Monitor<PerformanceMonitorSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Sales & performance', category: 'performance', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly PerformanceMonitorSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let eventsCreated = 0
    let eventsDeduplicated = 0
    let observationsCreated = 0

    const surgeThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:surge_threshold_pct`, 50)
    const declineThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:decline_threshold_pct`, -30)
    const returnRateThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:return_rate_increase_pct`, 50)
    const refundRateThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:refund_rate_increase_pct`, 50)

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
            // Keyed on the current window's actual unit count, not just
            // "surging": a product surging again from a new baseline
            // (e.g. 100 units, then later 100 -> 250) is a fresh fact each
            // time — see supplierMonitor.ts's price dedupeKey for the same
            // fix and why (Milestone 8.5).
            source: 'internal', severity: 'info', facts: { ...basis, changePct: unitsChangePct }, dedupeKey: `performance:${subject.productId}:surging:${subject.currentWindow.unitsSold}`,
          })
          if (!result.deduplicated) eventsCreated++
          else eventsDeduplicated++
        } else if (unitsChangePct !== null && unitsChangePct <= declineThresholdPct) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'PRODUCT_SALES_DECLINING', subjectType: 'product', subjectId: subject.productId,
            source: 'internal', severity: 'warning', facts: { ...basis, changePct: unitsChangePct }, dedupeKey: `performance:${subject.productId}:declining:${subject.currentWindow.unitsSold}`,
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
            source: 'internal', severity: 'warning', facts: { previousReturnRatePct: previousReturnRate, currentReturnRatePct: currentReturnRate }, dedupeKey: `performance:${subject.productId}:return_rate:${Math.round(currentReturnRate * 10)}`,
          })
          if (!result.deduplicated) eventsCreated++
          else eventsDeduplicated++
        }

        // A refund does not always mean a physical return (see
        // `REFUND_REASONS_COUNTED_AS_RETURNS` in `salesAggregation.ts`) —
        // pricing errors and goodwill credits are refunds without a
        // returned item, so this is tracked as its own fact, incidents per
        // unit sold, the same shape as the return-rate check above.
        const previousRefundRate = subject.previousWindow.unitsSold > 0 ? (subject.previousWindow.refundsCount / subject.previousWindow.unitsSold) * 100 : 0
        const currentRefundRate = subject.currentWindow.unitsSold > 0 ? (subject.currentWindow.refundsCount / subject.currentWindow.unitsSold) * 100 : 0
        const refundRateChangePct = pctChange(previousRefundRate, currentRefundRate)
        if (refundRateChangePct !== null && refundRateChangePct >= refundRateThresholdPct && currentRefundRate > previousRefundRate) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'PRODUCT_REFUND_RATE_INCREASED', subjectType: 'product', subjectId: subject.productId,
            source: 'internal', severity: 'warning', facts: { previousRefundRatePct: previousRefundRate, currentRefundRatePct: currentRefundRate }, dedupeKey: `performance:${subject.productId}:refund_rate:${Math.round(currentRefundRate * 10)}`,
          })
          if (!result.deduplicated) eventsCreated++
          else eventsDeduplicated++
        }

        // Revenue can decline independently of units (discounting, mix
        // shift, refunds) — a genuinely different fact from a unit-volume
        // change, so it gets its own threshold and its own event rather
        // than being inferred from the units comparison above.
        if (subject.previousWindow.netRevenueMinor !== undefined && subject.currentWindow.netRevenueMinor !== undefined) {
          const revenueChangePct = pctChange(subject.previousWindow.netRevenueMinor, subject.currentWindow.netRevenueMinor)
          const revenueDeclineThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:revenue_decline_threshold_pct`, -30)
          if (revenueChangePct !== null && revenueChangePct <= revenueDeclineThresholdPct) {
            const result = await ctx.events.createEvent({
              orgId: ctx.orgId, eventType: 'REVENUE_DECLINED', subjectType: 'product', subjectId: subject.productId,
              source: 'internal', severity: 'warning',
              facts: { previousNetRevenueMinor: subject.previousWindow.netRevenueMinor, currentNetRevenueMinor: subject.currentWindow.netRevenueMinor, changePct: revenueChangePct },
              dedupeKey: `performance:${subject.productId}:revenue_declined:${subject.currentWindow.netRevenueMinor}`,
            })
            if (!result.deduplicated) eventsCreated++
            else eventsDeduplicated++
          }
        }

        // Absolute-floor check, distinct from the relative surge/decline
        // comparisons above: a product selling consistently below a
        // configured minimum velocity is "underperforming" regardless of
        // whether it changed recently — and recovering above that floor
        // resolves the open event rather than leaving a stale alert.
        if (subject.currentWindow.salesVelocityPerDay !== undefined) {
          const underperformingThreshold = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:underperforming_velocity_per_day`, 0.5)
          const previousObservation = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'product', subject.productId)
          const wasUnderperforming = previousObservation?.value.underperforming === true

          if (subject.currentWindow.salesVelocityPerDay < underperformingThreshold) {
            const result = await ctx.events.createEvent({
              orgId: ctx.orgId, eventType: 'PRODUCT_UNDERPERFORMING', subjectType: 'product', subjectId: subject.productId,
              source: 'internal', severity: 'warning',
              facts: { salesVelocityPerDay: subject.currentWindow.salesVelocityPerDay, thresholdPerDay: underperformingThreshold },
              dedupeKey: `performance:${subject.productId}:underperforming`,
            })
            if (!result.deduplicated) eventsCreated++
            else eventsDeduplicated++
          } else if (wasUnderperforming) {
            const result = await ctx.events.createEvent({
              orgId: ctx.orgId, eventType: 'PRODUCT_SALES_RECOVERED', subjectType: 'product', subjectId: subject.productId,
              source: 'internal', severity: 'info',
              facts: { salesVelocityPerDay: subject.currentWindow.salesVelocityPerDay, thresholdPerDay: underperformingThreshold },
              dedupeKey: null,
            })
            if (!result.deduplicated) eventsCreated++
          }

          await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'product', subject.productId, {
            status: 'ok', value: { underperforming: subject.currentWindow.salesVelocityPerDay < underperformingThreshold }, lastCheckedAt: ctx.now.toISOString(),
          })
          observationsCreated++
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

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
