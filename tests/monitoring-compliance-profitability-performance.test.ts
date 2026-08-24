import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { complianceMonitor, type ComplianceMonitorSubject } from '@/lib/monitoring/monitors/complianceMonitor'
import { profitabilityMonitor, type ProfitabilityMonitorSubject } from '@/lib/monitoring/monitors/profitabilityMonitor'
import { performanceMonitor, type PerformanceMonitorSubject, type PerformanceWindow } from '@/lib/monitoring/monitors/performanceMonitor'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'

const ORG_A = 'org-a'

function makeCtx(offers?: Parameters<typeof createInMemoryFactsLoader>[0]) {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader(offers)
  const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
  return { ctx, store, events }
}

describe('compliance monitor', () => {
  const freshSubject: ComplianceMonitorSubject = {
    channelProductId: 'cp-1', productId: 'prod-1', channel: 'amazon_uk', supplierId: 'sup-1',
    context: { approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-1', daysSinceLastAssessment: 5, productDetailsChangedSinceApproval: false },
    complianceContext: {},
  }

  it('a fresh, unchanged-supplier assessment triggers no recheck', async () => {
    const { ctx, events } = makeCtx()
    await complianceMonitor.run(ctx, [freshSubject])
    expect(events.getState().events).toHaveLength(0)
  })

  it('a stale assessment triggers COMPLIANCE_ASSESSMENT_STALE and enqueues a recheck', async () => {
    const { ctx, events, store } = makeCtx()
    const staleSubject: ComplianceMonitorSubject = { ...freshSubject, context: { ...freshSubject.context, daysSinceLastAssessment: 120 } }
    const outcome = await complianceMonitor.run(ctx, [staleSubject])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('COMPLIANCE_ASSESSMENT_STALE')
    expect(store.getState().jobs.some((j) => j.jobType === 'product_compliance_recheck')).toBe(true)
  })

  it('a supplier substitution triggers COMPLIANCE_RECHECK_REQUIRED', async () => {
    const { ctx, events } = makeCtx()
    const switchedSupplier: ComplianceMonitorSubject = { ...freshSubject, context: { ...freshSubject.context, fulfillingSupplierId: 'sup-2' } }
    await complianceMonitor.run(ctx, [switchedSupplier])
    expect(events.getState().events[0].eventType).toBe('COMPLIANCE_RECHECK_REQUIRED')
  })

  it('repeated runs against the same stale condition deduplicate to one open event', async () => {
    const { ctx, events } = makeCtx()
    const staleSubject: ComplianceMonitorSubject = { ...freshSubject, context: { ...freshSubject.context, daysSinceLastAssessment: 120 } }
    await complianceMonitor.run(ctx, [staleSubject])
    await complianceMonitor.run(ctx, [staleSubject])
    expect(events.getState().events.filter((e) => e.status === 'open')).toHaveLength(1)
  })
})

describe('profitability safety-net monitor', () => {
  const subject: ProfitabilityMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1' }

  it('an unchanged supplier cost creates no event', async () => {
    const { ctx, events } = makeCtx({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    await profitabilityMonitor.run(ctx, [subject]) // Establish baseline.
    const outcome = await profitabilityMonitor.run(ctx, [subject]) // Unchanged.
    expect(outcome.eventsCreated).toBe(0)
    void events
  })

  it('a changed supplier cost triggers PRODUCT_PRICE_REVIEW_REQUIRED and enqueues a profitability recheck', async () => {
    const factsBefore = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts: factsBefore, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    await profitabilityMonitor.run(ctx, [subject])

    const factsAfter = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(10.76), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const outcome = await profitabilityMonitor.run({ ...ctx, facts: factsAfter }, [subject])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('PRODUCT_PRICE_REVIEW_REQUIRED')
    expect(store.getState().jobs.some((j) => j.jobType === 'product_profitability_recheck')).toBe(true)
  })

  it('unavailable supplier cost facts are skipped, never treated as unchanged or zero', async () => {
    const { ctx } = makeCtx() // No seeded offer.
    const outcome = await profitabilityMonitor.run(ctx, [subject])
    expect(outcome.eventsCreated).toBe(0)
    expect(outcome.observationsCreated).toBe(0)
  })

  it('a second genuine cost change is not swallowed by the first still-open event — oscillation regression', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const events = createInMemoryEventStore()
    const factsBaseline = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts: factsBaseline, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    await profitabilityMonitor.run(ctx, [subject]) // Baseline.

    const factsFirstChange = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(10.76), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    await profitabilityMonitor.run({ ...ctx, facts: factsFirstChange }, [subject]) // Event #1, left open.

    const factsSecondChange = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(13), shippingCost: fromMajor(2), stockQty: 40, inStock: true, lastVerifiedAt: new Date().toISOString() } } })
    const outcome = await profitabilityMonitor.run({ ...ctx, facts: factsSecondChange }, [subject]) // A further genuine rise.

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events.filter((e) => e.eventType === 'PRODUCT_PRICE_REVIEW_REQUIRED')).toHaveLength(2)
  })
})

