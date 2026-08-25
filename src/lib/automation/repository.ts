import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import { requireSession, type SessionContext } from '@/lib/security/session'
import { getAutomationSettings, type AutomationSettings } from './settings'
import { demoAutomationScenarios, type AnyDemoScenario } from '@/lib/demo/automation'
import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { listMarketplaceConnectors, marketplaceConnectorSummary } from '@/lib/marketplaces/connectors/registry'
import type { MarketplaceConnectorSummary } from '@/lib/marketplaces/connectors/types'
import type { Tables } from '@/lib/supabase/database.types'
import { getRecentMaintenanceRuns } from './maintenanceRuns'
import { classifyMaintenanceHealth, MAINTENANCE_JOB_KEY, type MaintenanceHealth } from './maintenanceHealth'

export type AutomationAction = Tables<'automation_actions'>
export type AutomationJob = Tables<'automation_jobs'>

export interface AutomationStatus {
  isDemo: boolean
  settings: AutomationSettings
  today: {
    actionsTotal: number
    succeeded: number
    failed: number
    blocked: number
    approvalsRequested: number
    approvalsCompleted: number
    productsPaused: number
    suppliersSwitched: number
    spentAutomaticallyMinor: number
    refundsProcessedMinor: number
  }
  risk: {
    failedActions: number
    blockedActions: number
    deadLetterJobs: number
  }
  recentActions: readonly AutomationAction[]
  pendingJobs: readonly AutomationJob[]
  demoScenarios: readonly AnyDemoScenario[]
  productionReadiness: ProductionReadiness
  /**
   * Milestone 17 — actions the execution reaper (`automation/recovery.ts`)
   * either could not classify (`status: 'retry_pending'`, genuinely
   * unknown provider result — see that module's own comment) or has not
   * reached yet (`status: 'executing'`, still within the recovery
   * threshold, or a genuinely still-in-flight request). Never presented as
   * a fake "successful" state — this section exists precisely so it is
   * never silently invisible.
   */
  recoveryRequired: readonly AutomationAction[]
  /** Milestone 18 — real operational status of the maintenance orchestrator itself, never fabricated. See `maintenanceHealth.ts`'s own comment for the state model. */
  maintenanceHealth: MaintenanceHealth
}

/**
 * The honest production-readiness view (brief §15). Never fabricates a
 * "healthy" scheduler or worker — a scheduler is "configured" only when the
 * shared secret it authenticates with actually exists, and worker/job
 * health is read from the same `automation_jobs` rows the rest of this page
 * already queries, not asserted separately.
 */
export interface ProductionReadiness {
  schedulerConfigured: boolean
  jobsByStatus: Record<string, number>
  externalActionsByVerification: Record<string, number>
  connectors: readonly MarketplaceConnectorSummary[]
}

const EMPTY_TODAY: AutomationStatus['today'] = {
  actionsTotal: 0, succeeded: 0, failed: 0, blocked: 0, approvalsRequested: 0, approvalsCompleted: 0,
  productsPaused: 0, suppliersSwitched: 0, spentAutomaticallyMinor: 0, refundsProcessedMinor: 0,
}

/**
 * The automation control centre's data (brief §20/§21).
 *
 * There is no CEO Dashboard yet — that is Milestone 8 in `docs/MILESTONES.md`
 * — so this is surfaced on its own `/automation` page for now. When the CEO
 * Dashboard is built, it reads from this exact function rather than growing
 * a second, possibly-diverging summary of the same data.
 */
