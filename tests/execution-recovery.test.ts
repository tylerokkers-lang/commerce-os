import { describe, expect, it } from 'vitest'
import { classifyStuckExecution, isRecoveryCandidate, EXECUTION_RECOVERY_THRESHOLD_MINUTES } from '@/lib/automation/executionRecovery'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import type { CreateActionInput } from '@/lib/automation/store'

/**
 * Milestone 17, Phases 1-4/16 — execution recovery.
 *
 * `classifyStuckExecution`/`isRecoveryCandidate` (`executionRecovery.ts`)
 * are pure and directly tested here in full. The orchestrator that calls
 * them (`automation/recovery.ts`) is `server-only` (transitively, via
 * `@/lib/audit` and `priceApprovalExecutor.ts`'s `resolveChannelProduct`)
 * and cannot be imported into Vitest — the same established limitation
 * `approveDecision`/`advertising/monitor.ts` already have. What *is*
 * directly testable without a database is the concurrency-safety property
 * the whole design depends on: the in-memory store's own
 * `findStuckExecutingActions`/`recordRecoveryOutcome` (no `server-only`
 * import anywhere in `inMemoryStore.ts`), which faithfully mirrors the
 * real store's compare-and-swap — proven here directly.
 */

function baseActionInput(overrides: Partial<CreateActionInput> = {}): CreateActionInput {
  return {
    orgId: 'org-1',
    idempotencyKey: `key-${Math.random()}`,
    actionType: 'update_price',
    entityType: 'channel_product',
    entityId: 'cp-1',
    reason: 'test',
    inputFacts: {},
    decision: {},
    policy: { outcome: 'allow_automatic', requirements: [], reason: 'test', riskLevel: 'low' },
    automationLevel: 'autonomous',
    ...overrides,
  }
}

describe('classifyStuckExecution: the three honest recovery outcomes', () => {
  it('connector cannot verify at all -> unknown, never a guess', () => {
    const result = classifyStuckExecution({ connectorSupportsVerification: false, verifyCallSucceeded: false, currentStateMatchesTarget: false, currentStateMatchesOriginal: null })
    expect(result.outcome).toBe('unknown')
  })

  it('the verify call itself fails -> unknown, never assumed either way', () => {
    const result = classifyStuckExecution({ connectorSupportsVerification: true, verifyCallSucceeded: false, currentStateMatchesTarget: false, currentStateMatchesOriginal: null })
    expect(result.outcome).toBe('unknown')
  })

  it('verified state matches the intended target -> succeeded', () => {
    const result = classifyStuckExecution({ connectorSupportsVerification: true, verifyCallSucceeded: true, currentStateMatchesTarget: true, currentStateMatchesOriginal: false })
    expect(result.outcome).toBe('succeeded')
  })

  it('verified state still matches the known original value -> failed, never silently retried', () => {
    const result = classifyStuckExecution({ connectorSupportsVerification: true, verifyCallSucceeded: true, currentStateMatchesTarget: false, currentStateMatchesOriginal: true })
    expect(result.outcome).toBe('failed')
  })

  it('verified state matches neither target nor a known original -> failed is never assumed; unknown instead', () => {
    const result = classifyStuckExecution({ connectorSupportsVerification: true, verifyCallSucceeded: true, currentStateMatchesTarget: false, currentStateMatchesOriginal: false })
    expect(result.outcome).toBe('unknown')
  })

  it('the original value was never recorded (null) and the target does not match -> unknown, never guessed as failed', () => {
    const result = classifyStuckExecution({ connectorSupportsVerification: true, verifyCallSucceeded: true, currentStateMatchesTarget: false, currentStateMatchesOriginal: null })
    expect(result.outcome).toBe('unknown')
  })

  it('every outcome carries a non-empty, human-readable reason', () => {
    const cases = [
      { connectorSupportsVerification: false, verifyCallSucceeded: false, currentStateMatchesTarget: false, currentStateMatchesOriginal: null },
      { connectorSupportsVerification: true, verifyCallSucceeded: true, currentStateMatchesTarget: true, currentStateMatchesOriginal: null },
      { connectorSupportsVerification: true, verifyCallSucceeded: true, currentStateMatchesTarget: false, currentStateMatchesOriginal: true },
    ] as const
    for (const c of cases) expect(classifyStuckExecution(c).reason.length).toBeGreaterThan(10)
  })
})

describe('isRecoveryCandidate: only a genuinely stuck action, never one merely slow', () => {
  const NOW = '2026-08-25T12:00:00.000Z'

  it('an action created just now is not yet a candidate', () => {
    expect(isRecoveryCandidate(NOW, NOW)).toBe(false)
  })

  it(`an action younger than ${EXECUTION_RECOVERY_THRESHOLD_MINUTES} minutes is not a candidate`, () => {
    const createdAt = new Date(new Date(NOW).getTime() - (EXECUTION_RECOVERY_THRESHOLD_MINUTES - 1) * 60_000).toISOString()
    expect(isRecoveryCandidate(createdAt, NOW)).toBe(false)
  })

  it(`an action exactly at the ${EXECUTION_RECOVERY_THRESHOLD_MINUTES}-minute threshold is a candidate`, () => {
    const createdAt = new Date(new Date(NOW).getTime() - EXECUTION_RECOVERY_THRESHOLD_MINUTES * 60_000).toISOString()
    expect(isRecoveryCandidate(createdAt, NOW)).toBe(true)
  })

  it('a long-stuck action is a candidate', () => {
    const createdAt = new Date(new Date(NOW).getTime() - 6 * 60 * 60_000).toISOString()
    expect(isRecoveryCandidate(createdAt, NOW)).toBe(true)
  })

  it('honours a custom threshold', () => {
    const createdAt = new Date(new Date(NOW).getTime() - 5 * 60_000).toISOString()
    expect(isRecoveryCandidate(createdAt, NOW, 5)).toBe(true)
    expect(isRecoveryCandidate(createdAt, NOW, 10)).toBe(false)
  })
})

