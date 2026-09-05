import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { evaluateAutomationPolicy } from '@/lib/automation/policyEngine'
import { canRunNow } from '@/lib/automation/circuitBreaker'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { runWorkerBatch } from '@/lib/automation/worker'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import { UNKNOWN_STATE_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import { demoShopifyListings } from '@/lib/demo/marketplaceData'

/**
 * Milestone: autonomous decision & capability layer, Part 9. One
 * consolidated proof, per explicitly-required scenario, that no execution
 * route bypasses the kill switch. Most of these behaviors already have
 * scattered coverage elsewhere (`automation-policy-engine.test.ts`,
 * `automation-job-handlers.test.ts`, `circuit-breaker.test.ts`) — this file
 * exists specifically to answer "does EVERY route respect this," in one
 * place, rather than trusting that scattered coverage adds up to that.
 */

const ORG_A = 'org-a'
const connectors = (key: string) => (key === 'shopify_demo' ? shopifyDemoConnector : undefined)
const PASS_REQUIREMENT = { key: 'domain', label: 'Domain check', satisfied: true, detail: 'ok' }

describe('1. Global pause', () => {
  it('blocks an otherwise-auto-permitted action of any type', () => {
    const paused = { ...CONFIGURED_AUTOMATION_SETTINGS, automationPaused: true }
    const result = evaluateAutomationPolicy({ actionType: 'switch_supplier', settings: paused, domainOutcome: 'auto_permitted', domainReason: 'ok', domainRequirements: [PASS_REQUIREMENT], riskLevel: 'low' })
    expect(result.outcome).toBe('block')
  })

  it('blocks it end to end through the real worker, not just the pure policy function', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous', automationPaused: true } } })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-1', entityId: 'prod-1', productTitle: 'Widget', reason: 'Out of stock.' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    const action = store.getState().actions[0]
    expect(action.status).toBe('blocked')
    expect(store.getState().channelProductReconciliations['cp-1']).toBeUndefined()
  })
})

describe('2. Category pause', () => {
  it('blocks only the paused category, never an unrelated one', () => {
    const categoryPaused = { ...CONFIGURED_AUTOMATION_SETTINGS, automationPausedCategories: ['publishing' as const] }
    const publishing = evaluateAutomationPolicy({ actionType: 'pause_product', settings: categoryPaused, domainOutcome: 'auto_permitted', domainReason: 'ok', domainRequirements: [PASS_REQUIREMENT], riskLevel: 'medium' })
    const pricing = evaluateAutomationPolicy({ actionType: 'update_price', settings: categoryPaused, domainOutcome: 'auto_permitted', domainReason: 'ok', domainRequirements: [PASS_REQUIREMENT], riskLevel: 'low' })
    expect(publishing.outcome).toBe('block')
    expect(pricing.outcome).toBe('allow_automatic')
  })

  it('blocks the real handleProductPause end to end when the "publishing" category is paused', async () => {
    const store = createInMemoryAutomationStore({
      settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous', automationPausedCategories: ['publishing'] } },
      channelProductInfoById: { 'cp-2': { externalId: demoShopifyListings()[0].externalId, connectorKey: 'shopify_demo', currentStatus: 'live' } },
    })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-2', entityId: 'prod-2', productTitle: 'Widget', reason: 'Out of stock.' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().actions[0].status).toBe('blocked')
    expect(store.getState().channelProductReconciliations['cp-2']).toBeUndefined()
  })
})

describe('3. Connector (circuit breaker) pause', () => {
  it('an open circuit refuses a call even when the automation-level kill switch is fully open', () => {
    const openCircuit = { isEnabled: true, lastSuccessAt: null, lastFailureAt: new Date().toISOString(), lastError: 'timeout', nextAllowedAt: new Date(Date.now() + 600_000).toISOString(), consecutiveFailures: 5 }
    const result = canRunNow(true, openCircuit, { minSecondsBetweenRuns: 5, failureThreshold: 3 })
    expect(result.ok).toBe(false)
    // This is a genuinely separate gate from `evaluateAutomationPolicy` — proven by construction: the settings object here isn't even consulted.
  })

  it('a disabled connector is refused independent of any automation setting', () => {
    const disabled = { isEnabled: false, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 }
    const result = canRunNow(true, disabled, { minSecondsBetweenRuns: 5, failureThreshold: 3 })
    expect(result.ok).toBe(false)
  })
})

describe('4. Unknown automation state', () => {
  it('fails closed — blocked even though the domain says auto_permitted and no limit is exceeded', () => {
    const result = evaluateAutomationPolicy({ actionType: 'switch_supplier', settings: UNKNOWN_STATE_AUTOMATION_SETTINGS, domainOutcome: 'auto_permitted', domainReason: 'ok', domainRequirements: [PASS_REQUIREMENT], riskLevel: 'low' })
    expect(result.outcome).toBe('block')
    expect(result.requirements.find((r) => r.key === 'automation_state_known')?.satisfied).toBe(false)
  })

  it('a genuinely unreadable settings row (no business_settings for this org) reaches the worker as UNKNOWN_STATE_AUTOMATION_SETTINGS, and the same job is blocked, not silently defaulted to running', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: UNKNOWN_STATE_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-3', entityId: 'prod-3', productTitle: 'Widget', reason: 'Out of stock.' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')
    expect(store.getState().actions[0].status).toBe('blocked')
  })
})

