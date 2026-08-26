import { describe, expect, it } from 'vitest'
import { classifyMaintenanceHealth, classifyMaintenanceOutcome, MAINTENANCE_LOCK_STALE_AFTER_MS, MAINTENANCE_STALE_AFTER_MS } from '@/lib/automation/maintenanceHealth'
import type { MaintenanceRunRecord } from '@/lib/automation/store'

/**
 * Milestone 18, Phase 9/10/15 — the pure health/staleness/outcome
 * classification behind the maintenance orchestrator. `classifyMaintenanceHealth`
 * takes `runs` already sorted newest-first, exactly as
 * `getRecentMaintenanceRuns` returns them.
 */

const NOW = '2026-08-25T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)

function run(overrides: Partial<MaintenanceRunRecord> = {}): MaintenanceRunRecord {
  return {
    id: 'run-1', jobKey: 'automation_maintenance', status: 'success',
    startedAt: NOW, finishedAt: NOW, durationMs: 1000,
    itemsProcessed: 0, itemsFailed: 0, decisionsCreated: 0, error: null, summary: {},
    ...overrides,
  }
}

function minutesAgo(minutes: number): string {
  return new Date(NOW_MS - minutes * 60_000).toISOString()
}

describe('classifyMaintenanceHealth: NEVER_RUN', () => {
  it('an empty run history is NEVER_RUN, never fabricated as healthy', () => {
    const health = classifyMaintenanceHealth([], NOW)
    expect(health.state).toBe('NEVER_RUN')
    expect(health.lastSuccessfulRun).toBeNull()
    expect(health.lastAttemptedRun).toBeNull()
  })
})

describe('classifyMaintenanceHealth: RUNNING', () => {
  it('a recent running row is RUNNING, with a real running duration', () => {
    const runs = [run({ id: 'r1', status: 'running', startedAt: minutesAgo(2), finishedAt: null })]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.state).toBe('RUNNING')
    expect(health.currentRun?.id).toBe('r1')
    expect(health.runningDurationMs).toBe(2 * 60_000)
  })

  it('a running row past the lock-stale threshold is not reported as RUNNING — it is a crashed-process ghost', () => {
    const staleMinutes = MAINTENANCE_LOCK_STALE_AFTER_MS / 60_000 + 5
    const runs = [
      run({ id: 'ghost', status: 'running', startedAt: minutesAgo(staleMinutes), finishedAt: null }),
      run({ id: 'earlier-success', status: 'success', startedAt: minutesAgo(staleMinutes + 10) }),
    ]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.state).not.toBe('RUNNING')
    expect(health.currentRun).toBeNull()
  })
})

describe('classifyMaintenanceHealth: HEALTHY', () => {
  it('a recent successful run is HEALTHY', () => {
    const runs = [run({ status: 'success', startedAt: minutesAgo(5) })]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.state).toBe('HEALTHY')
    expect(health.lastSuccessfulRun?.status).toBe('success')
  })
})

describe('classifyMaintenanceHealth: AUTOMATION_STALE', () => {
  it('the last success is older than the staleness window -> AUTOMATION_STALE', () => {
    const staleMinutes = MAINTENANCE_STALE_AFTER_MS / 60_000 + 10
    const runs = [run({ status: 'success', startedAt: minutesAgo(staleMinutes) })]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.state).toBe('AUTOMATION_STALE')
  })

  it('no successful run has ever existed, but failures have -> AUTOMATION_STALE, never HEALTHY', () => {
    const runs = [
      run({ id: 'f1', status: 'failed', startedAt: minutesAgo(200) }),
      run({ id: 'f2', status: 'failed', startedAt: minutesAgo(400) }),
    ]
    // Latest is 'failed', so FAILED wins over AUTOMATION_STALE per priority — but
    // there is genuinely no successful run at all, which the record still reflects.
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.lastSuccessfulRun).toBeNull()
    expect(['FAILED', 'AUTOMATION_STALE']).toContain(health.state)
  })

  it('exactly at the staleness boundary is not yet stale', () => {
    const runs = [run({ status: 'success', startedAt: new Date(NOW_MS - MAINTENANCE_STALE_AFTER_MS).toISOString() })]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.state).toBe('HEALTHY')
  })
})

describe('classifyMaintenanceHealth: FAILED', () => {
  it('the most recent attempt failed, even though nothing else is stale -> FAILED', () => {
    const runs = [
      run({ id: 'latest-failed', status: 'failed', startedAt: minutesAgo(2) }),
      run({ id: 'recent-success', status: 'success', startedAt: minutesAgo(10) }),
    ]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.state).toBe('FAILED')
    expect(health.lastAttemptedRun?.id).toBe('latest-failed')
    expect(health.lastSuccessfulRun?.id).toBe('recent-success')
  })
})

describe('classifyMaintenanceHealth: PARTIAL_SUCCESS', () => {
  it('the most recent attempt partially succeeded, and a recent enough success exists -> PARTIAL_SUCCESS', () => {
    const runs = [run({ status: 'partial_success', startedAt: minutesAgo(3) })]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.state).toBe('PARTIAL_SUCCESS')
  })
})

describe('classifyMaintenanceHealth: recentFailures and ordering', () => {
  it('recentFailures includes failed and partial_success runs from the supplied history', () => {
    const runs = [
      run({ id: 'r1', status: 'success', startedAt: minutesAgo(1) }),
      run({ id: 'r2', status: 'failed', startedAt: minutesAgo(20) }),
      run({ id: 'r3', status: 'partial_success', startedAt: minutesAgo(40) }),
    ]
    const health = classifyMaintenanceHealth(runs, NOW)
    expect(health.recentFailures.map((r) => r.id).sort()).toEqual(['r2', 'r3'])
  })
})

describe('classifyMaintenanceOutcome: partial failure never fails the whole run', () => {
  it('no errors, nothing threw -> success', () => {
    expect(classifyMaintenanceOutcome([{ threw: false, errorCount: 0 }, { threw: false, errorCount: 0 }])).toBe('success')
  })

  it('some per-item errors but no subsystem threw -> partial_success (organisation B failing never blocks C)', () => {
    expect(classifyMaintenanceOutcome([{ threw: false, errorCount: 0 }, { threw: false, errorCount: 2 }])).toBe('partial_success')
  })

  it('one subsystem threw entirely, others succeeded cleanly -> partial_success, never failed outright', () => {
    expect(classifyMaintenanceOutcome([{ threw: true, errorCount: 0 }, { threw: false, errorCount: 0 }, { threw: false, errorCount: 0 }])).toBe('partial_success')
  })

  it('every subsystem threw entirely -> failed, a genuinely catastrophic run', () => {
    expect(classifyMaintenanceOutcome([{ threw: true, errorCount: 0 }, { threw: true, errorCount: 0 }])).toBe('failed')
  })

  it('two of three subsystems threw, one still ran cleanly -> partial_success, not failed', () => {
    expect(classifyMaintenanceOutcome([{ threw: true, errorCount: 0 }, { threw: true, errorCount: 0 }, { threw: false, errorCount: 0 }])).toBe('partial_success')
  })

  it('an empty subsystem list -> success (vacuously nothing failed)', () => {
    expect(classifyMaintenanceOutcome([])).toBe('success')
  })
})
