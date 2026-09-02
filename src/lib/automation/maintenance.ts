import 'server-only'

import { runExecutionRecovery, type ExecutionRecoveryResult } from './recovery'
import { runAdvertisingSyncForConnectedOrgs, type MultiOrgAdvertisingSyncResult } from '@/lib/advertising/sync'
import { runCampaignReviewForConnectedOrgs, type MultiOrgCampaignReviewResult } from '@/lib/advertising/monitor'
import { runOrderIngestionForConnectedOrgs, type OrderIngestionRunResult } from '@/lib/orders/ingestionRun'
import { runPurchaseWorkflowForConnectedOrgs, type PurchaseWorkflowResult } from '@/lib/orders/purchaseWorkflow'
import { runMonitoringForAllOrgs, type OrgMonitoringResult } from '@/lib/monitoring/scheduledRun'
import { runScheduledJobBatch } from './scheduledJobBatch'
import { classifyMaintenanceOutcome, MAINTENANCE_JOB_KEY, MAINTENANCE_LOCK_STALE_AFTER_MS } from './maintenanceHealth'
import type { AutomationStore, MaintenanceRunRecord } from './store'
import type { WorkerBatchResult } from './worker'

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
 *   runOrderIngestionForConnectedOrgs -- real order-ingestion write path
 *           |                             (order-ingestion milestone), writes
 *           |                             orders/order_items, never a supplier
 *           |                             or marketplace write
 *           |
 *   runPurchaseWorkflowForConnectedOrgs -- resolves a supplier and creates
 *           |                               the AWAITING_PURCHASE fulfilment +
 *           |                               notification for newly-paid orders,
 *           |                               never places a purchase itself
 *           |
 *   runMonitoringForAllOrgs -- runs every org's due monitors; a monitor
 *           |                   detecting something actionable enqueues an
 *           |                   `automation_jobs` row (never executes anything
 *           |                   itself) — the production scheduler & automation
 *           |                   operations milestone's "safe job creation" step
 *           |
 *   runScheduledJobBatch -- claims and processes a bounded batch of whatever
 *           |                is now due in `automation_jobs`, including
 *           |                anything the monitoring step above just
 *           |                enqueued in this same cycle — the same
 *           |                atomic, race-safe claim the automation
 *           |                job-queue reliability milestone proved live
 *           |
 *   completeMaintenanceRun -- structured summary, Phase 6/9
 *
 * Monitoring runs immediately before the job batch, deliberately, for the
 * same reason advertising sync runs before the campaign monitor below: so
 * whatever this cycle's own monitoring pass just enqueued has a chance to
 * be claimed and processed in the same run, not only the next one.
 *
 * Before the production scheduler & automation operations milestone,
 * `/api/automation/run` (job batch) and `/api/monitoring/run` (monitoring)
 * existed and were independently correct, but neither had anything in
 * `vercel.json` actually calling it — only this function's own route,
 * `/api/automation/maintenance`, was ever scheduled. Since monitoring is
 * what produces most of `automation_jobs`' own work in the first place,
 * that meant the job queue the previous milestone proved genuinely
 * race-safe against real Postgres had no real producer or consumer
 * running on a timer at all. Both are now folded into this same,
 * already-scheduled, single-locked cycle rather than requiring new cron
 * entries this repository has no way to verify would actually be
 * deployed — this environment cannot confirm the connected Vercel
 * project's plan tier or its actual cron-job limit. `/api/automation/run`
 * and `/api/monitoring/run` remain independently callable — for manual
 * triggering, or a finer-grained external scheduler later — but are no
 * longer required for the baseline loop to run at all.
 *
 * Advertising sync runs before the campaign monitor deliberately (Phase 15)
 * so this cycle's monitor evaluation sees the freshest facts this same run
 * could obtain — never the other way round, and never blocking: a report
 * still `processing` this cycle simply means no new facts yet, and the
 * monitor's own existing freshness policy (`MAX_CAMPAIGN_DATA_AGE_HOURS`)
 * already refuses to recommend against stale data either way. Order
 * ingestion runs before the purchase workflow for the identical reason: a
 * newly-ingested `'paid'` order should reach the AWAITING_PURCHASE step in
 * the same cycle it arrives, not the next one.
 *
 * No subsystem call is wrapped in anything that could turn a
 * recommendation into a live execution — `runExecutionRecovery` only ever
 * calls a connector's read-only `verifyListingState`/`verifyCampaignState`,
 * `runAdvertisingSyncForConnectedOrgs` only ever reads (a report request
 * and a report download are both reads of the provider's own reporting
 * data, never a campaign mutation), `runCampaignReviewForConnectedOrgs`
 * never imports a connector's write methods at all (see that module's own
 * comment), `runOrderIngestionForConnectedOrgs` only ever calls a
 * connector's read-only `fetchOrders`, and `runPurchaseWorkflowForConnectedOrgs`
 * never calls a supplier's API, a connector's write methods, or anything
 * that moves money — it only ever creates an internal `'awaiting_supplier'`
 * fulfilment record and a notification; a fulfilment leaves that status
 * only via `manualPurchase.ts`'s `recordSupplierPurchase`, called
 * exclusively from a session-authenticated API route a person triggers
 * themselves. A recommendation this run creates lands on `/approvals`
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
      orderIngestion: OrderIngestionRunResult
      purchaseWorkflow: PurchaseWorkflowResult
      // Named distinctly from `monitoring` above, which is specifically the
      // advertising campaign review — this is the unrelated product/
      // supplier/compliance/FX/market monitor sweep (`runMonitoringForAllOrgs`).
      subjectMonitoring: { organisations: readonly OrgMonitoringResult[]; errors: readonly string[] }
      jobQueue: WorkerBatchResult
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

  let orderIngestion: OrderIngestionRunResult
  let orderIngestionThrew = false
  try {
    orderIngestion = await runOrderIngestionForConnectedOrgs()
  } catch (error) {
    orderIngestionThrew = true
    orderIngestion = {
      channelsChecked: 0, ordersFetched: 0, created: 0, statusChanged: 0, statusChangeBlocked: 0,
      alreadyIngested: 0, rejected: 0, errors: [error instanceof Error ? error.message : String(error)], createdOrderIds: [],
    }
  }

  let purchaseWorkflow: PurchaseWorkflowResult
  let purchaseWorkflowThrew = false
  try {
    purchaseWorkflow = await runPurchaseWorkflowForConnectedOrgs()
  } catch (error) {
    purchaseWorkflowThrew = true
    purchaseWorkflow = { ordersChecked: 0, fulfilmentsCreated: 0, ordersWithNoSupplierAvailable: 0, errors: [error instanceof Error ? error.message : String(error)] }
  }

  let subjectMonitoring: { organisations: readonly OrgMonitoringResult[]; errors: readonly string[] }
  let subjectMonitoringThrew = false
  try {
    const organisations = await runMonitoringForAllOrgs()
    subjectMonitoring = { organisations, errors: [] }
  } catch (error) {
    subjectMonitoringThrew = true
    subjectMonitoring = { organisations: [], errors: [error instanceof Error ? error.message : String(error)] }
  }

  // Deliberately after subjectMonitoring (see the module comment): whatever
  // that step just enqueued is claimable in this same cycle.
  let jobQueue: WorkerBatchResult
  let jobQueueThrew = false
  let jobQueueError: string | null = null
  try {
    jobQueue = await runScheduledJobBatch()
  } catch (error) {
    jobQueueThrew = true
    jobQueueError = error instanceof Error ? error.message : String(error)
    jobQueue = { claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 }
  }

  const status = classifyMaintenanceOutcome([
    { threw: recoveryThrew, errorCount: recovery.errors.length },
    { threw: advertisingSyncThrew, errorCount: advertisingSync.errors.length },
    { threw: monitoringThrew, errorCount: monitoring.totals.errors.length },
    { threw: orderIngestionThrew, errorCount: orderIngestion.errors.length },
    { threw: purchaseWorkflowThrew, errorCount: purchaseWorkflow.errors.length },
    { threw: subjectMonitoringThrew, errorCount: subjectMonitoring.errors.length },
    { threw: jobQueueThrew, errorCount: jobQueue.failed + jobQueue.deadLettered },
  ])

  const allErrors = [
    ...recovery.errors, ...advertisingSync.errors, ...monitoring.totals.errors, ...orderIngestion.errors,
    ...purchaseWorkflow.errors, ...subjectMonitoring.errors,
    ...(jobQueueError ? [jobQueueError] : []),
  ]

  await store.completeMaintenanceRun(lock.runId, {
    status,
    itemsProcessed: recovery.candidatesFound + advertisingSync.accountsChecked + monitoring.totals.campaignsEvaluated + orderIngestion.ordersFetched + purchaseWorkflow.ordersChecked + jobQueue.claimed,
    itemsFailed: recovery.failed + recovery.unknown + advertisingSync.reportsFailed + monitoring.totals.errors.length + orderIngestion.rejected + purchaseWorkflow.errors.length + jobQueue.failed + jobQueue.deadLettered,
    decisionsCreated: monitoring.totals.recommendationsCreated,
    error: allErrors.length > 0 ? allErrors.join('; ') : null,
    summary: { triggeredBy, recovery, advertisingSync, monitoring, orderIngestion, purchaseWorkflow, subjectMonitoring, jobQueue },
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
    orderIngestion,
    purchaseWorkflow,
    subjectMonitoring,
    jobQueue,
  }
}
