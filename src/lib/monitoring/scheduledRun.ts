import 'server-only'

import { runDueMonitors, type MonitorRunSummary } from './runner'
import { getSupabaseEventStore } from './eventStore'
import { getLiveSubjects } from './liveSubjects'
import { getSupabaseAutomationStore } from '@/lib/automation/supabaseStore'
import { getSupabaseFactsLoader } from '@/lib/automation/facts'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { getMarketplaceConnector } from '@/lib/marketplaces/connectors/registry'
import { getSupabaseFxStore } from '@/lib/fx/fxStore'
import { getSupabaseSupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFactsStore'
import { createServiceSupabase } from '@/lib/supabase/server'

export interface OrgMonitoringResult {
  orgId: string
  monitors: readonly MonitorRunSummary[]
}

/**
 * The one, self-contained "run every due monitor for every organisation"
 * implementation (Phase 15) — kept out of `runner.ts` deliberately, since
 * `runner.ts`'s own `runDueMonitors` is dependency-injected and pure
 * specifically so `tests/monitoring-scheduler.test.ts` and friends can
 * import it without pulling in `'server-only'`/a real Supabase client.
 * This wrapper is what `/api/monitoring/run` and `runMaintenance`
 * (`automation/maintenance.ts`, Phase 15) both call, rather than each
 * assembling the same organisation loop and dependency wiring
 * independently.
 */
export async function runMonitoringForAllOrgs(): Promise<readonly OrgMonitoringResult[]> {
  const supabase = createServiceSupabase()
  const { data: orgs, error } = await supabase.from('organisations').select('id')
  if (error) throw new Error(`Could not list organisations for monitoring: ${error.message}`)

  const store = getSupabaseAutomationStore()
  const events = getSupabaseEventStore()
  const facts = getSupabaseFactsLoader()
  const fxStore = getSupabaseFxStore()
  const supplierMarketFacts = getSupabaseSupplierMarketFactsLoader()

  const results: OrgMonitoringResult[] = []
  for (const org of orgs ?? []) {
    const settings = await getAutomationSettingsForOrg(org.id)
    const summaries = await runDueMonitors({
      orgId: org.id, store, events, facts, connectors: getMarketplaceConnector, settings, subjectsFor: getLiveSubjects,
      fxStore, supplierMarketFacts,
    })
    results.push({ orgId: org.id, monitors: summaries })
  }
  return results
}
