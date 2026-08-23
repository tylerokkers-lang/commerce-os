import 'server-only'

import { randomUUID } from 'node:crypto'
import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { CreateEventInput, EventStatus, EventStore, MonitorRunRecord, MonitorRunStatus, ObservationRecord, ObservationStatus } from './eventTypes'

/**
 * The production `EventStore`: real queries against `domain_events`,
 * `monitor_observations` and `monitor_runs` (migration 0022). Deduplication
 * is enforced by the database's own partial unique index
 * (`domain_events_open_dedupe_idx`) — this module attempts the insert and
 * treats a unique-violation (Postgres code 23505) as "already open," the
 * same "the constraint is the guarantee" pattern
 * `automation/actions.ts`/`jobs.ts` already use.
 */
export function getSupabaseEventStore(): EventStore {
  return {
    async getObservation(orgId, monitorKey, subjectType, subjectId): Promise<ObservationRecord | null> {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('monitor_observations')
        .select('status, value, last_checked_at')
        .eq('org_id', orgId)
        .eq('monitor_key', monitorKey)
        .eq('subject_type', subjectType)
        .eq('subject_id', subjectId)
        .maybeSingle()
      if (!data) return null
      return { status: data.status as ObservationStatus, value: (data.value ?? {}) as Record<string, unknown>, lastCheckedAt: data.last_checked_at }
    },

    async upsertObservation(orgId, monitorKey, subjectType, subjectId, observation): Promise<void> {
      const supabase = createServiceSupabase()
      await supabase.from('monitor_observations').upsert(
        {
          org_id: orgId,
          monitor_key: monitorKey,
          subject_type: subjectType,
          subject_id: subjectId,
          status: observation.status,
          value: observation.value as never,
          last_checked_at: observation.lastCheckedAt ?? new Date().toISOString(),
        },
        { onConflict: 'org_id,monitor_key,subject_type,subject_id' },
      )
    },

    async createEvent(input: CreateEventInput): Promise<{ id: string; deduplicated: boolean }> {
      const supabase = createServiceSupabase()
      const correlationId = input.correlationId ?? randomUUID()

      const { data, error } = await supabase
        .from('domain_events')
        .insert({
          org_id: input.orgId,
          event_type: input.eventType,
          subject_type: input.subjectType,
          subject_id: input.subjectId ?? null,
          source: input.source,
          source_connector_key: input.sourceConnectorKey ?? null,
          source_observation_id: input.sourceObservationId ?? null,
          severity: input.severity ?? 'info',
          previous_value: (input.previousValue ?? null) as never,
          current_value: (input.currentValue ?? null) as never,
          facts: (input.facts ?? {}) as never,
          metadata: (input.metadata ?? {}) as never,
          dedupe_key: input.dedupeKey ?? null,
          correlation_id: correlationId,
          causation_id: input.causationId ?? null,
          monitor_run_id: input.monitorRunId ?? null,
        })
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505' && input.dedupeKey) {
          const { data: existing } = await supabase
            .from('domain_events')
            .select('id')
            .eq('org_id', input.orgId)
            .eq('dedupe_key', input.dedupeKey)
            .eq('status', 'open')
            .maybeSingle()
          if (existing) return { id: existing.id, deduplicated: true }
        }
        throw new Error(`Could not create domain event: ${error.message}`)
      }

      await recordAudit({
        orgId: input.orgId,
        action: 'AUTOMATION_ACTION_CREATED',
        entityType: input.subjectType,
        entityId: input.subjectId ?? undefined,
        actorType: 'system',
        reason: `Event ${input.eventType} created (${input.source}).`,
        metadata: { domainEventId: data.id, eventType: input.eventType, correlationId },
      })

      return { id: data.id, deduplicated: false }
    },

    async resolveEvent(eventId: string, status: Exclude<EventStatus, 'open' | 'processing'>, supersededBy?: string): Promise<void> {
      const supabase = createServiceSupabase()
      const { data, error } = await supabase
        .from('domain_events')
        .update({ status, superseded_by: supersededBy ?? null })
        .eq('id', eventId)
        .select('org_id, subject_type, subject_id')
        .single()
      if (error) throw new Error(`Could not resolve event ${eventId}: ${error.message}`)

      await recordAudit({
        orgId: data.org_id,
        action: 'AUTOMATION_ACTION_EXECUTED',
        entityType: data.subject_type,
        entityId: data.subject_id ?? undefined,
        actorType: 'system',
        reason: `Event ${eventId} resolved as ${status}.`,
        metadata: { domainEventId: eventId, status },
      })
    },

    async markEventProcessing(eventId: string, automationJobId?: string): Promise<void> {
      const supabase = createServiceSupabase()
      await supabase.from('domain_events').update({ status: 'processing', automation_job_id: automationJobId ?? null }).eq('id', eventId)
    },

    async startMonitorRun(orgId: string, monitorKey: string, correlationId?: string): Promise<{ id: string }> {
      const supabase = createServiceSupabase()
      const { data, error } = await supabase
        .from('monitor_runs')
        .insert({ org_id: orgId, monitor_key: monitorKey, correlation_id: correlationId ?? randomUUID() })
        .select('id')
        .single()
      if (error) throw new Error(`Could not start monitor run: ${error.message}`)
      return { id: data.id }
    },

    async completeMonitorRun(runId, outcome): Promise<void> {
      const supabase = createServiceSupabase()
      await supabase
        .from('monitor_runs')
        .update({
          status: outcome.status,
          completed_at: new Date().toISOString(),
          subjects_checked: outcome.subjectsChecked,
          observations_created: outcome.observationsCreated,
          events_created: outcome.eventsCreated,
          events_deduplicated: outcome.eventsDeduplicated,
          error: outcome.error ?? null,
        })
        .eq('id', runId)
    },

    async getLastMonitorRun(orgId: string, monitorKey: string): Promise<MonitorRunRecord | null> {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('monitor_runs')
        .select('*')
        .eq('org_id', orgId)
        .eq('monitor_key', monitorKey)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      return {
        id: data.id,
        orgId: data.org_id,
        monitorKey: data.monitor_key,
        status: data.status,
        startedAt: data.started_at,
        completedAt: data.completed_at,
        subjectsChecked: data.subjects_checked,
        observationsCreated: data.observations_created,
        eventsCreated: data.events_created,
        eventsDeduplicated: data.events_deduplicated,
        error: data.error,
        correlationId: data.correlation_id,
      }
    },

    async getMonitorScheduleMinutes(orgId: string, monitorKey: string, defaultMinutes: number): Promise<number> {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('config_values')
        .select('value')
        .eq('org_id', orgId)
        .eq('key', `monitor_schedule:${monitorKey}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      const value = data?.value as { intervalMinutes?: number } | undefined
      return typeof value?.intervalMinutes === 'number' && value.intervalMinutes > 0 ? value.intervalMinutes : defaultMinutes
    },

    async getMonitorConfigNumber(orgId: string, configKey: string, defaultValue: number): Promise<number> {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('config_values')
        .select('value')
        .eq('org_id', orgId)
        .eq('key', configKey)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      const value = data?.value as { value?: number } | undefined
      return typeof value?.value === 'number' ? value.value : defaultValue
    },
  }
}

export type { MonitorRunStatus }
