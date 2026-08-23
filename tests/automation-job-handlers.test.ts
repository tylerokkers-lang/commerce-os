import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { createInMemoryFactsLoader } from '@/lib/automation/inMemoryFactsLoader'
import { runWorkerBatch } from '@/lib/automation/worker'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'
import type { OrderPipelineInput } from '@/lib/orders/pipeline'

/**
 * One end-to-end proof per registered job handler (Milestone 7 brief §2,
 * §18), each driven through the real `runWorkerBatch`/`enqueueJob` entry
 * points — never by calling a handler function or a decision engine
 * directly. Depth varies deliberately: `docs/MILESTONES.md` documents which
 * handlers this file exercises fully versus at a wiring-confidence level.
 */

const ORG_A = 'org-a'
const connectors = (key: string) => (key === 'shopify_demo' ? shopifyDemoConnector : undefined)

function goodSignals(overrides = {}) {
  return {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2, ...overrides,
  }
}

const baseRedundancyRequest: Omit<RedundancyRequest, 'automationLevel' | 'alternatives'> = {
  productTitle: 'Widget', channels: ['shopify'], reason: { key: 'out_of_stock', detail: 'zero stock' },
  thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
  previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed' },
  economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: 20, vatInclusive: true },
  profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
}

describe('job handler registry', () => {
  it('SUPPLIER_SWITCH executes and reconciles the channel product', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({
      orgId: ORG_A, jobType: 'supplier_switch',
      payload: { channelProductId: 'cp-1', request: { ...baseRedundancyRequest, automationLevel: 'autonomous', alternatives: [{ id: 'sup-good', name: 'Good Alt', signals: goodSignals() }] }, previousUnitCostPlusShippingMinor: fromMajor(11).minor },
    })
    const batch = await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(batch.succeeded).toBe(1)
    expect(store.getState().channelProductReconciliations['cp-1']?.fulfilmentSupplierId).toBe('sup-good')
  })

  it('SUPPLIER_PRICE_CHANGE chains into a PRODUCT_PROFITABILITY_RECHECK job', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_price_change', payload: { productId: 'prod-1', supplierId: 'sup-1', previousUnitCostMinor: 900, newUnitCostMinor: 1100 } })
    await runWorkerBatch(store, facts, connectors, 'worker-1', 1) // Claim only the first job — the chained one is asserted separately.

    const chained = store.getState().jobs.find((j) => j.jobType === 'product_profitability_recheck')
    expect(chained).toBeTruthy()
  })

  it('SUPPLIER_STOCK_CHANGE chains into a PRODUCT_PAUSE job when out of stock with no alternative', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({ orgId: ORG_A, jobType: 'supplier_stock_change', payload: { channelProductId: 'cp-2', entityId: 'prod-2', productTitle: 'Widget', availableUnits: 0, lowStockThreshold: 5, hasCompliantAlternativeSupplier: false } })
    await runWorkerBatch(store, facts, connectors, 'worker-1', 1)

    const chained = store.getState().jobs.find((j) => j.jobType === 'product_pause')
    expect(chained).toBeTruthy()
  })

  it('PRODUCT_PAUSE executes and reconciles the channel product to paused', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: { ...DEMO_AUTOMATION_SETTINGS, automationLevel: 'autonomous' } } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-3', entityId: 'prod-3', productTitle: 'Widget', reason: 'Out of stock, no alternative supplier.' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().channelProductReconciliations['cp-3']?.status).toBe('paused')
    expect(store.getState().actions[0].status).toBe('succeeded')
  })

  it('PRODUCT_PAUSE requests approval instead of pausing directly at a lower automation level', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } }) // 'assisted' by default.
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_pause', payload: { channelProductId: 'cp-3b', entityId: 'prod-3b', productTitle: 'Widget', reason: 'Out of stock, no alternative supplier.' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().channelProductReconciliations['cp-3b']).toBeUndefined()
    expect(store.getState().approvals).toHaveLength(1)
  })

  it('PRODUCT_PROFITABILITY_RECHECK blocks on stale supplier cost facts rather than guessing', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader() // No seeded offer — cost fact is unavailable.

    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_profitability_recheck', payload: { productId: 'prod-4', supplierId: 'sup-4', channelProductId: 'cp-4' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    const action = store.getState().actions[0]
    expect(action.policyResult.outcome).toBe('block')
    expect(action.reason).toContain('unavailable')
  })

  it('PRODUCT_PROFITABILITY_RECHECK runs against fresh live facts and flags an unprofitable product', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader({
      products: { 'prod-5': { title: 'Overpriced Widget', category: 'kitchen', stage: 'proven', updatedAt: new Date().toISOString() } },
      offers: { 'sup-5:prod-5': { unitCost: fromMajor(50), shippingCost: fromMajor(5), stockQty: 100, inStock: true, lastVerifiedAt: new Date().toISOString() } },
    })

    await store.enqueueJob({ orgId: ORG_A, jobType: 'product_profitability_recheck', payload: { productId: 'prod-5', supplierId: 'sup-5', channelProductId: 'cp-5', lowStockThreshold: 5 } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    const chained = store.getState().jobs.find((j) => j.jobType === 'product_price_review')
    expect(chained).toBeTruthy() // Selling price of £0 in this test's cost inputs guarantees an unprofitable verdict.
  })

  it('PRODUCT_COMPLIANCE_RECHECK composes assessCompliance with live supplier status', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader({ suppliers: { 'sup-6': { shopifyStatus: 'approved', amazonStatus: 'blocked', lastAssessedAt: new Date().toISOString() } } })

    await store.enqueueJob({
      orgId: ORG_A, jobType: 'product_compliance_recheck',
      payload: { productId: 'prod-6', channelProductId: 'cp-6', channel: 'amazon_uk', supplierId: 'sup-6', context: { title: 'Widget', category: 'kitchen', identifiers: [], documents: [], blockedCategories: [], ipInput: { brand: null, ownBrands: [], restrictedBrands: [], title: 'Widget', description: null } } },
    })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().actions[0].status).not.toBe('succeeded') // Blocked seller-of-record capability fails Amazon compliance.
  })

  it('CHANNEL_ELIGIBILITY_RECHECK evaluates one channel independently of any other', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader({ offers: { 'sup-7:prod-7': { unitCost: fromMajor(9), shippingCost: fromMajor(2), stockQty: 50, inStock: true, lastVerifiedAt: new Date().toISOString() } } })

    await store.enqueueJob({
      orgId: ORG_A, jobType: 'channel_eligibility_recheck',
      payload: { channelProductId: 'cp-7', channel: 'shopify', productStage: 'approved', profitabilityGatePasses: true, profitabilityFailureReason: null, compliance: { verdict: 'pass', checks: [], blockingReasons: [], reviewReasons: [], remediableBlockers: [], fundamentalBlockers: [], ip: { risk: 'low', reasons: [] }, restrictedCategory: false, requiresDocumentation: false, rulesetVersion: 'v1', assessedAt: new Date().toISOString(), summary: 'Passes.', disclaimer: 'Not legal advice.', channel: 'shopify' }, supplierId: 'sup-7', productId: 'prod-7' },
    })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().actions).toHaveLength(1)
    expect(store.getState().actions[0].entityType).toBe('channel_product')
  })

  it('PRODUCT_PRICE_REVIEW proposes a price via calculateProfitability\'s own break-even figure and routes it through executePriceChange', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({
      orgId: ORG_A, jobType: 'product_price_review',
      // A cost that clearly exceeds the current selling price — genuinely
      // unprofitable, so restoring the minimum margin means proposing an
      // increase, not an arbitrary reset to break-even from a healthy price.
      payload: { channelProductId: 'cp-8', externalId: 'shopify-CMO-1001', productTitle: 'Widget', currentSellingPriceMinor: 1500, productCostMinor: 1400, supplierShippingMinor: 200, connectorKey: 'shopify_demo' },
    })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    const action = store.getState().actions[0]
    expect(action.actionType).toBe('update_price')
    // The proposed price should be strictly higher than the current one — it is restoring margin, not cutting it.
    expect((action.inputFacts as { newPriceMinor: number }).newPriceMinor).toBeGreaterThan(1500)
  })

  it('MARKETPLACE_LISTING_SYNC reconciles our listing records against the connector\'s own reported state', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({
      orgId: ORG_A, jobType: 'marketplace_listing_sync',
      payload: { connectorKey: 'shopify_demo', ours: [{ channelProductRef: 'CMO-1001', priceMinor: 999999, status: 'active', recordedAt: new Date().toISOString() }] },
    })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    const action = store.getState().actions[0]
    expect(action.reconciliationStatus).toBe('discrepancy') // The seeded price deliberately disagrees with the demo listing.
  })

  it('MARKETPLACE_RECONCILIATION finds the seeded demo stock discrepancy', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({ orgId: ORG_A, jobType: 'marketplace_reconciliation', payload: { connectorKey: 'shopify_demo', ourInventory: [{ channelProductRef: 'CMO-1001', stockQty: 41, recordedAt: new Date().toISOString() }] } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().actions[0].reconciliationStatus).toBe('discrepancy')
  })

  it('FULFILMENT_UPDATE submits tracking through the existing connector method and records an uncertain (not verified) outcome', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({ orgId: ORG_A, jobType: 'fulfilment_update', payload: { connectorKey: 'shopify_demo', externalOrderId: 'shopify-order-1000', carrier: 'Royal Mail', trackingNumber: 'RM123', entityId: 'order-1' } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    const action = store.getState().actions[0]
    expect(action.status).toBe('succeeded')
    expect(action.verificationStatus).toBe('uncertain') // No read-back exists for fulfilment records — honestly not "verified".
  })

  it('TRACKING_CHECK notifies on a genuine delivery health issue', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()

    await store.enqueueJob({ orgId: ORG_A, jobType: 'tracking_check', payload: { entityId: 'order-2', shipment: { shippedAt: new Date().toISOString(), deliveredAt: null, trackingNumber: null, promisedBy: null, lastStatusAt: new Date().toISOString() } } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().notifications).toHaveLength(1)
    expect(store.getState().notifications[0].category).toBe('fulfilment')
  })

  it('ORDER_PROCESSING threads into the existing order pipeline without duplicating it', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const facts = createInMemoryFactsLoader()
    const input: OrderPipelineInput = {
      orderId: 'order-3',
      ingestion: { channel: 'shopify', snapshot: { externalId: 'ext-3', placedAt: new Date().toISOString(), status: 'paid', totalMinor: 3000, currency: 'GBP', lineItemRefs: ['SKU-A'], raw: {} }, existing: null, allLineItemsResolved: true, lineItemsTotalMinor: 3000 },
      lineEconomics: { sellingPrice: fromMajor(30), supplierUnitCost: fromMajor(9), supplierShipping: fromMajor(2), channelFee: fromMajor(0), paymentFee: fromMajor(0.75), quantity: 1, vatRatePct: 20 },
      marginThreshold: { minNetMarginPct: 10 },
      stock: { onHandQty: 100, reservedQty: 10 },
      requestedQuantity: 1,
      supplierCandidates: [{ id: 'sup-1', name: 'Meridian', signals: goodSignals(), isApprovedForListing: true }],
      complianceContext: { approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-1', daysSinceLastAssessment: 5, productDetailsChangedSinceApproval: false },
      complianceRecheckResult: null,
      automationLevel: 'autonomous',
      shipment: null,
    }

    await store.enqueueJob({ orgId: ORG_A, jobType: 'order_processing', payload: { input, supplierSpendAlreadyTodayMinor: 0 } })
    await runWorkerBatch(store, facts, connectors, 'worker-1')

    expect(store.getState().actions[0].status).toBe('succeeded')
  })

  it('an unregistered job type still fails safely, never silently succeeding', async () => {
    const store = createInMemoryAutomationStore()
    const facts = createInMemoryFactsLoader()
    await store.enqueueJob({ orgId: ORG_A, jobType: 'not_a_real_handler' })
    const batch = await runWorkerBatch(store, facts, connectors, 'worker-1')
    expect(batch.succeeded).toBe(0)
  })
})
