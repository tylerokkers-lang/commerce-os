import { fxRateFact } from '@/lib/fx/types'
import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * FX rate freshness and movement monitoring (Milestone 9 §10).
 *
 * Reuses `FxRateStore` (Milestone 9 §4) and the same `Fact<T>` freshness
 * vocabulary every other monitor uses — this module adds nothing to *how*
 * a rate is judged fresh or stale, only to *noticing when it changed* and
 * turning that into a domain event. It never converts money, never
 * recomputes a market's profitability itself, and never writes a rate —
 * it enqueues `fx_recheck` (a Milestone 9 job handler), and the automation
 * engine's chained `market_recheck` jobs decide and act from there.
 */

export interface FxPairSubject {
  base: string
  quote: string
}

const MONITOR_KEY = 'fx_rates'

function pctChange(previous: number, current: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100
}

export const fxMonitor: Monitor<FxPairSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'FX rates', category: 'profitability', defaultIntervalMinutes: 60 },

  async run(ctx: MonitorContext, subjects: readonly FxPairSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let observationsCreated = 0
    let eventsCreated = 0
    let eventsDeduplicated = 0

    if (!ctx.fxStore) {
      return { subjectsChecked: 0, observationsCreated: 0, eventsCreated: 0, eventsDeduplicated: 0, errors: ['fxMonitor requires ctx.fxStore, which was not provided.'] }
    }
    const fxStore = ctx.fxStore

    const movementThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:movement_threshold_pct`, 3)

    for (const subject of subjects) {
      try {
        const pairKey = `${subject.base}:${subject.quote}`
        const latest = await fxStore.getLatestRate(ctx.orgId, subject.base as never, subject.quote as never)
        const fact = fxRateFact(latest, 'automation', ctx.now)
        const previous = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'fx_pair', pairKey)

        // Freshness/availability, distinguished the same way every other
        // monitor in this codebase distinguishes them: a feed that has
        // never answered is UNAVAILABLE, one that answered but has aged
        // past the automation window is STALE — never conflated, and
        // never inferred as "unchanged".
        if (fact.freshness === 'unavailable') {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'FX_RATE_UNAVAILABLE', subjectType: 'fx_pair', subjectId: pairKey,
            source: 'external', severity: 'warning', facts: { reason: 'No exchange rate has ever been recorded for this pair.' },
            dedupeKey: `fx:${pairKey}:unavailable`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
        } else if (fact.freshness === 'stale') {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'FX_RATE_STALE', subjectType: 'fx_pair', subjectId: pairKey,
            source: 'external', severity: 'warning', facts: { asOf: fact.asOf }, dedupeKey: `fx:${pairKey}:stale`,
          })
          eventsCreated += result.deduplicated ? 0 : 1
          eventsDeduplicated += result.deduplicated ? 1 : 0
        } else if (previous?.status === 'unavailable' || previous?.status === 'unknown') {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'FX_RATE_RECOVERED', subjectType: 'fx_pair', subjectId: pairKey,
            source: 'external', severity: 'info', dedupeKey: null,
          })
          if (!result.deduplicated) eventsCreated++
        }

        await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'fx_pair', pairKey, {
          status: fact.freshness === 'unavailable' ? 'unavailable' : fact.freshness === 'unknown' ? 'unknown' : 'ok',
          value: { rate: fact.value?.rate ?? null },
          lastCheckedAt: ctx.now.toISOString(),
        })
        observationsCreated++

        if (fact.freshness !== 'fresh' && fact.freshness !== 'stale') continue // Nothing to compare a movement against.

        const previousRate = previous?.value.rate as number | null | undefined
        if (typeof previousRate === 'number' && previousRate > 0 && fact.value) {
          const change = pctChange(previousRate, fact.value.rate)
          if (Math.abs(change) >= movementThresholdPct) {
            // Keyed on the actual resulting rate, not just "moved" — the
            // Milestone 8.5 fix, applied from the start here: a rate that
            // keeps moving (1.00 -> 1.05 -> 1.10 -> 1.03) is a fresh fact
            // every time, never swallowed by the first still-open event.
            const result = await ctx.events.createEvent({
              orgId: ctx.orgId, eventType: 'FX_RATE_SIGNIFICANT_MOVEMENT', subjectType: 'fx_pair', subjectId: pairKey,
              source: 'external', severity: 'warning',
              previousValue: { rate: previousRate }, currentValue: { rate: fact.value.rate },
              facts: { changePct: change }, dedupeKey: `fx:${pairKey}:movement:${Math.sign(change)}:${fact.value.rate}`,
            })
            if (!result.deduplicated) {
              eventsCreated++
              await ctx.store.enqueueJob({
                orgId: ctx.orgId, jobType: 'fx_recheck',
                payload: { base: subject.base, quote: subject.quote, previousRate, newRate: fact.value.rate },
                idempotencyKey: `event:${result.id}`, correlationId: result.id,
              })
            } else {
              eventsDeduplicated++
            }
          }
        }
      } catch (error) {
        errors.push(`${subject.base}:${subject.quote}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
