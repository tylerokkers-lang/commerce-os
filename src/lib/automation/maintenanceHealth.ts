import type { MaintenanceRunRecord } from './store'

/**
 * Pure health/staleness/outcome logic for the maintenance orchestrator
 * (Milestone 18) — split out of `maintenance.ts` (which touches the
 * store and `server-only` audit code) the same way `executionRecovery.ts`
 * and `advertising/monitorPlan.ts` are, so the actual decisions here are
 * directly unit-testable without a database.
 */

export const MAINTENANCE_JOB_KEY = 'automation_maintenance'

/**
 * How long a `running` row may sit before it is treated as a crashed
 * process rather than a genuinely in-flight run (Phase 5). A real
 * maintenance run is a handful of DB reads plus a small number of
 * read-only provider verify calls per stuck action/campaign — it should
 * finish in well under a minute even on a bad day. 15 minutes is
 * deliberately generous headroom above that, not a guess: large enough
 * that a slow provider or a temporarily large backlog is never mistaken
 * for a crash, small enough that a genuinely crashed process cannot block
 * every future run for more than a quarter of an hour.
 */
export const MAINTENANCE_LOCK_STALE_AFTER_MS = 15 * 60_000

/**
 * The interval `vercel.json`'s actual cron entry fires
 * `/api/automation/maintenance` at. Originally every 15 minutes, corrected
 * to once daily (production deployment & scheduler activation milestone):
 * the real, connected Vercel account is on the Hobby plan, which rejects
 * any cron schedule firing more than once per day outright — confirmed
 * directly by a real failed deployment
 * ("Hobby accounts are limited to daily cron jobs"), not assumed. Moving to
 * the Pro plan (a billing decision, not made here) would allow reverting to
 * a shorter interval; until then, this constant must match `vercel.json`'s
 * real schedule exactly, since the staleness window below is derived from
 * it, not picked independently.
 */
export const MAINTENANCE_EXPECTED_INTERVAL_MS = 24 * 60 * 60_000

/**
 * Phase 10 — "no successful run within an acceptable window." Three times
 * the expected interval: generous enough that one or two missed/delayed
 * ticks (a brief scheduler hiccup, a slow run pushing the next one back)
 * never falsely reports `AUTOMATION_STALE`, while still catching "the
 * scheduler has genuinely stopped calling this at all" within an hour.
 * Purely an operational read — staleness never itself blocks, retries, or
 * triggers anything; it only changes what `/automation` displays.
 */
export const MAINTENANCE_STALE_AFTER_MS = MAINTENANCE_EXPECTED_INTERVAL_MS * 3

export type MaintenanceHealthState = 'NEVER_RUN' | 'RUNNING' | 'FAILED' | 'AUTOMATION_STALE' | 'PARTIAL_SUCCESS' | 'HEALTHY'

export interface MaintenanceHealth {
  state: MaintenanceHealthState
  lastSuccessfulRun: MaintenanceRunRecord | null
  /** The most recent run that was not itself a stale, already-reaped-looking ghost — null only when `runs` is empty. */
  lastAttemptedRun: MaintenanceRunRecord | null
  /** Present only when `state === 'RUNNING'`. */
  currentRun: MaintenanceRunRecord | null
  runningDurationMs: number | null
  /** Recent non-successful runs, most recent first — for the "recent failures" surface Phase 9 asks for. */
  recentFailures: readonly MaintenanceRunRecord[]
}

function isStaleRunning(run: MaintenanceRunRecord, nowMs: number): boolean {
  return run.status === 'running' && nowMs - Date.parse(run.startedAt) > MAINTENANCE_LOCK_STALE_AFTER_MS
}

/**
 * `runs` must already be sorted newest-first (`getRecentMaintenanceRuns`'s
 * own contract) — this function never re-sorts, so a caller passing an
 * unsorted list gets an honestly wrong answer rather than a silently
 * "corrected" one.
 */
export function classifyMaintenanceHealth(runs: readonly MaintenanceRunRecord[], nowIso: string, staleAfterMs = MAINTENANCE_STALE_AFTER_MS): MaintenanceHealth {
  const nowMs = Date.parse(nowIso)
  const recentFailures = runs.filter((r) => r.status === 'failed' || r.status === 'partial_success')

  if (runs.length === 0) {
    return { state: 'NEVER_RUN', lastSuccessfulRun: null, lastAttemptedRun: null, currentRun: null, runningDurationMs: null, recentFailures: [] }
  }

  const latest = runs[0]
  if (isStaleRunning(latest, nowMs)) {
    // A stale "running" ghost is not evidence of anything happening right
    // now — evaluate health from the most recent *real* attempt instead,
    // the same way `acquireMaintenanceRun` itself would reap this row
    // before ever reading it as "the current state."
    return classifyMaintenanceHealth(runs.slice(1), nowIso, staleAfterMs)
  }

  if (latest.status === 'running') {
    return {
      state: 'RUNNING',
      lastSuccessfulRun: runs.find((r) => r.status === 'success' || r.status === 'partial_success') ?? null,
      lastAttemptedRun: latest,
      currentRun: latest,
      runningDurationMs: nowMs - Date.parse(latest.startedAt),
      recentFailures,
    }
  }

  const lastSuccessfulRun = runs.find((r) => r.status === 'success' || r.status === 'partial_success') ?? null
  const base = { lastSuccessfulRun, lastAttemptedRun: latest, currentRun: null, runningDurationMs: null, recentFailures }

  if (latest.status === 'failed') {
    return { ...base, state: 'FAILED' }
  }

  const staleByRecency = !lastSuccessfulRun || nowMs - Date.parse(lastSuccessfulRun.startedAt) > staleAfterMs
  if (staleByRecency) {
    return { ...base, state: 'AUTOMATION_STALE' }
  }

  if (latest.status === 'partial_success') {
    return { ...base, state: 'PARTIAL_SUCCESS' }
  }

  return { ...base, state: 'HEALTHY' }
}

export type MaintenanceOutcomeStatus = 'success' | 'partial_success' | 'failed'

/** One subsystem's outcome (`runExecutionRecovery`, `runAdvertisingSyncForConnectedOrgs`, `runCampaignReviewForConnectedOrgs`, or any future one) — `threw` means the whole subsystem call itself threw, rather than returning its own per-item error list. */
export interface MaintenanceSubsystemOutcome {
  threw: boolean
  errorCount: number
}

/**
 * Phase 7 — one organisation or provider failing must never fail the
 * whole run. Every subsystem already catches per-item/per-org errors
 * internally and keeps going, surfacing them as its own `errors` array
 * rather than throwing — so a nonzero `errorCount` here already
 * represents "some, not all, work failed." Only *every* subsystem's call
 * itself throwing entirely (every one totally unreachable — not "one bad
 * campaign") counts toward `failed`; any single subsystem throwing while
 * at least one other still ran is `partial_success`, never a catastrophic
 * failure of the whole run.
 */
export function classifyMaintenanceOutcome(subsystems: readonly MaintenanceSubsystemOutcome[]): MaintenanceOutcomeStatus {
  const threwCount = subsystems.filter((s) => s.threw).length
  if (subsystems.length > 0 && threwCount === subsystems.length) return 'failed'
  if (threwCount > 0) return 'partial_success'
  if (subsystems.some((s) => s.errorCount > 0)) return 'partial_success'
  return 'success'
}
