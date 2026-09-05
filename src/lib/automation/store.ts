import type { Enums } from '@/lib/supabase/database.types'
import type { AutomationActionType, AutomationJobStatus, AutomationActionStatus, AutomationLevel, PolicyResult } from './types'
import type { AutomationSettings } from './settingsTypes'
import type { ChannelKey } from '@/lib/core/domain'
import type { StageChangePlan } from '@/lib/products/transitions'

/**
 * The `AutomationStore` abstraction (Milestone 6 verification pass).
 *
 * Every piece of the automation engine that touches persistence — the job
 * queue, the action record, the audit log, notifications — is defined here
 * as an interface with no `server-only` import, so it can be implemented
 * twice:
 *
 *   - `supabaseStore.ts`: the real implementation, backed by Postgres via
 *     Supabase. This is what runs in production.
 *   - `inMemoryStore.ts`: a fully-behaved in-memory implementation used by
 *     `tests/automation-engine-e2e.test.ts` to drive the *actual*
 *     orchestration code (`worker.ts`'s `runWorkerBatch`, the real
 *     `evaluateSupplierSwitchAutomation` / policy engine / audit shape)
 *     end-to-end, without needing a live Supabase project.
 *
 * This is the standard way to test code that would otherwise require a live
 * external service: the orchestration logic (which functions call which, in
 * what order, with what data threading between them) is proven correct by
 * running it for real against a swapped persistence layer, rather than by
 * calling the final decision function directly from a test. The one thing
 * this cannot prove is the live Supabase/PostgREST HTTP path itself — that
 * requires a deployed Supabase project, documented as a production
 * infrastructure requirement in `HANDOVER.md`.
 */

