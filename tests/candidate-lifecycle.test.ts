import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { candidateIntelligenceMonitor, type CandidateIntelligenceSubject } from '@/lib/monitoring/monitors/candidateIntelligenceMonitor'
import { EVENT_TO_JOB_MAPPING } from '@/lib/monitoring/registry'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { runWorkerBatch } from '@/lib/automation/worker'
import { dryRunCandidateLifecycleReview, describeMarketplaceExecution } from '@/lib/automation/dryRun'
import { assembleCandidateGateState, planCandidateAdvance } from '@/lib/products/candidateGateState'
import { DEMO_AUTOMATION_SETTINGS, UNKNOWN_STATE_AUTOMATION_SETTINGS, resolveBusinessConfiguration } from '@/lib/automation/settingsTypes'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import { fromMajor } from '@/lib/core/money'
import type { LifecycleHandlerDeps } from '@/lib/automation/handlers/productHandlers'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'
import type { AutomationSettings } from '@/lib/automation/settingsTypes'

const ORG = 'org-a'
const PRODUCT = 'prod-1'
const SUPPLIER = 'sup-1'
const CHANNEL = 'shopify'

/**
 * Milestone: continuous candidate lifecycle.
 *
 * Drives the whole loop through its real entry points — the real monitor,
 * the real `automation_jobs` queue, the real `runWorkerBatch`, the real
 * `lifecycle.ts` transition rules and the real policy engine — against the
 * in-memory store and facts loader, which are genuine implementations of
 * the same interfaces production uses, never mocks of the decision itself.
 */

const NOW = new Date('2026-09-06T12:00:00Z')
const FRESH = NOW.toISOString()
const LONG_AGO = new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 120).toISOString() // 120 days: stale for every window in play.

interface FactOverrides {
  stage?: string
  recommendation?: string
  intelligenceComputedAt?: string | null
  supplierStatus?: string
  supplierAssessedAt?: string | null
  offerVerifiedAt?: string | null
  complianceVerdict?: string
  complianceAssessedAt?: string | null
  profitabilityVerdict?: string
  profitabilityAssessedAt?: string | null
  /** Omit the compliance/profitability rows entirely — "never assessed", genuinely different from `not_assessed`. */
  omitVerdicts?: boolean
}

/** Everything fresh and passing, unless a test overrides one specific fact. */
function facts(overrides: FactOverrides = {}) {
  const {
    stage = 'compliance_review',
    recommendation = 'strong_candidate',
    intelligenceComputedAt = FRESH,
    supplierStatus = 'approved',
    supplierAssessedAt = FRESH,
    offerVerifiedAt = FRESH,
    complianceVerdict = 'pass',
    complianceAssessedAt = FRESH,
    profitabilityVerdict = 'pass',
    profitabilityAssessedAt = FRESH,
    omitVerdicts = false,
  } = overrides

  return createInMemoryFactsLoader({
    products: { [PRODUCT]: { title: 'Widget', category: null, stage, updatedAt: FRESH } },
    suppliers: { [SUPPLIER]: { shopifyStatus: supplierStatus, amazonStatus: supplierStatus, lastAssessedAt: supplierAssessedAt } },
    offers: { [`${SUPPLIER}:${PRODUCT}`]: { unitCost: fromMajor(5), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: offerVerifiedAt } },
    productIntelligence: { [PRODUCT]: { recommendation, recommendationReason: 'Clears every check.', computedAt: intelligenceComputedAt } },
    lifecycleVerdicts: omitVerdicts
      ? {}
      : {
          [`${PRODUCT}:${CHANNEL}`]: {
            complianceVerdict,
            complianceAssessedAt,
            complianceBlockingReasons: complianceVerdict === 'fail' ? ['Missing UKCA documentation.'] : [],
            profitabilityVerdict,
            profitabilityAssessedAt,
            profitabilityFailureReasons: profitabilityVerdict === 'fail' ? ['Net margin 2.1% is below the 10% minimum.'] : [],
          },
        },
  })
}

function store(settings: AutomationSettings = CONFIGURED_AUTOMATION_SETTINGS) {
  return createInMemoryAutomationStore({ settingsByOrg: { [ORG]: settings } })
}

/** A real (not mocked) refresher that records what it was asked to refresh. */
function recordingRefresher(result: { ok: boolean; error?: string } = { ok: true }) {
  const calls: { productId: string; channel: string }[] = []
  const deps: LifecycleHandlerDeps = {
    async refreshLifecycleFacts(_orgId, productId, channel) {
      calls.push({ productId, channel })
      return result
    },
  }
  return { deps, calls }
}

