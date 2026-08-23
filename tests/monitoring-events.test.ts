import { describe, expect, it } from 'vitest'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { isMonitorDue } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

describe('domain event lifecycle and deduplication', () => {
  it('creates a new open event when none exists for the dedupe key', async () => {
    const store = createInMemoryEventStore()
    const result = await store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })
    expect(result.deduplicated).toBe(false)
    const event = store.getState().events[0]
    expect(event.status).toBe('open')
  })

  it('deduplicates a second event for the same open condition', async () => {
    const store = createInMemoryEventStore()
    const first = await store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })
    const second = await store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })
    expect(second.deduplicated).toBe(true)
    expect(second.id).toBe(first.id)
    expect(store.getState().events).toHaveLength(1)
  })

  it('a new event can be created for the same dedupe key once the previous one is resolved', async () => {
    const store = createInMemoryEventStore()
    const first = await store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })
    await store.resolveEvent(first.id, 'processed')
    const second = await store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })
    expect(second.deduplicated).toBe(false)
    expect(second.id).not.toBe(first.id)
  })

  it('every lifecycle status is reachable and recorded, never silently disappearing', async () => {
    const store = createInMemoryEventStore()
    const ignored = await store.createEvent({ orgId: ORG_A, eventType: 'X', subjectType: 'y', source: 'internal' })
    await store.resolveEvent(ignored.id, 'ignored')
    const failed = await store.createEvent({ orgId: ORG_A, eventType: 'X', subjectType: 'y', source: 'internal' })
    await store.resolveEvent(failed.id, 'failed')
    const superseding = await store.createEvent({ orgId: ORG_A, eventType: 'X', subjectType: 'y', source: 'internal' })
    const superseded = await store.createEvent({ orgId: ORG_A, eventType: 'X', subjectType: 'y', source: 'internal' })
    await store.resolveEvent(superseded.id, 'superseded', superseding.id)
    await store.markEventProcessing(superseding.id, 'job-1')

    const statuses = store.getState().events.map((e) => e.status)
    expect(statuses).toContain('ignored')
    expect(statuses).toContain('failed')
    expect(statuses).toContain('processing')
    const supersededEvent = store.getState().events.find((e) => e.id === superseded.id)!
    expect(supersededEvent.status).toBe('superseded')
    expect(supersededEvent.supersededBy).toBe(superseding.id)
  })

  it('organisation isolation: the same dedupe key in two orgs never collides', async () => {
    const store = createInMemoryEventStore()
    const a = await store.createEvent({ orgId: ORG_A, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })
    const b = await store.createEvent({ orgId: ORG_B, eventType: 'SUPPLIER_OUT_OF_STOCK', subjectType: 'channel_product', subjectId: 'cp-1', source: 'external', dedupeKey: 'stock:cp-1' })
    expect(a.deduplicated).toBe(false)
    expect(b.deduplicated).toBe(false)
    expect(a.id).not.toBe(b.id)
  })

  it('every event carries a correlation id, generated if not supplied', async () => {
    const store = createInMemoryEventStore()
    const result = await store.createEvent({ orgId: ORG_A, eventType: 'X', subjectType: 'y', source: 'internal' })
    const event = store.getState().events.find((e) => e.id === result.id)!
    expect(event.correlationId).toBeTruthy()
  })

  it('observations distinguish ok, unavailable and unknown, never collapsing them', async () => {
    const store = createInMemoryEventStore()
    expect(await store.getObservation(ORG_A, 'm', 't', 's')).toBeNull() // unknown: never observed
    await store.upsertObservation(ORG_A, 'm', 't', 's', { status: 'unavailable', value: {}, lastCheckedAt: new Date().toISOString() })
    expect((await store.getObservation(ORG_A, 'm', 't', 's'))!.status).toBe('unavailable')
    await store.upsertObservation(ORG_A, 'm', 't', 's', { status: 'ok', value: { inStock: true }, lastCheckedAt: new Date().toISOString() })
    expect((await store.getObservation(ORG_A, 'm', 't', 's'))!.status).toBe('ok')
  })
})

describe('monitor due/not-due scheduling (pure)', () => {
  const now = new Date('2026-08-23T12:00:00Z')

  it('a monitor that has never run is always due', () => {
    expect(isMonitorDue(null, 15, now)).toBe(true)
  })

  it('a monitor is not due before its interval has elapsed', () => {
    const lastRun = new Date(now.getTime() - 5 * 60_000).toISOString()
    expect(isMonitorDue(lastRun, 15, now)).toBe(false)
  })

  it('a monitor becomes due exactly at its interval boundary', () => {
    const lastRun = new Date(now.getTime() - 15 * 60_000).toISOString()
    expect(isMonitorDue(lastRun, 15, now)).toBe(true)
  })

  it('a monitor is due well past its interval', () => {
    const lastRun = new Date(now.getTime() - 60 * 60_000).toISOString()
    expect(isMonitorDue(lastRun, 15, now)).toBe(true)
  })
})
