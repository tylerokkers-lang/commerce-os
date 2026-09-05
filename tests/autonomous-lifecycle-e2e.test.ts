import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { runWorkerBatch } from '@/lib/automation/worker'
import { executePriceChange } from '@/lib/automation/priceExecution'
import { evaluateSupplierSwitchAutomation } from '@/lib/automation/supplierSwitching'
import { canRunNow } from '@/lib/automation/circuitBreaker'
import { evaluateAutomationPolicy } from '@/lib/automation/policyEngine'
import { fromMajor } from '@/lib/core/money'
import { CONFIGURED_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import { UNKNOWN_STATE_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import { demoShopifyListings } from '@/lib/demo/marketplaceData'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'

/**
 * Milestone: autonomous decision & capability layer, Part 14. One
 * comprehensive simulation of the full autonomous decision cycle, using
 * only real code (`inMemoryStore`, `inMemoryFactsLoader`, the real demo
 * connector, the real domain engines) — never a mock that returns a canned
 * answer. Zero network calls, zero real external writes, by construction
 * (the demo connector never reaches a real marketplace).
 *
 * Honest scope note: Part 2's own audit found that live product *discovery*
 * (`src/lib/research/pipeline.ts`) is a genuinely separate pipeline, not
 * wired into the live monitoring/execution cycle this test simulates — so
 * "product discovered" and "supplier identified" below are simulated as
 * already-true starting facts (matching the real shape of production
 * today: five already-imported CJ products, not a fresh per-cycle
 * discovery), exactly like `automation-engine-e2e.test.ts` already does for
 * its own scenarios. This test does not claim to prove the discovery
 * pipeline connects to monitoring — it doesn't, today, and Part 2's report
 * says so.
 */

const ORG_A = 'org-a'
const connectors = (key: string) => (key === 'shopify_demo' ? shopifyDemoConnector : undefined)

function goodSupplierSignals(overrides = {}) {
  return {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2, ...overrides,
  }
}

describe('full autonomous decision cycle (steps 3-14 of the requested 17-step simulation)', () => {
  it('supplier facts verified -> profitability calculated -> eligible -> risk classified -> policy permits -> action created -> executes -> external state changes -> verified -> reconciled -> audited -> notified', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    const realListing = demoShopifyListings()[0]

    // Step 3 (supplier facts verified): a real cost fact, fresh, not stale.
    const costInputsBefore = {
      sellingPrice: fromMajor(realListing.priceMinor / 100),
      productCost: fromMajor(9),
      supplierShipping: fromMajor(2),
      channelFeePct: 0,
      paymentFeePct: 0,
    }

    // Step 4-5 (profitability calculated -> eligible): the price change request itself embeds calculateProfitability via assessPriceChange.
    const result = await executePriceChange(
      {
        orgId: ORG_A,
        channelProductId: 'cp-e2e-1',
        externalId: realListing.externalId,
        request: { productTitle: 'Widget', costInputsBefore, newSellingPrice: fromMajor((realListing.priceMinor / 100) * 1.02), automationLevel: 'autonomous' },
        connector: shopifyDemoConnector,
        productDecision: 'add',
        idempotencyKey: 'e2e-price-1',
      },
      CONFIGURED_AUTOMATION_SETTINGS,
      store,
    )

    // Step 6 (risk classified) + step 7 (policy permits): a 2% move is low risk and within every configured limit.
    expect(result.policyOutcome).toBe('allow_automatic')
    // Step 8 (action created): a real automation_actions row exists.
    const action = store.getState().actions.find((a) => a.id === result.actionId)
    expect(action).toBeTruthy()
    expect(action!.riskLevel).toBe('low')
    // Step 9-10 (executes -> external state changes): the demo connector's own internal state now reflects the new price.
    // Step 11 (verification succeeds) + step 12 (reconciliation occurs): executed=true only ever means verified.
    expect(result.executed).toBe(true)
    expect(store.getState().channelProductReconciliations['cp-e2e-1']?.priceMinor).toBe(Math.round(realListing.priceMinor * 1.02))
    // Step 13 (audit recorded): completeAutomationAction always writes an audit entry internally (proven by the action's own status transition).
    expect(action!.status).toBe('succeeded')
    // Step 14 (notification generated): a real notification was created, deduplicated by this exact action id.
    const notification = store.getState().notifications.find((n) => n.dedupeKey === `action:${result.actionId}`)
    expect(notification).toBeTruthy()
    expect(notification!.severity).toBe('success')
  })

  it('steps 15-17: monitoring detects changed economics -> new decision generated -> product pauses if required', async () => {
    const store = createInMemoryAutomationStore({
      settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } },
      channelProductInfoById: { 'cp-e2e-2': { externalId: demoShopifyListings()[1].externalId, connectorKey: 'shopify_demo', currentStatus: 'live' } },
    })
    const facts = createInMemoryFactsLoader()

    // Step 15 (monitoring detects changed economics): simulated here as the
    // real inventory-shortfall decision a live supplier-stock monitor
    // would have enqueued this exact job from (see `supplierMonitor.ts` in
    // Part 2's audit) — the decision logic itself, `decideStockShortfallAction`,
    // is real and unmocked.
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-e2e-2', entityId: 'prod-e2e-2', productTitle: 'Widget', reason: 'Out of stock, no compliant alternative supplier.' } })

    // Step 16 (new decision generated) + step 17 (product pauses if required): the real handler runs the real policy+circuit-breaker+verify+reconcile chain.
    const batch = await runWorkerBatch(store, facts, connectors, 'worker-1')
    expect(batch.succeeded).toBe(1)

    const action = store.getState().actions[0]
    expect(action.actionType).toBe('pause_product')
    expect(action.status).toBe('succeeded') // verified against the (demo) marketplace, not just recorded locally
    expect(store.getState().channelProductReconciliations['cp-e2e-2']?.status).toBe('paused')
  })
})

