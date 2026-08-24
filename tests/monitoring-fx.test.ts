import { describe, expect, it } from 'vitest'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { createInMemoryEventStore } from '@/lib/monitoring/inMemoryEventStore'
import { createInMemoryFxStore } from '@/lib/fx/inMemoryFxStore'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { fxMonitor, type FxPairSubject } from '@/lib/monitoring/monitors/fxMonitor'
import type { MonitorContext } from '@/lib/monitoring/eventTypes'
import type { ExchangeRateFact } from '@/lib/fx/types'

const ORG_A = 'org-a'
const SUBJECT: FxPairSubject = { base: 'GBP', quote: 'USD' }

function makeCtx(fxStore = createInMemoryFxStore()) {
  const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
  const events = createInMemoryEventStore()
  const facts = createInMemoryFactsLoader()
  const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore }
  return { ctx, store, events, fxStore }
}

function rate(overrides: Partial<ExchangeRateFact> = {}): ExchangeRateFact {
  return { base: 'GBP', quote: 'USD', rate: 1.27, source: 'demo', observedAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), ...overrides }
}

describe('FX monitor', () => {
  it('never observed at all reports FX_RATE_UNAVAILABLE, never a guessed rate', async () => {
    const { ctx, events } = makeCtx()
    const outcome = await fxMonitor.run(ctx, [SUBJECT])
    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('FX_RATE_UNAVAILABLE')
  })

  it('a stale rate (older than the automation freshness window) reports FX_RATE_STALE', async () => {
    const fxStore = createInMemoryFxStore()
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() // 24h old, automation window is 6h.
    await fxStore.recordRate(ORG_A, rate({ observedAt: old }))
    const { ctx, events } = makeCtx(fxStore)
    const outcome = await fxMonitor.run(ctx, [SUBJECT])
    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('FX_RATE_STALE')
  })

  it('a fresh rate creates no event, and establishes a baseline for movement detection', async () => {
    const fxStore = createInMemoryFxStore()
    await fxStore.recordRate(ORG_A, rate())
    const { ctx, events } = makeCtx(fxStore)
    const outcome = await fxMonitor.run(ctx, [SUBJECT])
    expect(outcome.eventsCreated).toBe(0)
    expect(events.getState().events).toHaveLength(0)
  })

  it('a significant movement beyond the configured threshold creates FX_RATE_SIGNIFICANT_MOVEMENT and enqueues fx_recheck', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'fx_rates:movement_threshold_pct': 3 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const fxStore = createInMemoryFxStore()
    await fxStore.recordRate(ORG_A, rate({ rate: 1.00 }))
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore }
    await fxMonitor.run(ctx, [SUBJECT]) // Baseline.

    await fxStore.recordRate(ORG_A, rate({ rate: 1.05 })) // +5%, above the 3% threshold.
    const outcome = await fxMonitor.run(ctx, [SUBJECT])

    expect(outcome.eventsCreated).toBe(1)
    expect(events.getState().events[0].eventType).toBe('FX_RATE_SIGNIFICANT_MOVEMENT')
    expect(store.getState().jobs.some((j) => j.jobType === 'fx_recheck')).toBe(true)
  })

  it('a movement below the threshold creates no event', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'fx_rates:movement_threshold_pct': 5 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const fxStore = createInMemoryFxStore()
    await fxStore.recordRate(ORG_A, rate({ rate: 1.00 }))
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore }
    await fxMonitor.run(ctx, [SUBJECT])

    await fxStore.recordRate(ORG_A, rate({ rate: 1.01 })) // +1%, below threshold.
    const outcome = await fxMonitor.run(ctx, [SUBJECT])
    expect(outcome.eventsCreated).toBe(0)
  })

  it('FX oscillation: 1.00 -> 1.05 -> 1.10 -> 1.03 must produce a fresh event for every genuine subsequent move, never swallowed by the first still-open event', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'fx_rates:movement_threshold_pct': 3 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const fxStore = createInMemoryFxStore()
    const ctx: MonitorContext = { orgId: ORG_A, store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore }

    await fxStore.recordRate(ORG_A, rate({ rate: 1.00 }))
    await fxMonitor.run(ctx, [SUBJECT]) // Baseline.

    await fxStore.recordRate(ORG_A, rate({ rate: 1.05 }))
    await fxMonitor.run(ctx, [SUBJECT]) // Move #1.

    await fxStore.recordRate(ORG_A, rate({ rate: 1.10 }))
    await fxMonitor.run(ctx, [SUBJECT]) // Move #2, same direction as #1.

    await fxStore.recordRate(ORG_A, rate({ rate: 1.03 }))
    await fxMonitor.run(ctx, [SUBJECT]) // Move #3, reverses direction.

    const movementEvents = events.getState().events.filter((e) => e.eventType === 'FX_RATE_SIGNIFICANT_MOVEMENT')
    expect(movementEvents).toHaveLength(3) // Every genuine move is visible — none silently absorbed into an earlier still-open event.
    expect(store.getState().jobs.filter((j) => j.jobType === 'fx_recheck')).toHaveLength(3)
  })

  it('recovering from unavailable to a fresh rate creates FX_RATE_RECOVERED', async () => {
    const fxStore = createInMemoryFxStore()
    const { ctx, events } = makeCtx(fxStore)
    await fxMonitor.run(ctx, [SUBJECT]) // Unavailable first.

    await fxStore.recordRate(ORG_A, rate())
    await fxMonitor.run(ctx, [SUBJECT])
    expect(events.getState().events.some((e) => e.eventType === 'FX_RATE_RECOVERED')).toBe(true)
  })

  it('rates for one organisation never leak into another organisation\'s movement detection', async () => {
    const events = createInMemoryEventStore({ configNumbersByKey: { 'fx_rates:movement_threshold_pct': 3 } })
    const store = createInMemoryAutomationStore({ settingsByOrg: { 'org-a': DEMO_AUTOMATION_SETTINGS, 'org-b': DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const fxStore = createInMemoryFxStore()
    await fxStore.recordRate('org-a', rate({ rate: 1.00 }))
    await fxStore.recordRate('org-b', rate({ rate: 5.00 })) // A wildly different baseline for org-b.

    const ctxA: MonitorContext = { orgId: 'org-a', store, events, facts, connectors: () => undefined, settings: DEMO_AUTOMATION_SETTINGS, now: new Date(), fxStore }
    await fxMonitor.run(ctxA, [SUBJECT])
    await fxStore.recordRate('org-a', rate({ rate: 1.05 }))
    const outcome = await fxMonitor.run(ctxA, [SUBJECT])

    // If org-b's rate leaked in as the "previous" baseline, this would
    // compute a nonsensical -79% change instead of the real +5%.
    expect(outcome.eventsCreated).toBe(1)
    const event = events.getState().events.find((e) => e.eventType === 'FX_RATE_SIGNIFICANT_MOVEMENT')
    expect(event?.facts.changePct).toBeCloseTo(5, 0)
  })
})
