import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { candidateIntelligenceMonitor, type CandidateIntelligenceSubject } from '@/lib/monitoring/monitors/candidateIntelligenceMonitor'
import { EVENT_TO_JOB_MAPPING } from '@/lib/monitoring/registry'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { runWorkerBatch } from '@/lib/automation/worker'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'
const PRODUCT_ID = 'prod-1'

/**
 * Milestone: autonomous decision & capability layer — closing the read-only
 * audit's central finding (no pre-listing candidate was ever continuously
 * monitored; scoring only ever happened once, at import). Covers the new
 * `candidateIntelligenceMonitor` (detection) and `handleCandidateLifecycleReview`
 * (the one safe, ungated `discovered` -> `researching` auto-advance) end to
 * end through the real `automation_jobs` queue and worker, exactly like
 * every other monitor -> job -> handler chain already proven in this
 * codebase.
 */

function makeStore(settings = CONFIGURED_AUTOMATION_SETTINGS) {
  return createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: settings } })
}

describe('candidateIntelligenceMonitor', () => {
  it('never computed at all: no event, no job — this monitor never forces a first score', async () => {
    const store = makeStore()
    const events = createInMemoryEventStore()
    const facts = createInMemoryFactsLoader() // No seeded productIntelligence for PRODUCT_ID.
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: CONFIGURED_AUTOMATION_SETTINGS, now: new Date() }
    const subject: CandidateIntelligenceSubject = { productId: PRODUCT_ID, stage: 'discovered' }

    const outcome = await candidateIntelligenceMonitor.run(ctx, [subject])

    expect(outcome.eventsCreated).toBe(0)
    expect(store.getState().jobs.length).toBe(0)
  })

  it('fresh score, still discovered: creates a review-due event and enqueues candidate_lifecycle_review', async () => {
    const store = makeStore()
    const events = createInMemoryEventStore()
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: CONFIGURED_AUTOMATION_SETTINGS, now }
    const subject: CandidateIntelligenceSubject = { productId: PRODUCT_ID, stage: 'discovered' }

    const outcome = await candidateIntelligenceMonitor.run(ctx, [subject])

    expect(outcome.eventsCreated).toBe(1)
    const jobs = store.getState().jobs
    expect(jobs.length).toBe(1)
    expect(jobs[0].jobType).toBe('candidate_lifecycle_review')

    // EVENT_TO_JOB_MAPPING must agree with what the monitor actually did — the same discipline tests/monitoring-registry.test.ts already applies to every other monitor.
    const event = events.getState().events[0]
    expect(EVENT_TO_JOB_MAPPING[event.eventType]).toBe('candidate_lifecycle_review')
  })

  it('fresh score, past discovered: nothing due — already advanced, and fresh, so no review is needed', async () => {
    const store = makeStore()
    const events = createInMemoryEventStore()
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: CONFIGURED_AUTOMATION_SETTINGS, now }
    const subject: CandidateIntelligenceSubject = { productId: PRODUCT_ID, stage: 'researching' }

    const outcome = await candidateIntelligenceMonitor.run(ctx, [subject])

    expect(outcome.eventsCreated).toBe(0)
    expect(store.getState().jobs.length).toBe(0)
  })

  it('stale score (computed long ago): creates an event and enqueues a review regardless of stage', async () => {
    const store = makeStore()
    const events = createInMemoryEventStore()
    const now = new Date()
    const longAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 60).toISOString() // 60 days — well past the 14-day window.
    const facts = createInMemoryFactsLoader({
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'candidate', recommendationReason: 'Clears every check.', computedAt: longAgo } },
    })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: CONFIGURED_AUTOMATION_SETTINGS, now }
    const subject: CandidateIntelligenceSubject = { productId: PRODUCT_ID, stage: 'testing' }

    const outcome = await candidateIntelligenceMonitor.run(ctx, [subject])

    expect(outcome.eventsCreated).toBe(1)
    expect(store.getState().jobs[0].jobType).toBe('candidate_lifecycle_review')
  })

  it('a second run against the same unchanged condition deduplicates — never a duplicate job for the same computed_at', async () => {
    const store = makeStore()
    const events = createInMemoryEventStore()
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: CONFIGURED_AUTOMATION_SETTINGS, now }
    const subject: CandidateIntelligenceSubject = { productId: PRODUCT_ID, stage: 'discovered' }

    await candidateIntelligenceMonitor.run(ctx, [subject])
    const secondOutcome = await candidateIntelligenceMonitor.run(ctx, [subject])

    expect(secondOutcome.eventsCreated).toBe(0)
    expect(secondOutcome.eventsDeduplicated).toBe(1)
    expect(store.getState().jobs.length).toBe(1)
  })
})