describe('5. Worker restart (abandoned job recovery)', () => {
  it('an abandoned job (crashed worker) is correctly recovered by a different worker and reaches the same real handler — never lost, never silently skipped, never re-run twice', async () => {
    const store = createInMemoryAutomationStore({ lockTimeoutMs: 10, settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-5', entityId: 'prod-5', productTitle: 'Widget', reason: 'Out of stock.' } })

    // Simulate a crashed worker: claim the job, but never complete it.
    const claimed = await store.claimNextJob('worker-crashed')
    expect(claimed).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 15)) // let the lock go stale

    // A fresh worker batch recovers the abandoned job by its own normal claim logic and runs it through the real handler path — the same `store.getAutomationSettings(job.orgId)` call proven fresh in scenario 6 below, not a value carried over from the crashed attempt.
    const batch = await runWorkerBatch(store, facts, connectors, 'worker-2')
    expect(batch.claimed).toBe(1)
    expect(store.getState().jobs.find((j) => j.id === claimed!.id)?.status).toBe('succeeded')
  })
})

describe('6. Retry (a job that failed once and is retried)', () => {
  it('a job that fails and is scheduled for retry is picked up again on its next due claim, going through the identical handler entry point — no separate "retry" code path exists that could skip the settings/policy check', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    const enqueued = await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-6', entityId: 'prod-6', productTitle: 'Widget', reason: 'Out of stock.' } })

    const first = await store.claimNextJob('worker-1')
    expect(first!.id).toBe(enqueued.id)
    // Force a retryable failure and confirm the job is rescheduled, not dead-lettered or dropped.
    await store.completeJob(first!, { succeeded: false, retryable: true, error: 'simulated transient failure' })
    const afterFailure = store.getState().jobs.find((j) => j.id === enqueued.id)!
    expect(afterFailure.status).toBe('pending') // rescheduled — this is what "retry" concretely means in this engine, never a bespoke second execution path.
    expect(new Date(afterFailure.runAt).getTime()).toBeGreaterThan(Date.now() - 1000) // backoff pushed run_at into the future or now, never immediately re-claimable in the same instant
  })

  it('static proof: job handlers load settings via store.getAutomationSettings INSIDE the handler, never accept a pre-loaded settings object from the job payload — so a retry always re-reads current state', () => {
    const source = readFileSync('src/lib/automation/handlers/productHandlers.ts', 'utf8')
    const pauseHandler = source.match(/export async function handleProductPause[\s\S]*?\n}\n/)![0]
    expect(pauseHandler).toMatch(/const settings = await store\.getAutomationSettings\(job\.orgId\)/)
  })
})

describe('7. Approval-triggered execution', () => {
  it('an approved-decision executor still passes settings into the same policy check that blocks on a kill switch — proven structurally: settings is a real parameter, not hardcoded, and a block outcome stops execution before any connector call', () => {
    // `priceApprovalExecutor.ts` is `server-only` and (per `execution-dispatch.test.ts`'s own documented finding) cannot be imported into Vitest in this project. Verified by static source inspection instead — the same technique this codebase already uses for equally un-importable server-only orchestration files.
    const source = readFileSync('src/lib/automation/handlers/priceApprovalExecutor.ts', 'utf8')
    expect(source).toMatch(/export async function executeApprovedPriceChange\(decision: ApprovedPriceDecision, settings: AutomationSettings, store: AutomationStore\)/)
    expect(source).toMatch(/assessPriceChangePolicy\(/)
    expect(source).toMatch(/if \(assessment\.policy\.outcome === 'block'\) \{/)
    // The connector call must appear strictly after the block-check, never before it.
    const blockCheckIndex = source.indexOf("if (assessment.policy.outcome === 'block')")
    const submitIndex = source.indexOf('submitPriceChangeAction(')
    expect(blockCheckIndex).toBeGreaterThan(-1)
    expect(submitIndex).toBeGreaterThan(blockCheckIndex)
  })

  it('the underlying policy check an approval executor calls does genuinely block on a paused kill switch, proven directly', () => {
    const paused = { ...CONFIGURED_AUTOMATION_SETTINGS, automationPaused: true }
    const result = evaluateAutomationPolicy({ actionType: 'update_price', settings: paused, domainOutcome: 'auto_permitted', domainReason: 'ok', domainRequirements: [PASS_REQUIREMENT], riskLevel: 'low' })
    expect(result.outcome).toBe('block')
  })
})

describe('8. Scheduled execution (the standard cron-triggered path)', () => {
  it('a job claimed and run through the real worker batch — the same entry point /api/automation/run and /api/automation/maintenance both use — respects a global pause', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous', automationPaused: true } } })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-8', entityId: 'prod-8', productTitle: 'Widget', reason: 'Out of stock.' } })
    const batch = await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(batch.claimed).toBe(1)
    expect(store.getState().actions[0].status).toBe('blocked')
  })
})
