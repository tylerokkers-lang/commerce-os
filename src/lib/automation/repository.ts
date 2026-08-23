import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import { requireSession, type SessionContext } from '@/lib/security/session'
import { getAutomationSettings, type AutomationSettings } from './settings'
import { demoAutomationScenarios, type AnyDemoScenario } from '@/lib/demo/automation'
import type { Tables } from '@/lib/supabase/database.types'

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

  if (session.isDemo) {
    return {
      isDemo: true,
      settings,
      today: EMPTY_TODAY,
      risk: { failedActions: 0, blockedActions: 0, deadLetterJobs: 0 },
      recentActions: [],
      pendingJobs: [],
      demoScenarios: demoAutomationScenarios(),
    }
  }

  const supabase = await createServerSupabase()
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)

  const [{ data: todaysActions }, { data: recentActions }, { data: pendingJobs }, { count: deadLetterCount }] = await Promise.all([
    supabase.from('automation_actions').select('*').eq('org_id', session.orgId).gte('created_at', startOfDay.toISOString()),
    supabase.from('automation_actions').select('*').eq('org_id', session.orgId).order('created_at', { ascending: false }).limit(25),
    supabase.from('automation_jobs').select('*').eq('org_id', session.orgId).in('status', ['pending', 'running']).order('run_at', { ascending: true }).limit(25),
    supabase.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('org_id', session.orgId).eq('status', 'dead_letter'),
  ])

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
