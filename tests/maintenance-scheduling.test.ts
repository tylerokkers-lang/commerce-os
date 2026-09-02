import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { MAINTENANCE_JOB_KEY } from '@/lib/automation/maintenanceHealth'

/**
 * Phase 15 follow-up — `runMaintenance`'s two new subsystem steps
 * (`runMonitoringForAllOrgs`, `runScheduledJobBatch`), which fold job-queue
 * processing and due-monitor evaluation into the one already-scheduled
 * maintenance cycle. Live behaviour against real Postgres was already
 * proven in this phase's own verification pass (`HANDOVER.md` §69); what
 * this file proves instead is the *orchestration* around that — ordering,
 * isolation, and truthful outcome classification — by mocking all seven
 * subsystem functions `maintenance.ts` imports by name and driving the
 * real (in-memory, not mocked) `AutomationStore` implementation, the same
 * way `tests/maintenance-locking.test.ts` already does for the lock itself.
 */

const recoveryMock = vi.fn()
const advertisingSyncMock = vi.fn()
const campaignReviewMock = vi.fn()
const orderIngestionMock = vi.fn()
const purchaseWorkflowMock = vi.fn()
const monitoringMock = vi.fn()
const jobQueueMock = vi.fn()

// `maintenance.ts` (and several of the real modules it imports) carry
// `import 'server-only'`, which plain Node/Vitest module resolution cannot
// find outside Next's own bundler — confirmed directly: without this, every
// test below fails with `Cannot find package 'server-only'`, not a
// mock-related failure (the same fix `tests/automation-jobs.test.ts` and
// `tests/logout-action.test.ts` already needed).
vi.mock('server-only', () => ({}))

vi.mock('@/lib/automation/recovery', () => ({ runExecutionRecovery: () => recoveryMock() }))
vi.mock('@/lib/advertising/sync', () => ({ runAdvertisingSyncForConnectedOrgs: () => advertisingSyncMock() }))
vi.mock('@/lib/advertising/monitor', () => ({ runCampaignReviewForConnectedOrgs: () => campaignReviewMock() }))
vi.mock('@/lib/orders/ingestionRun', () => ({ runOrderIngestionForConnectedOrgs: () => orderIngestionMock() }))
vi.mock('@/lib/orders/purchaseWorkflow', () => ({ runPurchaseWorkflowForConnectedOrgs: () => purchaseWorkflowMock() }))
vi.mock('@/lib/monitoring/scheduledRun', () => ({ runMonitoringForAllOrgs: () => monitoringMock() }))
vi.mock('@/lib/automation/scheduledJobBatch', () => ({ runScheduledJobBatch: () => jobQueueMock() }))

const OK_RECOVERY = { candidatesFound: 0, succeeded: 0, failed: 0, unknown: 0, alreadyResolved: 0, errors: [] }
const OK_ADSYNC = { accountsChecked: 0, reportsRequested: 0, reportsProcessing: 0, reportsRetrieved: 0, reportsFailed: 0, recordsValidated: 0, recordsQuarantined: 0, factsCreated: 0, factsUpdated: 0, errors: [], perAccount: [] }
const OK_CAMPAIGN = { organisationsEvaluated: 0, providersChecked: 0, totals: { orgId: 'all', campaignsEvaluated: 0, campaignsSkipped: 0, recommendationsCreated: 0, duplicatesAvoided: 0, blocked: 0, blockedByFreshness: 0, errors: [] }, perOrg: [] }
const OK_ORDERS = { channelsChecked: 0, ordersFetched: 0, created: 0, statusChanged: 0, statusChangeBlocked: 0, alreadyIngested: 0, rejected: 0, errors: [], createdOrderIds: [] }
const OK_PURCHASE = { ordersChecked: 0, fulfilmentsCreated: 0, ordersWithNoSupplierAvailable: 0, errors: [] }
const OK_MONITORING: readonly unknown[] = []
const OK_JOBQUEUE = { claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 }

