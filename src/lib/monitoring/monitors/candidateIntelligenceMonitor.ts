import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'
import type { ProductStage } from '@/lib/core/domain'

/**
 * Candidate intelligence monitoring (Milestone: autonomous decision &
 * capability layer, closing the read-only audit's central finding: every
 * pre-launch candidate's score/recommendation is computed exactly once, at
 * import time, and never again until a human clicks "recalculate"
 * (`products/actions.ts`) — there was no continuous "REFRESH STALE FACTS" /
 * "SCORE OPPORTUNITIES" step for the discovery domain at all, unlike every
 * post-listing domain (supplier, profitability, compliance, marketplace).
 *
 * This monitor does not recompute anything itself — `computeProductIntelligence`
 * (`products/intelligence/assemble.ts`) stays exactly what it always was: a
 * human-triggered, `server-only` engine. This only reads the LAST-PERSISTED
 * verdict via `ctx.facts.loadProductIntelligenceFacts` (real, freshness-aware,
 * satisfies the same `FactsLoader` interface every other monitor already
 * uses) and reacts to two, and only two, real facts:
 *
 *   1. The candidate's intelligence has gone stale (never recomputed inside
 *      the configured window) — worth telling a human to re-run it.
 *   2. The candidate is still sitting at `discovered` despite having a
 *      genuinely fresh score on file — eligible for the one, single,
 *      completely ungated lifecycle transition (`lifecycle.ts`'s own
 *      `ALLOWED` graph has zero gate conditions for `researching` as a
 *      target), so it is worth automatically advancing rather than leaving
 *      every real candidate stuck at `discovered` forever.
 *
 * Deliberately does NOT attempt to auto-advance past `researching` —
 * `supplier_review`/`compliance_review`/`approved`/`testing` all have real
 * gate conditions (`lifecycle.ts`'s `checkGates`) that need per-channel
 * compliance-pass and profitability-pass booleans nothing in this codebase
 * exposes as an independently-queryable, already-computed fact yet (only as
 * values transiently produced inside `product_compliance_recheck`/
 * `product_profitability_recheck` job runs). Building that GateState
 * assembly without a real, tested source for those two booleans would be
 * exactly the "fake automation" the brief prohibits — left as a documented,
 * scoped follow-up, not attempted here.
 */

export interface CandidateIntelligenceSubject {
  productId: string
  stage: ProductStage
}

const MONITOR_KEY = 'candidate_intelligence'

export const candidateIntelligenceMonitor: Monitor<CandidateIntelligenceSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Candidate intelligence', category: 'discovery', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly CandidateIntelligenceSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let eventsCreated = 0
    let eventsDeduplicated = 0

    for (const subject of subjects) {
      try {
        const intel = await ctx.facts.loadProductIntelligenceFacts(ctx.orgId, subject.productId)

        // Never computed at all: not this monitor's job to force one — the
        // real trigger (import, or a human clicking "recalculate") has
        // simply not happened yet. "Unknown" stays unknown, never guessed.
        if (intel.recommendation.freshness === 'unavailable') continue

        const isStale = intel.recommendation.freshness === 'stale'
        const readyToAdvance = !isStale && subject.stage === 'discovered'
        if (!isStale && !readyToAdvance) continue // Fresh, and already past `discovered` — nothing due.

        const result = await ctx.events.createEvent({
          orgId: ctx.orgId,
          eventType: 'CANDIDATE_LIFECYCLE_REVIEW_DUE',
          subjectType: 'product',
          subjectId: subject.productId,
          source: 'internal',
          severity: isStale ? 'warning' : 'info',
          facts: { stage: subject.stage, recommendation: intel.recommendation.value, recommendationAsOf: intel.recommendation.asOf, isStale },
          // Keyed on the actual computed_at, matching every other monitor's
          // dedup discipline: a NEW staleness/readiness fact at a new
          // computed_at is a fresh condition, not a repeat of the last one.
          dedupeKey: `candidate-review:${subject.productId}:${intel.recommendation.asOf ?? 'never'}`,
        })

        if (!result.deduplicated) {
          eventsCreated++
          await ctx.store.enqueueJob({
            orgId: ctx.orgId,
            jobType: 'candidate_lifecycle_review',
            payload: { productId: subject.productId, stage: subject.stage },
            idempotencyKey: `event:${result.id}`,
            correlationId: result.id,
          })
        } else {
          eventsDeduplicated++
        }
      } catch (error) {
        errors.push(`${subject.productId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated: subjects.length, eventsCreated, eventsDeduplicated, errors }
  },
}
