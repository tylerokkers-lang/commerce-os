import { randomUUID } from 'node:crypto'
import type { CreateEventInput, DomainEvent, EventStatus, EventStore, MonitorRunRecord, MonitorRunStatus, ObservationRecord } from './eventTypes'

/**
 * A real (not mocked) in-memory `EventStore`, used by tests to drive
 * monitors end to end without a live database — the same pattern as
 * `automation/inMemoryStore.ts` (Milestone 6) and
 * `automation/inMemoryFactsLoader.ts` (Milestone 7). Deduplication here
 * enforces the identical invariant the real store's partial unique index
 * enforces: at most one OPEN event per `(orgId, dedupeKey)`.
 */
export function createInMemoryEventStore(options?: { scheduleMinutesByKey?: Record<string, number>; configNumbersByKey?: Record<string, number> }) {
  const events: DomainEvent[] = []
  const openByDedupeKey = new Map<string, string>() // `${orgId}:${dedupeKey}` -> event id
  const observations = new Map<string, ObservationRecord>() // `${orgId}:${monitorKey}:${subjectType}:${subjectId}`
  const monitorRuns: MonitorRunRecord[] = []
  const scheduleMinutesByKey = options?.scheduleMinutesByKey ?? {}
  const configNumbersByKey = options?.configNumbersByKey ?? {}

  const obsKey = (orgId: string, monitorKey: string, subjectType: string, subjectId: string) => `${orgId}:${monitorKey}:${subjectType}:${subjectId}`
  const dedupeMapKey = (orgId: string, dedupeKey: string) => `${orgId}:${dedupeKey}`

  const store: EventStore & { getState: () => { events: DomainEvent[]; monitorRuns: MonitorRunRecord[] } } = {
    async getObservation(orgId, monitorKey, subjectType, subjectId) {
      return observations.get(obsKey(orgId, monitorKey, subjectType, subjectId)) ?? null
    },

    async upsertObservation(orgId, monitorKey, subjectType, subjectId, observation) {
      observations.set(obsKey(orgId, monitorKey, subjectType, subjectId), observation)
    },

    async createEvent(input: CreateEventInput) {
      // Two separate awaits, matching the read-then-write round trip a real
      // database INSERT with a unique-constraint retry makes — exactly
      // where a race between concurrent monitor runs can occur. The actual
      // dedupe check re-reads current state at commit time (just before
      // the map write below), not the snapshot taken before either await,
      // which is what makes the race safe.
      if (input.dedupeKey) {
        const key = dedupeMapKey(input.orgId, input.dedupeKey)
        if (openByDedupeKey.has(key)) return { id: openByDedupeKey.get(key)!, deduplicated: true }
        await Promise.resolve()
        await Promise.resolve()
        const stillOpen = openByDedupeKey.get(key)
        if (stillOpen) return { id: stillOpen, deduplicated: true }
      }

      const nowIso = new Date().toISOString()
      const id = randomUUID()
      const event: DomainEvent = {
        id,
        orgId: input.orgId,
        eventType: input.eventType,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        source: input.source,
        sourceConnectorKey: input.sourceConnectorKey ?? null,
        sourceObservationId: input.sourceObservationId ?? null,
        occurredAt: nowIso,
        detectedAt: nowIso,
        severity: input.severity ?? 'info',
        previousValue: input.previousValue ?? null,
        currentValue: input.currentValue ?? null,
        facts: input.facts ?? {},
        metadata: input.metadata ?? {},
        dedupeKey: input.dedupeKey ?? null,
        correlationId: input.correlationId ?? randomUUID(),
        causationId: input.causationId ?? null,
        status: 'open',
        automationJobId: null,
        supersededBy: null,
        monitorRunId: input.monitorRunId ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      events.push(event)
      if (input.dedupeKey) openByDedupeKey.set(dedupeMapKey(input.orgId, input.dedupeKey), id)

      return { id, deduplicated: false }
    },

    async resolveEvent(eventId: string, status: Exclude<EventStatus, 'open' | 'processing'>, supersededBy?: string) {
      const index = events.findIndex((e) => e.id === eventId)
      if (index === -1) throw new Error(`Unknown event ${eventId}`)
      const event = events[index]
      events[index] = { ...event, status, supersededBy: supersededBy ?? null, updatedAt: new Date().toISOString() }
      if (event.dedupeKey) {
        const key = dedupeMapKey(event.orgId, event.dedupeKey)
        if (openByDedupeKey.get(key) === eventId) openByDedupeKey.delete(key)
      }
    },

    async markEventProcessing(eventId: string, automationJobId?: string) {
      const index = events.findIndex((e) => e.id === eventId)
      if (index === -1) return
      events[index] = { ...events[index], status: 'processing', automationJobId: automationJobId ?? null, updatedAt: new Date().toISOString() }
    },

    async startMonitorRun(orgId: string, monitorKey: string, correlationId?: string) {
      const id = randomUUID()
      monitorRuns.push({
        id, orgId, monitorKey, status: 'running', startedAt: new Date().toISOString(), completedAt: null,
        subjectsChecked: 0, observationsCreated: 0, eventsCreated: 0, eventsDeduplicated: 0, error: null,
        correlationId: correlationId ?? randomUUID(),
      })
      return { id }
    },

    async completeMonitorRun(runId: string, outcome: { status: MonitorRunStatus; subjectsChecked: number; observationsCreated: number; eventsCreated: number; eventsDeduplicated: number; error?: string | null }) {
      const index = monitorRuns.findIndex((r) => r.id === runId)
      if (index === -1) return
      monitorRuns[index] = {
        ...monitorRuns[index],
        status: outcome.status,
        completedAt: new Date().toISOString(),
        subjectsChecked: outcome.subjectsChecked,
        observationsCreated: outcome.observationsCreated,
        eventsCreated: outcome.eventsCreated,
        eventsDeduplicated: outcome.eventsDeduplicated,
        error: outcome.error ?? null,
      }
    },

    async getLastMonitorRun(orgId: string, monitorKey: string) {
      const runs = monitorRuns.filter((r) => r.orgId === orgId && r.monitorKey === monitorKey && r.completedAt !== null)
      if (runs.length === 0) return null
      return runs.sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))[0]
    },

    async getMonitorScheduleMinutes(_orgId: string, monitorKey: string, defaultMinutes: number) {
      return scheduleMinutesByKey[monitorKey] ?? defaultMinutes
    },

    async getMonitorConfigNumber(_orgId: string, configKey: string, defaultValue: number) {
      return configNumbersByKey[configKey] ?? defaultValue
    },

    getState() {
      return { events: [...events], monitorRuns: [...monitorRuns] }
    },
  }

  return store
}