describe('handleCandidateLifecycleReview (via the real worker)', () => {
  function seedJob(store: ReturnType<typeof createInMemoryAutomationStore>, stage: string) {
    return store.enqueueJob({ orgId: ORG_A, jobType: 'candidate_lifecycle_review', payload: { productId: PRODUCT_ID, stage } })
  }

  it('configured settings, fresh score, still discovered: advances to researching, audited as actorType "system", and notifies', async () => {
    const store = makeStore(CONFIGURED_AUTOMATION_SETTINGS)
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      products: { [PRODUCT_ID]: { title: 'Widget', category: null, stage: 'discovered', updatedAt: now.toISOString() } },
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'strong_candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    await seedJob(store, 'discovered')

    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(batch.succeeded).toBe(1)

    const state = store.getState()
    expect(state.productStageChanges.length).toBe(1)
    const plan = state.productStageChanges[0]
    expect(plan.transitionRow.from_stage).toBe('discovered')
    expect(plan.transitionRow.to_stage).toBe('researching')
    expect(plan.transitionRow.actor_type).toBe('system')
    expect(plan.auditEntry.actorType).toBe('system')

    expect(state.notifications.some((n) => n.title.includes('Researching'))).toBe(true)
  })

  it('configured settings, stale score: notifies to recalculate, never advances or writes a stage change', async () => {
    const store = makeStore(CONFIGURED_AUTOMATION_SETTINGS)
    const now = new Date()
    const longAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 60).toISOString()
    const facts = createInMemoryFactsLoader({
      products: { [PRODUCT_ID]: { title: 'Widget', category: null, stage: 'discovered', updatedAt: now.toISOString() } },
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'candidate', recommendationReason: 'Clears every check.', computedAt: longAgo } },
    })
    await seedJob(store, 'discovered')

    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(batch.succeeded).toBe(1)

    const state = store.getState()
    expect(state.productStageChanges.length).toBe(0)
    expect(state.notifications.some((n) => n.title.includes('stale'))).toBe(true)
  })

  it('global kill switch (automationPaused): blocks the decision — no stage change, no notification', async () => {
    const pausedSettings = { ...CONFIGURED_AUTOMATION_SETTINGS, automationPaused: true }
    const store = makeStore(pausedSettings)
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      products: { [PRODUCT_ID]: { title: 'Widget', category: null, stage: 'discovered', updatedAt: now.toISOString() } },
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'strong_candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    await seedJob(store, 'discovered')

    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(batch.succeeded).toBe(1) // The job itself completes successfully — being blocked by policy is a normal, handled outcome, not a job failure.

    const state = store.getState()
    expect(state.productStageChanges.length).toBe(0)
    expect(state.notifications.length).toBe(0)
    expect(state.actions[0].policyResult.outcome).not.toBe('allow_automatic')
  })

  it('unconfigured business settings (DEMO_AUTOMATION_SETTINGS, matching the real Informax org today): downgraded to require_approval, never auto-advances', async () => {
    const store = makeStore(DEMO_AUTOMATION_SETTINGS)
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      products: { [PRODUCT_ID]: { title: 'Widget', category: null, stage: 'discovered', updatedAt: now.toISOString() } },
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'strong_candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    await seedJob(store, 'discovered')

    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(batch.succeeded).toBe(1)

    const state = store.getState()
    expect(state.productStageChanges.length).toBe(0)
    expect(state.actions[0].policyResult.outcome).toBe('require_approval')
  })

  it('the product already moved on (e.g. a human changed its stage before this job ran): completes without error, no duplicate/invalid transition', async () => {
    const store = makeStore(CONFIGURED_AUTOMATION_SETTINGS)
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      // Facts re-read at execution time show the product already at `researching` — the job's payload snapshot (still says `discovered`) is stale.
      products: { [PRODUCT_ID]: { title: 'Widget', category: null, stage: 'researching', updatedAt: now.toISOString() } },
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'strong_candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    await seedJob(store, 'discovered')

    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(batch.succeeded).toBe(1)
    expect(store.getState().productStageChanges.length).toBe(0)
  })

  it('never computed at all by the time the job runs: succeeds as a no-op, never fabricates a decision', async () => {
    const store = makeStore(CONFIGURED_AUTOMATION_SETTINGS)
    const facts = createInMemoryFactsLoader({
      products: { [PRODUCT_ID]: { title: 'Widget', category: null, stage: 'discovered', updatedAt: new Date().toISOString() } },
    })
    await seedJob(store, 'discovered')

    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(batch.succeeded).toBe(1)
    expect(store.getState().productStageChanges.length).toBe(0)
    expect(store.getState().actions.length).toBe(0)
  })

  it('malformed payload is rejected non-retryably, never silently succeeding having done nothing', async () => {
    const store = makeStore(CONFIGURED_AUTOMATION_SETTINGS)
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'candidate_lifecycle_review', payload: { stage: 'discovered' } })

    const batch = await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(batch.failed + batch.deadLettered).toBe(1)
  })

  it('idempotency: a duplicate job for the same idempotency key never creates a second automation action or a second stage change', async () => {
    const store = makeStore(CONFIGURED_AUTOMATION_SETTINGS)
    const now = new Date()
    const facts = createInMemoryFactsLoader({
      products: { [PRODUCT_ID]: { title: 'Widget', category: null, stage: 'discovered', updatedAt: now.toISOString() } },
      productIntelligence: { [PRODUCT_ID]: { recommendation: 'strong_candidate', recommendationReason: 'Clears every check.', computedAt: now.toISOString() } },
    })
    const first = await store.enqueueJob({ orgId: ORG_A, jobType: 'candidate_lifecycle_review', payload: { productId: PRODUCT_ID, stage: 'discovered' }, idempotencyKey: 'event:evt-1' })
    const second = await store.enqueueJob({ orgId: ORG_A, jobType: 'candidate_lifecycle_review', payload: { productId: PRODUCT_ID, stage: 'discovered' }, idempotencyKey: 'event:evt-1' })
    expect(second.alreadyExisted).toBe(true)
    expect(second.id).toBe(first.id)

    await runWorkerBatch(store, facts, () => undefined, 'worker-1')
    expect(store.getState().productStageChanges.length).toBe(1)
    expect(store.getState().actions.length).toBe(1)
  })
})
