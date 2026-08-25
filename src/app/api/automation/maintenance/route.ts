import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { secretsMatch } from '@/lib/core/schedulerAuth'
import { runExecutionRecovery } from '@/lib/automation/recovery'
import { getSupabaseAutomationStore } from '@/lib/automation/supabaseStore'
import { runCampaignReviewForConnectedOrgs } from '@/lib/advertising/monitor'

/**
 * Milestone 17, Phases 12/13 — the one manual/scheduled entry point for
 * "run maintenance now": execution recovery (Phases 1-4) followed by the
 * advertising monitor (Phase 5+, `advertising/monitor.ts`, already built
 * in Milestone 16). Deliberately reuses the exact `AUTOMATION_CRON_SECRET`
 * bearer-token pattern `/api/automation/run` and `/api/monitoring/run`
 * already use, rather than inventing a separate "platform admin" user
 * role — this codebase has no cross-organisation user role at all (every
 * session role is scoped to one org), and a shared secret authenticating
 * a scheduler or an operator running a manual `curl` is the existing,
 * correct mechanism for a cross-org maintenance job, not a gap to fill.
 *
 * Recovery always runs first and unconditionally: a stuck `executing`
 * action should never be left blocking a re-run of the monitor for that
 * same org's campaigns (the runaway-automation safeguard in
 * `createAutomationAction` counts actions of any status, `executing`
 * included), and recovery itself never touches a connector's write
 * methods, so there is no ordering risk in running it before the monitor.
 *
 * Never executes a live provider action. `runExecutionRecovery` only ever
 * reads a provider's current state (`verifyWrites`); `runCampaignReviewForConnectedOrgs`
 * never imports a connector's write methods at all — see that module's
 * own comment.
 *
 * No separate "run started/finished" audit entry is written at this
 * route level: `audit_logs.org_id` is `not null references organisations`,
 * and a cross-org maintenance run has no single owning organisation to
 * attribute one to. Every real event this run causes is already audited
 * against its real org by the functions that cause it — `runExecutionRecovery`
 * audits `EXECUTION_RECOVERY_ATTEMPTED`/`EXECUTION_RESULT_UNKNOWN` per
 * stuck action, and `runCampaignReviewForConnectedOrgs` audits every
 * proposal/block through the same `createAutomationAction`/`proposeApproval`
 * paths a chat-originated action does. This route's JSON response is the
 * structured, loggable summary Phase 13 asks for.
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
    return Response.json({ status: 'skipped', reason: 'Demo mode has no database and nothing to recover or monitor.' })
  }

  const startedAt = new Date().toISOString()
  const store = getSupabaseAutomationStore()

  const recovery = await runExecutionRecovery(store)
  const monitoring = await runCampaignReviewForConnectedOrgs()

  return Response.json({ status: 'ok', startedAt, finishedAt: new Date().toISOString(), recovery, monitoring })
}

/** A GET is a convenience for manual/browser checks; the scheduled call should use POST. */
export async function GET(request: Request) {
  return POST(request)
}
