import { randomUUID, timingSafeEqual } from 'node:crypto'
import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { runWorkerBatch } from '@/lib/automation/worker'
import { getSupabaseAutomationStore } from '@/lib/automation/supabaseStore'

/** Constant-time comparison so a wrong guess cannot be narrowed down by response timing. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

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
 */
export async function POST(request: Request) {
  if (isSupabaseConfigured()) {
    const expected = automationCronSecret()
    if (!expected) {
      return Response.json({ error: 'AUTOMATION_CRON_SECRET is not configured; refusing to run against a live database.' }, { status: 503 })
    }
    const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!provided || !secretsMatch(provided, expected)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    return Response.json({
      status: 'skipped',
      reason: 'Demo mode has no database and no job queue to process.',
    })
  }

  const result = await runWorkerBatch(getSupabaseAutomationStore(), randomUUID())
  return Response.json({ status: 'ok', checkedAt: new Date().toISOString(), ...result })
}

/** A GET is a convenience for manual/browser checks; the scheduled call should use POST. */
export async function GET(request: Request) {
  return POST(request)
}
