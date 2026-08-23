import { randomUUID } from 'node:crypto'
import { computeBackoffSeconds } from './backoff'
import { DEMO_AUTOMATION_SETTINGS } from './settingsTypes'
import {
  RUNAWAY_MAX_ACTIONS_PER_WINDOW,
  RUNAWAY_WINDOW_MINUTES,
  type ActionRecord,
  type AuditEntryInput,
  type AutomationStore,
  type ChannelProductReconciliation,
  type CompleteActionOutcome,
  type CreateActionInput,
  type EnqueueJobInput,
  type JobOutcome,
  type JobRecord,
  type NotifyInput,
  type ProposeApprovalInput,
} from './store'
import type { AutomationActionType } from './types'
import type { AutomationSettings } from './settingsTypes'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * A fully-behaved in-memory `AutomationStore`, used only by
 * `tests/automation-engine-e2e.test.ts` to drive the real orchestration
 * code (`worker.ts`'s `runWorkerBatch`, the real business decision modules)
 * without a live Supabase project.
 *
 * This is not a mock that returns canned responses — it is a real, if
 * simplified, implementation of the same semantics the Postgres-backed
 * store provides: idempotency-key uniqueness, atomic job claiming (proven
 * below using genuine async interleaving, not a lock), retry/backoff/
 * dead-letter transitions, and the runaway-automation safeguard. What it
 * cannot prove is the live Supabase/PostgREST HTTP path itself, which needs
 * a deployed project — documented as a production-infrastructure
 * requirement in `HANDOVER.md`.
 */
export function createInMemoryAutomationStore(options?: { lockTimeoutMs?: number; settingsByOrg?: Record<string, AutomationSettings> }) {
  const lockTimeoutMs = options?.lockTimeoutMs ?? 300_000
  const jobs = new Map<string, JobRecord>()
  const jobsByIdempotencyKey = new Map<string, string>()
  const actions: ActionRecord[] = []
  const actionsByIdempotencyKey = new Map<string, string>()
  const auditLog: (AuditEntryInput & { occurredAt: string })[] = []
  const notifications: (NotifyInput & { id: string; createdAt: string })[] = []
  const notificationDedupeKeys = new Set<string>()
  const settingsByOrg = new Map<string, AutomationSettings>(Object.entries(options?.settingsByOrg ?? {}))
  const approvals: (ProposeApprovalInput & { id: string; status: 'awaiting_approval' | 'approved' | 'rejected'; createdAt: string })[] = []
  const channelProductReconciliations = new Map<string, Partial<ChannelProductReconciliation>>()

  function isAbandoned(job: JobRecord, nowMs: number): boolean {
    return job.status === 'running' && job.lockedAt !== null && nowMs - Date.parse(job.lockedAt) > lockTimeoutMs
  }

  const store: AutomationStore & {
    getState: () => {
      jobs: JobRecord[]
      actions: ActionRecord[]
      auditLog: readonly (AuditEntryInput & { occurredAt: string })[]
      notifications: readonly (NotifyInput & { id: string; createdAt: string })[]
      approvals: readonly (ProposeApprovalInput & { id: string; status: 'awaiting_approval' | 'approved' | 'rejected'; createdAt: string })[]
      channelProductReconciliations: Record<string, Partial<ChannelProductReconciliation>>
    }
    setAutomationSettings: (orgId: string, settings: AutomationSettings) => void
  } = {
    async enqueueJob(input: EnqueueJobInput) {
      const orgKey = `${input.orgId}:${input.idempotencyKey}`
      if (input.idempotencyKey && jobsByIdempotencyKey.has(orgKey)) {
        return { id: jobsByIdempotencyKey.get(orgKey)!, alreadyExisted: true }
      }

      const id = randomUUID()
      const nowIso = new Date().toISOString()
      const job: JobRecord = {
        id,
        orgId: input.orgId,
        jobType: input.jobType,
        status: 'pending',
        payload: input.payload ?? {},
        runAt: input.runAt ?? nowIso,
        idempotencyKey: input.idempotencyKey ?? null,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        correlationId: input.correlationId ?? randomUUID(),
        createdAt: nowIso,
        updatedAt: nowIso,
        completedAt: null,
      }
      jobs.set(id, job)
      if (input.idempotencyKey) jobsByIdempotencyKey.set(orgKey, id)

      auditLog.push({ orgId: input.orgId, action: 'AUTOMATION_JOB_ENQUEUED', entityType: 'automation_job', entityId: id, actorType: 'system', reason: `Enqueued "${input.jobType}"`, occurredAt: nowIso })

      return { id, alreadyExisted: false }
    },

    async claimNextJob(workerId: string): Promise<JobRecord | null> {
      const nowMs = Date.now()
      // Two separate awaits, matching the read-then-write round trip a real
      // network call makes — exactly where a race between concurrent
      // workers becomes possible. The actual claim check below re-reads
      // current state rather than trusting this snapshot, which is what
      // makes the race safe.
      await Promise.resolve()
      const candidateIds = Array.from(jobs.values())
        .filter((j) => (j.status === 'pending' && Date.parse(j.runAt) <= nowMs) || isAbandoned(j, nowMs))
        .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt))
        .map((j) => j.id)
      await Promise.resolve()

      for (const id of candidateIds) {
        const current = jobs.get(id)
        if (!current) continue
        const stillClaimable = current.status === 'pending' || isAbandoned(current, Date.now())
        if (!stillClaimable) continue // Another concurrent claim already won this job.

        const nowIso = new Date().toISOString()
        const claimed: JobRecord = { ...current, status: 'running', lockedAt: nowIso, lockedBy: workerId, attempts: current.attempts + 1, updatedAt: nowIso }
        jobs.set(id, claimed)
        return claimed
      }
      return null
    },

    async completeJob(job: JobRecord, outcome: JobOutcome): Promise<void> {
      const current = jobs.get(job.id) ?? job
      const nowIso = new Date().toISOString()

      if (outcome.succeeded) {
        jobs.set(job.id, { ...current, status: 'succeeded', completedAt: nowIso, lastError: null })
        return
      }

      const retryable = outcome.retryable ?? true
      const exhausted = current.attempts >= current.maxAttempts

      if (!retryable || exhausted) {
        jobs.set(job.id, { ...current, status: exhausted ? 'dead_letter' : 'failed', lastError: outcome.error ?? null, completedAt: nowIso })
        auditLog.push({
          orgId: job.orgId,
          action: exhausted ? 'AUTOMATION_JOB_DEAD_LETTERED' : 'AUTOMATION_ACTION_FAILED',
          entityType: 'automation_job',
          entityId: job.id,
          actorType: 'system',
          reason: exhausted ? `"${job.jobType}" exhausted ${job.maxAttempts} attempts.` : `"${job.jobType}" failed with a non-retryable error.`,
          result: 'failure',
          error: outcome.error ?? undefined,
          occurredAt: nowIso,
        })
        return
      }

      const backoffSeconds = computeBackoffSeconds(current.attempts)
      jobs.set(job.id, {
        ...current,
        status: 'pending',
        runAt: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
        lastError: outcome.error ?? null,
        lockedAt: null,
        lockedBy: null,
        updatedAt: nowIso,
      })
    },

    async cancelJob(jobId: string, reason: string): Promise<boolean> {
      const current = jobs.get(jobId)
      if (!current || current.status !== 'pending') return false // Same guard as the real store: a claimed job cannot be cancelled out from under a worker.

      const nowIso = new Date().toISOString()
      jobs.set(jobId, { ...current, status: 'cancelled', lastError: reason, completedAt: nowIso, updatedAt: nowIso })
      auditLog.push({ orgId: current.orgId, action: 'AUTOMATION_JOB_CANCELLED', entityType: 'automation_job', entityId: jobId, actorType: 'user', reason: `Cancelled "${current.jobType}": ${reason}`, occurredAt: nowIso })
      return true
    },

    async proposeApproval(input: ProposeApprovalInput): Promise<{ id: string }> {
      const id = randomUUID()
      const nowIso = new Date().toISOString()
      approvals.push({ ...input, id, status: 'awaiting_approval', createdAt: nowIso })
      auditLog.push({ orgId: input.orgId, action: 'APPROVAL_REQUESTED', entityType: input.entityType, entityId: input.entityId ?? undefined, actorType: 'system', reason: input.reasoning, occurredAt: nowIso })
      return { id }
    },

    async createAutomationAction(input: CreateActionInput) {
      const orgKey = `${input.orgId}:${input.idempotencyKey}`
      if (input.idempotencyKey && actionsByIdempotencyKey.has(orgKey)) {
        const existingId = actionsByIdempotencyKey.get(orgKey)!
        const existing = actions.find((a) => a.id === existingId)!
        return { id: existing.id, status: existing.status, alreadyExisted: true }
      }

      const windowStart = new Date(Date.now() - RUNAWAY_WINDOW_MINUTES * 60_000).toISOString()
      const recentCount = await store.countRecentActionsForEntity(input.orgId, input.entityType, input.entityId ?? null, input.actionType, windowStart)
      const runawayTripped = recentCount >= RUNAWAY_MAX_ACTIONS_PER_WINDOW

      const statusByOutcome: Record<'allow_automatic' | 'require_approval' | 'block', Enums<'automation_action_status'>> = {
        allow_automatic: 'executing',
        require_approval: 'requires_approval',
        block: 'blocked',
      }
      const status = runawayTripped ? 'blocked' : statusByOutcome[input.policy.outcome]
      const reason = runawayTripped
        ? `Blocked by the runaway-automation safeguard: ${recentCount} "${input.actionType}" actions already recorded for ${input.entityType} ${input.entityId ?? '(none)'} in the last ${RUNAWAY_WINDOW_MINUTES} minutes (limit ${RUNAWAY_MAX_ACTIONS_PER_WINDOW}). ${input.reason}`
        : input.reason

      const id = randomUUID()
      const nowIso = new Date().toISOString()
      const record: ActionRecord = {
        id,
        orgId: input.orgId,
        correlationId: input.correlationId ?? randomUUID(),
        idempotencyKey: input.idempotencyKey ?? null,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        reason,
        inputFacts: input.inputFacts,
        decision: input.decision,
        policyResult: input.policy,
        automationLevel: input.automationLevel,
        riskLevel: input.policy.riskLevel,
        status,
        error: null,
        actorType: input.actorType ?? 'system',
        aiDecisionId: input.aiDecisionId ?? null,
        jobId: input.jobId ?? null,
        createdAt: nowIso,
        completedAt: status === 'executing' ? null : nowIso,
        externalRef: null,
        verificationStatus: 'not_applicable',
        reconciliationStatus: 'not_applicable',
      }
      actions.push(record)
      if (input.idempotencyKey) actionsByIdempotencyKey.set(orgKey, id)

      auditLog.push({
        orgId: input.orgId,
        action: status === 'blocked' ? 'AUTOMATION_ACTION_BLOCKED' : status === 'requires_approval' ? 'APPROVAL_REQUESTED' : 'AUTOMATION_ACTION_CREATED',
        entityType: input.entityType,
        entityId: input.entityId ?? undefined,
        actorType: input.actorType ?? 'system',
        reason,
        ruleKey: input.actionType,
        aiDecisionId: input.aiDecisionId ?? undefined,
        metadata: { automationActionId: id, policyOutcome: input.policy.outcome, runawayTripped, correlationId: record.correlationId },
        occurredAt: nowIso,
      })

      return { id, status, alreadyExisted: false }
    },

    async completeAutomationAction(actionId: string, outcome: CompleteActionOutcome): Promise<void> {
      const index = actions.findIndex((a) => a.id === actionId)
      if (index === -1) throw new Error(`Unknown automation action ${actionId}`)
      const nowIso = new Date().toISOString()
      const status: Enums<'automation_action_status'> = outcome.succeeded ? 'succeeded' : 'failed'
      actions[index] = {
        ...actions[index],
        status,
        error: outcome.error ?? null,
        completedAt: nowIso,
        externalRef: outcome.externalRef ?? actions[index].externalRef,
        verificationStatus: outcome.verificationStatus ?? actions[index].verificationStatus,
        reconciliationStatus: outcome.reconciliationStatus ?? actions[index].reconciliationStatus,
      }

      auditLog.push({
        orgId: outcome.orgId,
        action: outcome.succeeded ? 'AUTOMATION_ACTION_EXECUTED' : 'AUTOMATION_ACTION_FAILED',
        entityType: outcome.entityType,
        entityId: outcome.entityId ?? undefined,
        actorType: 'system',
        reason: outcome.succeeded ? 'Automation action executed successfully.' : (outcome.error ?? 'Automation action failed.'),
        result: outcome.succeeded ? 'success' : 'failure',
        error: outcome.error ?? undefined,
        metadata: { automationActionId: actionId },
        occurredAt: nowIso,
      })
    },

    async countRecentActionsForEntity(orgId: string, entityType: string, entityId: string | null, actionType: AutomationActionType, sinceIso: string): Promise<number> {
      const sinceMs = Date.parse(sinceIso)
      return actions.filter(
        (a) => a.orgId === orgId && a.entityType === entityType && a.entityId === entityId && a.actionType === actionType && Date.parse(a.createdAt) >= sinceMs,
      ).length
    },

    async recordAudit(entry: AuditEntryInput): Promise<void> {
      auditLog.push({ ...entry, occurredAt: new Date().toISOString() })
    },

    async notify(entry: NotifyInput): Promise<void> {
      if (entry.dedupeKey) {
        const key = `${entry.orgId}:${entry.dedupeKey}`
        if (notificationDedupeKeys.has(key)) return // Same guarantee as the real store's unique(org_id, dedupe_key).
        notificationDedupeKeys.add(key)
      }
      notifications.push({ ...entry, id: randomUUID(), createdAt: new Date().toISOString() })
    },

    async getAutomationSettings(orgId: string): Promise<AutomationSettings> {
      return settingsByOrg.get(orgId) ?? DEMO_AUTOMATION_SETTINGS
    },

    async reconcileChannelProduct(input: ChannelProductReconciliation): Promise<void> {
      const current = channelProductReconciliations.get(input.channelProductId) ?? {}
      const merged = { ...current, ...input }
      channelProductReconciliations.set(input.channelProductId, merged)
      auditLog.push({
        orgId: input.orgId,
        action: 'CHANNEL_PRODUCT_RECONCILED',
        entityType: 'channel_product',
        entityId: input.channelProductId,
        actorType: 'system',
        reason: "Reconciled local record with the marketplace's verified state after an automated write.",
        occurredAt: new Date().toISOString(),
      })
    },

    setAutomationSettings(orgId: string, settings: AutomationSettings) {
      settingsByOrg.set(orgId, settings)
    },

    getState() {
      return {
        jobs: Array.from(jobs.values()),
        actions: [...actions],
        auditLog: [...auditLog],
        notifications: [...notifications],
        approvals: [...approvals],
        channelProductReconciliations: Object.fromEntries(channelProductReconciliations),
      }
    },
  }

  return store
}