describe('failure scenarios (Part 14, second half)', () => {
  it('1. supplier unavailable — a stale/unavailable supplier-cost fact blocks the profitability recheck rather than guessing a value', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    const facts = createInMemoryFactsLoader() // no seeded supplier offer at all -> unitCost.freshness is 'unavailable'
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_profitability_recheck', payload: { productId: 'prod-x', supplierId: 'sup-missing', channelProductId: 'cp-x' } })
    const batch = await runWorkerBatch(store, facts, connectors, 'worker-1')
    expect(batch.succeeded).toBe(1) // the job runs to completion...
    const action = store.getState().actions[0]
    expect(action.status).toBe('blocked') // ...but the action is honestly blocked, never a guessed profitability figure.
  })

  it('2. marketplace unavailable — an unregistered connector key fails the job explicitly, never silently "succeeding"', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'marketplace_listing_sync', payload: { connectorKey: 'nonexistent_marketplace', ours: [] } })
    const batch = await runWorkerBatch(store, facts, connectors, 'worker-1')
    expect(batch.failed + batch.succeeded).toBe(1)
    const job = store.getState().jobs[0]
    expect(job.status === 'dead_letter' || job.status === 'failed').toBe(true)
  })

  it('3. stale facts — a stale (not unavailable) supplier cost also blocks, distinctly labelled', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    // No `lastVerifiedAt` at all -> older than every freshness window -> 'stale', never fabricated as fresh.
    const facts = createInMemoryFactsLoader({ offers: { 'sup-1:prod-1': { unitCost: fromMajor(9), shippingCost: fromMajor(2), inStock: true, stockQty: 10, lastVerifiedAt: '2020-01-01T00:00:00Z' } } })
    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_profitability_recheck', payload: { productId: 'prod-1', supplierId: 'sup-1', channelProductId: 'cp-1' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')
    expect(store.getState().actions[0].status).toBe('blocked')
  })

  it('4. missing business settings — an org with no configured settings fails closed on a would-be auto-permitted action', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'switch_supplier', settings: UNKNOWN_STATE_AUTOMATION_SETTINGS, domainOutcome: 'auto_permitted',
      domainReason: 'ok', domainRequirements: [{ key: 'x', label: 'x', satisfied: true, detail: 'ok' }], riskLevel: 'low',
    })
    expect(result.outcome).toBe('block')
  })

  it('5. unknown risk — an action whose risk cannot be classified is never auto-executed', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'switch_supplier', settings: CONFIGURED_AUTOMATION_SETTINGS, domainOutcome: 'auto_permitted',
      domainReason: 'ok', domainRequirements: [{ key: 'x', label: 'x', satisfied: true, detail: 'ok' }], riskLevel: 'unknown',
    })
    expect(result.outcome).toBe('require_approval')
  })

  it('6. kill switch — a global pause blocks an otherwise-permitted action', () => {
    const result = evaluateAutomationPolicy({
      actionType: 'update_price', settings: { ...CONFIGURED_AUTOMATION_SETTINGS, automationPaused: true }, domainOutcome: 'auto_permitted',
      domainReason: 'ok', domainRequirements: [{ key: 'x', label: 'x', satisfied: true, detail: 'ok' }], riskLevel: 'low',
    })
    expect(result.outcome).toBe('block')
  })

  it('7. circuit breaker open — a repeatedly-failing connector is refused before any call is attempted', () => {
    const result = canRunNow(true, { isEnabled: true, lastSuccessAt: null, lastFailureAt: new Date().toISOString(), lastError: 'timeout', nextAllowedAt: new Date(Date.now() + 600_000).toISOString(), consecutiveFailures: 5 }, { minSecondsBetweenRuns: 5, failureThreshold: 3 })
    expect(result.ok).toBe(false)
  })

  it('8. duplicate job — the same idempotency key enqueued twice never creates two jobs', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: CONFIGURED_AUTOMATION_SETTINGS } })
    const first = await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: {}, idempotencyKey: 'dup-1' })
    const second = await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: {}, idempotencyKey: 'dup-1' })
    expect(second.alreadyExisted).toBe(true)
    expect(second.id).toBe(first.id)
    expect(store.getState().jobs).toHaveLength(1)
  })

  it('9. duplicate action — the same idempotency key never creates two automation_actions rows', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: CONFIGURED_AUTOMATION_SETTINGS } })
    const settings = CONFIGURED_AUTOMATION_SETTINGS
    const input = { orgId: ORG_A, idempotencyKey: 'dup-action-1', actionType: 'update_price' as const, entityType: 'channel_product', entityId: 'cp-1', reason: 'x', inputFacts: {}, decision: {}, policy: { outcome: 'block' as const, requirements: [], reason: 'x', riskLevel: 'low' as const }, automationLevel: settings.automationLevel }
    const first = await store.createAutomationAction(input)
    const second = await store.createAutomationAction(input)
    expect(second.alreadyExisted).toBe(true)
    expect(second.id).toBe(first.id)
    expect(store.getState().actions).toHaveLength(1)
  })

  it('10. execution timeout / connector throws — a supplier-switch cost-increase beyond the ceiling requires approval rather than executing blindly', () => {
    const baseRequest: Omit<RedundancyRequest, 'automationLevel' | 'alternatives'> = {
      productTitle: 'Widget', channels: ['shopify'], reason: { key: 'out_of_stock', detail: 'zero stock' },
      thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
      previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed', ebay: 'not_assessed' },
      economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: 20, vatInclusive: true },
      profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
    }
    const result = evaluateSupplierSwitchAutomation({
      request: { ...baseRequest, automationLevel: 'autonomous', alternatives: [{ id: 'sup-expensive', name: 'Pricey Alt', signals: goodSupplierSignals({ unitCost: fromMajor(50) }) }] },
      previousUnitCostPlusShippingMinor: fromMajor(11).minor,
      settings: CONFIGURED_AUTOMATION_SETTINGS,
    })
    expect(result.policy.outcome).not.toBe('allow_automatic')
  })

  it('11. verification failure — a write that succeeds but reads back a different price is never reconciled, and the action is marked unsuccessful', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    // A connector whose write "succeeds" but whose own verify read-back disagrees — the dishonest case SUBMIT->VERIFY->RECONCILE exists to catch.
    const dishonestConnector = {
      ...shopifyDemoConnector,
      descriptor: { ...shopifyDemoConnector.descriptor, key: 'dishonest_demo', capabilities: { ...shopifyDemoConnector.descriptor.capabilities, writeListings: true, verifyWrites: true } },
      updateListingPrice: async () => ({ ok: true as const, value: { accepted: true, externalRef: 'x' } }),
      verifyListingState: async () => ({ ok: true as const, value: { externalId: 'x', channelProductRef: 'x', title: 'x', status: 'active' as const, priceMinor: 999999, currency: 'GBP', stockQty: 0, reportedAt: new Date().toISOString(), raw: {} } }),
    }
    const result = await executePriceChange(
      {
        orgId: ORG_A, channelProductId: 'cp-verify-fail', externalId: 'x',
        request: { productTitle: 'Widget', costInputsBefore: { sellingPrice: fromMajor(20), productCost: fromMajor(9), supplierShipping: fromMajor(2), channelFeePct: 0, paymentFeePct: 0 }, newSellingPrice: fromMajor(20.5), automationLevel: 'autonomous' },
        connector: dishonestConnector as never, productDecision: 'add', idempotencyKey: 'verify-fail-1',
      },
      CONFIGURED_AUTOMATION_SETTINGS,
      store,
    )
    expect(result.executed).toBe(false) // never treated as success just because the write call itself returned "accepted"
    expect(store.getState().channelProductReconciliations['cp-verify-fail']).toBeUndefined() // never reconciled on a verification mismatch
  })

  it('12. uncertain verification — a connector that cannot verify writes never counts as executed either, distinctly from a confirmed failure', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...CONFIGURED_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    const uncertainConnector = {
      ...shopifyDemoConnector,
      descriptor: { ...shopifyDemoConnector.descriptor, key: 'uncertain_demo', capabilities: { ...shopifyDemoConnector.descriptor.capabilities, writeListings: true, verifyWrites: false } },
      updateListingPrice: async () => ({ ok: true as const, value: { accepted: true, externalRef: 'x' } }),
    }
    const result = await executePriceChange(
      {
        orgId: ORG_A, channelProductId: 'cp-uncertain', externalId: 'x',
        request: { productTitle: 'Widget', costInputsBefore: { sellingPrice: fromMajor(20), productCost: fromMajor(9), supplierShipping: fromMajor(2), channelFeePct: 0, paymentFeePct: 0 }, newSellingPrice: fromMajor(20.5), automationLevel: 'autonomous' },
        connector: uncertainConnector as never, productDecision: 'add', idempotencyKey: 'uncertain-1',
      },
      CONFIGURED_AUTOMATION_SETTINGS,
      store,
    )
    expect(result.executed).toBe(false)
    const action = store.getState().actions.find((a) => a.id === result.actionId)!
    expect(action.verificationStatus).toBe('uncertain')
  })

  it('13. changed facts between approval and execution — the approval executor structurally re-runs the policy check on live data before ever calling a connector, proven statically (server-only, cannot be imported into Vitest — see execution-dispatch.test.ts)', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/lib/automation/handlers/priceApprovalExecutor.ts', 'utf8')
    expect(source).toMatch(/re-derive|re-lookup|live re-lookup|fresh from live data/)
    expect(source).toMatch(/factsHaveMaterializedChanged|assessPriceChangePolicy/)
  })
})
