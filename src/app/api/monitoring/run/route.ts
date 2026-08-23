import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { secretsMatch } from '@/lib/core/schedulerAuth'
import { createServiceSupabase } from '@/lib/supabase/server'
import { runDueMonitors } from '@/lib/monitoring/runner'
import { getSupabaseEventStore } from '@/lib/monitoring/eventStore'
import { getLiveSubjects } from '@/lib/monitoring/liveSubjects'
import { getSupabaseAutomationStore } from '@/lib/automation/supabaseStore'
import { getSupabaseFactsLoader } from '@/lib/automation/facts'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { getMarketplaceConnector } from '@/lib/marketplaces/connectors/registry'

/**
 * The scheduled-monitoring entry point (Milestone 8), the same shape and
 * the same authentication as `/api/automation/run` (Milestone 6) —
 * deliberately reusing `AUTOMATION_CRON_SECRET` rather than a second
 * secret, since both exist for the identical reason: letting an external
 * scheduler drive this application without Claude Code, ChatGPT, or any
 * coding assistant staying open.
 *
 * Iterates every organisation (this is a single-worker-pool, multi-tenant
 * design, the same as `automation_jobs`' unscoped claim query) and runs
 * whichever registered monitors are due for each, per that org's own
 * configured schedule (`config_values`).
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
    return Response.json({ status: 'skipped', reason: 'Demo mode has no database and no monitors to run.' })
  }

  const supabase = createServiceSupabase()
  const { data: orgs, error } = await supabase.from('organisations').select('id')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const store = getSupabaseAutomationStore()
  const events = getSupabaseEventStore()
  const facts = getSupabaseFactsLoader()

  const results = []
  for (const org of orgs ?? []) {
    const settings = await getAutomationSettingsForOrg(org.id)
    const summaries = await runDueMonitors({
      orgId: org.id, store, events, facts, connectors: getMarketplaceConnector, settings, subjectsFor: getLiveSubjects,
    })
    results.push({ orgId: org.id, monitors: summaries })
  }

  return Response.json({ status: 'ok', checkedAt: new Date().toISOString(), organisations: results })
}

/** A GET is a convenience for manual/browser checks; the scheduled call should use POST. */
export async function GET(request: Request) {
  return POST(request)
}
