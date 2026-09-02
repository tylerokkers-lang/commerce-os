import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { Tables } from '@/lib/supabase/database.types'
import { computeBackoffSeconds } from './backoff'
import type { EnqueueJobInput, JobOutcome, JobRecord } from './store'

/**
 * The application-level job queue (brief §5), Supabase-backed.
 *
 * This is what makes automation run without Claude Code, ChatGPT or any
 * other coding assistant open: `automation_jobs` is a plain Postgres table,
 * claimed and executed by `/api/automation/run` (see that route), which any
 * external scheduler can call — a hosted cron trigger, a serverless
 * scheduled function, a queue worker, or a manually-configured `curl` on a
 * timer. Nothing about claiming, executing or retrying a job depends on an
 * AI process being present; the route is a normal, stateless HTTP endpoint.
 *
 * Concurrency safety does not use `SELECT ... FOR UPDATE`, because the
 * Supabase/PostgREST client this project uses has no way to issue a raw
 * locking `SELECT`. Instead each claim is a single atomic
 * `UPDATE ... WHERE id = ? AND status = 'pending'`: under Postgres's default
 * READ COMMITTED isolation, if two workers race for the same row, the loser's
 * `WHERE status = 'pending'` re-evaluates against the winner's already-committed
 * change and matches zero rows — the same guarantee `FOR UPDATE SKIP LOCKED`
 * gives, achieved through the row-level atomicity of a single UPDATE
 * statement rather than an explicit lock.
 *
 * Returns the plain `JobRecord` shape from `store.ts` (not the raw Supabase
 * row) so this module is a drop-in `AutomationStore` implementation
 * (assembled in `supabaseStore.ts`) and shares its exact types with
 * `inMemoryStore.ts`, the test double used to verify the engine end-to-end.
 */

const LOCK_TIMEOUT_SECONDS = 300 // A claim older than this is treated as an abandoned worker, not a live one.

export { computeBackoffSeconds } from './backoff'

function toJobRecord(row: Tables<'automation_jobs'>): JobRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    jobType: row.job_type,
    status: row.status,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    runAt: row.run_at,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