describe('AutomationStore.findStuckExecutingActions (in-memory): only genuinely stuck, in-scope actions', () => {
  it('finds an old, still-executing, in-scope action', async () => {
    const store = createInMemoryAutomationStore()
    const created = await store.createAutomationAction(baseActionInput())
    expect(created.status).toBe('executing')

    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const stuck = await store.findStuckExecutingActions(future, ['update_price'])
    expect(stuck).toHaveLength(1)
    expect(stuck[0].id).toBe(created.id)
  })

  it('never returns an action younger than the threshold', async () => {
    const store = createInMemoryAutomationStore()
    await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k1' }))

    const past = new Date(Date.now() - 60 * 60_000).toISOString()
    const stuck = await store.findStuckExecutingActions(past, ['update_price'])
    expect(stuck).toHaveLength(0)
  })

  it('never returns an action that already succeeded — a resolved action is never re-recovered', async () => {
    const store = createInMemoryAutomationStore()
    const created = await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k2' }))
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: 'org-1', entityType: 'channel_product', entityId: 'cp-1' })

    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const stuck = await store.findStuckExecutingActions(future, ['update_price'])
    expect(stuck).toHaveLength(0)
  })

  it('never returns an action outside the requested action types', async () => {
    const store = createInMemoryAutomationStore()
    await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k3', actionType: 'pause_campaign', entityType: 'advertising_campaign', entityId: 'shopify:camp-1' }))

    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const stuck = await store.findStuckExecutingActions(future, ['update_price'])
    expect(stuck).toHaveLength(0)
  })

  it('organisation isolation: never returns another organisation\'s stuck action', async () => {
    const store = createInMemoryAutomationStore()
    await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k4', orgId: 'org-A' }))
    await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k5', orgId: 'org-B' }))

    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const stuck = await store.findStuckExecutingActions(future, ['update_price'])
    expect(stuck.map((s) => s.orgId).sort()).toEqual(['org-A', 'org-B'])
  })
})

describe('AutomationStore.recordRecoveryOutcome (in-memory): compare-and-swap prevents duplicate recovery', () => {
  it('applies once and transitions status correctly for each outcome', async () => {
    const store = createInMemoryAutomationStore()
    const created = await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k6' }))

    const result = await store.recordRecoveryOutcome(created.id, {
      status: 'retry_pending', error: 'unknown provider result', orgId: 'org-1', entityType: 'channel_product', entityId: 'cp-1',
      verificationStatus: 'uncertain', reconciliationStatus: 'not_applicable',
    })
    expect(result.applied).toBe(true)

    const state = store.getState()
    const row = state.actions.find((a) => a.id === created.id)!
    expect(row.status).toBe('retry_pending')
    expect(row.error).toBe('unknown provider result')
  })

  it('a second recovery attempt on the same already-resolved action is not applied — duplicate recovery prevented', async () => {
    const store = createInMemoryAutomationStore()
    const created = await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k7' }))

    const first = await store.recordRecoveryOutcome(created.id, {
      status: 'succeeded', error: null, orgId: 'org-1', entityType: 'channel_product', entityId: 'cp-1',
      verificationStatus: 'verified', reconciliationStatus: 'matched',
    })
    expect(first.applied).toBe(true)

    const second = await store.recordRecoveryOutcome(created.id, {
      status: 'failed', error: 'a concurrent pass tried to reclassify this', orgId: 'org-1', entityType: 'channel_product', entityId: 'cp-1',
      verificationStatus: 'failed', reconciliationStatus: 'not_applicable',
    })
    expect(second.applied).toBe(false)

    // The first, winning classification is never overwritten by the loser.
    const row = store.getState().actions.find((a) => a.id === created.id)!
    expect(row.status).toBe('succeeded')
  })

  it('recording a recovery outcome creates an audit entry', async () => {
    const store = createInMemoryAutomationStore()
    const created = await store.createAutomationAction(baseActionInput({ idempotencyKey: 'k8' }))
    await store.recordRecoveryOutcome(created.id, {
      status: 'retry_pending', error: 'cannot verify', orgId: 'org-1', entityType: 'channel_product', entityId: 'cp-1',
      verificationStatus: 'uncertain', reconciliationStatus: 'not_applicable',
    })

    const audit = store.getState().auditLog.find((e) => e.action === 'EXECUTION_RESULT_UNKNOWN' && e.entityId === 'cp-1')
    expect(audit).toBeDefined()
  })
})
