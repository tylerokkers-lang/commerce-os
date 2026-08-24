import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import { requireSession } from '@/lib/security/session'
import { demoMonitoringScenarios, type MonitoringDemoScenario } from '@/lib/demo/monitoring'
import { isSupabaseConfigured, automationCronSecret } from '@/lib/core/env'
import { isMonitorDue } from './eventTypes'
import { MONITORS } from './registry'
import { MARKET_CATALOG, resolveMarketStatus } from '@/lib/markets/catalog'
import type { Tables } from '@/lib/supabase/database.types'
import type { MarketConnectorStatus } from '@/lib/markets/types'

export type DomainEventRow = Tables<'domain_events'>
export type MonitorRunRow = Tables<'monitor_runs'>

export interface MonitoringStatus {
  isDemo: boolean
  schedulerConfigured: boolean
  systemHealth: {
    monitorsRegistered: number
    monitorsRunLast24h: number
    monitorsFailedLast24h: number
    /** A run in the last 24h that was `partial_success` — some subjects checked fine, others did not. */
    monitorsDegraded: number
    /** Never run, or last run finished longer ago than its own configured interval — genuinely due but not happening. */
    monitorsOverdue: readonly string[]
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
  /** Supplier operational intelligence (Milestone 8.5 §13), each a list of distinct supplier/subject ids behind an open event — never a bare count with nothing to drill into. */
  supplierIntelligence: {
    suppliersWithDispatchDelays: readonly string[]
    suppliersWithCancellationIncrease: readonly string[]
    suppliersWithPriceIncreases: readonly string[]
    suppliersWithFeedProblems: readonly string[]
  }
  productIntelligence: {
    newlyProfitable: readonly string[]
    losingProfitability: readonly string[]
    risingSales: readonly string[]
    decliningSales: readonly string[]
    requiringReview: readonly string[]
  }
  marketplaceIntelligence: {
    listingsOutOfSync: readonly string[]
    failedExternalActions: readonly string[]
  }
  /** Milestone 9: global expansion intelligence — FX and market-scoped events, plus the real (never hardcoded) marketplace readiness catalog. */
  expansionIntelligence: {
    fxRatesStale: readonly string[]
    fxSignificantMovements: readonly string[]
    marketsWithProfitabilityDeterioration: readonly string[]
    marketsRequiringComplianceRecheck: readonly string[]
    marketsWithSupplierCapabilityChanges: readonly string[]
    marketsBecameViable: readonly string[]
  }
  marketReadiness: readonly { marketKey: string; label: string; countryLabel: string; status: MarketConnectorStatus }[]
  recentEvents: readonly DomainEventRow[]
  demoScenarios: readonly MonitoringDemoScenario[]
}

const EMPTY_BUSINESS_ALERTS: MonitoringStatus['businessAlerts'] = {
  openCriticalEvents: 0, openWarningEvents: 0, unavailableSuppliers: 0, reconciliationProblems: 0, complianceRechecksRequired: 0,
}
const EMPTY_SUPPLIER_INTELLIGENCE: MonitoringStatus['supplierIntelligence'] = {
  suppliersWithDispatchDelays: [], suppliersWithCancellationIncrease: [], suppliersWithPriceIncreases: [], suppliersWithFeedProblems: [],
}
const EMPTY_PRODUCT_INTELLIGENCE: MonitoringStatus['productIntelligence'] = {
  newlyProfitable: [], losingProfitability: [], risingSales: [], decliningSales: [], requiringReview: [],
}
const EMPTY_MARKETPLACE_INTELLIGENCE: MonitoringStatus['marketplaceIntelligence'] = { listingsOutOfSync: [], failedExternalActions: [] }
const EMPTY_EXPANSION_INTELLIGENCE: MonitoringStatus['expansionIntelligence'] = {
  fxRatesStale: [], fxSignificantMovements: [], marketsWithProfitabilityDeterioration: [], marketsRequiringComplianceRecheck: [], marketsWithSupplierCapabilityChanges: [], marketsBecameViable: [],
}

/** event_type -> which grouping in `MonitoringStatus` it drills into. Explicit and inspectable, same discipline as `EVENT_TO_JOB_MAPPING`. */
const SUPPLIER_DISPATCH_EVENTS = ['SUPPLIER_DISPATCH_DELAYED']
const SUPPLIER_CANCELLATION_EVENTS = ['SUPPLIER_CANCELLATION_RATE_INCREASED']
const SUPPLIER_PRICE_INCREASE_EVENTS = ['SUPPLIER_PRICE_INCREASED']
const SUPPLIER_FEED_PROBLEM_EVENTS = ['SUPPLIER_FEED_FAILED', 'SUPPLIER_FEED_STALE']
const PRODUCT_NEWLY_PROFITABLE_EVENTS = ['PRODUCT_BECAME_PROFITABLE']
const PRODUCT_LOSING_PROFITABILITY_EVENTS = ['PRODUCT_NO_LONGER_PROFITABLE', 'PRODUCT_MARGIN_DROPPED', 'PRODUCT_PRICE_REVIEW_REQUIRED', 'REVENUE_DECLINED']
const PRODUCT_RISING_SALES_EVENTS = ['PRODUCT_SALES_SURGING']
const PRODUCT_DECLINING_SALES_EVENTS = ['PRODUCT_SALES_DECLINING', 'PRODUCT_UNDERPERFORMING']
const MARKETPLACE_OUT_OF_SYNC_EVENTS = ['LISTING_OUT_OF_SYNC', 'LISTING_PRICE_CHANGED_EXTERNALLY', 'LISTING_STATUS_CHANGED_EXTERNALLY', 'INVENTORY_MISMATCH']
const MARKETPLACE_FAILED_ACTION_EVENTS = ['EXTERNAL_ACTION_FAILED', 'EXTERNAL_ACTION_UNVERIFIED']
const COMPLIANCE_RECHECK_EVENTS = ['COMPLIANCE_RECHECK_REQUIRED', 'COMPLIANCE_ASSESSMENT_STALE']
const SUPPLIER_UNAVAILABLE_EVENTS = ['SUPPLIER_OUT_OF_STOCK', 'SUPPLIER_FEED_FAILED']
const FX_STALE_EVENTS = ['FX_RATE_STALE', 'FX_RATE_UNAVAILABLE']
const FX_MOVEMENT_EVENTS = ['FX_RATE_SIGNIFICANT_MOVEMENT']
const MARKET_PROFITABILITY_EVENTS = ['MARKET_PROFITABILITY_DETERIORATED']
const MARKET_COMPLIANCE_EVENTS = ['MARKET_COMPLIANCE_RECHECK_REQUIRED']
const MARKET_SUPPLIER_EVENTS = ['MARKET_SUPPLIER_CAPABILITY_CHANGED']
const MARKET_VIABLE_EVENTS = ['MARKET_BECAME_VIABLE']

function distinctSubjectIds(events: readonly Pick<DomainEventRow, 'event_type' | 'subject_id'>[], eventTypes: readonly string[]): readonly string[] {
  return [...new Set(events.filter((e) => eventTypes.includes(e.event_type) && e.subject_id).map((e) => e.subject_id as string))]
}

/** Every product with any open event at all, regardless of type — the honest "needs a human look" list, not narrowed to one event type. */
function distinctSubjectIdsForSubjectType(events: readonly Pick<DomainEventRow, 'subject_type' | 'subject_id'>[], subjectType: string): readonly string[] {
  return [...new Set(events.filter((e) => e.subject_type === subjectType && e.subject_id).map((e) => e.subject_id as string))]
}

/**
 * The Milestone 8 "Business Intelligence / Live Operations" data, extended
 * in Milestone 8.5 with monitoring health (degraded/overdue), supplier
 * operational intelligence, product intelligence, and marketplace
 * intelligence — every figure a list of real open-event subject ids to
 * drill into, never a bare invented number. There is still no dedicated
 * CEO Dashboard route (that remains Milestone 10 in `docs/MILESTONES.md`)
 * — this extends the same `/automation` page `getAutomationStatus` already
 * established for Milestone 7's production-readiness view.
 */
export async function getMonitoringStatus(): Promise<MonitoringStatus> {
  const session = await requireSession()
  const schedulerConfigured = isSupabaseConfigured() && automationCronSecret() !== undefined
  const monitorKeys = Object.keys(MONITORS)

  // Real for both demo and live: reads each market's actual connector
  // status (or `planned` when none exists) the same way `/marketplaces`
  // and `/automation`'s production-readiness card already do — never a
  // hardcoded LIVE/DEMO/PLANNED label.
  const marketReadiness = await Promise.all(
    MARKET_CATALOG.map(async (market) => {
      const snapshot = await resolveMarketStatus(market)
      return { marketKey: market.marketKey, label: market.label, countryLabel: market.countryLabel, status: snapshot.status }
    }),
  )

  if (session.isDemo) {
    return {
      isDemo: true,
      schedulerConfigured: false,
      systemHealth: { monitorsRegistered: monitorKeys.length, monitorsRunLast24h: 0, monitorsFailedLast24h: 0, monitorsDegraded: 0, monitorsOverdue: monitorKeys, monitorsNeverRun: monitorKeys, lastRunByMonitor: {} },
      businessAlerts: EMPTY_BUSINESS_ALERTS,
      supplierIntelligence: EMPTY_SUPPLIER_INTELLIGENCE,
      productIntelligence: EMPTY_PRODUCT_INTELLIGENCE,
      marketplaceIntelligence: EMPTY_MARKETPLACE_INTELLIGENCE,
      expansionIntelligence: EMPTY_EXPANSION_INTELLIGENCE,
      marketReadiness,
      recentEvents: [],
      demoScenarios: await demoMonitoringScenarios(),
    }
  }

  const supabase = await createServerSupabase()
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const [{ data: recentRuns }, { data: recentEvents }, { data: openEvents }] = await Promise.all([
    supabase.from('monitor_runs').select('*').eq('org_id', session.orgId).order('started_at', { ascending: false }).limit(200),
    supabase.from('domain_events').select('*').eq('org_id', session.orgId).order('detected_at', { ascending: false }).limit(25),
    // One bounded query for every open event, grouped in-memory below —
    // simpler and fewer round trips than a dozen separate count queries.
    supabase.from('domain_events').select('event_type, subject_type, subject_id, severity').eq('org_id', session.orgId).eq('status', 'open').limit(500),
  ])

  const runs = recentRuns ?? []
  const events = openEvents ?? []
  const lastRunByMonitor: Record<string, MonitorRunRow | null> = {}
  for (const key of monitorKeys) {
    lastRunByMonitor[key] = runs.find((r) => r.monitor_key === key) ?? null
  }

  const monitorsOverdue = monitorKeys.filter((key) => {
    const lastRun = lastRunByMonitor[key]
    const monitor = MONITORS[key]
    return isMonitorDue(lastRun?.completed_at ?? null, monitor.descriptor.defaultIntervalMinutes, now)
  })

  return {
    isDemo: false,
    schedulerConfigured,
    systemHealth: {
      monitorsRegistered: monitorKeys.length,
      monitorsRunLast24h: runs.filter((r) => r.started_at >= since24h).length,
      monitorsFailedLast24h: runs.filter((r) => r.started_at >= since24h && r.status === 'failed').length,
      monitorsDegraded: runs.filter((r) => r.started_at >= since24h && r.status === 'partial_success').length,
      monitorsOverdue,
      monitorsNeverRun: monitorKeys.filter((key) => !lastRunByMonitor[key]),
      lastRunByMonitor,
    },
    businessAlerts: {
      openCriticalEvents: events.filter((e) => e.severity === 'critical').length,
      openWarningEvents: events.filter((e) => e.severity === 'warning').length,
      unavailableSuppliers: distinctSubjectIds(events, SUPPLIER_UNAVAILABLE_EVENTS).length,
      reconciliationProblems: distinctSubjectIds(events, MARKETPLACE_OUT_OF_SYNC_EVENTS).length,
      complianceRechecksRequired: distinctSubjectIds(events, COMPLIANCE_RECHECK_EVENTS).length,
    },
    supplierIntelligence: {
      suppliersWithDispatchDelays: distinctSubjectIds(events, SUPPLIER_DISPATCH_EVENTS),
      suppliersWithCancellationIncrease: distinctSubjectIds(events, SUPPLIER_CANCELLATION_EVENTS),
      suppliersWithPriceIncreases: distinctSubjectIds(events, SUPPLIER_PRICE_INCREASE_EVENTS),
      suppliersWithFeedProblems: distinctSubjectIds(events, SUPPLIER_FEED_PROBLEM_EVENTS),
    },
    productIntelligence: {
      newlyProfitable: distinctSubjectIds(events, PRODUCT_NEWLY_PROFITABLE_EVENTS),
      losingProfitability: distinctSubjectIds(events, PRODUCT_LOSING_PROFITABILITY_EVENTS),
      risingSales: distinctSubjectIds(events, PRODUCT_RISING_SALES_EVENTS),
      decliningSales: distinctSubjectIds(events, PRODUCT_DECLINING_SALES_EVENTS),
      requiringReview: distinctSubjectIdsForSubjectType(events, 'product'),
    },
    marketplaceIntelligence: {
      listingsOutOfSync: distinctSubjectIds(events, MARKETPLACE_OUT_OF_SYNC_EVENTS),
      failedExternalActions: distinctSubjectIds(events, MARKETPLACE_FAILED_ACTION_EVENTS),
    },
    expansionIntelligence: {
      fxRatesStale: distinctSubjectIds(events, FX_STALE_EVENTS),
      fxSignificantMovements: distinctSubjectIds(events, FX_MOVEMENT_EVENTS),
      marketsWithProfitabilityDeterioration: distinctSubjectIds(events, MARKET_PROFITABILITY_EVENTS),
      marketsRequiringComplianceRecheck: distinctSubjectIds(events, MARKET_COMPLIANCE_EVENTS),
      marketsWithSupplierCapabilityChanges: distinctSubjectIds(events, MARKET_SUPPLIER_EVENTS),
      marketsBecameViable: distinctSubjectIds(events, MARKET_VIABLE_EVENTS),
    },
    marketReadiness,
    recentEvents: recentEvents ?? [],
    demoScenarios: [],
  }
}
