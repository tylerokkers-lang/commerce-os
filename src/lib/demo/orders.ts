import { fromMajor } from '@/lib/core/money'
import { demoShopifyOrders, demoAmazonOrders } from './marketplaceData'
import { PRODUCT_SEEDS, type DemoProductSeed } from './dataset'
import { runOrderPipeline, type OrderPipelineInput, type OrderPipelineResult } from '@/lib/orders/pipeline'
import type { MarketplaceOrderSnapshot } from '@/lib/marketplaces/connectors/types'
import type { ChannelKey } from '@/lib/core/domain'
import type { SupplierSignals } from '@/lib/suppliers/scoring'
import type { FulfilmentSupplierCandidate } from '@/lib/fulfilment/selection'

/**
 * Demo order orchestration.
 *
 * Runs three of the demo business's own orders (already shown on the
 * Marketplaces page, via `demoShopifyOrders`/`demoAmazonOrders`) through the
 * real `runOrderPipeline`, so the orchestration this milestone builds is
 * exercised against genuine order data rather than only in unit tests.
 *
 * Each scenario's supplier cost is built from that specific product's own
 * seed cost, deliberately — sharing one fixed supplier cost profile across
 * three different-priced products would make an unrelated product look
 * unprofitable purely because the numbers do not correspond to it, which
 * would defeat the point of isolating one genuine failure per scenario:
 * a clean happy path, a case where the only supplier available differs from
 * the one the listing was approved against (forcing a compliance re-check),
 * and a genuine stock shortfall with nothing else wrong.
 */

function seedFor(sku: string): DemoProductSeed {
  const seed = PRODUCT_SEEDS.find((s) => s.sku === sku)
  if (!seed) throw new Error(`No demo product seed for ${sku}`)
  return seed
}

/** A supplier signal profile built around one product's own real economics. */
function supplierFor(seed: DemoProductSeed, overrides: Partial<SupplierSignals> = {}): SupplierSignals {
  return {
    unitCost: fromMajor(seed.cost),
    shippingCost: fromMajor(seed.supplierShipping),
    deliveryDaysMin: 2,
    deliveryDaysMax: 4,
    ordersPlaced: 120,
    ordersLate: 4,
    ordersDefective: 2,
    qualityRating: 4.5,
    communicationRating: 4.4,
    handlesReturns: true,
    returnsWindowDays: 45,
    acceptsFaultyReturns: true,
    providesTracking: true,
    supportsBlindShipping: true,
    supportsCustomInvoice: true,
    supportsCustomPackaging: true,
    supportsOwnBranding: true,
    documentCount: 2,
    ...overrides,
  }
}

export interface DemoOrderScenario {
  label: string
  description: string
  channel: ChannelKey
  snapshot: MarketplaceOrderSnapshot
  result: OrderPipelineResult
}

interface ScenarioConfig {
  label: string
  description: string
  channel: ChannelKey
  snapshot: MarketplaceOrderSnapshot
  supplierCandidates: readonly FulfilmentSupplierCandidate[]
  stockOnHand: number
  stockReserved: number
  requestedQuantity: number
  fulfillingSupplierId: string | null
  approvedSupplierId: string | null
  complianceRecheckResult: boolean | null
}

