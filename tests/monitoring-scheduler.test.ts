import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { runDueMonitors, type SubjectProvider } from '@/lib/monitoring/runner'
import type { SupplierMonitorSubject } from '@/lib/monitoring/monitors/supplierMonitor'

const ORG_A = 'org-a'
const SUPPLIER_KEY = 'supplier_stock_and_price'

function makeInputs(overrides: { subjectsFor?: SubjectProvider; scheduleMinutesByKey?: Record<string, number> } = {}) {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore({ scheduleMinutesByKey: overrides.scheduleMinutesByKey })
  const facts = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
  const subject: SupplierMonitorSubject = { supplierId: 'sup-1', productId: 'prod-1', channelProductId: 'cp-1', entityId: 'prod-1' }
  const subjectsFor: SubjectProvider = overrides.subjectsFor ?? (async (_orgId, monitorKey) => ({ subjects: monitorKey === SUPPLIER_KEY ? [subject] : [], errors: [] }))
  return { store, events, facts, subjectsFor }
}

describe('runDueMonitors', () => {
  afterEach(() => {
    vi.useRealTimers()
  })


  it('a monitor with no prior run is due immediately and its run is recorded', async () => {
    const { store, events, facts, subjectsFor } = makeInputs()
    const summaries = await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ monitorKey: SUPPLIER_KEY, ran: true, subjectsChecked: 1 })

    const run = await events.getLastMonitorRun(ORG_A, SUPPLIER_KEY)
    expect(run?.status).toBe('success')
    expect(run?.subjectsChecked).toBe(1)
  })

  it('a monitor run just now is not due again before its interval elapses', async () => {
    const { store, events, facts, subjectsFor } = makeInputs({ scheduleMinutesByKey: { [SUPPLIER_KEY]: 15 } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })

    vi.setSystemTime(new Date('2026-08-23T12:05:00Z')) // Only 5 of 15 minutes elapsed.
    const summaries = await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })

    expect(summaries[0]).toMatchObject({ monitorKey: SUPPLIER_KEY, ran: false, reason: 'not due' })
  })

  it('a monitor becomes due again once its configured interval has elapsed', async () => {
    const { store, events, facts, subjectsFor } = makeInputs({ scheduleMinutesByKey: { [SUPPLIER_KEY]: 15 } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })

    vi.setSystemTime(new Date('2026-08-23T12:16:00Z'))
    const summaries = await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })

    expect(summaries[0]).toMatchObject({ monitorKey: SUPPLIER_KEY, ran: true })
  })

  it('an unregistered monitor key is reported, never silently skipped', async () => {
    const { store, events, facts, subjectsFor } = makeInputs()
    const summaries = await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['no_such_monitor'] })
    expect(summaries[0]).toMatchObject({ monitorKey: 'no_such_monitor', ran: false, reason: 'not registered' })
  })

  it('a subject-level failure is recorded as partial_success, not success, and never hides the error', async () => {
    const { store, events, facts } = makeInputs()
    const subjectsFor: SubjectProvider = async () => ({
      subjects: [
        { supplierId: 'sup-1', productId: 'prod-1', channelProductId: 'cp-1', entityId: 'prod-1' },
        { supplierId: 'sup-1', productId: 'prod-broken', channelProductId: 'cp-2', entityId: 'prod-broken' },
      ],
      errors: [],
    })
    const brokenFacts = { ...facts, loadSupplierFactsForProduct: async (_orgId: string, _supplierId: string, productId: string) => {
      if (productId === 'prod-broken') throw new Error('feed exploded')
      return facts.loadSupplierFactsForProduct(_orgId, _supplierId, productId)
    } }

    const summaries = await runDueMonitors({ orgId: ORG_A, store, events, facts: brokenFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })
    expect(summaries[0].ran).toBe(true)
    expect(summaries[0].errors).toHaveLength(1)

    const run = await events.getLastMonitorRun(ORG_A, SUPPLIER_KEY)
    expect(run?.status).toBe('partial_success')
    expect(run?.error).toContain('feed exploded')
  })

  it('every subject failing is recorded as failed, never success', async () => {
    const { store, events, facts } = makeInputs()
    const subjectsFor: SubjectProvider = async () => ({ subjects: [{ supplierId: 'sup-1', productId: 'prod-broken', channelProductId: 'cp-1', entityId: 'prod-broken' }], errors: [] })
    const brokenFacts = { ...facts, loadSupplierFactsForProduct: async () => { throw new Error('total outage') } }

    await runDueMonitors({ orgId: ORG_A, store, events, facts: brokenFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })
    const run = await events.getLastMonitorRun(ORG_A, SUPPLIER_KEY)
    expect(run?.status).toBe('failed')
  })

  it('a thrown failure enumerating subjects (e.g. the database itself is unreachable) is recorded as a failed run, never crashes the sweep or leaves the run stuck at "running"', async () => {
    const { store, events, facts } = makeInputs()
    const subjectsFor: SubjectProvider = async () => { throw new Error('subject enumeration exploded') }

    const summaries = await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })
    expect(summaries[0]).toMatchObject({ monitorKey: SUPPLIER_KEY, ran: true, errors: ['subject enumeration exploded'] })

    const run = await events.getLastMonitorRun(ORG_A, SUPPLIER_KEY)
    expect(run?.status).toBe('failed')
    expect(run?.error).toBe('subject enumeration exploded')
  })

  it('one source failing during discovery (supplier B) does not lose supplier A or C, and is reported as partial_success, never success', async () => {
    const { store, events, facts } = makeInputs()
    const subjectsFor: SubjectProvider = async () => ({
      subjects: [
        { supplierId: 'sup-a', productId: 'prod-a', channelProductId: 'cp-a', entityId: 'prod-a' },
        { supplierId: 'sup-c', productId: 'prod-c', channelProductId: 'cp-c', entityId: 'prod-c' },
      ],
      errors: ['sup-b: connector timed out'],
    })

    const summaries = await runDueMonitors({ orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY] })
    expect(summaries[0].ran).toBe(true)
    expect(summaries[0].subjectsChecked).toBe(2) // A and C were not silently discarded.
    expect(summaries[0].errors).toContain('sup-b: connector timed out')

    const run = await events.getLastMonitorRun(ORG_A, SUPPLIER_KEY)
    expect(run?.status).toBe('partial_success') // Never "success" — B's failure is not invisible.
  })

  it('two organisations are scheduled independently — one being due does not affect the other', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { 'org-a': DEMO_AUTOMATION_SETTINGS, 'org-b': DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore({ scheduleMinutesByKey: { [SUPPLIER_KEY]: 15 } })
    const facts = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const subjectsFor: SubjectProvider = async () => ({ subjects: [{ supplierId: 'sup-1', productId: 'prod-1', channelProductId: 'cp-1', entityId: 'prod-1' }], errors: [] })
    const now = new Date('2026-08-23T12:00:00Z')

    await runDueMonitors({ orgId: 'org-a', store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY], now })
    const summariesB = await runDueMonitors({ orgId: 'org-b', store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: [SUPPLIER_KEY], now })

    expect(summariesB[0]).toMatchObject({ ran: true }) // org-b has never run this monitor before, so it is due despite org-a just having run.
  })
})
