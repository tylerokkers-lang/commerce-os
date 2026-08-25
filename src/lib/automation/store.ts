import type { Enums } from '@/lib/supabase/database.types'
import type { AutomationActionType, AutomationJobStatus, AutomationActionStatus, AutomationLevel, PolicyResult } from './types'
import type { AutomationSettings } from './settingsTypes'
import type { ChannelKey } from '@/lib/core/domain'

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
   * The RECONCILE step (brief §Non-negotiable principles, "SUBMIT -> VERIFY
   * -> RECONCILE"): applies a verified external change to our own record.
   * Never called speculatively — only after `verifyListingState` (or
   * equivalent) has confirmed the external state actually changed.
   */
  reconcileChannelProduct(input: ChannelProductReconciliation): Promise<void>
  /** The advertising equivalent of `reconcileChannelProduct` (Milestone 15) — same SUBMIT -> VERIFY -> RECONCILE discipline, never called speculatively. */
  reconcileAdvertisingCampaign(input: AdvertisingCampaignReconciliation): Promise<void>
}
