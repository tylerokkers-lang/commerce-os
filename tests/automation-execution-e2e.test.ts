import { describe, expect, it, vi } from 'vitest'
import { fromMajor } from '@/lib/core/money'

// Milestone: execution reliability. `priceExecution.ts` now imports the
// circuit-breaker gate (`marketplaces/connectors/executionGate.ts`), which
// is `server-only` (it can call `createServiceSupabase`) — same technique
// every other server-only-adjacent test file in this repo already uses.
vi.mock('server-only', () => ({}))
import { createInMemoryAutomationStore } from '@/lib/automation/inMemoryStore'
import { executePriceChange } from '@/lib/automation/priceExecution'
import { executeSupplierSwitch } from '@/lib/automation/supplierSwitchExecution'
import { CONFIGURED_AUTOMATION_SETTINGS as DEMO_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'

/**
 * Milestone 7's SUBMIT -> VERIFY -> RECONCILE proof, driven through the real
 * entry points (`executePriceChange`, `executeSupplierSwitch`) against a
 * real demo marketplace connector — never by asserting on the connector's
 * internal state directly.
 */

const ORG_A = 'org-a'

describe('price change execution: SUBMIT -> VERIFY -> RECONCILE', () => {
  it('a permitted price change is submitted, verified against the marketplace, and reconciled locally', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await executePriceChange(
      {
        orgId: ORG_A,
        channelProductId: 'cp-1',
        externalId: 'shopify-CMO-1001',
        request: {
          productTitle: 'Magnetic Knife Rail',
          costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
          newSellingPrice: fromMajor(30.5),
          automationLevel: 'autonomous',
        },
        connector: shopifyDemoConnector,
        productDecision: 'add',
        idempotencyKey: 'price-evt-1',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(result.executed).toBe(true)
    const action = store.getState().actions[0]
    expect(action.status).toBe('succeeded')
    expect(action.verificationStatus).toBe('verified')
    expect(action.reconciliationStatus).toBe('matched')
    expect(action.externalRef).toBeTruthy()
    expect(store.getState().channelProductReconciliations['cp-1']?.priceMinor).toBe(fromMajor(30.5).minor)
    expect(store.getState().notifications[0].severity).toBe('success')

    // Confirm the connector's own state actually changed — not assumed.
    const verified = await shopifyDemoConnector.verifyListingState('shopify-CMO-1001')
    expect(verified.ok && verified.value.priceMinor).toBe(fromMajor(30.5).minor)
  })

  it('a price change requiring approval never touches the connector', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await executePriceChange(
      {
        orgId: ORG_A,
        channelProductId: 'cp-2',
        externalId: 'shopify-CMO-1002',
        request: {
          productTitle: 'Bamboo Drawer Dividers',
          costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
          newSellingPrice: fromMajor(30.5),
          automationLevel: 'assisted',
        },
        connector: shopifyDemoConnector,
        productDecision: 'add',
        idempotencyKey: 'price-evt-2',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(result.executed).toBe(false)
    expect(result.policyOutcome).toBe('require_approval')
    expect(store.getState().approvals).toHaveLength(1)
    expect(store.getState().channelProductReconciliations['cp-2']).toBeUndefined()
  })

  it('a price change blocked by the minimum margin never touches the connector', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await executePriceChange(
      {
        orgId: ORG_A,
        channelProductId: 'cp-3',
        externalId: 'shopify-CMO-1003',
        request: {
          productTitle: 'Silicone Food Covers',
          costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
          newSellingPrice: fromMajor(9.5), // Below cost.
          automationLevel: 'autonomous',
        },
        connector: shopifyDemoConnector,
        productDecision: 'add',
        idempotencyKey: 'price-evt-3',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(result.executed).toBe(false)
    expect(result.policyOutcome).toBe('block')
    expect(store.getState().channelProductReconciliations['cp-3']).toBeUndefined()
  })

  it('the marketplace rejecting the write never marks the action succeeded', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    // A price change that passes every profitability/policy check on our
    // side (a small, safe increase) can still be rejected marketplace-side
    // — a rate limit, a locked listing, a validation rule we do not model.
    // A connector that always rejects proves the pipeline propagates that
    // honestly rather than assuming our own checks are the only gate.
    const alwaysRejectingConnector: typeof shopifyDemoConnector = Object.create(shopifyDemoConnector, {
      updateListingPrice: {
        value: async () => ({ ok: false as const, error: { reason: 'rejected' as const, detail: 'Listing is locked for editing (simulated marketplace-side rejection).' } }),
      },
    })

    const result = await executePriceChange(
      {
        orgId: ORG_A,
        channelProductId: 'cp-4',
        externalId: 'shopify-CMO-1001',
        request: {
          productTitle: 'Magnetic Knife Rail',
          costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
          newSellingPrice: fromMajor(30.5),
          automationLevel: 'autonomous',
        },
        connector: alwaysRejectingConnector,
        productDecision: 'add',
        idempotencyKey: 'price-evt-4',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(result.executed).toBe(false)
    const action = store.getState().actions[0]
    expect(action.status).toBe('failed')
    expect(action.verificationStatus).toBe('failed')
    expect(store.getState().channelProductReconciliations['cp-4']).toBeUndefined()
  })

  it('retrying the exact same price-change event (same idempotency key) never submits a second write', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })
    const input = {
      orgId: ORG_A,
      channelProductId: 'cp-5',
      externalId: 'shopify-CMO-1001',
      request: {
        productTitle: 'Magnetic Knife Rail',
        costInputsBefore: { sellingPrice: fromMajor(30), productCost: fromMajor(9), supplierShipping: fromMajor(2), vatRatePct: 20 },
        newSellingPrice: fromMajor(30.5),
        automationLevel: 'autonomous' as const,
      },
      connector: shopifyDemoConnector,
      productDecision: 'add' as const,
      idempotencyKey: 'price-evt-duplicate',
    }

    const first = await executePriceChange(input, DEMO_AUTOMATION_SETTINGS, store)
    const second = await executePriceChange(input, DEMO_AUTOMATION_SETTINGS, store)

    expect(first.actionId).toBe(second.actionId)
    expect(store.getState().actions).toHaveLength(1) // Not two.
  })
})

function goodSignals(overrides = {}) {
  return {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 100, ordersLate: 2, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.5,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2, ...overrides,
  }
}

describe('supplier switch execution', () => {
  const baseRequest: Omit<RedundancyRequest, 'automationLevel' | 'alternatives'> = {
    productTitle: 'Widget', channels: ['shopify'], reason: { key: 'out_of_stock', detail: 'zero stock' },
    thresholds: { minGrossMarginPct: 25, minNetMarginPct: 10 },
    previousChannelStatus: { shopify: 'approved', amazon_uk: 'not_assessed', ebay: 'not_assessed' },
    economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: 20, vatInclusive: true },
    profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
  }

  it('a permitted switch actually updates the channel product\'s fulfilment supplier', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await executeSupplierSwitch(
      {
        orgId: ORG_A,
        channelProductId: 'cp-10',
        request: { ...baseRequest, automationLevel: 'autonomous', alternatives: [{ id: 'sup-good', name: 'Good Alt', signals: goodSignals({ unitCost: fromMajor(9.5) }) }] },
        previousUnitCostPlusShippingMinor: fromMajor(11).minor,
        idempotencyKey: 'switch-evt-1',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(result.executed).toBe(true)
    expect(store.getState().channelProductReconciliations['cp-10']?.fulfilmentSupplierId).toBe('sup-good')
    expect(store.getState().actions[0].reconciliationStatus).toBe('matched')
  })

  it('a switch blocked by compliance never touches the channel product record', async () => {
    const store = createInMemoryAutomationStore({ settingsByOrg: { [ORG_A]: DEMO_AUTOMATION_SETTINGS } })

    const result = await executeSupplierSwitch(
      {
        orgId: ORG_A,
        channelProductId: 'cp-11',
        request: {
          ...baseRequest,
          channels: ['shopify', 'amazon_uk'],
          previousChannelStatus: { shopify: 'approved', amazon_uk: 'approved', ebay: 'not_assessed' },
          automationLevel: 'autonomous',
          alternatives: [{ id: 'sup-bad', name: 'Bad Alt', signals: goodSignals({ supportsCustomInvoice: false }) }],
        },
        previousUnitCostPlusShippingMinor: fromMajor(11).minor,
        idempotencyKey: 'switch-evt-2',
      },
      DEMO_AUTOMATION_SETTINGS,
      store,
    )

    expect(result.executed).toBe(false)
    expect(store.getState().channelProductReconciliations['cp-11']).toBeUndefined()
  })
})
