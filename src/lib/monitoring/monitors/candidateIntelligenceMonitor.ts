import { AUTONOMOUS_STAGE_PATH } from '@/lib/products/candidateGateState'
import { resolveBusinessConfiguration } from '@/lib/automation/settingsTypes'
import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'
import type { ProductStage } from '@/lib/core/domain'

/**
 * Candidate lifecycle monitoring (Milestone: autonomous decision &
 * capability layer, extended by: continuous candidate lifecycle).
 *
 * The gap this closes: every post-listing domain (supplier, profitability,
 * compliance, marketplace) already had a monitor, but a pre-launch
 * candidate had none — its score was computed once at import and it then
 * sat at `discovered` forever, because nothing ever looked at it again.
 *
 * This monitor observes and never acts, exactly like every other one. It
 * decides only whether a candidate is *worth re-evaluating* right now, and
 * enqueues `candidate_lifecycle_review` if so. Every actual decision — what
 * the gate state is, which transition (if any) is warranted, what to
 * recheck — belongs to that job, which re-reads the facts itself at
 * execution time.
 *
 * "Worth re-evaluating" is deliberately broad: any candidate still on the
 * autonomous pre-launch path is a candidate whose facts may have changed
 * since the last cycle. What stops this from producing an endless stream of
 * duplicate work is the dedupe key, not a narrow trigger condition — it is
 * keyed on the facts that would change the answer (stage, the freshness
 * anchor of the intelligence, AND the organisation's own automation
 * readiness), so an unchanged candidate produces exactly one event no
 * matter how many cycles run, and a candidate whose facts have genuinely
 * moved produces exactly one more.
 *
 * `orgAutomationReady` exists because of a genuine incident this milestone's
 * audit found in production: five real candidates were reviewed once while
 * `business_settings` had zero rows, correctly blocked, and their events
 * were left `open` (nothing in this codebase ever calls `resolveEvent` —
 * `domain_events.dedupe_key` is unique, so an open event with an unchanged
 * key can never be recreated). Once the settings were saved, `stage` and
 * the intelligence freshness anchor were STILL unchanged, so without this
 * fix the exact same five candidates would have been silently stuck at
 * "blocked, unknown automation state" forever — the org-level condition
 * that caused the block would have resolved with no code path left able to
 * notice. Including the org's own readiness in the key makes that specific
 * resolution a genuinely new fact, exactly like a stage change or a
 * re-scored candidate.
 */

export interface CandidateIntelligenceSubject {
  productId: string
  stage: ProductStage
  /** The channel whose persisted verdicts gate this candidate. */
  channel: string
  /** The supplier recorded as fulfilling it, when there is one. `null` leaves the supplier gates UNKNOWN rather than assumed. */
  supplierId: string | null
}

const MONITOR_KEY = 'candidate_intelligence'

export const candidateIntelligenceMonitor: Monitor<CandidateIntelligenceSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Candidate lifecycle', category: 'discovery', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly CandidateIntelligenceSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let eventsCreated = 0
    let eventsDeduplicated = 0

    for (const subject of subjects) {
      try {
        // A candidate that has left the pre-launch path (already trading,
        // rejected, removed, paused) is a safe no-op — never an attempted
        // invalid transition. `AUTONOMOUS_STAGE_PATH` is the single source
        // of truth for which stages this loop covers.
        if (!AUTONOMOUS_STAGE_PATH[subject.stage]) continue

        const intel = await ctx.facts.loadProductIntelligenceFacts(ctx.orgId, subject.productId)

        // Never scored at all: nothing in this system can compute a first
        // score on its own (that is a human-triggered engine), so there is
        // no useful review to enqueue and nothing to say that a stale-facts
        // notification would not repeat every cycle.
        if (intel.recommendation.freshness === 'unavailable') continue

        // Mirrors exactly the three organisation-level requirements
        // `productHandlers.ts`'s `isGloballyBlocked` checks against the real
        // policy result: automation state known, not paused, and every
        // required business setting present. Computed directly from
        // `ctx.settings` (already available to every monitor) rather than
        // running the real policy engine here — this module only ever
        // decides whether a review is due, never the review's own verdict.
        const orgAutomationReady = ctx.settings.automationStateKnown && !ctx.settings.automationPaused && resolveBusinessConfiguration(ctx.settings).configured

        const result = await ctx.events.createEvent({
          orgId: ctx.orgId,
          eventType: 'CANDIDATE_LIFECYCLE_REVIEW_DUE',
          subjectType: 'product',
          subjectId: subject.productId,
          source: 'internal',
          severity: 'info',
          facts: {
            stage: subject.stage,
            channel: subject.channel,
            recommendation: intel.recommendation.value,
            recommendationAsOf: intel.recommendation.asOf,
            freshness: intel.recommendation.freshness,
            orgAutomationReady,
          },
          // Keyed on everything that would change the review's answer: the
          // stage it is being reviewed from, the intelligence's own
          // freshness anchor, AND whether the organisation's own automation
          // state currently permits anything to happen at all. An
          // unchanged candidate in an unchanged organisation therefore
          // dedupes across every subsequent cycle; a candidate that has
          // just advanced, been re-scored, OR whose organisation just
          // became (or stopped being) ready is a genuinely new condition
          // and gets exactly one new review. This is what makes the loop
          // continuous without being repetitive — and what stops it from
          // getting permanently stuck the moment a block was ever caused by
          // something outside the candidate's own facts.
          dedupeKey: `candidate-review:${subject.productId}:${subject.channel}:${subject.stage}:${intel.recommendation.asOf ?? 'never'}:${orgAutomationReady}`,
        })

        if (!result.deduplicated) {
          eventsCreated++
          await ctx.store.enqueueJob({
            orgId: ctx.orgId,
            jobType: 'candidate_lifecycle_review',
            payload: { productId: subject.productId, channel: subject.channel, supplierId: subject.supplierId },
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
