import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { secretsMatch, extractBearerToken } from '@/lib/core/schedulerAuth'
import { runMaintenance } from '@/lib/automation/maintenance'
import { classifySchedulerProvenance } from '@/lib/automation/maintenanceHealth'
import { getSupabaseAutomationStore } from '@/lib/automation/supabaseStore'

/**
 * Milestone 18 — the single, canonical maintenance entry point (Phase 2):
 * execution recovery followed by the advertising monitor, coordinated
 * through `runMaintenance` (`automation/maintenance.ts`), which is also
 * exactly what a manual trigger calls (Phase 12) — never a second
 * implementation of the same orchestration, never a second route.
 *
 * Authenticated with the same `AUTOMATION_CRON_SECRET` bearer-token
 * pattern `/api/automation/run`/`/api/monitoring/run` already use — this
 * codebase has no cross-organisation user role (every session role is
 * scoped to one org), so a shared secret is the existing, correct
 * mechanism for a cross-org maintenance job, not a gap to fill.
 *
 * Scheduler vs. manual is a *label* only, carried by `?trigger=manual` on
 * an otherwise identical, identically-authenticated request — both reach
 * `runMaintenance` and are subject to the exact same single-run lock and
 * safety rules; there is no separate "admin" credential this codebase has
 * to distinguish them by, and inventing one would be a bigger change than
 * this milestone's actual need justifies. Omitting the parameter (what any
 * real scheduler will do) defaults to `'scheduler'`.
 *
 * Never executes a live provider action — see `maintenance.ts`'s own
 * module comment for the full safety chain and for why orchestration-level
 * events are recorded in `automation_runs` rather than `audit_logs`.
 */
export async function POST(request: Request) {
  if (isSupabaseConfigured()) {
    const expected = automationCronSecret()
    if (!expected) {
      return Response.json({ error: 'AUTOMATION_CRON_SECRET is not configured; refusing to run against a live database.' }, { status: 503 })
    }
    const provided = extractBearerToken(request.headers.get('authorization'))
    if (!provided || !secretsMatch(provided, expected)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    return Response.json({ status: 'skipped', reason: 'Demo mode has no database and nothing to recover or monitor.' })
  }

  const url = new URL(request.url)
  const triggeredBy = url.searchParams.get('trigger') === 'manual' ? 'manual' : 'scheduler'
  // Independent of `triggeredBy` above, which is only ever what the caller
  // claims via the query string — see `classifySchedulerProvenance`'s own
  // comment for why a second, header-derived signal exists at all.
  const schedulerProvenance = classifySchedulerProvenance(request.headers.get('user-agent'), triggeredBy)

  const store = getSupabaseAutomationStore()
  const result = await runMaintenance(store, triggeredBy, schedulerProvenance)

  if (result.outcome === 'already_running') {
    return Response.json({ status: 'already_running', triggeredBy, activeRun: result.activeRun }, { status: 409 })
  }

  return Response.json({ status: result.outcome, triggeredBy, ...result })
}

/** A GET is a convenience for manual/browser checks; the scheduled call should use POST. */
export async function GET(request: Request) {
  return POST(request)
}