describe('sales & performance monitor', () => {
  const window = (unitsSold: number, returnsCount = 0, adSpendMinor = 0): PerformanceWindow => ({
    unitsSold, revenueMinor: unitsSold * 1000, returnsCount, refundsCount: 0, adSpendMinor, windowStart: '2026-08-16', windowEnd: '2026-08-23',
  })

  it('a subject with no previous window is skipped — no popularity data is invented', async () => {
    const { ctx, events } = makeCtx()
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(100), previousWindow: null, adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events).toHaveLength(0)
  })

  it('a surge above the configured threshold creates PRODUCT_SALES_SURGING with the calculation basis stored', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'sales_performance:surge_threshold_pct': 50 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(100), previousWindow: window(40), adSpendLimitMinor: null }

    await performanceMonitor.run(ctx, [subject])
    const event = events.getState().events.find((e) => e.eventType === 'PRODUCT_SALES_SURGING')!
    expect(event).toBeTruthy()
    expect(event.facts.previousUnits).toBe(40)
    expect(event.facts.currentUnits).toBe(100)
  })

  it('a second surge from a new baseline is not swallowed by the first still-open surge event — oscillation regression', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'sales_performance:surge_threshold_pct': 50 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }

    const first: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(100), previousWindow: window(40), adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [first]) // Event #1, left open (nothing resolves a surge automatically).

    // Sales keep climbing before anyone acted on the first alert.
    const second: PerformanceMonitorSubject = { ...first, currentWindow: window(250) }
    const outcome = await performanceMonitor.run(ctx, [second])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events.filter((e) => e.eventType === 'PRODUCT_SALES_SURGING')).toHaveLength(2)
  })

  it('a decline beyond the threshold creates PRODUCT_SALES_DECLINING and enqueues a profitability recheck', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'sales_performance:decline_threshold_pct': -30 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date() }
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(20), previousWindow: window(100), adSpendLimitMinor: null }

    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events.some((e) => e.eventType === 'PRODUCT_SALES_DECLINING')).toBe(true)
    expect(store.getState().jobs.some((j) => j.jobType === 'product_profitability_recheck')).toBe(true)
  })

  it('a return-rate increase beyond the threshold creates PRODUCT_RETURN_RATE_INCREASED', async () => {
    const { ctx, events } = makeCtx()
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(100, 20), previousWindow: window(100, 5), adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events.some((e) => e.eventType === 'PRODUCT_RETURN_RATE_INCREASED')).toBe(true)
  })

  it('ad spend exceeding the configured limit creates AD_SPEND_EXCEEDED', async () => {
    const { ctx, events } = makeCtx()
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(100, 0, 10000), previousWindow: window(100), adSpendLimitMinor: 5000 }
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events.some((e) => e.eventType === 'AD_SPEND_EXCEEDED')).toBe(true)
  })

  it('a modest change within thresholds creates no event', async () => {
    const { ctx, events } = makeCtx()
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(105), previousWindow: window(100), adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events).toHaveLength(0)
  })

  it('revenue declining beyond the threshold creates REVENUE_DECLINED even when unit volume is flat', async () => {
    const { ctx, events } = makeCtx()
    const previous = { ...window(100), netRevenueMinor: 100000 }
    const current = { ...window(100), netRevenueMinor: 50000 } // Units flat, net revenue halved (e.g. heavy discounting).
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: current, previousWindow: previous, adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events.some((e) => e.eventType === 'REVENUE_DECLINED')).toBe(true)
  })

  it('velocity below the configured floor creates PRODUCT_UNDERPERFORMING, and recovering above it resolves with PRODUCT_SALES_RECOVERED', async () => {
    const { ctx, events } = makeCtx()
    const low = { ...window(1), salesVelocityPerDay: 0.1 }
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: low, previousWindow: window(1), adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events.some((e) => e.eventType === 'PRODUCT_UNDERPERFORMING' && e.status === 'open')).toBe(true)

    const healthy = { ...window(20), salesVelocityPerDay: 3 }
    const recoverySubject: PerformanceMonitorSubject = { ...subject, currentWindow: healthy }
    await performanceMonitor.run(ctx, [recoverySubject])
    expect(events.getState().events.some((e) => e.eventType === 'PRODUCT_SALES_RECOVERED')).toBe(true)
  })

  it('repeated runs while still underperforming deduplicate to one open event, not a flood', async () => {
    const { ctx, events } = makeCtx()
    const low = { ...window(1), salesVelocityPerDay: 0.1 }
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: low, previousWindow: window(1), adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [subject])
    await performanceMonitor.run(ctx, [subject])
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events.filter((e) => e.eventType === 'PRODUCT_UNDERPERFORMING' && e.status === 'open')).toHaveLength(1)
  })

  it('a product with no velocity data (not yet computed live) never triggers PRODUCT_UNDERPERFORMING — absence is not a guess', async () => {
    const { ctx, events } = makeCtx()
    const subject: PerformanceMonitorSubject = { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1', currentWindow: window(1), previousWindow: window(1), adSpendLimitMinor: null }
    await performanceMonitor.run(ctx, [subject])
    expect(events.getState().events.some((e) => e.eventType === 'PRODUCT_UNDERPERFORMING')).toBe(false)
  })
})
