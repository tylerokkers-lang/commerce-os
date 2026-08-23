import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { runDueMonitors, type SubjectProvider } from '@/lib/monitoring/runner'
import { runWorkerBatch } from '@/lib/automation/worker'
import type { SupplierMonitorSubject } from '@/lib/monitoring/monitors/supplierMonitor'

const ORG_A = 'org-a'
const PRODUCT_ID = 'prod-1'
const SUPPLIER_ID = 'sup-1'
const CHANNEL_PRODUCT_ID = 'cp-1'

/**
 * The flagship Milestone 8 acceptance test (brief's final acceptance
 * criterion): the *entire* chain, through real entry points only —
 *
 *   runDueMonitors (M8)
 *     -> domain event (SUPPLIER_PRICE_INCREASED)
 *     -> automation job (supplier_price_change)
 *   runWorkerBatch (M6/M7)
 *     -> handleSupplierPriceChange -> audit + chained job (product_profitability_recheck)
 *   runWorkerBatch again
 *     -> handleProductProfitabilityRecheck -> live facts -> calculateProfitability
 *     -> automation action + policy decision + notification
 *
 * No individual function is called directly outside these two real
 * entry points — this is deliberately not a unit test of any one layer.
 */
describe('Milestone 8 flagship: monitor -> event -> job -> worker -> facts -> policy -> action -> audit -> notification', () => {
  it('a genuine supplier price increase flows end to end through real entry points only', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    // Interval forced to 0 so the second `runDueMonitors` call below is due
    // immediately — real time elapses in milliseconds between the two
    // calls, not the monitor's real 15-minute default interval, and this
    // test is proving the chain, not the scheduling gap covered by
    // tests/monitoring-scheduler.test.ts.
    const events = createInMemoryEventStore({ scheduleMinutesByKey: { supplier_stock_and_price: 0 } })

    const priceIncreaseFacts = createInMemoryFactsLoader({
      products: { [PRODUCT_ID]: { title: 'Magnetic Knife Rail', category: 'kitchen', stage: 'live', updatedAt: new Date().toISOString() } },
      offers: { [`${SUPPLIER_ID}:${PRODUCT_ID}`]: { unitCost: fromMajor(10.76), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } },
    })
    const baselineFacts = createInMemoryFactsLoader({
      offers: { [`${SUPPLIER_ID}:${PRODUCT_ID}`]: { unitCost: fromMajor(9.1), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } },
    })

    const subject: SupplierMonitorSubject = { supplierId: SUPPLIER_ID, productId: PRODUCT_ID, channelProductId: CHANNEL_PRODUCT_ID, entityId: PRODUCT_ID }
    const subjectsFor: SubjectProvider = async (_orgId, monitorKey) => (monitorKey === 'supplier_stock_and_price' ? [subject] : [])

    // Step 1: establish the baseline observation — the monitor's first-ever
    // look at this supplier/product pair, £9.10/unit.
    await runDueMonitors({
      orgId: ORG_A, store, events, facts: baselineFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS,
      subjectsFor, monitorKeys: ['supplier_stock_and_price'],
    })
    expect(events.getState().events).toHaveLength(0) // No event on the very first observation.

    // Step 2: the supplier's real price rises to £10.76/unit (brief's
    // demo scenario 1) and the monitor runs again — genuinely due, since
    // no interval has been configured to block it in this test.
    await runDueMonitors({
      orgId: ORG_A, store, events, facts: priceIncreaseFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS,
      subjectsFor, monitorKeys: ['supplier_stock_and_price'],
    })

    const priceEvent = events.getState().events.find((e) => e.eventType === 'SUPPLIER_PRICE_INCREASED')
    expect(priceEvent).toBeTruthy()
    expect(priceEvent!.status).toBe('open')
    expect(priceEvent!.previousValue).toMatchObject({ unitCostMinor: fromMajor(9.1).minor })
    expect(priceEvent!.currentValue).toMatchObject({ unitCostMinor: fromMajor(10.76).minor })

    const priceChangeJob = store.getState().jobs.find((j) => j.jobType === 'supplier_price_change')
    expect(priceChangeJob).toBeTruthy()
    expect(priceChangeJob!.correlationId).toBe(priceEvent!.id) // Traceable: job carries the event's id as its correlation id.

    // Step 3: the real worker claims and runs the supplier_price_change job.
    // `maxJobs: 1` here so each stage of the chain is asserted on
    // separately below — `runWorkerBatch` would otherwise drain the whole
    // chain (including the job this step itself enqueues) in one call,
    // which the final assertion of this test relies on and proves too.
    const batch1 = await runWorkerBatch(store, priceIncreaseFacts, () => undefined, 'worker-1', 1)
    expect(batch1.claimed).toBe(1)
    expect(batch1.succeeded).toBe(1)

    const recheckJob = store.getState().jobs.find((j) => j.jobType === 'product_profitability_recheck')
    expect(recheckJob).toBeTruthy() // handleSupplierPriceChange chained this job itself.
    expect(recheckJob!.correlationId).toBe(priceChangeJob!.correlationId) // Correlation id survives the chain.

    const priceChangeAudit = store.getState().auditLog.find((a) => a.action === 'AUTOMATION_ACTION_CREATED' && a.entityId === `${SUPPLIER_ID}:${PRODUCT_ID}`)
    expect(priceChangeAudit?.reason).toContain('Supplier cost changed')

    // Step 4: the real worker claims and runs the chained profitability
    // recheck job — this is where calculateProfitability (the one
    // profitability engine) actually runs, against live facts.
    const batch2 = await runWorkerBatch(store, priceIncreaseFacts, () => undefined, 'worker-1', 1)
    expect(batch2.claimed).toBe(1)
    expect(batch2.succeeded).toBe(1)

    const action = store.getState().actions.find((a) => a.entityId === PRODUCT_ID && a.actionType === 'update_price')
    expect(action).toBeTruthy()
    expect(action!.jobId).toBe(recheckJob!.id)
    expect(action!.inputFacts).toMatchObject({ unitCostMinor: fromMajor(10.76).minor })
    expect(action!.status).toBe('succeeded')

    // A real consequence is visible: the recheck recorded either an
    // "allow_automatic: none" outcome or an actual required-approval /
    // pause recommendation — never silently nothing.
    expect(['allow_automatic', 'require_approval']).toContain(action!.policyResult.outcome)

    const notified = store.getState().notifications.some((n) => n.category === 'profitability' || n.dedupeKey === `action:${action!.id}`)
    // A "none" recommendation intentionally sends no notification (avoiding
    // spam per the brief) — only assert a notification when the recheck
    // actually found something worth surfacing.
    if (action!.decision.recommendation !== 'none') {
      expect(notified).toBe(true)
    }

    // Step 5: the chain terminates — it does not loop indefinitely. The
    // profitability recheck may itself chain one further, genuinely
    // different job (e.g. `product_price_review` when the recommendation
    // calls for it), but draining the queue must reach empty, never cycle.
    const batch3 = await runWorkerBatch(store, priceIncreaseFacts, () => undefined, 'worker-1', 10)
    expect(batch3.claimed).toBeLessThanOrEqual(1)
    const batch3b = await runWorkerBatch(store, priceIncreaseFacts, () => undefined, 'worker-1', 10)
    expect(batch3b.claimed).toBe(0) // The queue is now genuinely empty.

    // Step 6: running the same monitor tick again against the identical
    // condition must not re-fire the whole chain (brief's deduplication
    // requirement, proven here at the full-chain level, not just the event
    // layer in isolation).
    const repeatSummaries = await runDueMonitors({
      orgId: ORG_A, store, events, facts: priceIncreaseFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS,
      subjectsFor, monitorKeys: ['supplier_stock_and_price'],
    })
    expect(repeatSummaries[0].eventsCreated).toBe(0)
    expect(store.getState().jobs.filter((j) => j.jobType === 'supplier_price_change')).toHaveLength(1) // Still just the one from step 2.

    // The full audit trail is inspectable end to end: monitor run history,
    // the event, both jobs, the automation action, and the audit log all
    // trace back to each other via ids the brief requires be retrievable
    // for a future "why did this happen" question.
    const run = await events.getLastMonitorRun(ORG_A, 'supplier_stock_and_price')
    expect(run?.status).toBe('success')
    expect(run?.eventsCreated).toBe(0) // The repeat run's own completed record.
  })

  it('unknown supplier data never reaches the profitability engine or triggers an automated action (brief scenario 4)', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const noFacts = createInMemoryFactsLoader() // No seeded offer at all -> the connector/feed is "down".

    const subject: SupplierMonitorSubject = { supplierId: SUPPLIER_ID, productId: PRODUCT_ID, channelProductId: CHANNEL_PRODUCT_ID, entityId: PRODUCT_ID }
    const subjectsFor: SubjectProvider = async () => [subject]

    await runDueMonitors({ orgId: ORG_A, store, events, facts: noFacts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, subjectsFor, monitorKeys: ['supplier_stock_and_price'] })

    const event = events.getState().events[0]
    expect(event.eventType).toBe('SUPPLIER_FEED_FAILED')
    expect(event.eventType).not.toBe('SUPPLIER_OUT_OF_STOCK')

    // No automation job was ever enqueued for this — an unknown state gets
    // an event and (in production) a notification, never a guessed action.
    expect(store.getState().jobs).toHaveLength(0)

    const batch = await runWorkerBatch(store, noFacts, () => undefined, 'worker-1', 10)
    expect(batch.claimed).toBe(0)
    expect(store.getState().actions).toHaveLength(0)
  })
})
