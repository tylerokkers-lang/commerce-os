import type { AutomationStore } from '@/lib/automation/store'
import type { FactsLoader } from '@/lib/automation/factsTypes'
import type { AutomationSettings } from '@/lib/automation/settingsTypes'
import type { ConnectorLookup } from '@/lib/automation/worker'
import type { FxRateStore } from '@/lib/fx/types'
import type { SupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFacts'

/**
 * The domain-event system (Milestone 8).
 *
 * Kept in its own pure file, no `server-only` import — same reasoning as
 * `automation/store.ts` and `automation/factsTypes.ts` (Milestones 6–7):
 * an `EventStore` interface here is satisfied twice, once for real
 * (`eventStore.ts`, Supabase-backed) and once by `inMemoryEventStore.ts`
 * for tests, so monitors can be driven end to end without a live database.
 */

export type EventStatus = 'open' | 'processing' | 'processed' | 'ignored' | 'superseded' | 'failed'
export type EventSeverity = 'info' | 'warning' | 'critical'
/** Whether a fact was observed locally (our own database) or from the external platform. Never conflated (brief). */
export type EventSource = 'local' | 'external' | 'internal'

export interface DomainEvent {
  id: string
  orgId: string
  eventType: string
  subjectType: string
  subjectId: string | null
  source: EventSource
  sourceConnectorKey: string | null
  sourceObservationId: string | null
  occurredAt: string
  detectedAt: string
  severity: EventSeverity
  previousValue: unknown
  currentValue: unknown
  facts: Record<string, unknown>
  metadata: Record<string, unknown>
  dedupeKey: string | null
  correlationId: string
  causationId: string | null
  status: EventStatus
  automationJobId: string | null
  supersededBy: string | null
  monitorRunId: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateEventInput {
  orgId: string
  eventType: string
  subjectType: string
  subjectId?: string | null
  source: EventSource
  sourceConnectorKey?: string | null
  sourceObservationId?: string | null
  severity?: EventSeverity
  previousValue?: unknown
  currentValue?: unknown
  facts?: Record<string, unknown>
  metadata?: Record<string, unknown>
  /** When set, an existing OPEN event with the same key is reused rather than duplicated — the actual deduplication guarantee. */
  dedupeKey?: string | null
  correlationId?: string
  causationId?: string | null
  monitorRunId?: string | null
}

/** 'ok' means a value was genuinely observed; 'unavailable' means the source failed to answer; 'unknown' means no observation has ever been made. Never collapsed into each other. */
export type ObservationStatus = 'ok' | 'unavailable' | 'unknown'

export interface ObservationRecord {
  status: ObservationStatus
  value: Record<string, unknown>
  lastCheckedAt: string | null
}

export type MonitorRunStatus = 'running' | 'success' | 'partial_success' | 'failed' | 'cancelled'

export interface MonitorRunRecord {
  id: string
  orgId: string
  monitorKey: string
  status: MonitorRunStatus
  startedAt: string
  completedAt: string | null
  subjectsChecked: number
  observationsCreated: number
  eventsCreated: number
  eventsDeduplicated: number
  error: string | null
  correlationId: string
}

export interface EventStore {
  getObservation(orgId: string, monitorKey: string, subjectType: string, subjectId: string): Promise<ObservationRecord | null>
  upsertObservation(orgId: string, monitorKey: string, subjectType: string, subjectId: string, observation: ObservationRecord): Promise<void>
  /** Returns `deduplicated: true` when an OPEN event with the same dedupeKey already existed — no new row was created. */
  createEvent(input: CreateEventInput): Promise<{ id: string; deduplicated: boolean }>
  resolveEvent(eventId: string, status: Exclude<EventStatus, 'open' | 'processing'>, supersededBy?: string): Promise<void>
  markEventProcessing(eventId: string, automationJobId?: string): Promise<void>
  startMonitorRun(orgId: string, monitorKey: string, correlationId?: string): Promise<{ id: string }>
  completeMonitorRun(runId: string, outcome: { status: MonitorRunStatus; subjectsChecked: number; observationsCreated: number; eventsCreated: number; eventsDeduplicated: number; error?: string | null }): Promise<void>
  getLastMonitorRun(orgId: string, monitorKey: string): Promise<MonitorRunRecord | null>
  getMonitorScheduleMinutes(orgId: string, monitorKey: string, defaultMinutes: number): Promise<number>
  /** Any other configurable monitor threshold (a percentage, a day count, …) — same `config_values` store, a different key namespace. */
  getMonitorConfigNumber(orgId: string, configKey: string, defaultValue: number): Promise<number>
}

/** True when enough time has passed since the last completed run — the pure due/not-due decision, testable without a database. */
export function isMonitorDue(lastRunCompletedAt: string | null, intervalMinutes: number, now: Date): boolean {
  if (!lastRunCompletedAt) return true
  const dueAt = new Date(lastRunCompletedAt).getTime() + intervalMinutes * 60_000
  return now.getTime() >= dueAt
}

export interface MonitorDescriptor {
  key: string
  label: string
  category: 'supplier' | 'profitability' | 'compliance' | 'marketplace' | 'performance' | 'discovery'
  /** The starting-point interval; overridable per org via `config_values` (`monitor_schedule:<key>`), never hardcoded as immutable. */
  defaultIntervalMinutes: number
}

export interface MonitorContext {
  orgId: string
  store: AutomationStore
  events: EventStore
  facts: FactsLoader
  connectors: ConnectorLookup
  settings: AutomationSettings
  now: Date
  /**
   * Milestone 9: exchange-rate and supplier-destination-capability facts,
   * used only by `fxMonitor`/`marketMonitor`. Optional so every other
   * monitor's context construction (and every existing test) is
   * unaffected — the same reasoning `connectors` already established for
   * `marketplaceMonitor` alone.
   */
  fxStore?: FxRateStore
  supplierMarketFacts?: SupplierMarketFactsLoader
}

export interface MonitorRunOutcome {
  subjectsChecked: number
  observationsCreated: number
  eventsCreated: number
  eventsDeduplicated: number
  errors: readonly string[]
}

/**
 * A monitor observes; it never acts. It may enqueue an automation job (the
 * existing engine decides and acts from there), but it must never call a
 * connector's write methods, `reconcileChannelProduct`, or any other
 * business-action function directly.
 */
export interface Monitor<TSubject> {
  descriptor: MonitorDescriptor
  run(ctx: MonitorContext, subjects: readonly TSubject[]): Promise<MonitorRunOutcome>
}