export interface JobRecord {
  id: string
  orgId: string
  jobType: string
  status: AutomationJobStatus
  payload: Record<string, unknown>
  runAt: string
  idempotencyKey: string | null
  attempts: number
  maxAttempts: number
  lastError: string | null
  lockedAt: string | null
  lockedBy: string | null
  correlationId: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface ActionRecord {
  id: string
  orgId: string
  correlationId: string
  idempotencyKey: string | null
  actionType: AutomationActionType
  entityType: string
  entityId: string | null
  reason: string
  inputFacts: Record<string, unknown>
  decision: Record<string, unknown>
  policyResult: PolicyResult
  automationLevel: AutomationLevel
  riskLevel: PolicyResult['riskLevel']
  status: AutomationActionStatus
  error: string | null
  actorType: Enums<'actor_type'>
  aiDecisionId: string | null
  jobId: string | null
  createdAt: string
  completedAt: string | null
  externalRef: string | null
  verificationStatus: VerificationStatus
  reconciliationStatus: ReconciliationStatus
}

export interface EnqueueJobInput {
  orgId: string
  jobType: string
  payload?: Record<string, unknown>
  runAt?: string
  idempotencyKey?: string | null
  maxAttempts?: number
  correlationId?: string
}

export interface JobOutcome {
  succeeded: boolean
  error?: string | null
  retryable?: boolean
}

export interface CreateActionInput {
  orgId: string
  correlationId?: string
  idempotencyKey?: string | null
  actionType: AutomationActionType
  entityType: string
  entityId?: string | null
  reason: string
  inputFacts: Record<string, unknown>
  decision: Record<string, unknown>
  policy: PolicyResult
  automationLevel: AutomationLevel
  expectedOutcome?: string | null
  actorType?: Enums<'actor_type'>
  aiDecisionId?: string | null
  jobId?: string | null
}

export type VerificationStatus = 'not_applicable' | 'pending' | 'verified' | 'failed' | 'uncertain'
export type ReconciliationStatus = 'not_applicable' | 'matched' | 'discrepancy' | 'pending'

/**
 * Milestone 18 — a cross-organisation system job's run record, backed by
 * the previously-unused `automation_runs` table (migration 0008; made
 * `org_id`-nullable for exactly this in migration 0029). `status` is a
 * free-text column, not a Postgres enum, so `'partial_success'` and
 * `'skipped'` need no schema change to introduce.
 */
export type MaintenanceRunStatus = 'running' | 'success' | 'failed' | 'partial_success' | 'skipped'

export interface MaintenanceRunRecord {
  id: string
  jobKey: string
  status: MaintenanceRunStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  itemsProcessed: number
  itemsFailed: number
  decisionsCreated: number
  error: string | null
  summary: Record<string, unknown>
}

export type AcquireMaintenanceRunResult =
  | { acquired: true; runId: string; startedAt: string }
  /** Another row for this `jobKey` is still genuinely `running` (not stale) — the caller must not start a second, concurrent run. */
  | { acquired: false; activeRun: MaintenanceRunRecord }

export interface CompleteMaintenanceRunInput {
  status: 'success' | 'failed' | 'partial_success' | 'skipped'
  itemsProcessed: number
  itemsFailed: number
  decisionsCreated: number
  error: string | null
  summary: Record<string, unknown>
}

export interface CompleteActionOutcome {
  succeeded: boolean
  error?: string | null
  orgId: string
  entityType: string
  entityId?: string | null
  /** The provider's own reference for the external write this action performed, if any (Milestone 7). */
  externalRef?: string | null
  verificationStatus?: VerificationStatus
  reconciliationStatus?: ReconciliationStatus
}

/**
 * Milestone 17 — the outcome of re-checking one action stuck in
 * `executing`. Reuses `AutomationActionStatus`'s existing `'retry_pending'`
 * value (reserved since migration 0019's `SafeFailureState` — never a
 * value the codebase actually set until now) for the genuinely-unknown
 * case, rather than a new column or enum value.
 */
export interface RecoveryOutcomeInput {
  status: 'succeeded' | 'failed' | 'retry_pending'
  error: string | null
  orgId: string
  entityType: string
  entityId: string | null
  externalRef?: string | null
  verificationStatus: VerificationStatus
  reconciliationStatus: ReconciliationStatus
}

/** A patch to our own record of a channel listing, applied only after a write has been verified — never speculatively. */
export interface ChannelProductReconciliation {
  orgId: string
  channelProductId: string
  priceMinor?: number
  status?: 'live' | 'paused'
  fulfilmentSupplierId?: string
}

/** A patch to our own record of an advertising campaign, applied only after a write has been verified — never speculatively. Same discipline as `ChannelProductReconciliation`. */
export interface AdvertisingCampaignReconciliation {
  orgId: string
  channel: ChannelKey
  externalId: string
  isPaused?: boolean
  dailyBudgetMinor?: number
}

export interface AuditEntryInput {
  orgId: string
  action: string
  entityType: string
  entityId?: string | null
  actorType: Enums<'actor_type'>
  actorLabel?: string | null
  reason?: string | null
  ruleKey?: string | null
  aiDecisionId?: string | null
  result?: 'success' | 'failure' | 'blocked'
  error?: string | null
  metadata?: Record<string, unknown>
}

export interface NotifyInput {
  orgId: string
  severity: Enums<'notification_severity'>
  category: string
  title: string
  body?: string | null
  entityType?: string | null
  entityId?: string | null
  actionUrl?: string | null
  dedupeKey?: string | null
}

/**
 * The runaway-automation safeguard (brief §15): a hard backstop independent
 * of any domain engine's own verdict. If the same org/entity/action-type
 * combination has already produced this many actions within the window, the
 * next one is forced to `blocked` regardless of what the policy engine
 * would otherwise have decided — a rule triggering itself indefinitely
 * (e.g. a flapping stock signal repeatedly "switching" and "switching back")
 * cannot execute an unbounded number of times.
 */
export const RUNAWAY_MAX_ACTIONS_PER_WINDOW = 5
export const RUNAWAY_WINDOW_MINUTES = 60

export interface ProposeApprovalInput {
  orgId: string
  decisionType: string
  entityType: string
  entityId: string | null
  title: string
  detail: string
  reasoning: string
  confidence: number | null
  estimatedImpactMinor: number | null
  automationLevelRequired: AutomationLevel
  riskLevel: PolicyResult['riskLevel']
  inputs: Record<string, unknown>
  /** Replayed verbatim by `approvalWorkflow.ts` on approval — never recomputed. */
  actionPayload: {
    actionType: AutomationActionType
    entityType: string
    entityId: string | null
    reason: string
    inputFacts: Record<string, unknown>
  }
  expiresAt: string | null
}

export interface AutomationStore {
  enqueueJob(input: EnqueueJobInput): Promise<{ id: string; alreadyExisted: boolean }>
  claimNextJob(workerId: string): Promise<JobRecord | null>
  completeJob(job: JobRecord, outcome: JobOutcome): Promise<void>
  /** Cancels a job that has not started running yet. A no-op (returns false) once it is running or terminal. */
  cancelJob(jobId: string, reason: string): Promise<boolean>
  /** Surfaces a `requires_approval` action on the owner-facing Approvals queue (brief §11). */
  proposeApproval(input: ProposeApprovalInput): Promise<{ id: string }>
  createAutomationAction(input: CreateActionInput): Promise<{ id: string; status: AutomationActionStatus; alreadyExisted: boolean }>
  completeAutomationAction(actionId: string, outcome: CompleteActionOutcome): Promise<void>
  recordAudit(entry: AuditEntryInput): Promise<void>
  notify(entry: NotifyInput): Promise<void>
  getAutomationSettings(orgId: string): Promise<AutomationSettings>
  /** Count of actions of this exact type for this exact entity created since `sinceIso` — the runaway-loop safeguard's input. */
  countRecentActionsForEntity(orgId: string, entityType: string, entityId: string | null, actionType: AutomationActionType, sinceIso: string): Promise<number>
  /**
   * Milestone 15, Phase 5 — is there already a decision for this exact
   * entity+action type sitting in `ai_decisions` with `status:
   * 'awaiting_approval'` right now? Deliberately distinct from
   * `countRecentActionsForEntity` (which counts *any* actions, decided or
   * not, in a rolling window — the runaway-loop safeguard) — this answers
   * "is something already awaiting the owner's decision," so a second
   * proposal for the same campaign+action is returned rather than
   * duplicated.
   */
  findPendingCampaignAction(orgId: string, entityType: string, entityId: string, decisionType: string): Promise<{ id: string } | null>
  /**
   * The RECONCILE step (brief §Non-negotiable principles, "SUBMIT -> VERIFY
   * -> RECONCILE"): applies a verified external change to our own record.
   * Never called speculatively — only after `verifyListingState` (or
   * equivalent) has confirmed the external state actually changed.
   */
  reconcileChannelProduct(input: ChannelProductReconciliation): Promise<void>
  /** The advertising equivalent of `reconcileChannelProduct` (Milestone 15) — same SUBMIT -> VERIFY -> RECONCILE discipline, never called speculatively. */
  reconcileAdvertisingCampaign(input: AdvertisingCampaignReconciliation): Promise<void>
  /**
   * Milestone: execution reliability & unified write path. What
   * `handleProductPause`/`handleProductResume` need to actually call a
   * marketplace connector for one `channel_products` row — `null` when the
   * row cannot be found at all (the action should block, never guess).
   */
  getChannelProductConnectorInfo(orgId: string, channelProductId: string): Promise<{ externalId: string | null; connectorKey: string | null; currentStatus: string } | null>
  /**
   * Milestone 17 — every `automation_actions` row still `status: 'executing'`
   * and created before `olderThanIso`, restricted to `actionTypes` (the
   * domains that actually have a real provider write + verify path;
   * anything else stuck `executing` is a different subsystem's concern).
   */
  findStuckExecutingActions(olderThanIso: string, actionTypes: readonly AutomationActionType[]): Promise<readonly ActionRecord[]>
  /**
   * Records what the reaper (`automation/recovery.ts`) learned about one
   * stuck action, moving it out of `executing` — but only if it is *still*
   * `executing` at the moment of the write (a compare-and-swap on
   * `status`, not a blind update). `applied: false` means another
   * concurrent recovery pass already claimed and resolved this exact row;
   * the caller must not reconcile or audit a row it did not actually just
   * transition, which is what makes running the reaper twice at once safe.
   */
  recordRecoveryOutcome(actionId: string, input: RecoveryOutcomeInput): Promise<{ applied: boolean }>
  /**
   * Milestone 18 — the single-run lock for a cross-organisation system job
   * (Phase 4/5). First reaps any row for `jobKey` still `status: 'running'`
   * whose `started_at` is older than `staleAfterMs` (a crashed process that
   * never completed its run — marked `failed` with an explanatory `error`,
   * never silently deleted), then attempts to insert a fresh `running` row.
   * The database's own partial unique index (`automation_runs_active_system_lock_idx`,
   * migration 0029: `unique(job_key) where org_id is null and status =
   * 'running'`) is what makes `acquired: false` correct across concurrent
   * processes/instances, not merely within one process's memory.
   */
  acquireMaintenanceRun(jobKey: string, staleAfterMs: number): Promise<AcquireMaintenanceRunResult>
  /** Moves a run out of `running` into its real terminal outcome, recording timing and the structured summary Phase 6/9 need. */
  completeMaintenanceRun(runId: string, outcome: CompleteMaintenanceRunInput): Promise<void>
  /** Most recent runs for `jobKey`, newest first — the input to the health/staleness reader (`maintenanceHealth.ts`). */
  getRecentMaintenanceRuns(jobKey: string, limit: number): Promise<readonly MaintenanceRunRecord[]>
  /**
   * Milestone: autonomous decision & capability layer. Applies an
   * already-validated `StageChangePlan` (`products/transitions.ts`) —
   * writes `products.stage`, the append-only `product_stage_transitions`
   * history row, and the paired audit entry. The only caller today is
   * `handleCandidateLifecycleReview`, and only for the one ungated
   * transition (`discovered` -> `researching`) that has no supplier/
   * compliance/profitability gate to satisfy — see that handler's own
   * comment for why nothing further is auto-advanced yet.
   */
  applyProductStageChange(plan: StageChangePlan): Promise<{ succeeded: boolean; error?: string }>
}
