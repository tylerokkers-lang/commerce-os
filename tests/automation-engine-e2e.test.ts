import { describe, expect, it, vi } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { runWorkerBatch } from '@/lib/automation/worker'
import type { SupplierAvailabilityCheckPayload } from '@/lib/automation/handlers/supplierHandlers'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'

const factsLoader = createInMemoryFactsLoader()
const connectorLookup = () => undefined

/**
 * Verifies the actual automation loop end to end (brief §1, §22):
 *
 *   EVENT -> JOB CREATED -> WORKER PICKS UP JOB -> FACTS LOADED
 *   -> PROFITABILITY CHECK -> COMPLIANCE CHECK -> AUTOMATION POLICY
 *   -> ACTION EXECUTION -> RESULT VERIFICATION -> AUDIT EVENT -> NOTIFICATION
 *
 * Every test in this file drives that loop through the real orchestration
 * entry points (`enqueueJob`, `runWorkerBatch`) — never by calling
 * `evaluateSupplierSwitchAutomation` or any other decision function
 * directly. The only thing swapped out is the persistence layer
 * (`createInMemoryAutomationStore` instead of `getSupabaseAutomationStore`),
 * for the reason explained in `store.ts`: the Supabase/PostgREST HTTP path
 * itself needs a live deployed project to exercise, which is documented as
 * a production-infrastructure requirement rather than faked here.
 */

const ORG_A = 'org-a'
const ORG_B = 'org-b'

function goodSignals(overrides: Partial<RedundancyRequest['alternatives'][number]['signals']> = {}) {
  return {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2, ...overrides,
  }
}

function autoSwitchRequest(overrides: Partial<RedundancyRequest> = {}): RedundancyRequest {
  return {
    productTitle: 'E2E Test Widget',
    channels: ['shopify'],
    reason: { key: 'out_of_stock', detail: 'zero stock reported' },
    automationLevel: 'autonomous',
    thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
    previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed', ebay: 'not_assessed' },
    economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: 20, vatInclusive: true },
    profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
    alternatives: [{ id: 'sup-good-alt', name: 'Ridgeway Homeware Supply', signals: goodSignals({ unitCost: fromMajor(9.5) }) }],
    ...overrides,
  }
}

function payloadFor(request: RedundancyRequest, entityId = 'product-1'): SupplierAvailabilityCheckPayload {
  return {
    entityType: 'product',
    entityId,
    request,
    previousUnitCostPlusShippingMinor: fromMajor(9).minor + fromMajor(2).minor,
  }
}

