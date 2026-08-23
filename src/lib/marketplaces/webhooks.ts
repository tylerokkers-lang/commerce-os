/**
 * Idempotent webhook ingestion.
 *
 * Every major marketplace's webhook documentation carries the same warning:
 * the same event can be delivered more than once, and a receiver must
 * tolerate that. `channel_webhook_events` enforces this at the database level
 * with `unique (org_id, channel_id, external_event_id)` — a duplicate
 * delivery fails to insert rather than being processed twice. This module is
 * the pure decision logic in front of that constraint: given an event and
 * what has already been recorded, decide whether to process it, and produce
 * the row to insert either way.
 */

export interface IncomingWebhookEvent {
  channelId: string
  eventType: string
  externalEventId: string
  payload: Record<string, unknown>
}

export type WebhookIngestOutcome = 'process' | 'duplicate_ignored'

export interface WebhookIngestDecision {
  outcome: WebhookIngestOutcome
  reason: string
  row: {
    channel_id: string
    event_type: string
    external_event_id: string
    payload: Record<string, unknown>
    status: 'received' | 'ignored_duplicate'
  }
}

/**
 * Decides what to do with an incoming event, given the set of external event
 * ids already recorded for this channel.
 *
 * A duplicate is still worth a row — recording "we saw this again and
 * correctly ignored it" is itself part of the audit trail — but its status is
 * `ignored_duplicate` rather than `received`, so a listing of events can tell
 * the two apart at a glance.
 */
export function decideWebhookIngest(
  event: IncomingWebhookEvent,
  alreadyRecordedExternalIds: ReadonlySet<string>,
): WebhookIngestDecision {
  const isDuplicate = alreadyRecordedExternalIds.has(event.externalEventId)

  return {
    outcome: isDuplicate ? 'duplicate_ignored' : 'process',
    reason: isDuplicate
      ? `Event ${event.externalEventId} (${event.eventType}) has already been recorded for this channel; ignoring the redelivery.`
      : `New event ${event.externalEventId} (${event.eventType}) accepted for processing.`,
    row: {
      channel_id: event.channelId,
      event_type: event.eventType,
      external_event_id: event.externalEventId,
      payload: event.payload,
      status: isDuplicate ? 'ignored_duplicate' : 'received',
    },
  }
}

/**
 * Filters a batch to the events genuinely worth acting on, in delivery order,
 * treating a repeated external id within the same batch as a duplicate too —
 * a burst-delivered retry does not get processed twice just because it never
 * touched the database in between.
 */
export function partitionWebhookBatch(
  events: readonly IncomingWebhookEvent[],
  alreadyRecordedExternalIds: ReadonlySet<string>,
): { toProcess: readonly IncomingWebhookEvent[]; duplicates: readonly IncomingWebhookEvent[] } {
  const seen = new Set(alreadyRecordedExternalIds)
  const toProcess: IncomingWebhookEvent[] = []
  const duplicates: IncomingWebhookEvent[] = []

  for (const event of events) {
    if (seen.has(event.externalEventId)) {
      duplicates.push(event)
    } else {
      seen.add(event.externalEventId)
      toProcess.push(event)
    }
  }

  return { toProcess, duplicates }
}