async function enqueueReview(s: ReturnType<typeof store>, key?: string) {
  return s.enqueueJob({
    orgId: ORG,
    jobType: 'candidate_lifecycle_review',
    payload: { productId: PRODUCT, channel: CHANNEL, supplierId: SUPPLIER },
    idempotencyKey: key,
  })
}

async function runReview(s: ReturnType<typeof store>, f: ReturnType<typeof facts>, deps?: LifecycleHandlerDeps) {
  return runWorkerBatch(s, f, () => undefined, 'worker-1', 10, undefined, undefined, deps)
}

// ---------------------------------------------------------------------------
// The pure gate state (Part 4)
// ---------------------------------------------------------------------------

describe('assembleCandidateGateState', () => {
  const base = {
    stage: 'compliance_review',
    intelligenceRecommendation: 'strong_candidate',
    intelligenceFreshness: 'fresh' as const,
    supplierChannelStatus: 'approved',
    supplierStatusFreshness: 'fresh' as const,
    supplierOfferFreshness: 'fresh' as const,
    complianceVerdict: 'pass',
    complianceFreshness: 'fresh' as const,
    profitabilityVerdict: 'pass',
    profitabilityFreshness: 'fresh' as const,
    businessSettingsConfigured: true,
  }

  it('every requirement passes when every fact is fresh and passing', () => {
    const state = assembleCandidateGateState(base)
    expect(state.requirements.every((r) => r.verdict === 'pass')).toBe(true)
    expect(planCandidateAdvance(state).to).toBe('approved')
  })

  it('a missing verdict is UNKNOWN, never FAIL and never PASS', () => {
    const state = assembleCandidateGateState({ ...base, complianceVerdict: null, complianceFreshness: 'unavailable' })
    expect(state.requirements.find((r) => r.key === 'compliance_pass')?.verdict).toBe('unknown')
    expect(state.lifecycleGates.compliancePassesAnyChannel).toBe(false)
    expect(state.lifecycleGates.complianceAssessed).toBe(false)
  })

  it('a stale verdict is UNKNOWN, never carried forward as a pass', () => {
    const state = assembleCandidateGateState({ ...base, profitabilityFreshness: 'stale' })
    expect(state.requirements.find((r) => r.key === 'profitability_pass')?.verdict).toBe('unknown')
    expect(state.lifecycleGates.profitablePassesAnyChannel).toBe(false)
  })

  it('an explicit not_assessed verdict is UNKNOWN, distinct from a real fail', () => {
    const unknown = assembleCandidateGateState({ ...base, profitabilityVerdict: 'not_assessed' })
    const failed = assembleCandidateGateState({ ...base, profitabilityVerdict: 'fail' })
    expect(unknown.requirements.find((r) => r.key === 'profitability_pass')?.verdict).toBe('unknown')
    expect(failed.requirements.find((r) => r.key === 'profitability_pass')?.verdict).toBe('fail')
  })

  it('never infers the opportunity-score gate from a recommendation that never reached that rung', () => {
    // `do_not_sell` fires for an unassigned supplier long before the score
    // is examined, so it says nothing about the score.
    const state = assembleCandidateGateState({ ...base, intelligenceRecommendation: 'do_not_sell' })
    expect(state.requirements.find((r) => r.key === 'meets_minimum_score')?.verdict).toBe('unknown')
  })

  it('a stage outside the pre-launch path never plans a transition', () => {
    for (const stage of ['testing', 'proven', 'rejected', 'removed', 'paused']) {
      expect(planCandidateAdvance(assembleCandidateGateState({ ...base, stage })).to).toBeNull()
    }
  })

  it('distinguishes "blocked only by unknowns" (recheckable) from a real failure', () => {
    const unknown = planCandidateAdvance(assembleCandidateGateState({ ...base, complianceFreshness: 'stale' }))
    expect(unknown.to).toBeNull()
    expect(unknown.blockedOnlyByUnknowns).toBe(true)

    const failed = planCandidateAdvance(assembleCandidateGateState({ ...base, complianceVerdict: 'fail' }))
    expect(failed.to).toBeNull()
    expect(failed.blockedOnlyByUnknowns).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Transitions through the real worker (Part 5, Part 11 scenarios 1-9)
// ---------------------------------------------------------------------------

describe('candidate lifecycle transitions', () => {
  it('1. fresh intelligence and every gate passing advances the stage', async () => {
    const s = store()
    await enqueueReview(s)
    const batch = await runReview(s, facts({ stage: 'compliance_review' }))

    expect(batch.succeeded).toBe(1)
    const changes = s.getState().productStageChanges
    expect(changes.length).toBe(1)
    expect(changes[0].transitionRow.from_stage).toBe('compliance_review')
    expect(changes[0].transitionRow.to_stage).toBe('approved')
  })

  it('2. stale intelligence blocks the transition and enqueues a real recompute (not just a notification)', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'researching', intelligenceComputedAt: LONG_AGO }))

    expect(s.getState().productStageChanges.length).toBe(0)
    const refreshJobs = s.getState().jobs.filter((j) => j.jobType === 'candidate_intelligence_refresh')
    expect(refreshJobs.length).toBe(1)
    expect(refreshJobs[0].payload).toMatchObject({ productId: PRODUCT })
  })

  it('2b. the recompute job is keyed on the stale score it supersedes, so it repeats across cycles without duplicating', async () => {
    const s = store()
    const stale = facts({ stage: 'researching', intelligenceComputedAt: LONG_AGO })

    // Two cycles over the same unchanged stale fact: one job, not two.
    await enqueueReview(s, 'event:c1')
    await runReview(s, stale)
    await enqueueReview(s, 'event:c2')
    await runReview(s, stale)
    expect(s.getState().jobs.filter((j) => j.jobType === 'candidate_intelligence_refresh').length).toBe(1)

    // A genuinely newer (but still stale) score is a new fact, so it earns
    // a new refresh — proving the loop cannot silently stop after one run.
    const newerButStillStale = facts({ stage: 'researching', intelligenceComputedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 30).toISOString() })
    await enqueueReview(s, 'event:c3')
    await runReview(s, newerButStillStale)
    expect(s.getState().jobs.filter((j) => j.jobType === 'candidate_intelligence_refresh').length).toBe(2)
  })

  it('2c. a recompute is not scheduled at all while business settings are unconfigured — the answer could not change', async () => {
    const s = store(DEMO_AUTOMATION_SETTINGS)
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'researching', intelligenceComputedAt: LONG_AGO }))

    expect(s.getState().jobs.filter((j) => j.jobType.startsWith('candidate_')).length).toBe(1) // Only the review itself.
  })

  it('2d. the intelligence refresh runs the real engine, and a failure never fabricates a score', async () => {
    const s = store()
    await s.enqueueJob({ orgId: ORG, jobType: 'candidate_intelligence_refresh', payload: { productId: PRODUCT } })

    const calls: string[] = []
    const deps: LifecycleHandlerDeps = {
      async refreshLifecycleFacts() { return { ok: true } },
      async refreshProductIntelligence(_orgId, productId) { calls.push(productId); return { ok: false, error: 'Scoring engine unavailable.' } },
    }
    const batch = await runReview(s, facts({ intelligenceComputedAt: LONG_AGO }), deps)

    expect(calls).toEqual([PRODUCT])
    expect(batch.succeeded).toBe(0) // Retryable failure, never a silent success.
    expect(s.getState().productStageChanges.length).toBe(0)
  })

  it('3. stale supplier facts block the transition into compliance_review', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'supplier_review', offerVerifiedAt: LONG_AGO }), recordingRefresher().deps)

    expect(s.getState().productStageChanges.length).toBe(0)
  })

  it('4. a supplier the channel has actually blocked is a FAIL, not a recheck', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'supplier_review', supplierStatus: 'blocked' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    const action = s.getState().actions[0]
    expect(action.decision).toMatchObject({ failedRequirements: expect.arrayContaining(['supplier_approved']) })
  })

  it('5. compliance PASS and profitability PASS together reach approved', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review', complianceVerdict: 'pass', profitabilityVerdict: 'pass' }))

    expect(s.getState().productStageChanges[0].transitionRow.to_stage).toBe('approved')
  })

  it('6. compliance FAIL blocks approval and records the reason', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review', complianceVerdict: 'fail' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].decision).toMatchObject({ failedRequirements: expect.arrayContaining(['compliance_pass']) })
  })

  it('7. profitability FAIL blocks approval and records the reason', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review', profitabilityVerdict: 'fail' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].decision).toMatchObject({ failedRequirements: expect.arrayContaining(['profitability_pass']) })
  })

  it('8. compliance UNKNOWN blocks approval and enqueues a real recheck rather than rejecting', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review', omitVerdicts: true }))

    expect(s.getState().productStageChanges.length).toBe(0)
    const refreshJobs = s.getState().jobs.filter((j) => j.jobType === 'candidate_facts_refresh')
    expect(refreshJobs.length).toBe(1)
    expect(refreshJobs[0].payload).toMatchObject({ productId: PRODUCT, channel: CHANNEL })
  })

  it('9. profitability UNKNOWN blocks approval — never treated as a pass', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review', profitabilityVerdict: 'not_assessed' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].decision).toMatchObject({ unknownRequirements: expect.arrayContaining(['profitability_pass']) })
  })
})