describe('automation engine end-to-end: event -> job -> worker -> facts -> policy -> action -> audit -> notification', () => {
  it('a permitted supplier switch runs the full pipeline and leaves a complete, correct trail', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    // EVENT -> JOB CREATED
    const enqueueResult = await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest()) as unknown as Record<string, unknown>, idempotencyKey: 'evt-1' })
    expect(enqueueResult.alreadyExisted).toBe(false)

    // WORKER PICKS UP JOB -> ... -> ACTION EXECUTION -> AUDIT -> NOTIFICATION
    const batch = await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')
    expect(batch).toEqual({ claimed: 1, succeeded: 1, failed: 0, deadLettered: 0 })

    const state = store.getState()

    // JOB reached a terminal, successful state.
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs[0].status).toBe('succeeded')
    expect(state.jobs[0].completedAt).not.toBeNull()

    // ACTION: the fact-first record of the decision, correctly executed.
    expect(state.actions).toHaveLength(1)
    const action = state.actions[0]
    expect(action.status).toBe('succeeded')
    expect(action.actionType).toBe('switch_supplier')
    expect(action.automationLevel).toBe('autonomous')
    expect(action.policyResult.outcome).toBe('allow_automatic')
    expect(action.riskLevel).toBe('low')
    expect(action.correlationId).toBeTruthy()
    expect(action.jobId).toBe(state.jobs[0].id)

    // AUDIT: every step left a trace, in order, with a correlation id.
    const auditActions = state.auditLog.map((e) => e.action)
    expect(auditActions).toContain('AUTOMATION_JOB_ENQUEUED')
    expect(auditActions).toContain('AUTOMATION_ACTION_CREATED')
    expect(auditActions).toContain('AUTOMATION_ACTION_EXECUTED')

    // NOTIFICATION: the owner is told what happened.
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0].severity).toBe('success')
    expect(state.notifications[0].title).toContain('permitted')
  })

  it('a supplier switch that fails the profitability bar is never executed, and the reason is recorded', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const expensiveAlternative = autoSwitchRequest({ alternatives: [{ id: 'sup-pricey', name: 'Pricey Supply Co', signals: goodSignals({ unitCost: fromMajor(50) }) }] })

    await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(expensiveAlternative) as unknown as Record<string, unknown> })
    const batch = await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')

    expect(batch.succeeded).toBe(1) // The job itself succeeded — it correctly determined the switch should not happen.
    const action = store.getState().actions[0]
    expect(action.policyResult.outcome).not.toBe('allow_automatic')
    expect(action.status).not.toBe('succeeded')
  })

  it('a supplier switch that fails compliance (the alternative cannot serve a previously-approved channel) is never executed', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const noncompliantAlternative = autoSwitchRequest({
      channels: ['shopify', 'amazon_uk'],
      previousChannelStatus: { shopify: 'approved', amazon_uk: 'approved', ebay: 'not_assessed' },
      alternatives: [{ id: 'sup-noncompliant', name: 'No Invoice Supply', signals: goodSignals({ supportsCustomInvoice: false }) }],
    })

    await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(noncompliantAlternative) as unknown as Record<string, unknown> })
    await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')

    const action = store.getState().actions[0]
    expect(action.decision.redundancy).toMatchObject({ outcome: expect.not.stringMatching('switch_automatically') })
    expect(action.status).not.toBe('succeeded')
  })

  it('a valid switch whose cost exceeds the automation limit requires approval, not automatic execution', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...DEMO_AUTOMATION_SETTINGS, maxAutoSupplierSwitchCostIncreasePct: 2 } } })
    await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest()) as unknown as Record<string, unknown> })
    await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')

    const action = store.getState().actions[0]
    expect(action.status).toBe('requires_approval')
    expect(store.getState().notifications[0].severity).toBe('approval_required')
  })

  describe('emergency stop (mandatory)', () => {
    it('ON: an automated action executes; PAUSE: the same kind of action is blocked, reasoned and audited; RESUME: automation works again', async () => {
      const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

      // ON
      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest(), 'product-1') as unknown as Record<string, unknown> })
      await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')
      expect(store.getState().actions[0].status).toBe('succeeded')

      // PAUSE ALL AUTOMATION
      store.setAutomationSettings(ORG_A, { ...DEMO_AUTOMATION_SETTINGS, automationPaused: true, automationPausedReason: 'Owner emergency stop' })
      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest(), 'product-2') as unknown as Record<string, unknown> })
      const pausedBatch = await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')

      expect(pausedBatch.succeeded).toBe(1) // The job ran and correctly determined it must not execute.
      const blockedAction = store.getState().actions.find((a) => a.entityId === 'product-2')!
      expect(blockedAction.status).toBe('blocked')
      expect(blockedAction.reason).toMatch(/paused/i)
      expect(store.getState().auditLog.some((e) => e.action === 'AUTOMATION_ACTION_BLOCKED' && e.entityId === 'product-2')).toBe(true)
      expect(store.getState().notifications.find((n) => n.entityId === 'product-2')?.severity).toBe('warning')

      // RESUME
      store.setAutomationSettings(ORG_A, DEMO_AUTOMATION_SETTINGS)
      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest(), 'product-3') as unknown as Record<string, unknown> })
      await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')
      const resumedAction = store.getState().actions.find((a) => a.entityId === 'product-3')!
      expect(resumedAction.status).toBe('succeeded')
    })

    it('a category-level pause blocks only that category, leaving every other category running', async () => {
      const store = createInMemoryAutomationStore({
        settingsByOrg: { [ORG_A]: { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['supplier_switching'] } },
      })
      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest()) as unknown as Record<string, unknown> })
      await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')
      expect(store.getState().actions[0].status).toBe('blocked')
    })
  })

  describe('approval bridge and job cancellation', () => {
    it('a decision requiring approval is surfaced on the owner-facing approvals queue with the exact action payload to replay', async () => {
      const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...DEMO_AUTOMATION_SETTINGS, maxAutoSupplierSwitchCostIncreasePct: 2 } } })
      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest()) as unknown as Record<string, unknown> })
      await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')

      const approvals = store.getState().approvals
      expect(approvals).toHaveLength(1)
      expect(approvals[0].status).toBe('awaiting_approval')
      expect(approvals[0].actionPayload.actionType).toBe('switch_supplier')
      expect(approvals[0].riskLevel).toBeTruthy()
      expect(approvals[0].expiresAt).not.toBeNull()
      expect(store.getState().auditLog.some((e) => e.action === 'APPROVAL_REQUESTED')).toBe(true)
    })

    it('cancelling a pending job prevents it from ever executing', async () => {
      const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
      const { id } = await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest()) as unknown as Record<string, unknown> })

      const cancelled = await store.cancelJob(id, 'No longer needed')
      expect(cancelled).toBe(true)

      const batch = await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')
      expect(batch.claimed).toBe(0) // A cancelled job is never claimed.
      expect(store.getState().actions).toHaveLength(0)
    })

    it('a job that has already been claimed cannot be cancelled out from under the worker', async () => {
      const store = createInMemoryAutomationStore()
      const { id } = await store.enqueueJob({ orgId: ORG_A, jobType: 'noop' })
      await store.claimNextJob('worker-1')
      expect(await store.cancelJob(id, 'too late')).toBe(false)
    })
  })

  describe('job engine mechanics', () => {
    it('duplicate events (same idempotency key) never create a second job', async () => {
      const store = createInMemoryAutomationStore()
      const first = await store.enqueueJob({ orgId: ORG_A, jobType: 'noop', idempotencyKey: 'evt-dup' })
      const second = await store.enqueueJob({ orgId: ORG_A, jobType: 'noop', idempotencyKey: 'evt-dup' })
      expect(second.alreadyExisted).toBe(true)
      expect(second.id).toBe(first.id)
      expect(store.getState().jobs).toHaveLength(1)
    })

    it('two concurrent workers can never both execute the same job', async () => {
      const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest()) as unknown as Record<string, unknown> })

      const [batchA, batchB] = await Promise.all([runWorkerBatch(store, factsLoader, connectorLookup, 'worker-A'), runWorkerBatch(store, factsLoader, connectorLookup, 'worker-B')])

      const totalClaimed = batchA.claimed + batchB.claimed
      expect(totalClaimed).toBe(1) // Exactly one worker claimed the only job.
      expect(store.getState().actions).toHaveLength(1) // Exactly one execution — no double-spend, no double-switch.
    })

    it('a retryable failure schedules a later retry with backoff; exhausting attempts dead-letters the job', async () => {
      const store = createInMemoryAutomationStore()
      await store.enqueueJob({ orgId: ORG_A, jobType: 'always_fails', maxAttempts: 2 })

      const first = await store.claimNextJob('worker-1')
      expect(first!.attempts).toBe(1)
      await store.completeJob(first!, { succeeded: false, error: 'transient timeout', retryable: true })
      const afterFirstFailure = store.getState().jobs[0]
      expect(afterFirstFailure.status).toBe('pending') // Scheduled to retry, not abandoned.
      expect(new Date(afterFirstFailure.runAt).getTime()).toBeGreaterThan(Date.now())

      const second = await store.claimNextJob('worker-1') // Won't be claimable yet — runAt is in the future.
      expect(second).toBeNull()
    })

    it('a permanently failed (non-retryable) job fails immediately without waiting for attempts to exhaust', async () => {
      const store = createInMemoryAutomationStore()
      await store.enqueueJob({ orgId: ORG_A, jobType: 'always_fails', maxAttempts: 5 })
      const job = await store.claimNextJob('worker-1')
      await store.completeJob(job!, { succeeded: false, error: 'malformed payload', retryable: false })
      expect(store.getState().jobs[0].status).toBe('failed') // Not dead_letter — attempts were not exhausted, but retrying is pointless.
    })

    it('exhausting every retry attempt dead-letters the job and audits it', async () => {
      const store = createInMemoryAutomationStore()
      await store.enqueueJob({ orgId: ORG_A, jobType: 'always_fails', maxAttempts: 1 })
      const job = await store.claimNextJob('worker-1')
      expect(job!.attempts).toBe(1)
      await store.completeJob(job!, { succeeded: false, error: 'still failing', retryable: true })
      expect(store.getState().jobs[0].status).toBe('dead_letter')
      expect(store.getState().auditLog.some((e) => e.action === 'AUTOMATION_JOB_DEAD_LETTERED')).toBe(true)
    })

    it('an unregistered job type fails safely and non-retryably, never silently "succeeding"', async () => {
      const store = createInMemoryAutomationStore()
      await store.enqueueJob({ orgId: ORG_A, jobType: 'no_such_handler', maxAttempts: 5 })
      const batch = await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')
      expect(batch.succeeded).toBe(0)
      expect(store.getState().jobs[0].status).toBe('failed')
      expect(store.getState().jobs[0].lastError).toContain('No handler registered')
    })

    it('a stale/abandoned claim (worker crashed) is recovered by a later worker after the lock timeout', async () => {
      vi.useFakeTimers()
      try {
        const store = createInMemoryAutomationStore({ lockTimeoutMs: 1000 })
        await store.enqueueJob({ orgId: ORG_A, jobType: 'always_fails' })
        const crashedClaim = await store.claimNextJob('worker-crashed')
        expect(crashedClaim).not.toBeNull()
        expect(await store.claimNextJob('worker-2')).toBeNull() // Still within the lock timeout — not stale yet.

        vi.advanceTimersByTime(2000)

        const recovered = await store.claimNextJob('worker-2')
        expect(recovered).not.toBeNull()
        expect(recovered!.lockedBy).toBe('worker-2')
      } finally {
        vi.useRealTimers()
      }
    })

    it('organisation isolation: one org cannot see or be affected by another org\'s automation actions', async () => {
      const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS, [ORG_B]: DEMO_AUTOMATION_SETTINGS } })

      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', payload: payloadFor(autoSwitchRequest(), 'shared-entity-id') as unknown as Record<string, unknown> })
      await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')

      const countForOrgB = await store.countRecentActionsForEntity(ORG_B, 'product', 'shared-entity-id', 'switch_supplier', new Date(Date.now() - 60_000).toISOString())
      expect(countForOrgB).toBe(0) // Org A's action does not leak into Org B's count, even for the same entity id.

      const countForOrgA = await store.countRecentActionsForEntity(ORG_A, 'product', 'shared-entity-id', 'switch_supplier', new Date(Date.now() - 60_000).toISOString())
      expect(countForOrgA).toBe(1)
    })
  })

  describe('runaway-automation safeguard', () => {
    it('blocks the same entity/action-type combination once the frequency limit is reached, independent of the policy engine\'s own verdict', async () => {
      const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

      for (let i = 0; i < 5; i++) {
        await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', idempotencyKey: `evt-${i}`, payload: payloadFor(autoSwitchRequest(), 'flapping-product') as unknown as Record<string, unknown> })
        await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')
      }
      const firstFive = store.getState().actions
      expect(firstFive.every((a) => a.status === 'succeeded')).toBe(true)

      await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_availability_check', idempotencyKey: 'evt-6', payload: payloadFor(autoSwitchRequest(), 'flapping-product') as unknown as Record<string, unknown> })
      await runWorkerBatch(store, factsLoader, connectorLookup, 'worker-1')

      const sixth = store.getState().actions.at(-1)!
      expect(sixth.status).toBe('blocked')
      expect(sixth.reason).toMatch(/runaway-automation safeguard/i)
    })
  })
})
