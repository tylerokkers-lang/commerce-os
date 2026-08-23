import { isMonitorDue } from './eventTypes'
import { MONITORS, runMonitor } from './registry'
import type { EventStore, MonitorContext } from './eventTypes'
import type { AutomationStore } from '@/lib/automation/store'
import type { FactsLoader } from '@/lib/automation/factsTypes'
import type { AutomationSettings } from '@/lib/automation/settingsTypes'
import type { ConnectorLookup } from '@/lib/automation/worker'

/**
 * The monitoring scheduler runner (brief's "scheduler integration" and
 * "concurrency and locking" sections).
 *
 * Deliberately reuses the exact concurrency pattern
 * `automation/jobs.ts`'s `claimNextJob` already established rather than
 * inventing a second one: a monitor "claim" is a single atomic
 * `UPDATE ... WHERE completed_at IS NULL` (`startMonitorRun` creates the
 * row; nothing else can start a second run for the same monitor while one
 * is `status = 'running'`, because `isDue` below checks the *last
 * completed* run, and a still-running run has no `completed_at` to become
 * newly due from). Two workers racing to start the same monitor's run
 * still both succeed at inserting a `monitor_runs` row — this mirrors
 * `enqueueJob`'s own idempotency-key pattern, and is deliberately followed
 * up in the same way: `runMonitors` is safe to call concurrently because
 * every downstream write (`createEvent`) is itself idempotent via
 * `dedupeKey`, so a duplicate monitor tick produces duplicate *attempts*
 * but never duplicate *events* — proven in
 * `tests/monitoring-concurrency.test.ts`.
 *
 * Enumerating *which subjects* a monitor should check is supplied by the
 * caller (`SubjectProvider`) — the same honest boundary Milestone 7 drew
 * for `FactsLoader` ("answers what's true for X, not which X to check").
 * A live per-org "enumerate every active product/supplier" sweep is
 * `docs/MILESTONES.md`'s documented next step, not faked here.
 */

export type SubjectProvider = (orgId: string, monitorKey: string) => Promise<readonly unknown[]>

export interface RunMonitorsInput {
  orgId: string
  store: AutomationStore
  events: EventStore
  facts: FactsLoader
  connectors: ConnectorLookup
  settings: AutomationSettings
  subjectsFor: SubjectProvider
  now?: Date
  /** Restrict to specific monitor keys — used by tests and by a manual "run this one monitor now" trigger. Defaults to every registered monitor. */
  monitorKeys?: readonly string[]
}

export interface MonitorRunSummary {
  monitorKey: string
  ran: boolean
  reason?: string
  subjectsChecked: number
  eventsCreated: number
  eventsDeduplicated: number
  errors: readonly string[]
}

export async function runDueMonitors(input: RunMonitorsInput): Promise<readonly MonitorRunSummary[]> {
  const now = input.now ?? new Date()
  const keys = input.monitorKeys ?? Object.keys(MONITORS)
  const summaries: MonitorRunSummary[] = []

  for (const key of keys) {
    const monitor = MONITORS[key]
    if (!monitor) {
      summaries.push({ monitorKey: key, ran: false, reason: 'not registered', subjectsChecked: 0, eventsCreated: 0, eventsDeduplicated: 0, errors: [] })
      continue
    }

    const lastRun = await input.events.getLastMonitorRun(input.orgId, key)
    const intervalMinutes = await input.events.getMonitorScheduleMinutes(input.orgId, key, monitor.descriptor.defaultIntervalMinutes)
    if (!isMonitorDue(lastRun?.completedAt ?? null, intervalMinutes, now)) {
      summaries.push({ monitorKey: key, ran: false, reason: 'not due', subjectsChecked: 0, eventsCreated: 0, eventsDeduplicated: 0, errors: [] })
      continue
    }

    const { id: runId } = await input.events.startMonitorRun(input.orgId, key)
    const ctx: MonitorContext = { orgId: input.orgId, store: input.store, events: input.events, facts: input.facts, connectors: input.connectors, settings: input.settings, now }

    try {
      // Subject enumeration is inside the same try as the run itself: a
      // failure here (e.g. the database is unreachable) must still leave a
      // "failed" monitor_runs row, never crash the whole scheduler sweep or
      // leave this monitor's run stuck at "running" forever.
      const subjects = await input.subjectsFor(input.orgId, key)
      const outcome = await runMonitor(key, ctx, subjects)
      const status = outcome.errors.length === 0 ? 'success' : outcome.errors.length < subjects.length ? 'partial_success' : 'failed'
      await input.events.completeMonitorRun(runId, {
        status, subjectsChecked: outcome.subjectsChecked, observationsCreated: outcome.observationsCreated,
        eventsCreated: outcome.eventsCreated, eventsDeduplicated: outcome.eventsDeduplicated,
        error: outcome.errors.length > 0 ? outcome.errors.join('; ') : null,
      })
      summaries.push({ monitorKey: key, ran: true, subjectsChecked: outcome.subjectsChecked, eventsCreated: outcome.eventsCreated, eventsDeduplicated: outcome.eventsDeduplicated, errors: outcome.errors })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await input.events.completeMonitorRun(runId, { status: 'failed', subjectsChecked: 0, observationsCreated: 0, eventsCreated: 0, eventsDeduplicated: 0, error: message })
      summaries.push({ monitorKey: key, ran: true, subjectsChecked: 0, eventsCreated: 0, eventsDeduplicated: 0, errors: [message] })
    }
  }

  return summaries
}
