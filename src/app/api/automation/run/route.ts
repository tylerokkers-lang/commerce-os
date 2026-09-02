import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { secretsMatch, extractBearerToken } from '@/lib/core/schedulerAuth'
import { runScheduledJobBatch } from '@/lib/automation/scheduledJobBatch'

/**
 * The scheduled-automation entry point (brief §5, §30).
 *
 * This is a plain, stateless HTTP route with no session, no cookies and no
 * dependency on any AI coding tool being open. Point any external scheduler
 * at it — a Vercel Cron entry, a hosted worker's timer, a serverless
 * scheduled function, or a `curl` line in a crontab — and it claims and
 * executes whatever automation jobs are due, exactly the same way regardless
 * of what called it.
 *
 * Authenticated by a shared secret (`AUTOMATION_CRON_SECRET`), not a user
 * session, because a scheduler is not a logged-in owner. Once Supabase is
 * configured the secret is required — an unconfigured or missing secret
 * refuses every request rather than running unauthenticated against a real
 * database.
 *
 * Phase 15: `/api/automation/maintenance` now also runs this same batch
 * (via `runScheduledJobBatch`, the one shared implementation) as part of
 * its own scheduled cycle, so the job queue is processed even if nothing
 * calls this route directly. This route remains independently callable —
 * for a finer-grained external scheduler, or a manual/on-demand trigger —
 * and is not a second, competing implementation of the same work.
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
    return Response.json({
      status: 'skipped',
      reason: 'Demo mode has no database and no job queue to process.',
    })
  }

  const result = await runScheduledJobBatch(10)
  return Response.json({ status: 'ok', checkedAt: new Date().toISOString(), ...result })
}

/** A GET is a convenience for manual/browser checks; the scheduled call should use POST. */
export async function GET(request: Request) {
  return POST(request)
}