// ---------------------------------------------------------------------------
// Safety (Part 10, Part 11 scenarios 10-11)
// ---------------------------------------------------------------------------

describe('candidate lifecycle safety', () => {
  it('10. unconfigured business settings never auto-advance — the real Informax state today', async () => {
    const s = store(DEMO_AUTOMATION_SETTINGS)
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].policyResult.outcome).not.toBe('allow_automatic')
  })

  it('11. the kill switch blocks the transition, and schedules no work while paused', async () => {
    const s = store({ ...CONFIGURED_AUTOMATION_SETTINGS, automationPaused: true })
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review', omitVerdicts: true }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().jobs.filter((j) => j.jobType === 'candidate_facts_refresh').length).toBe(0)
    expect(s.getState().actions[0].policyResult.outcome).toBe('block')
  })

  it('11b. unknown automation state fails closed exactly like an explicit pause', async () => {
    const s = store({ ...CONFIGURED_AUTOMATION_SETTINGS, automationStateKnown: false })
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].policyResult.outcome).not.toBe('allow_automatic')
  })

  it('a facts refresh is skipped entirely while automation is paused', async () => {
    const s = store({ ...CONFIGURED_AUTOMATION_SETTINGS, automationPaused: true })
    await s.enqueueJob({ orgId: ORG, jobType: 'candidate_facts_refresh', payload: { productId: PRODUCT, channel: CHANNEL } })
    const refresher = recordingRefresher()
    await runReview(s, facts(), refresher.deps)

    expect(refresher.calls.length).toBe(0)
  })

  it('no marketplace connector is ever consulted anywhere in this lifecycle', async () => {
    const connectorLookup = vi.fn(() => undefined)
    const s = store()
    await enqueueReview(s)
    await runWorkerBatch(s, facts({ stage: 'compliance_review' }), connectorLookup, 'worker-1', 10, undefined, undefined, recordingRefresher().deps)

    expect(connectorLookup).not.toHaveBeenCalled()
    expect(s.getState().channelProductReconciliations).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Idempotency and concurrency (Part 11 scenarios 12-15, 18)
// ---------------------------------------------------------------------------

describe('candidate lifecycle idempotency', () => {
  it('12. a repeated monitoring cycle over unchanged facts creates no duplicate event or job', async () => {
    const s = store()
    const events = createInMemoryEventStore()
    const f = facts({ stage: 'researching' })
    const ctx: MonitorContext = { orgId: ORG, store: s, events, facts: f, connectors: () => undefined, settings: CONFIGURED_AUTOMATION_SETTINGS, now: NOW }
    const subject: CandidateIntelligenceSubject = { productId: PRODUCT, stage: 'researching', channel: CHANNEL, supplierId: SUPPLIER }

    const first = await candidateIntelligenceMonitor.run(ctx, [subject])
    const second = await candidateIntelligenceMonitor.run(ctx, [subject])

    expect(first.eventsCreated).toBe(1)
    expect(second.eventsCreated).toBe(0)
    expect(second.eventsDeduplicated).toBe(1)
    expect(s.getState().jobs.filter((j) => j.jobType === 'candidate_lifecycle_review').length).toBe(1)
    expect(EVENT_TO_JOB_MAPPING[events.getState().events[0].eventType]).toBe('candidate_lifecycle_review')
  })

  it('13. a duplicate job for the same idempotency key produces one action and one transition', async () => {
    const s = store()
    const first = await enqueueReview(s, 'event:evt-1')
    const second = await enqueueReview(s, 'event:evt-1')
    expect(second.alreadyExisted).toBe(true)
    expect(second.id).toBe(first.id)

    await runReview(s, facts({ stage: 'compliance_review' }))
    expect(s.getState().productStageChanges.length).toBe(1)
    expect(s.getState().actions.length).toBe(1)
  })

  it('14. a product that already advanced past the reviewed stage is a safe no-op', async () => {
    const s = store()
    await enqueueReview(s)
    // The payload was enqueued while it was a candidate; by execution time
    // it is already trading.
    await runReview(s, facts({ stage: 'proven' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].policyResult.outcome).not.toBe('allow_automatic')
  })

  it('15. facts that changed between the event and execution are re-read, and a now-invalid transition is refused', async () => {
    const s = store()
    await enqueueReview(s)
    // Enqueued when compliance passed; by execution time it genuinely fails.
    await runReview(s, facts({ stage: 'compliance_review', complianceVerdict: 'fail' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].inputFacts).toMatchObject({ complianceVerdict: 'fail' })
  })

  it('18. a candidate blocked for the same reason twice notifies once', async () => {
    const s = store()
    await enqueueReview(s, 'event:evt-1')
    await runReview(s, facts({ stage: 'compliance_review', complianceVerdict: 'fail' }))
    await enqueueReview(s, 'event:evt-2')
    await runReview(s, facts({ stage: 'compliance_review', complianceVerdict: 'fail' }))

    const blocked = s.getState().notifications.filter((n) => n.title.startsWith('Candidate blocked'))
    expect(blocked.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The real production fact pattern
// ---------------------------------------------------------------------------

/**
 * The five real CJ candidates, exactly as production holds them (verified
 * read-only against the live database): stage `discovered`; intelligence
 * computed ~1 day ago so genuinely fresh, but with `recommendation:
 * 'unconfigured'` because no `business_settings` row exists; supplier
 * `shopify_status: 'review_required'` assessed 2 days ago; supplier offer
 * with `last_verified_at: null`; no compliance or profitability record; no
 * listing price.
 *
 * With no settings row, `getAutomationSettingsForOrg` returns
 * `UNKNOWN_STATE_AUTOMATION_SETTINGS`, so this is also the kill-switch
 * fail-closed path. This pins what the scheduler will actually do to real
 * products on its next run, rather than reasoning about it.
 */
describe('the real production fact pattern (business_settings empty)', () => {
  function productionFacts() {
    return createInMemoryFactsLoader({
      products: { [PRODUCT]: { title: 'CJ candidate', category: null, stage: 'discovered', updatedAt: FRESH } },
      suppliers: { [SUPPLIER]: { shopifyStatus: 'review_required', amazonStatus: 'not_assessed', lastAssessedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 48).toISOString() } },
      offers: { [`${SUPPLIER}:${PRODUCT}`]: { unitCost: fromMajor(5), shippingCost: fromMajor(2), stockQty: null, inStock: true, lastVerifiedAt: null } },
      productIntelligence: { [PRODUCT]: { recommendation: 'unconfigured', recommendationReason: 'No business settings saved.', computedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24).toISOString() } },
      // No compliance or profitability rows at all — never assessed.
    })
  }

  it('refuses to advance, records a blocked action, and schedules no work', async () => {
    const s = store(UNKNOWN_STATE_AUTOMATION_SETTINGS)
    await enqueueReview(s)
    const batch = await runReview(s, productionFacts())

    expect(batch.succeeded).toBe(1) // A refusal is a handled outcome, not a job failure.
    const state = s.getState()
    expect(state.productStageChanges).toEqual([])
    expect(state.actions).toHaveLength(1)
    expect(state.actions[0].policyResult.outcome).toBe('block')
    expect(state.jobs.filter((j) => j.jobType.startsWith('candidate_')).length).toBe(1) // The review itself only.
  })

  it('emits no per-candidate notification, because the cause is one org-wide configuration gap, not five product findings', async () => {
    const s = store(UNKNOWN_STATE_AUTOMATION_SETTINGS)
    await enqueueReview(s)
    await runReview(s, productionFacts())

    expect(s.getState().notifications).toEqual([])
  })

  it('reports each gate honestly: UNKNOWN where unknown, FAIL only where an engine genuinely said so', () => {
    const state = assembleCandidateGateState({
      stage: 'discovered',
      intelligenceRecommendation: 'unconfigured',
      intelligenceFreshness: 'fresh',
      supplierChannelStatus: 'review_required',
      supplierStatusFreshness: 'fresh',
      supplierOfferFreshness: 'unavailable',
      complianceVerdict: null,
      complianceFreshness: 'unavailable',
      profitabilityVerdict: null,
      profitabilityFreshness: 'unavailable',
      businessSettingsConfigured: false,
    })
    const verdict = (key: string) => state.requirements.find((r) => r.key === key)?.verdict

    expect(verdict('intelligence_fresh')).toBe('pass') // Genuinely fresh, even though its content is "unconfigured".
    expect(verdict('meets_minimum_score')).toBe('unknown') // `unconfigured` never reached the score rung.
    expect(verdict('supplier_facts_fresh')).toBe('unknown') // last_verified_at is null.
    expect(verdict('supplier_approved')).toBe('fail') // `review_required` is a real, current, non-approved status.
    expect(verdict('compliance_pass')).toBe('unknown')
    expect(verdict('profitability_pass')).toBe('unknown')
    expect(verdict('business_settings_configured')).toBe('unknown')
  })

  it('a per-candidate failure DOES notify once settings exist, and the body states the real reason', async () => {
    const s = store(CONFIGURED_AUTOMATION_SETTINGS)
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'supplier_review', supplierStatus: 'blocked' }))

    const blocked = s.getState().notifications.filter((n) => n.title.startsWith('Candidate blocked'))
    expect(blocked).toHaveLength(1)
    // Never the lifecycle plan's own wording: for an ungated step that
    // reads "every gate is satisfied", which as the body of a "blocked"
    // notification would contradict its own title.
    expect(blocked[0].body).not.toMatch(/is satisfied by current, fresh facts/)
    expect(blocked[0].body).toBe(s.getState().actions[0].policyResult.reason)
  })
})

// ---------------------------------------------------------------------------
// Production first-run verification — the exact incident found in
// production: five real candidates were reviewed once while
// business_settings had zero rows, correctly blocked, and left an `open`
// domain event each (dedupe_key is unique; nothing ever calls
// `resolveEvent`). Once the settings were saved, stage and the intelligence
// freshness anchor were still unchanged, so without the fix below the same
// five candidates would have stayed stuck at "blocked, unknown automation
// state" forever, with no code path able to notice the organisation had
// become ready.
// ---------------------------------------------------------------------------

describe('an org-level block resolves (business settings first saved) without getting the candidate stuck', () => {
  function subjectAt(stage: CandidateIntelligenceSubject['stage'] = 'discovered'): CandidateIntelligenceSubject {
    return { productId: PRODUCT, stage, channel: CHANNEL, supplierId: SUPPLIER }
  }
  function intelFacts() {
    return createInMemoryFactsLoader({
      productIntelligence: { [PRODUCT]: { recommendation: 'unconfigured', recommendationReason: 'No business settings saved.', computedAt: FRESH } },
    })
  }

  it('reproduces the incident, then proves the fix: the same stage and intelligence anchor still earns a new review once the org becomes ready', async () => {
    const events = createInMemoryEventStore()
    const s = store(UNKNOWN_STATE_AUTOMATION_SETTINGS)
    const notReadyCtx: MonitorContext = { orgId: ORG, store: s, events, facts: intelFacts(), connectors: () => undefined, settings: UNKNOWN_STATE_AUTOMATION_SETTINGS, now: NOW }

    // Cycle 1: organisation not ready (the real incident's starting state).
    const first = await candidateIntelligenceMonitor.run(notReadyCtx, [subjectAt()])
    expect(first.eventsCreated).toBe(1)

    // Cycle 2: STILL not ready, same stage, same intelligence anchor —
    // this must dedupe exactly as before the fix. Proves the fix did not
    // turn every unchanged cycle into duplicate work.
    const stillNotReady = await candidateIntelligenceMonitor.run(notReadyCtx, [subjectAt()])
    expect(stillNotReady.eventsCreated).toBe(0)
    expect(stillNotReady.eventsDeduplicated).toBe(1)

    // Cycle 3: business_settings now saved (the real fix landing) — stage
    // and intelligence anchor are IDENTICAL to cycle 1. Before this
    // milestone's fix, this would also have deduplicated forever.
    const readyCtx: MonitorContext = { ...notReadyCtx, settings: CONFIGURED_AUTOMATION_SETTINGS, facts: intelFacts() }
    const nowReady = await candidateIntelligenceMonitor.run(readyCtx, [subjectAt()])
    expect(nowReady.eventsCreated, 'the organisation becoming ready must count as a genuinely new fact, or the candidate is stuck forever').toBe(1)
    expect(nowReady.eventsDeduplicated).toBe(0)

    // And the loop still correctly dedupes going forward once ready.
    const stillReady = await candidateIntelligenceMonitor.run(readyCtx, [subjectAt()])
    expect(stillReady.eventsCreated).toBe(0)
    expect(stillReady.eventsDeduplicated).toBe(1)

    expect(s.getState().jobs.filter((j) => j.jobType === 'candidate_lifecycle_review').length).toBe(2)
  })

  it('the org-readiness signal reflects settings.automationPaused and automationStateKnown too, not only the configured-fields check', async () => {
    const events = createInMemoryEventStore()
    const pausedButConfigured = { ...CONFIGURED_AUTOMATION_SETTINGS, automationPaused: true }
    const ctxPaused: MonitorContext = { orgId: ORG, store: store(pausedButConfigured), events, facts: intelFacts(), connectors: () => undefined, settings: pausedButConfigured, now: NOW }
    const whilePaused = await candidateIntelligenceMonitor.run(ctxPaused, [subjectAt()])
    expect(whilePaused.eventsCreated).toBe(1)

    const ctxResumed: MonitorContext = { ...ctxPaused, settings: CONFIGURED_AUTOMATION_SETTINGS, facts: intelFacts() }
    const afterResume = await candidateIntelligenceMonitor.run(ctxResumed, [subjectAt()])
    expect(afterResume.eventsCreated, 'resuming automation must also count as a new fact, not only saving settings the first time').toBe(1)
  })
})

describe('the gate state reads the real "all required fields present" fact, not merely "a settings row exists"', () => {
  it('a settings row that exists but is missing a required field must NOT read as configured', async () => {
    const s = store({ ...CONFIGURED_AUTOMATION_SETTINGS, importDutyPct: null }) // A row exists (businessSettingsConfigured: true on the raw type) but one required field is null.
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review' }))

    // Must NOT advance: `resolveBusinessConfiguration` correctly reports
    // this as unconfigured, and the gate must agree — reading the raw
    // "a row exists" flag instead would have incorrectly reported PASS here.
    expect(s.getState().productStageChanges).toEqual([])
    expect(s.getState().actions[0].policyResult.outcome).not.toBe('allow_automatic')
  })

  it('the same incomplete-row settings genuinely differ from a fully configured row on the gate itself', () => {
    const incomplete = { ...CONFIGURED_AUTOMATION_SETTINGS, importDutyPct: null }
    const complete = CONFIGURED_AUTOMATION_SETTINGS
    expect(resolveBusinessConfiguration(incomplete).configured).toBe(false)
    expect(resolveBusinessConfiguration(complete).configured).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Marketplace capability and supplier availability
// ---------------------------------------------------------------------------

describe('marketplace capability and supplier availability', () => {
  it('an approved product with no marketplace capability cannot be published, and says exactly why', () => {
    // The real Shopify connector today: configured, but createListings is
    // false (the write_products OAuth scope was never granted).
    const shopifyToday = describeMarketplaceExecution({ channel: 'shopify', isConfigured: true, createListings: false, verifyWrites: false })
    expect(shopifyToday.possible).toBe(false)
    expect(shopifyToday.reason).toMatch(/cannot create listings/i)

    // A connector that could create but could not verify is still refused:
    // an unverifiable write is never recorded as a published state.
    const unverifiable = describeMarketplaceExecution({ channel: 'shopify', isConfigured: true, createListings: true, verifyWrites: false })
    expect(unverifiable.possible).toBe(false)
    expect(unverifiable.reason).toMatch(/never confirmed/i)

    expect(describeMarketplaceExecution(null).possible).toBe(false)
    expect(describeMarketplaceExecution({ channel: 'shopify', isConfigured: false, createListings: true, verifyWrites: true }).possible).toBe(false)
  })

  it('the dry run reports marketplace execution as impossible without ever consulting a connector', () => {
    const result = dryRunCandidateLifecycleReview(
      PRODUCT,
      { stage: 'approved', intelligenceRecommendation: 'strong_candidate', intelligenceFreshness: 'fresh', supplierChannelStatus: 'approved', supplierStatusFreshness: 'fresh', supplierOfferFreshness: 'fresh', complianceVerdict: 'pass', complianceFreshness: 'fresh', profitabilityVerdict: 'pass', profitabilityFreshness: 'fresh', businessSettingsConfigured: true },
      CONFIGURED_AUTOMATION_SETTINGS,
      { channel: 'shopify', isConfigured: true, createListings: false, verifyWrites: false },
    )
    expect(result.payload?.marketplaceExecution.possible).toBe(false)
    // And the lifecycle itself stops at approved — no transition proposed.
    expect(result.payload?.wouldMoveTo).toBeNull()
  })

  it('a supplier with no recorded status leaves the gate UNKNOWN, never assumed available', async () => {
    const s = store()
    // No supplierId on the payload at all: the supplier facts cannot be loaded.
    await s.enqueueJob({ orgId: ORG, jobType: 'candidate_lifecycle_review', payload: { productId: PRODUCT, channel: CHANNEL, supplierId: null } })
    await runReview(s, facts({ stage: 'supplier_review' }))

    expect(s.getState().productStageChanges.length).toBe(0)
    expect(s.getState().actions[0].decision).toMatchObject({ unknownRequirements: expect.arrayContaining(['supplier_approved']) })
  })

  it('a candidate job abandoned by a crashed worker is reclaimed and completed by the next one', async () => {
    const s = createInMemoryAutomationStore({ settingsByOrg: { [ORG]: CONFIGURED_AUTOMATION_SETTINGS }, lockTimeoutMs: 10 })
    await s.enqueueJob({ orgId: ORG, jobType: 'candidate_lifecycle_review', payload: { productId: PRODUCT, channel: CHANNEL, supplierId: SUPPLIER } })

    const claimed = await s.claimNextJob('worker-that-crashes')
    expect(claimed).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20)) // Let the lock go stale.

    const batch = await runWorkerBatch(s, facts({ stage: 'compliance_review' }), () => undefined, 'worker-2', 10, undefined, undefined, recordingRefresher().deps)
    expect(batch.claimed).toBe(1)
    expect(s.getState().productStageChanges.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Audit, dry run, recheck honesty (Part 11 scenarios 16-17, 19-20)
// ---------------------------------------------------------------------------

describe('candidate lifecycle evidence and dry run', () => {
  it('19. the transition is audited with the gate evidence it was decided on', async () => {
    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review' }))

    const plan = s.getState().productStageChanges[0]
    expect(plan.transitionRow.actor_type).toBe('system')
    expect(plan.auditEntry.action).toBe('PRODUCT_STAGE_CHANGED')
    expect(plan.auditEntry.metadata).toMatchObject({ channel: CHANNEL })
    expect(JSON.stringify(plan.transitionRow.evidence)).toContain('compliance_pass')
  })

  it('16. the dry run reaches the identical decision and writes nothing', async () => {
    const input = {
      stage: 'compliance_review',
      intelligenceRecommendation: 'strong_candidate',
      intelligenceFreshness: 'fresh' as const,
      supplierChannelStatus: 'approved',
      supplierStatusFreshness: 'fresh' as const,
      supplierOfferFreshness: 'fresh' as const,
      complianceVerdict: 'pass',
      complianceFreshness: 'fresh' as const,
      profitabilityVerdict: 'pass',
      profitabilityFreshness: 'fresh' as const,
      businessSettingsConfigured: true,
    }
    const dry = dryRunCandidateLifecycleReview(PRODUCT, input, CONFIGURED_AUTOMATION_SETTINGS)

    const s = store()
    await enqueueReview(s)
    await runReview(s, facts({ stage: 'compliance_review' }))
    const real = s.getState().productStageChanges[0]

    expect(dry.payload?.wouldMoveTo).toBe(real.transitionRow.to_stage)
    expect(dry.wouldExecuteAutomatically).toBe(true)

    // And the dry run on its own store touches nothing at all.
    const clean = store()
    dryRunCandidateLifecycleReview(PRODUCT, input, CONFIGURED_AUTOMATION_SETTINGS)
    expect(clean.getState()).toMatchObject({ jobs: [], actions: [], notifications: [], productStageChanges: [] })
  })

  it('17. a failed recheck is retryable and fabricates no verdict', async () => {
    const s = store()
    await s.enqueueJob({ orgId: ORG, jobType: 'candidate_facts_refresh', payload: { productId: PRODUCT, channel: CHANNEL } })
    const refresher = recordingRefresher({ ok: false, error: 'Supplier read timed out.' })
    const batch = await runReview(s, facts({ omitVerdicts: true }), refresher.deps)

    expect(batch.succeeded).toBe(0)
    expect(refresher.calls.length).toBe(1)
    // Nothing was written, so the gate still reads UNKNOWN rather than a pass.
    expect(s.getState().productStageChanges.length).toBe(0)
  })

  it('a refresh with no refresher wired fails non-retryably rather than silently succeeding', async () => {
    const s = store()
    await s.enqueueJob({ orgId: ORG, jobType: 'candidate_facts_refresh', payload: { productId: PRODUCT, channel: CHANNEL } })
    const batch = await runReview(s, facts())

    expect(batch.succeeded).toBe(0)
  })

  it('20. a candidate walks the full path from discovered to approved across successive cycles', async () => {
    const s = store()
    const stages = ['discovered', 'researching', 'supplier_review', 'compliance_review']
    const reached: string[] = []

    for (const [index, stage] of stages.entries()) {
      await enqueueReview(s, `event:cycle-${index}`)
      await runReview(s, facts({ stage }), recordingRefresher().deps)
      const change = s.getState().productStageChanges[index]
      expect(change, `cycle ${index} (${stage}) should have advanced`).toBeDefined()
      reached.push(change.transitionRow.to_stage)
    }

    expect(reached).toEqual(['researching', 'supplier_review', 'compliance_review', 'approved'])
    // And it stops there: `testing` means live on a channel, which nothing
    // in this milestone may claim.
    await enqueueReview(s, 'event:cycle-final')
    await runReview(s, facts({ stage: 'approved' }))
    expect(s.getState().productStageChanges.length).toBe(4)
  })
})
