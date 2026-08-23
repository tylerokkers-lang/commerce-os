import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import { requireSession } from '@/lib/security/session'
import { demoMonitoringScenarios, type MonitoringDemoScenario } from '@/lib/demo/monitoring'
import { isSupabaseConfigured, automationCronSecret } from '@/lib/core/env'
import { MONITORS } from './registry'
import type { Tables } from '@/lib/supabase/database.types'

export type DomainEventRow = Tables<'domain_events'>
export type MonitorRunRow = Tables<'monitor_runs'>

export interface MonitoringStatus {
  isDemo: boolean
  schedulerConfigured: boolean
  systemHealth: {
    monitorsRegistered: number
    monitorsRunLast24h: number
    monitorsFailedLast24h: number
    monitorsNeverRun: readonly string[]
    lastRunByMonitor: Record<string, MonitorRunRow | null>
  }
  businessAlerts: {
    openCriticalEvents: number
    openWarningEvents: number
    unavailableSuppliers: number
    reconciliationProblems: number
    complianceRechecksRequired: number
  }
  recentEvents: readonly DomainEventRow[]
  demoScenarios: readonly MonitoringDemoScenario[]
}

const EMPTY_BUSINESS_ALERTS: MonitoringStatus['businessAlerts'] = {
  openCriticalEvents: 0, openWarningEvents: 0, unavailableSuppliers: 0, reconciliationProblems: 0, complianceRechecksRequired: 0,
}

/**
 * The Milestone 8 "Business Intelligence / Live Operations" data (brief's
 * CEO-dashboard extension). There is still no dedicated CEO Dashboard route
 * (that remains Milestone 9 in `docs/MILESTONES.md`) — this extends the
 * same `/automation` page `getAutomationStatus` already established for
 * Milestone 7's production-readiness view, for the same reason: one honest
 * summary, read from real `monitor_runs`/`domain_events` rows, never a
 * second diverging one.
 */
export async function getMonitoringStatus(): Promise<MonitoringStatus> {
  const session = await requireSession()
  const schedulerConfigured = isSupabaseConfigured() && automationCronSecret() !== undefined
  const monitorKeys = Object.keys(MONITORS)

  if (session.isDemo) {
    return {
      isDemo: true,
      schedulerConfigured: false,
      systemHealth: { monitorsRegistered: monitorKeys.length, monitorsRunLast24h: 0, monitorsFailedLast24h: 0, monitorsNeverRun: monitorKeys, lastRunByMonitor: {} },
      businessAlerts: EMPTY_BUSINESS_ALERTS,
      recentEvents: [],
      demoScenarios: await demoMonitoringScenarios(),
    }
  }

  const supabase = await createServerSupabase()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [{ data: recentRuns }, { data: recentEvents }, { count: openCritical }, { count: openWarning }] = await Promise.all([
    supabase.from('monitor_runs').select('*').eq('org_id', session.orgId).order('started_at', { ascending: false }).limit(200),
    supabase.from('domain_events').select('*').eq('org_id', session.orgId).order('detected_at', { ascending: false }).limit(25),
    supabase.from('domain_events').select('id', { count: 'exact', head: true }).eq('org_id', session.orgId).eq('status', 'open').eq('severity', 'critical'),
    supabase.from('domain_events').select('id', { count: 'exact', head: true }).eq('org_id', session.orgId).eq('status', 'open').eq('severity', 'warning'),
  ])

  const [{ count: unavailableSuppliers }, { count: reconciliationProblems }, { count: complianceRechecksRequired }] = await Promise.all([
    supabase.from('domain_events').select('id', { count: 'exact', head: true }).eq('org_id', session.orgId).eq('status', 'open').in('event_type', ['SUPPLIER_OUT_OF_STOCK', 'SUPPLIER_FEED_FAILED']),
    supabase.from('domain_events').select('id', { count: 'exact', head: true }).eq('org_id', session.orgId).eq('status', 'open').in('event_type', ['LISTING_OUT_OF_SYNC', 'LISTING_PRICE_CHANGED_EXTERNALLY', 'LISTING_STATUS_CHANGED_EXTERNALLY', 'INVENTORY_MISMATCH']),
    supabase.from('domain_events').select('id', { count: 'exact', head: true }).eq('org_id', session.orgId).eq('status', 'open').in('event_type', ['COMPLIANCE_RECHECK_REQUIRED', 'COMPLIANCE_ASSESSMENT_STALE']),
  ])

  const runs = recentRuns ?? []
  const lastRunByMonitor: Record<string, MonitorRunRow | null> = {}
  for (const key of monitorKeys) {
    lastRunByMonitor[key] = runs.find((r) => r.monitor_key === key) ?? null
  }

  return {
    isDemo: false,
    schedulerConfigured,
    systemHealth: {
      monitorsRegistered: monitorKeys.length,
      monitorsRunLast24h: runs.filter((r) => r.started_at >= since24h).length,
      monitorsFailedLast24h: runs.filter((r) => r.started_at >= since24h && r.status === 'failed').length,
      monitorsNeverRun: monitorKeys.filter((key) => !lastRunByMonitor[key]),
      lastRunByMonitor,
    },
    businessAlerts: {
      openCriticalEvents: openCritical ?? 0,
      openWarningEvents: openWarning ?? 0,
      unavailableSuppliers: unavailableSuppliers ?? 0,
      reconciliationProblems: reconciliationProblems ?? 0,
      complianceRechecksRequired: complianceRechecksRequired ?? 0,
    },
    recentEvents: recentEvents ?? [],
    demoScenarios: [],
  }
}
