import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { secretsMatch, extractBearerToken } from '@/lib/core/schedulerAuth'
import { runMonitoringForAllOrgs } from '@/lib/monitoring/scheduledRun'

/**
 * The scheduled-monitoring entry point (Milestone 8), the same shape and
 * the same authentication as `/api/automation/run` (Milestone 6) —
 * deliberately reusing `AUTOMATION_CRON_SECRET` rather than a second
 * secret, since both exist for the identical reason: letting an external
 * scheduler drive this application without Claude Code, ChatGPT, or any
 * coding assistant staying open.
 *
 * Iterates every organisation and runs whichever registered monitors are
 * due for each, per that org's own configured schedule (`config_values`) —
 * via `runMonitoringForAllOrgs` (Phase 15), the one shared implementation
 * `/api/automation/maintenance` also calls as part of its own scheduled
 * cycle. This route remains independently callable; it is not a second,
 * competing implementation of the same work.
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
    return Response.json({ status: 'skipped', reason: 'Demo mode has no database and no monitors to run.' })
  }

  const organisations = await runMonitoringForAllOrgs()
  return Response.json({ status: 'ok', checkedAt: new Date().toISOString(), organisations })
}

/** A GET is a convenience for manual/browser checks; the scheduled call should use POST. */
export async function GET(request: Request) {
  return POST(request)
}