export async function getAutomationStatus(): Promise<AutomationStatus> {
  const session = await requireSession()
  const settings = await getAutomationSettings(session)

  const connectorSummaries = await Promise.all(listMarketplaceConnectors().map((c) => marketplaceConnectorSummary(c)))
  const schedulerConfigured = isSupabaseConfigured() && automationCronSecret() !== undefined

  if (session.isDemo) {
    return {
      isDemo: true,
      settings,
      today: EMPTY_TODAY,
      risk: { failedActions: 0, blockedActions: 0, deadLetterJobs: 0 },
      recentActions: [],
      pendingJobs: [],
      demoScenarios: demoAutomationScenarios(),
      productionReadiness: { schedulerConfigured: false, jobsByStatus: {}, externalActionsByVerification: {}, connectors: connectorSummaries },
      recoveryRequired: [],
      maintenanceHealth: classifyMaintenanceHealth([], new Date().toISOString()),
    }
  }

  const supabase = await createServerSupabase()
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)

  const [{ data: todaysActions }, { data: recentActions }, { data: pendingJobs }, { count: deadLetterCount }, { data: allJobs }, { data: recoveryRequired }, maintenanceRuns] = await Promise.all([
    supabase.from('automation_actions').select('*').eq('org_id', session.orgId).gte('created_at', startOfDay.toISOString()),
    supabase.from('automation_actions').select('*').eq('org_id', session.orgId).order('created_at', { ascending: false }).limit(25),
    supabase.from('automation_jobs').select('*').eq('org_id', session.orgId).in('status', ['pending', 'running']).order('run_at', { ascending: true }).limit(25),
    supabase.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('org_id', session.orgId).eq('status', 'dead_letter'),
    supabase.from('automation_jobs').select('status').eq('org_id', session.orgId),
    supabase.from('automation_actions').select('*').eq('org_id', session.orgId).in('status', ['retry_pending', 'executing']).order('created_at', { ascending: false }).limit(25),
    // Service-role read: maintenance runs are `org_id is null` (Milestone
    // 18, migration 0029) and so are never visible through the
    // session-scoped `supabase` client's RLS above — same reasoning as
    // `getRecentMaintenanceRuns`'s own comment.
    getRecentMaintenanceRuns(MAINTENANCE_JOB_KEY, 10),
  ])

  const maintenanceHealth = classifyMaintenanceHealth(maintenanceRuns, new Date().toISOString())

  const jobsByStatus: Record<string, number> = {}
  for (const job of allJobs ?? []) jobsByStatus[job.status] = (jobsByStatus[job.status] ?? 0) + 1

  const externalActionsByVerification: Record<string, number> = {}
  for (const action of recentActions ?? []) {
    externalActionsByVerification[action.verification_status] = (externalActionsByVerification[action.verification_status] ?? 0) + 1
  }

  const rows = todaysActions ?? []
  const today = {
    actionsTotal: rows.length,
    succeeded: rows.filter((r) => r.status === 'succeeded').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    blocked: rows.filter((r) => r.status === 'blocked').length,
    approvalsRequested: rows.filter((r) => r.status === 'requires_approval').length,
    approvalsCompleted: rows.filter((r) => r.status === 'succeeded' && r.ai_decision_id !== null).length,
    productsPaused: rows.filter((r) => r.action_type === 'pause_product' && r.status === 'succeeded').length,
    suppliersSwitched: rows.filter((r) => r.action_type === 'switch_supplier' && r.status === 'succeeded').length,
    spentAutomaticallyMinor: sumFacts(rows, 'submit_supplier_order'),
    refundsProcessedMinor: sumFacts(rows, 'process_refund'),
  }

  return {
    isDemo: false,
    settings,
    today,
    risk: {
      failedActions: rows.filter((r) => r.status === 'failed').length,
      blockedActions: rows.filter((r) => r.status === 'blocked').length,
      deadLetterJobs: deadLetterCount ?? 0,
    },
    recentActions: recentActions ?? [],
    pendingJobs: pendingJobs ?? [],
    demoScenarios: [],
    productionReadiness: { schedulerConfigured, jobsByStatus, externalActionsByVerification, connectors: connectorSummaries },
    recoveryRequired: recoveryRequired ?? [],
    maintenanceHealth,
  }
}

function sumFacts(rows: readonly AutomationAction[], actionType: string): number {
  return rows
    .filter((r) => r.action_type === actionType && r.status === 'succeeded')
    .reduce((total, r) => {
      const facts = r.input_facts as Record<string, unknown> | null
      const amount = facts && typeof facts.amountMinor === 'number' ? facts.amountMinor : 0
      return total + amount
    }, 0)
}

export async function getAutomationActionDetail(session: SessionContext, id: string): Promise<AutomationAction | null> {
  if (session.isDemo) return null
  const supabase = await createServerSupabase()
  const { data } = await supabase.from('automation_actions').select('*').eq('id', id).eq('org_id', session.orgId).maybeSingle()
  return data
}