/** Enqueues a job. Idempotent: the same `idempotencyKey` returns the existing job rather than duplicating it. */
export async function enqueueJob(input: EnqueueJobInput): Promise<{ id: string; alreadyExisted: boolean }> {
  const supabase = createServiceSupabase()

  if (input.idempotencyKey) {
    const { data: existing } = await supabase
      .from('automation_jobs')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()
    if (existing) return { id: existing.id, alreadyExisted: true }
  }

  const { data, error } = await supabase
    .from('automation_jobs')
    .insert({
      org_id: input.orgId,
      job_type: input.jobType,
      payload: (input.payload ?? {}) as never,
      run_at: input.runAt ?? new Date().toISOString(),
      idempotency_key: input.idempotencyKey ?? null,
      max_attempts: input.maxAttempts ?? 5,
      correlation_id: input.correlationId,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not enqueue job: ${error.message}`)

  await recordAudit({
    orgId: input.orgId,
    action: 'AUTOMATION_JOB_ENQUEUED',
    entityType: 'automation_job',
    entityId: data.id,
    actorType: 'system',
    reason: `Enqueued "${input.jobType}"`,
  })

  return { id: data.id, alreadyExisted: false }
}

/**
 * Claims one due job for `workerId`, or `null` if none is ready. A crashed
 * worker's claim is recovered automatically once `LOCK_TIMEOUT_SECONDS` has
 * passed, rather than stranding the job in `running` forever.
 */
export async function claimNextJob(workerId: string): Promise<JobRecord | null> {
  const supabase = createServiceSupabase()
  const nowIso = new Date().toISOString()
  const lockCutoff = new Date(Date.now() - LOCK_TIMEOUT_SECONDS * 1000).toISOString()

  const { data: candidates } = await supabase
    .from('automation_jobs')
    .select('id, attempts')
    .eq('status', 'pending')
    .lte('run_at', nowIso)
    .order('run_at', { ascending: true })
    .limit(10)

  const abandoned = (
    await supabase
      .from('automation_jobs')
      .select('id, attempts')
      .eq('status', 'running')
      .lt('locked_at', lockCutoff)
      .order('run_at', { ascending: true })
      .limit(10)
  ).data

  // Two separate, narrowly-scoped update attempts rather than one loop with
  // `.in('status', ['pending', 'running'])` (a real bug this project's own
  // Phase 14 live-verification against real Postgres caught — the in-memory
  // test double can't reproduce it, since it doesn't model true concurrent
  // commits): `.in()` alone re-matches a row the instant *any* other worker
  // has already claimed it as 'running', not only a genuinely stale one,
  // because it never re-checks `locked_at` at update time. A pending job
  // must only ever move pending -> running; an abandoned job must only be
  // re-claimed if it is *still* stale at the moment of the update, not just
  // at the moment of the earlier `select` above (a second worker's `select`
  // can race ahead of a first worker's already-committed re-claim).
  for (const candidate of candidates ?? []) {
    const { data: claimed, error } = await supabase
      .from('automation_jobs')
      .update({ status: 'running', locked_at: nowIso, locked_by: workerId, attempts: candidate.attempts + 1 })
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()

    if (!error && claimed) return toJobRecord(claimed)
    // 0 rows updated means another worker won the race for this row; try the next candidate.
  }

  for (const candidate of abandoned ?? []) {
    const { data: claimed, error } = await supabase
      .from('automation_jobs')
      .update({ status: 'running', locked_at: nowIso, locked_by: workerId, attempts: candidate.attempts + 1 })
      .eq('id', candidate.id)
      .eq('status', 'running')
      .lt('locked_at', lockCutoff)
      .select('*')
      .maybeSingle()

    if (!error && claimed) return toJobRecord(claimed)
    // 0 rows updated means another worker already recovered this abandoned job.
  }

  return null
}

/**
 * Cancels a job that has not started running yet — the same atomic
 * `UPDATE ... WHERE status = 'pending'` pattern as claiming, so a job a
 * worker has already picked up cannot be cancelled out from under it.
 */
export async function cancelJob(jobId: string, reason: string): Promise<boolean> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase
    .from('automation_jobs')
    .update({ status: 'cancelled', last_error: reason, completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('org_id, job_type')
    .maybeSingle()

  if (error || !data) return false

  await recordAudit({
    orgId: data.org_id,
    action: 'AUTOMATION_JOB_CANCELLED',
    entityType: 'automation_job',
    entityId: jobId,
    actorType: 'user',
    reason: `Cancelled "${data.job_type}": ${reason}`,
  })
  return true
}

/** Records a job's outcome: success, a scheduled retry, or dead-lettering once attempts are exhausted. */
export async function completeJob(job: JobRecord, outcome: JobOutcome): Promise<void> {
  const supabase = createServiceSupabase()

  if (outcome.succeeded) {
    await supabase
      .from('automation_jobs')
      .update({ status: 'succeeded', completed_at: new Date().toISOString(), last_error: null })
      .eq('id', job.id)
    return
  }

  const retryable = outcome.retryable ?? true
  const exhausted = job.attempts >= job.maxAttempts

  if (!retryable || exhausted) {
    await supabase
      .from('automation_jobs')
      .update({
        status: exhausted ? 'dead_letter' : 'failed',
        last_error: outcome.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    await recordAudit({
      orgId: job.orgId,
      action: exhausted ? 'AUTOMATION_JOB_DEAD_LETTERED' : 'AUTOMATION_ACTION_FAILED',
      entityType: 'automation_job',
      entityId: job.id,
      actorType: 'system',
      reason: exhausted
        ? `"${job.jobType}" exhausted ${job.maxAttempts} attempts.`
        : `"${job.jobType}" failed with a non-retryable error.`,
      result: 'failure',
      error: outcome.error ?? undefined,
    })
    return
  }

  const backoffSeconds = computeBackoffSeconds(job.attempts)
  await supabase
    .from('automation_jobs')
    .update({
      status: 'pending',
      run_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
      last_error: outcome.error ?? null,
      locked_at: null,
      locked_by: null,
    })
    .eq('id', job.id)
}
