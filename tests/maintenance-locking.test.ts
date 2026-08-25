import { describe, expect, it } from 'vitest'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS } from '@/lib/automation/maintenanceHealth'

/**
 * Milestone 18, Phase 4/5/15 — the single-run lock, exercised through the
 * in-memory `AutomationStore` implementation. `inMemoryStore.ts` has no
 * `server-only` import anywhere, so this drives the *real* reap-then-acquire
 * orchestration `acquireMaintenanceRun`/`completeMaintenanceRun` implement —
 * the same reasoning `tests/automation-engine-e2e.test.ts` already applies
 * to the job queue. The Supabase-backed implementation
 * (`maintenanceRuns.ts`) mirrors this exactly, using the database's own
 * partial unique index instead of an in-memory `Map` lookup, but that half
 * cannot be exercised without a live database — the same established
 * limitation as `createAutomationAction`'s own idempotency race.
 */

describe('acquireMaintenanceRun: single-run protection', () => {
  it('the first call acquires the lock', async () => {
    const store = createInMemoryAutomationStore()
    const result = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(result.acquired).toBe(true)
  })

  it('a concurrent call while one is still running is rejected with the active run\'s own detail — never a duplicate run', async () => {
    const store = createInMemoryAutomationStore()
    const first = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(first.acquired).toBe(true)

    const second = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(second.acquired).toBe(false)
    if (!second.acquired) {
      expect(second.activeRun.status).toBe('running')
      if (first.acquired) expect(second.activeRun.id).toBe(first.runId)
    }
  })

  it('two instances (simulated as two sequential acquire attempts against the same store) cannot both own the active run', async () => {
    const store = createInMemoryAutomationStore()
    const instanceA = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    const instanceB = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect([instanceA.acquired, instanceB.acquired].filter(Boolean)).toHaveLength(1)
  })

  it('a completed run releases the lock — a subsequent call acquires cleanly', async () => {
    const store = createInMemoryAutomationStore()
    const first = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    if (first.acquired) {
      await store.completeMaintenanceRun(first.runId, { status: 'success', itemsProcessed: 3, itemsFailed: 0, decisionsCreated: 1, error: null, summary: {} })
    }

    const second = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(second.acquired).toBe(true)
  })

  it('a failed run also releases the lock, never leaving it stuck on non-success', async () => {
    const store = createInMemoryAutomationStore()
    const first = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    if (first.acquired) {
      await store.completeMaintenanceRun(first.runId, { status: 'failed', itemsProcessed: 0, itemsFailed: 1, decisionsCreated: 0, error: 'boom', summary: {} })
    }

    const second = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(second.acquired).toBe(true)
  })

  it('a different job_key never contends for the same lock', async () => {
    const store = createInMemoryAutomationStore()
    const a = await store.acquireMaintenanceRun('automation_maintenance', MAINTENANCE_LOCK_STALE_AFTER_MS)
    const b = await store.acquireMaintenanceRun('some_other_job', MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(a.acquired).toBe(true)
    expect(b.acquired).toBe(true)
  })
})

describe('acquireMaintenanceRun: crash/timeout recovery (Phase 5)', () => {
  it('a run stuck "running" well past the stale threshold is reaped, and a fresh acquire then succeeds', async () => {
    const store = createInMemoryAutomationStore()
    const first = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, 1) // 1ms threshold — immediately stale
    expect(first.acquired).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 5))

    const second = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, 1)
    expect(second.acquired).toBe(true)
    if (first.acquired && second.acquired) expect(second.runId).not.toBe(first.runId)

    // The reaped ghost is recorded as failed, not silently deleted.
    const history = await store.getRecentMaintenanceRuns(MAINTENANCE_JOB_KEY, 10)
    const reaped = history.find((r) => first.acquired && r.id === first.runId)
    expect(reaped?.status).toBe('failed')
    expect(reaped?.error).toContain('Reaped')
  })

  it('a run that is genuinely still within the stale threshold is never reaped', async () => {
    const store = createInMemoryAutomationStore()
    const first = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(first.acquired).toBe(true)

    const second = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    expect(second.acquired).toBe(false)

    const history = await store.getRecentMaintenanceRuns(MAINTENANCE_JOB_KEY, 10)
    expect(history.find((r) => first.acquired && r.id === first.runId)?.status).toBe('running')
  })

  it('permanently stuck lock does not block Commerce-OS forever — repeated reap-and-acquire attempts keep succeeding', async () => {
    const store = createInMemoryAutomationStore()
    for (let i = 0; i < 3; i++) {
      const result = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, 1)
      expect(result.acquired).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 3))
    }
  })
})

describe('getRecentMaintenanceRuns: ordering and history', () => {
  it('returns runs newest-first', async () => {
    const store = createInMemoryAutomationStore()
    const first = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    if (first.acquired) await store.completeMaintenanceRun(first.runId, { status: 'success', itemsProcessed: 0, itemsFailed: 0, decisionsCreated: 0, error: null, summary: {} })

    await new Promise((resolve) => setTimeout(resolve, 2))
    const second = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)

    const history = await store.getRecentMaintenanceRuns(MAINTENANCE_JOB_KEY, 10)
    expect(history[0].id).toBe(second.acquired ? second.runId : history[0].id)
    expect(history.length).toBe(2)
  })

  it('completeMaintenanceRun records the full structured summary', async () => {
    const store = createInMemoryAutomationStore()
    const acquired = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
    if (!acquired.acquired) throw new Error('expected to acquire')

    await store.completeMaintenanceRun(acquired.runId, {
      status: 'partial_success', itemsProcessed: 12, itemsFailed: 2, decisionsCreated: 3, error: 'two campaigns failed',
      summary: { triggeredBy: 'scheduler', recovery: { candidatesFound: 1 } },
    })

    const [run] = await store.getRecentMaintenanceRuns(MAINTENANCE_JOB_KEY, 1)
    expect(run.status).toBe('partial_success')
    expect(run.itemsProcessed).toBe(12)
    expect(run.itemsFailed).toBe(2)
    expect(run.decisionsCreated).toBe(3)
    expect(run.durationMs).toBeGreaterThanOrEqual(0)
    expect(run.summary.triggeredBy).toBe('scheduler')
  })
})
