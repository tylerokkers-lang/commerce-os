import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import type { AcquireMaintenanceRunResult, CompleteMaintenanceRunInput, MaintenanceRunRecord, MaintenanceRunStatus } from './store'

/**
 * The `automation_runs`-backed implementation of the single-run lock and
 * run history for cross-organisation system jobs (Milestone 18). See
 * migration 0029's own comment for why `automation_runs` (reserved since
 * migration 0008, never previously written to) is reused here rather than
 * a new table, and why `org_id` is nullable specifically for this class
 * of job.
 */

function mapRunRow(row: Record<string, unknown>): MaintenanceRunRecord {
  return {
    id: row.id as string,
    jobKey: row.job_key as string,
    status: row.status as MaintenanceRunStatus,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    itemsProcessed: row.items_processed as number,
    itemsFailed: row.items_failed as number,
    decisionsCreated: row.decisions_created as number,
    error: (row.error as string | null) ?? null,
    summary: (row.summary as Record<string, unknown>) ?? {},
  }
}

/**
 * Reap-then-acquire, in that order: a stale `running` row is moved to
 * `failed` first (Phase 5 — a maintenance process that itself crashed must
 * not permanently block every future run), then a fresh `running` row is
 * inserted. If a genuinely active (non-stale) run already holds the lock,
 * the insert collides with `automation_runs_active_system_lock_idx` and
 * this returns `acquired: false` with that run's own current detail.
 */
export async function acquireMaintenanceRun(jobKey: string, staleAfterMs: number): Promise<AcquireMaintenanceRunResult> {
  const supabase = createServiceSupabase()
  const staleBeforeIso = new Date(Date.now() - staleAfterMs).toISOString()

  const { data: stale } = await supabase
    .from('automation_runs')
    .select('id')
    .is('org_id', null)
    .eq('job_key', jobKey)
    .eq('status', 'running')
    .lt('started_at', staleBeforeIso)

  for (const row of stale ?? []) {
    await supabase
      .from('automation_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: `Reaped: this run was still "running" past the ${Math.round(staleAfterMs / 60_000)}-minute stale threshold — the process handling it most likely crashed without recording an outcome.`,
      })
      .eq('id', row.id)
      .eq('status', 'running') // Compare-and-swap: never reaps a row a concurrent reap/complete already moved on.
  }

  const startedAt = new Date().toISOString()
  const { data: inserted, error } = await supabase
    .from('automation_runs')
    .insert({ org_id: null, job_key: jobKey, status: 'running', started_at: startedAt })
    .select('id, started_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: active } = await supabase
        .from('automation_runs')
        .select('*')
        .is('org_id', null)
        .eq('job_key', jobKey)
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (active) return { acquired: false, activeRun: mapRunRow(active) }
      // Extremely narrow window: the row that won raced past `completeMaintenanceRun`
      // between our insert failing and this re-read. Safe to retry once — never loop.
      return acquireMaintenanceRun(jobKey, staleAfterMs)
    }
    throw new Error(`Could not acquire maintenance run lock for "${jobKey}": ${error.message}`)
  }

  return { acquired: true, runId: inserted.id, startedAt: inserted.started_at }
}

export async function completeMaintenanceRun(runId: string, outcome: CompleteMaintenanceRunInput): Promise<void> {
  const supabase = createServiceSupabase()
  const { data: existing } = await supabase.from('automation_runs').select('started_at').eq('id', runId).maybeSingle()
  const finishedAt = new Date().toISOString()
  const durationMs = existing ? Date.parse(finishedAt) - Date.parse(existing.started_at) : null

  const { error } = await supabase
    .from('automation_runs')
    .update({
      status: outcome.status,
      finished_at: finishedAt,
      duration_ms: durationMs,
      items_processed: outcome.itemsProcessed,
      items_failed: outcome.itemsFailed,
      decisions_created: outcome.decisionsCreated,
      error: outcome.error,
      summary: outcome.summary as never,
    })
    .eq('id', runId)

  if (error) throw new Error(`Could not complete maintenance run ${runId}: ${error.message}`)
}

export async function getRecentMaintenanceRuns(jobKey: string, limit: number): Promise<readonly MaintenanceRunRecord[]> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase
    .from('automation_runs')
    .select('*')
    .is('org_id', null)
    .eq('job_key', jobKey)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not load maintenance run history for "${jobKey}": ${error.message}`)
  return (data ?? []).map(mapRunRow)
}