function mockAllHealthy() {
  recoveryMock.mockResolvedValue(OK_RECOVERY)
  advertisingSyncMock.mockResolvedValue(OK_ADSYNC)
  campaignReviewMock.mockResolvedValue(OK_CAMPAIGN)
  orderIngestionMock.mockResolvedValue(OK_ORDERS)
  purchaseWorkflowMock.mockResolvedValue(OK_PURCHASE)
  monitoringMock.mockResolvedValue(OK_MONITORING)
  jobQueueMock.mockResolvedValue(OK_JOBQUEUE)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAllHealthy()
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('runMaintenance: the two new scheduled subsystems', () => {
  it('a fully healthy run includes real subjectMonitoring/jobQueue results and reports success', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    monitoringMock.mockResolvedValue([{ orgId: 'org-a', monitors: [{ monitorKey: 'fx_rates', ran: true, subjectsChecked: 2, eventsCreated: 1, eventsDeduplicated: 0, errors: [] }] }])
    jobQueueMock.mockResolvedValue({ claimed: 3, succeeded: 3, failed: 0, deadLettered: 0 })

    const outcome = await runMaintenance(store, 'scheduler')

    expect(outcome.outcome).toBe('succeeded')
    if (outcome.outcome !== 'already_running') {
      expect(outcome.subjectMonitoring.organisations).toHaveLength(1)
      expect(outcome.subjectMonitoring.errors).toHaveLength(0)
      expect(outcome.jobQueue).toEqual({ claimed: 3, succeeded: 3, failed: 0, deadLettered: 0 })
    }
    expect(monitoringMock).toHaveBeenCalledTimes(1)
    expect(jobQueueMock).toHaveBeenCalledTimes(1)
  })

  it('monitoring runs before the job batch, so the batch can claim what monitoring just enqueued', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    const callOrder: string[] = []
    monitoringMock.mockImplementation(async () => { callOrder.push('monitoring'); return OK_MONITORING })
    jobQueueMock.mockImplementation(async () => { callOrder.push('jobQueue'); return OK_JOBQUEUE })

    await runMaintenance(store, 'scheduler')

    expect(callOrder).toEqual(['monitoring', 'jobQueue'])
  })

  it('subjectMonitoring throwing does not prevent jobQueue from still running (per-subsystem isolation)', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    monitoringMock.mockRejectedValue(new Error('monitoring subsystem exploded'))

    const outcome = await runMaintenance(store, 'scheduler')

    expect(jobQueueMock).toHaveBeenCalledTimes(1)
    if (outcome.outcome !== 'already_running') {
      expect(outcome.subjectMonitoring.errors).toContain('monitoring subsystem exploded')
      expect(outcome.jobQueue).toEqual(OK_JOBQUEUE) // Still ran, still healthy, unaffected.
    }
    // One subsystem threw while every other one (including jobQueue) still
    // ran cleanly — never a catastrophic 'failed' whole-run result.
    expect(outcome.outcome).toBe('partially_succeeded')
  })

  it('jobQueue throwing does not corrupt the run outcome or hide the failure', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    jobQueueMock.mockRejectedValue(new Error('job queue batch exploded'))

    const outcome = await runMaintenance(store, 'scheduler')

    expect(outcome.outcome).toBe('partially_succeeded')
    if (outcome.outcome !== 'already_running') {
      expect(outcome.jobQueue).toEqual(OK_JOBQUEUE) // Safe zeroed fallback, never fabricated activity.
    }
  })

  it('a jobQueue batch with failed/dead-lettered jobs is truthfully reported as partial success, never silent success', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    jobQueueMock.mockResolvedValue({ claimed: 2, succeeded: 0, failed: 1, deadLettered: 1 })

    const outcome = await runMaintenance(store, 'scheduler')

    expect(outcome.outcome).toBe('partially_succeeded')
    if (outcome.outcome !== 'already_running') {
      expect(outcome.jobQueue.failed + outcome.jobQueue.deadLettered).toBe(2)
    }
  })

  it('every subsystem throwing at once (including the two new ones) is reported as a genuine failure, never success', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    recoveryMock.mockRejectedValue(new Error('r'))
    advertisingSyncMock.mockRejectedValue(new Error('a'))
    campaignReviewMock.mockRejectedValue(new Error('c'))
    orderIngestionMock.mockRejectedValue(new Error('o'))
    purchaseWorkflowMock.mockRejectedValue(new Error('p'))
    monitoringMock.mockRejectedValue(new Error('m'))
    jobQueueMock.mockRejectedValue(new Error('j'))

    const outcome = await runMaintenance(store, 'scheduler')

    expect(outcome.outcome).toBe('failed')
  })

  it('a concurrent maintenance run is rejected with already_running — never a second, overlapping execution', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    // Block on the very first subsystem call so the first run is reliably
    // still "in flight" (lock held, nothing else has run yet) at the exact
    // moment the second invocation arrives — the deterministic version of
    // the real overlapping-scheduler-tick race this phase proved live
    // against actual Postgres (`HANDOVER.md` §69: two genuinely concurrent
    // HTTP requests, one 200 + one 409 already_running).
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve })
    recoveryMock.mockImplementation(async () => { await gate; return OK_RECOVERY })

    const firstPromise = runMaintenance(store, 'scheduler')
    await Promise.resolve() // Let the first call run synchronously up to acquiring the lock and calling recoveryMock.
    const second = await runMaintenance(store, 'scheduler')
    expect(second.outcome).toBe('already_running')

    releaseFirst()
    const first = await firstPromise
    expect(first.outcome).not.toBe('already_running')
  })
})

describe('runMaintenance: completeMaintenanceRun summary truthfulness', () => {
  it('itemsProcessed/itemsFailed include the job queue counts, not just the five original subsystems', async () => {
    const { runMaintenance } = await import('@/lib/automation/maintenance')
    const store = createInMemoryAutomationStore()
    jobQueueMock.mockResolvedValue({ claimed: 5, succeeded: 2, failed: 2, deadLettered: 1 })

    await runMaintenance(store, 'scheduler')

    const [run] = await store.getRecentMaintenanceRuns(MAINTENANCE_JOB_KEY, 1)
    expect(run.itemsProcessed).toBeGreaterThanOrEqual(5)
    expect(run.itemsFailed).toBeGreaterThanOrEqual(3)
  })
})
