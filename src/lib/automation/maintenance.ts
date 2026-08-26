import 'server-only'

import { runExecutionRecovery, type ExecutionRecoveryResult } from './recovery'
import { runAdvertisingSyncForConnectedOrgs, type MultiOrgAdvertisingSyncResult } from '@/lib/advertising/sync'
import { runCampaignReviewForConnectedOrgs, type MultiOrgCampaignReviewResult } from '@/lib/advertising/monitor'
import { classifyMaintenanceOutcome, MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS } from './maintenanceHealth'
import type { AutomationStore, MaintenanceRunRecord } from './store'

/**
 * The canonical maintenance orchestrator (Milestone 18, Phase 2). This is
 * the *only* place that calls `runExecutionRecovery` and
 * `runCampaignReviewForConnectedOrgs` together — `/api/automation/maintenance`
 * (scheduler) and the manual admin trigger (Phase 12) both call this same
 * function, never a second implementation of the same orchestration.
 *
 *   External trigger (scheduler or manual)
 *           |
 *   acquireMaintenanceRun  -- single-run lock, Phase 4/5
 *           |
 *   runExecutionRecovery   -- read-only provider verify, reconcile, never a write
 *           |
 *   runAdvertisingSyncForConnectedOrgs -- advance the async report pipeline
 *           |                             (Milestone 20), sync facts, never a write
 *           |
 *   runCampaignReviewForConnectedOrgs -- OBSERVE -> EVALUATE -> RECOMMEND, never executes
 *           |
 *   completeMaintenanceRun -- structured summary, Phase 6/9
 *
 * Advertising sync runs before the campaign monitor deliberately (Phase 15)
 * so this cycle's monitor evaluation sees the freshest facts this same run
 * could obtain — never the other way round, and never blocking: a report
 * still `processing` this cycle simply means no new facts yet, and the
 * monitor's own existing freshness policy (`MAX_CAMPAIGN_DATA_AGE_HOURS`)
 * already refuses to recommend against stale data either way.
 *
 * No subsystem call is wrapped in anything that could turn a
 * recommendation into a live execution — `runExecutionRecovery` only ever
 * calls a connector's read-only `verifyListingState`/`verifyCampaignState`,
 * `runAdvertisingSyncForConnectedOrgs` only ever reads (a report request
 * and a report download are both reads of the provider's own reporting
 * data, never a campaign mutation), and `runCampaignReviewForConnectedOrgs`
 * never imports a connector's write methods at all (see that module's own
 * comment). A recommendation this run creates lands on `/approvals`
 * exactly like a chat-originated one and requires the same human approval
 * before anything executes.
 *
 * Audit note (Phase 13): orchestration-level events ("maintenance
 * started/completed/skipped/failed") are recorded as `automation_runs`
 * rows (`maintenanceRuns.ts`), not `audit_logs` entries. `audit_logs.org_id`
 * is `not null references organisations` (migration 0001), and a
 * maintenance run is genuinely cross-organisation — it has no single
 * owning org to attribute a row to, and inventing one would misattribute
 * every row that table's other readers assume belongs to a real tenant.
 * `automation_runs` (migration 0008, made `org_id`-nullable in 0029
 * specifically for this) is the structurally correct place for a
 * cross-org system job's own run history, and every *domain-level* event
 * these two subsystems cause — an individual recommendation, an
 * individual recovery outcome — is already audited through `audit_logs`
 * with a real org_id by `runExecutionRecovery`/`proposeCampaignAction`
 * themselves, exactly as Phase 13 asks: "domain-level events... are
 * already audited by their respective systems."
 */

export type MaintenanceOutcome =
  | { outcome: 'already_running'; activeRun: MaintenanceRunRecord }
  | {
      outcome: 'succeeded' | 'partially_succeeded' | 'failed'
      runId: string
      startedAt: string
      finishedAt: string
      durationMs: number
      recovery: ExecutionRecoveryResult
      advertisingSync: MultiOrgAdvertisingSyncResult
      monitoring: MultiOrgCampaignReviewResult
    }

export async function runMaintenance(store: AutomationStore, triggeredBy: 'scheduler' | 'manual'): Promise<MaintenanceOutcome> {
  const lock = await store.acquireMaintenanceRun(MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS)
  if (!lock.acquired) {
    return { outcome: 'already_running', activeRun: lock.activeRun }
  }

  let recovery: ExecutionRecoveryResult
  let recoveryThrew = false
  try {
    recovery = await runExecutionRecovery(store)
  } catch (error) {
    recoveryThrew = true
    recovery = { candidatesFound: 0, succeeded: 0, failed: 0, unknown: 0, alreadyResolved: 0, errors: [error instanceof Error ? error.message : String(error)] }
  }

  let advertisingSync: MultiOrgAdvertisingSyncResult
  let advertisingSyncThrew = false
  try {
    advertisingSync = await runAdvertisingSyncForConnectedOrgs()
  } catch (error) {
    advertisingSyncThrew = true
    advertisingSync = {
      accountsChecked: 0, reportsRequested: 0, reportsProcessing: 0, reportsRetrieved: 0, reportsFailed: 0,
      recordsValidated: 0, recordsQuarantined: 0, factsCreated: 0, factsUpdated: 0,
      errors: [error instanceof Error ? error.message : String(error)], perAccount: [],
    }
  }

  let monitoring: MultiOrgCampaignReviewResult
  let monitoringThrew = false
  try {
    monitoring = await runCampaignReviewForConnectedOrgs()
  } catch (error) {
    monitoringThrew = true
    monitoring = {
      organisationsEvaluated: 0,
      providersChecked: 0,
      totals: { orgId: 'all', campaignsEvaluated: 0, campaignsSkipped: 0, recommendationsCreated: 0, duplicatesAvoided: 0, blocked: 0, blockedByFreshness: 0, errors: [error instanceof Error ? error.message : String(error)] },
      perOrg: [],
    }
  }

  const status = classifyMaintenanceOutcome([
    { threw: recoveryThrew, errorCount: recovery.errors.length },
    { threw: advertisingSyncThrew, errorCount: advertisingSync.errors.length },
    { threw: monitoringThrew, errorCount: monitoring.totals.errors.length },
  ])

  const allErrors = [...recovery.errors, ...advertisingSync.errors, ...monitoring.totals.errors]

  await store.completeMaintenanceRun(lock.runId, {
    status,
    itemsProcessed: recovery.candidatesFound + advertisingSync.accountsChecked + monitoring.totals.campaignsEvaluated,
    itemsFailed: recovery.failed + recovery.unknown + advertisingSync.reportsFailed + monitoring.totals.errors.length,
    decisionsCreated: monitoring.totals.recommendationsCreated,
    error: allErrors.length > 0 ? allErrors.join('; ') : null,
    summary: { triggeredBy, recovery, advertisingSync, monitoring },
  })

  const finishedAt = new Date().toISOString()
  return {
    outcome: status === 'success' ? 'succeeded' : status === 'partial_success' ? 'partially_succeeded' : 'failed',
    runId: lock.runId,
    startedAt: lock.startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(lock.startedAt),
    recovery,
    advertisingSync,
    monitoring,
  }
}