function buildScenario(config: ScenarioConfig): DemoOrderScenario {
  const seed = seedFor(config.snapshot.lineItemRefs[0])
  const fulfillingSignals = config.supplierCandidates.find((c) => c.id === config.fulfillingSupplierId)?.signals

  const input: OrderPipelineInput = {
    orderId: config.snapshot.externalId,
    ingestion: {
      channel: config.channel,
      snapshot: config.snapshot,
      existing: null,
      allLineItemsResolved: true,
      lineItemsTotalMinor: config.snapshot.totalMinor,
    },
    lineEconomics: {
      sellingPrice: fromMajor(seed.price),
      supplierUnitCost: fulfillingSignals?.unitCost ?? fromMajor(seed.cost),
      supplierShipping: fulfillingSignals?.shippingCost ?? fromMajor(seed.supplierShipping),
      channelFee: config.channel === 'amazon_uk' ? fromMajor(seed.price * 0.15) : fromMajor(0),
      paymentFee: config.channel === 'shopify' ? fromMajor(seed.price * 0.0175 + 0.25) : fromMajor(0),
      quantity: config.requestedQuantity,
      vatRatePct: 20,
    },
    marginThreshold: { minNetMarginPct: 10 },
    stock: { onHandQty: config.stockOnHand, reservedQty: config.stockReserved },
    requestedQuantity: config.requestedQuantity,
    supplierCandidates: config.supplierCandidates,
    complianceContext: {
      approvedSupplierId: config.approvedSupplierId,
      fulfillingSupplierId: config.fulfillingSupplierId,
      daysSinceLastAssessment: 15,
      productDetailsChangedSinceApproval: false,
    },
    complianceRecheckResult: config.complianceRecheckResult,
    automationLevel: 'assisted', // The demo business's automation level throughout this system.
    shipment: null,
  }

  return {
    label: config.label,
    description: config.description,
    channel: config.channel,
    snapshot: config.snapshot,
    result: runOrderPipeline(input),
  }
}

let cached: readonly DemoOrderScenario[] | null = null

export function demoOrderScenarios(): readonly DemoOrderScenario[] {
  if (cached) return cached

  const shopifyOrders = demoShopifyOrders()
  const amazonOrders = demoAmazonOrders()

  const cmo1001 = seedFor('CMO-1001')
  const cmo1002 = seedFor('CMO-1002')
  const cmo1003 = seedFor('CMO-1003')

  const happyPath = buildScenario({
    label: 'Straightforward fulfilment',
    description: 'The approved supplier is available, stock is sufficient, and the order is profitable at its real price. Held for approval because the automation level is "assisted".',
    channel: 'shopify',
    snapshot: shopifyOrders[0], // CMO-1001
    supplierCandidates: [
      { id: 'sup-1', name: 'Meridian Housewares Ltd', signals: supplierFor(cmo1001), isApprovedForListing: true },
    ],
    stockOnHand: 100, stockReserved: 20, requestedQuantity: 1,
    fulfillingSupplierId: 'sup-1', approvedSupplierId: 'sup-1', complianceRecheckResult: null,
  })

  const complianceRecheckCase = buildScenario({
    label: 'Approved supplier unavailable',
    description: 'Meridian (the listing’s approved supplier) is out of stock for this order, so Northwind is the only candidate — Amazon’s compliance verdict depends on the supplier, so a re-check is required, and it has failed: Northwind cannot act as seller of record.',
    channel: 'shopify',
    snapshot: shopifyOrders[1], // CMO-1002
    supplierCandidates: [
      {
        id: 'sup-2', name: 'Northwind Supply Co',
        signals: supplierFor(cmo1002, { supportsCustomInvoice: false, ordersPlaced: 34, qualityRating: 4.1 }),
        isApprovedForListing: false,
      },
    ],
    stockOnHand: 50, stockReserved: 10, requestedQuantity: 1,
    fulfillingSupplierId: 'sup-2', approvedSupplierId: 'sup-1', complianceRecheckResult: false,
  })

  const stockShortfall = buildScenario({
    label: 'Stock shortfall',
    description: 'Every other requirement passes — same approved supplier, profitable at the real price — but the reservation itself fails: no stock remains to commit to this order.',
    channel: 'amazon_uk',
    snapshot: amazonOrders[2], // CMO-1003
    supplierCandidates: [
      { id: 'sup-1', name: 'Meridian Housewares Ltd', signals: supplierFor(cmo1003), isApprovedForListing: true },
    ],
    stockOnHand: 5, stockReserved: 5, requestedQuantity: 2, // 0 available, 2 requested
    fulfillingSupplierId: 'sup-1', approvedSupplierId: 'sup-1', complianceRecheckResult: null,
  })

  cached = [happyPath, complianceRecheckCase, stockShortfall]
  return cached
}
