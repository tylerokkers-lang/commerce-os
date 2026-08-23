import { describe, expect, it } from 'vitest'
import { decideWebhookIngest, partitionWebhookBatch, type IncomingWebhookEvent } from '@/lib/marketplaces/webhooks'

function event(over: Partial<IncomingWebhookEvent> = {}): IncomingWebhookEvent {
  return {
    channelId: 'chan-1',
    eventType: 'orders/create',
    externalEventId: 'evt-1',
    payload: { orderId: '123' },
    ...over,
  }
}

describe('idempotent webhook ingestion', () => {
  it('processes a genuinely new event', () => {
    const decision = decideWebhookIngest(event(), new Set())
    expect(decision.outcome).toBe('process')
    expect(decision.row.status).toBe('received')
  })

  it('ignores a duplicate delivery of an already-recorded event', () => {
    const decision = decideWebhookIngest(event(), new Set(['evt-1']))
    expect(decision.outcome).toBe('duplicate_ignored')
    expect(decision.row.status).toBe('ignored_duplicate')
  })

  it('still records a row for a duplicate, so the redelivery itself is auditable', () => {
    const decision = decideWebhookIngest(event(), new Set(['evt-1']))
    expect(decision.row.external_event_id).toBe('evt-1')
    expect(decision.row.channel_id).toBe('chan-1')
  })

  it('explains why in the reason field', () => {
    const processed = decideWebhookIngest(event(), new Set())
    expect(processed.reason).toMatch(/accepted for processing/)

    const duplicate = decideWebhookIngest(event(), new Set(['evt-1']))
    expect(duplicate.reason).toMatch(/already been recorded/)
  })

  it('treats events with different ids as distinct even if the type matches', () => {
    const decision = decideWebhookIngest(event({ externalEventId: 'evt-2' }), new Set(['evt-1']))
    expect(decision.outcome).toBe('process')
  })
})

describe('duplicate webhook in a batch', () => {
  it('splits a batch into new events and duplicates against prior history', () => {
    const { toProcess, duplicates } = partitionWebhookBatch(
      [event({ externalEventId: 'evt-1' }), event({ externalEventId: 'evt-2' })],
      new Set(['evt-1']),
    )
    expect(toProcess.map((e) => e.externalEventId)).toEqual(['evt-2'])
    expect(duplicates.map((e) => e.externalEventId)).toEqual(['evt-1'])
  })

  it('treats a repeated id within the same batch as a duplicate, even with no prior history', () => {
    // A burst redelivery can arrive as two events in one batch without either
    // having touched the database yet.
    const { toProcess, duplicates } = partitionWebhookBatch(
      [event({ externalEventId: 'evt-1' }), event({ externalEventId: 'evt-1' })],
      new Set(),
    )
    expect(toProcess).toHaveLength(1)
    expect(duplicates).toHaveLength(1)
  })

  it('processes every event when none are duplicates', () => {
    const { toProcess, duplicates } = partitionWebhookBatch(
      [event({ externalEventId: 'evt-1' }), event({ externalEventId: 'evt-2' })],
      new Set(),
    )
    expect(toProcess).toHaveLength(2)
    expect(duplicates).toHaveLength(0)
  })
})
