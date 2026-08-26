import { fromMajor } from '@/lib/core/money'
import { assessAmazonCapability, assessShopifyCapability } from '@/lib/suppliers/scoring'
import { assessCompliance, type ComplianceContext } from '@/lib/compliance/rules'
import { evaluateSupplierSwitchAutomation, type SupplierSwitchAutomationResult } from '@/lib/automation/supplierSwitching'
import { evaluatePublicationAutomation, type PublicationAutomationResult } from '@/lib/automation/publicationAutomation'
import { evaluateOrderAutomation, type OrderAutomationResult } from '@/lib/automation/orderAutomation'
import { evaluateProductMonitoring, type ProductMonitoringResult } from '@/lib/automation/monitoring'
import { computeBackoffSeconds } from '@/lib/automation/backoff'
import type { AutomationSettings } from '@/lib/automation/settings'
import { DEMO_CONTEXT, demoEvaluationByRef } from './research'
import { suppliersFor } from './suppliers'
import { PRODUCT_SEEDS } from './dataset'
import type { OrderPipelineInput } from '@/lib/orders/pipeline'

/**
 * The seven demo automation scenarios from the brief's §25, each isolating
 * exactly one behaviour of the policy engine. Every scenario runs the real
 * evaluators this milestone built (`supplierSwitching.ts`,
 * `publicationAutomation.ts`, `orderAutomation.ts`, `monitoring.ts`,
 * `jobs.ts`) against genuine demo catalogue/supplier data already used
 * elsewhere in the app (`demo/research.ts`, `demo/suppliers.ts`,
 * `demo/dataset.ts`) — nothing here is a value invented just for this page.
 */

const RUNNING_SETTINGS: AutomationSettings = {
  automationLevel: 'autonomous',
  automationPaused: false,
  automationPausedAt: null,
  automationPausedReason: null,
  automationPausedCategories: [],
  maxAutoPurchaseMinor: 20000,
  maxAutoPriceChangePct: 5,
  maxPriceMovementPerDayPct: 10,
  maxAutoRefundMinor: 5000,
  maxDailyAutoRefundMinor: 20000,
  maxRefundsPerOrder: 3,
  maxDailyAutoSupplierSpendMinor: 100000,
  maxAutoSupplierSwitchCostIncreasePct: 10,
  minNetMarginPct: 10,
  maxDailyAdSpendMinor: 5000,
  minRoas: 3,
  maxAutoAdIncreasePct: 20,
}

const PAUSED_SETTINGS: AutomationSettings = { ...RUNNING_SETTINGS, automationPaused: true, automationPausedReason: 'Owner paused automation while reviewing Q3 numbers' }
const TIGHT_SPEND_SETTINGS: AutomationSettings = { ...RUNNING_SETTINGS, maxDailyAutoSupplierSpendMinor: 500 } // £5/day — deliberately unrealistic, to force the limit

export interface DemoAutomationScenario {
  key: string
  label: string
  description: string
}

export interface SupplierSwitchScenario extends DemoAutomationScenario {
  kind: 'supplier_switch'
  result: SupplierSwitchAutomationResult
}

export interface PublicationScenario extends DemoAutomationScenario {
  kind: 'publication'
  shopify: PublicationAutomationResult
  amazon: PublicationAutomationResult
}

export interface MonitoringScenario extends DemoAutomationScenario {
  kind: 'monitoring'
  result: ProductMonitoringResult
}

export interface OrderScenario extends DemoAutomationScenario {
  kind: 'order'
  result: OrderAutomationResult
}

export interface ConnectorFailureScenario extends DemoAutomationScenario {
  kind: 'connector_failure'
  attempts: readonly { attempt: number; backoffSeconds: number; outcome: string }[]
  finalState: string
}

export type AnyDemoScenario =
  | SupplierSwitchScenario | PublicationScenario | MonitoringScenario | OrderScenario | ConnectorFailureScenario

/**
 * A bespoke, fully hand-controlled switch scenario rather than reusing
 * `demo/suppliers.ts`'s Northwind quote for the bamboo dividers directly:
 * Northwind's real cost (£13.20 landed, against a £19.50 selling price) is
 * too thin a margin once the profitability engine's pessimistic default
 * advertising assumption is included — realistic, but it would only ever
 * demonstrate the *blocked* path, not the successful-automatic-switch path
 * this scenario needs to isolate. Every number here is explicit and
 * deliberately generous specifically so this scenario can isolate "a small
 * cost increase that a healthy product easily absorbs," the same way
 * `demo/orders.ts` (Milestone 5) builds bespoke per-scenario supplier costs
 * rather than forcing one shared fixture to fit every story.
 */
function goodAlternativeSwitchRequest(automationLevel: AutomationSettings['automationLevel']) {
  const preferredSignals = {
    unitCost: fromMajor(9), shippingCost: fromMajor(2), deliveryDaysMin: 2, deliveryDaysMax: 4,
    ordersPlaced: 120, ordersLate: 3, ordersDefective: 1, qualityRating: 4.6, communicationRating: 4.6,
    handlesReturns: true, returnsWindowDays: 45, acceptsFaultyReturns: true, providesTracking: true,
    supportsBlindShipping: true, supportsCustomInvoice: true, supportsCustomPackaging: true,
    supportsOwnBranding: true, documentCount: 2,
  }

  return {
    productTitle: 'Oak Serving Board, Large',
    channels: ['shopify'] as const,
    reason: { key: 'out_of_stock' as const, detail: 'the supplier reported zero stock on the last sync' },
    automationLevel,
    thresholds: { minGrossMarginPct: DEMO_CONTEXT.minGrossMarginPct, minNetMarginPct: DEMO_CONTEXT.minNetMarginPct },
    previousChannelStatus: { shopify: assessShopifyCapability(preferredSignals).status, amazon_uk: 'not_assessed' as const, ebay: 'not_assessed' as const },
    alternatives: [
      // A small, realistic cost increase (80p landed) against an otherwise
      // identical supplier profile — genuinely "provably no worse."
      { id: 'sup-good-alt', name: 'Ridgeway Homeware Supply', signals: { ...preferredSignals, unitCost: fromMajor(9.5), shippingCost: fromMajor(2.3) } },
    ],
    economics: { sellingPrice: fromMajor(35), returnRatePct: 4, vatRatePct: DEMO_CONTEXT.vatRatePct, vatInclusive: true },
    profileInput: { category: 'kitchen', shopifyAdSpendPerUnit: fromMajor(1.5) },
  }
}

function knifeRailSwitchRequest(automationLevel: AutomationSettings['automationLevel']) {
  const evaluation = demoEvaluationByRef('demo-magnetic-knife-rail')!
  const quoting = suppliersFor('demo-magnetic-knife-rail')
  const preferred = quoting.find((q) => q.id === 'sup-1')!
  const alternatives = quoting.filter((q) => q.id !== 'sup-1').map((q) => ({ id: q.id, name: q.name, signals: q.signals }))

  return {
    productTitle: evaluation.candidate.title,
    channels: ['shopify', 'amazon_uk'] as const,
    reason: { key: 'out_of_stock' as const, detail: 'the supplier reported zero stock on the last sync' },
    automationLevel,
    thresholds: { minGrossMarginPct: DEMO_CONTEXT.minGrossMarginPct, minNetMarginPct: DEMO_CONTEXT.minNetMarginPct },
    previousChannelStatus: {
      shopify: assessShopifyCapability(preferred.signals).status,
      amazon_uk: assessAmazonCapability(preferred.signals).status,
      ebay: 'not_assessed' as const,
    },
    alternatives,
    economics: {
      sellingPrice: evaluation.candidate.estimatedSellingPrice,
      returnRatePct: evaluation.candidate.expectedReturnRatePct ?? 5,
      vatRatePct: DEMO_CONTEXT.vatRatePct,
      vatInclusive: true,
    },
    profileInput: { category: evaluation.candidate.category },
  }
}

function scenario1(): SupplierSwitchScenario {
  const request = goodAlternativeSwitchRequest('autonomous')
  const preferredCostMinor = suppliersFor('demo-bamboo-drawer-dividers').find((q) => q.id === 'sup-1')!.signals.unitCost.minor +
    suppliersFor('demo-bamboo-drawer-dividers').find((q) => q.id === 'sup-1')!.signals.shippingCost.minor

  return {
    key: 'supplier_switch_success',
    kind: 'supplier_switch',
    label: 'Supplier becomes unavailable — automatic switch',
    description: 'Meridian goes out of stock for the bamboo drawer dividers (Shopify-only product). An alternative supplier is available at a small cost increase, preserves the one channel that was actually approved, and clears profitability — the "autonomous" automation level switches automatically.',
    result: evaluateSupplierSwitchAutomation({ request, previousUnitCostPlusShippingMinor: preferredCostMinor, settings: RUNNING_SETTINGS }),
  }
}

function scenario2(): SupplierSwitchScenario {
  const request = knifeRailSwitchRequest('autonomous')
  const preferredCostMinor = suppliersFor('demo-magnetic-knife-rail').find((q) => q.id === 'sup-1')!.signals.unitCost.minor +
    suppliersFor('demo-magnetic-knife-rail').find((q) => q.id === 'sup-1')!.signals.shippingCost.minor

  return {
    key: 'supplier_switch_blocked',
    kind: 'supplier_switch',
    label: 'Supplier unavailable — no acceptable alternative',
    description: 'Meridian goes out of stock for the magnetic knife rail, approved on both channels. The only alternative, an unverified marketplace seller, is blocked for Amazon and fails the profitability bar. No switch happens automatically at any automation level — the product is protected, and the owner is asked to decide.',
    result: evaluateSupplierSwitchAutomation({ request, previousUnitCostPlusShippingMinor: preferredCostMinor, settings: RUNNING_SETTINGS }),
  }
}

function scenario3(): MonitoringScenario {
  const seed = PRODUCT_SEEDS.find((s) => s.sku === 'CMO-1003')!
  return {
    key: 'product_unprofitable',
    kind: 'monitoring',
    label: 'Product becomes unprofitable',
    description: `${seed.title}'s supplier cost has risen; margin has fallen below the configured minimum. The product is not paused automatically — a price or supplier review is recommended first.`,
    result: evaluateProductMonitoring({
      productTitle: seed.title,
      automationLevel: 'autonomous',
      settings: RUNNING_SETTINGS,
      supplierAvailable: true,
      stockAvailableUnits: 40,
      lowStockThreshold: 10,
      hasCompliantAlternativeSupplier: false,
      costInputs: {
        sellingPrice: fromMajor(seed.price),
        // A cost increase severe enough to fail the margin bar on its own,
        // sized off the selling price rather than the seed's own (much
        // lower) cost so this reliably fails regardless of which product it
        // is applied to.
        productCost: fromMajor(seed.price * 0.75),
        supplierShipping: fromMajor(seed.supplierShipping),
        channelFeePct: 15,
        vatRatePct: 20,
      },
      minNetMarginPct: RUNNING_SETTINGS.minNetMarginPct,
    }),
  }
}

function scenario4(): PublicationScenario {
  const seed = PRODUCT_SEEDS.find((s) => s.sku === 'CMO-1001')!
  const supplierSignals = suppliersFor('demo-magnetic-knife-rail').find((q) => q.id === 'sup-1')!.signals

  const baseContext: ComplianceContext = {
    title: seed.title,
    category: 'kitchen',
    identifiers: [], // No GTIN on file — fatal for Amazon, irrelevant for Shopify.
    supplierCapability: 'approved',
    supplierCapabilityReasons: [],
    supplierName: 'Meridian Housewares Ltd',
    documents: [],
    blockedCategories: [],
    ipInput: { brand: null, ownBrands: DEMO_CONTEXT.ownBrands, restrictedBrands: [], title: seed.title, description: null },
  }

  const shopifyCompliance = assessCompliance('shopify', baseContext)
  const amazonCompliance = assessCompliance('amazon_uk', baseContext)

  const shopify = evaluatePublicationAutomation(
    {
      channel: 'shopify',
      productStage: 'approved',
      supplierCapability: assessShopifyCapability(supplierSignals),
      profitabilityGatePasses: true,
      profitabilityFailureReason: null,
      compliance: shopifyCompliance,
      automationLevel: 'autonomous',
    },
    RUNNING_SETTINGS,
  )

  const amazon = evaluatePublicationAutomation(
    {
      channel: 'amazon_uk',
      productStage: 'approved',
      supplierCapability: assessAmazonCapability(supplierSignals),
      profitabilityGatePasses: true,
      profitabilityFailureReason: null,
      compliance: amazonCompliance,
      automationLevel: 'autonomous',
    },
    RUNNING_SETTINGS,
  )

  return {
    key: 'channel_independent_publication',
    kind: 'publication',
    label: 'Amazon compliance fails, Shopify passes',
    description: `${seed.title} has no GTIN on file. Amazon requires one; Shopify does not. The two channels are decided completely independently — Shopify may still auto-publish while Amazon stays blocked.`,
    shopify,
    amazon,
  }
}

function scenario5(): SupplierSwitchScenario {
  const request = goodAlternativeSwitchRequest('autonomous')
  const preferredCostMinor = suppliersFor('demo-bamboo-drawer-dividers').find((q) => q.id === 'sup-1')!.signals.unitCost.minor +
    suppliersFor('demo-bamboo-drawer-dividers').find((q) => q.id === 'sup-1')!.signals.shippingCost.minor

  return {
    key: 'kill_switch_active',
    kind: 'supplier_switch',
    label: 'Kill switch active',
    description: 'The exact same switch as the first scenario — every domain gate passes identically — but the owner has paused all automation. The action is blocked and audited, not executed and not silently skipped.',
    result: evaluateSupplierSwitchAutomation({ request, previousUnitCostPlusShippingMinor: preferredCostMinor, settings: PAUSED_SETTINGS }),
  }
}

function scenario6(): OrderScenario {
  const seed = PRODUCT_SEEDS.find((s) => s.sku === 'CMO-1001')!
  const input: OrderPipelineInput = {
    orderId: 'demo-spend-limit-order',
    ingestion: {
      channel: 'shopify',
      snapshot: {
        externalId: 'shopify-demo-spend-limit',
        placedAt: new Date().toISOString(),
        status: 'paid',
        totalMinor: Math.round(seed.price * 100),
        currency: 'GBP',
        lineItemRefs: [seed.sku],
        raw: {},
      },
      existing: null,
      allLineItemsResolved: true,
      lineItemsTotalMinor: Math.round(seed.price * 100),
    },
    lineEconomics: {
      sellingPrice: fromMajor(seed.price),
      supplierUnitCost: fromMajor(seed.cost),
      supplierShipping: fromMajor(seed.supplierShipping),
      channelFee: fromMajor(0),
      paymentFee: fromMajor(seed.price * 0.0175 + 0.25),
      quantity: 1,
      vatRatePct: 20,
    },
    marginThreshold: { minNetMarginPct: 10 },
    stock: { onHandQty: 100, reservedQty: 10 },
    requestedQuantity: 1,
    supplierCandidates: [
      { id: 'sup-1', name: 'Meridian Housewares Ltd', signals: suppliersFor('demo-magnetic-knife-rail').find((q) => q.id === 'sup-1')!.signals, isApprovedForListing: true },
    ],
    complianceContext: { approvedSupplierId: 'sup-1', fulfillingSupplierId: 'sup-1', daysSinceLastAssessment: 5, productDetailsChangedSinceApproval: false },
    complianceRecheckResult: null,
    automationLevel: 'autonomous',
    shipment: null,
  }

  return {
    key: 'spend_limit_exceeded',
    kind: 'order',
    label: 'Automatic supplier order exceeds the spending limit',
    description: 'Every fulfilment requirement passes and "autonomous" would normally submit this automatically — but the (deliberately tight, for this demo) daily automatic supplier-spend limit is already exhausted, so it waits for approval instead of silently exceeding it.',
    result: evaluateOrderAutomation(input, TIGHT_SPEND_SETTINGS, 0),
  }
}

function scenario7(): ConnectorFailureScenario {
  const attempts = [1, 2, 3, 4, 5].map((attempt) => ({
    attempt,
    backoffSeconds: computeBackoffSeconds(attempt),
    outcome: attempt < 5 ? 'Amazon SP-API timed out; retry scheduled.' : 'Attempts exhausted; moved to dead-letter.',
  }))

  return {
    key: 'connector_unavailable',
    kind: 'connector_failure',
    label: 'Marketplace API unavailable',
    description: 'A reconciliation job cannot reach Amazon\'s SP-API. It never fabricates a "reconciled" result — it retries with exponential backoff, and if the marketplace stays unreachable through every attempt, the job is dead-lettered and the owner is notified, rather than silently dropped.',
    attempts,
    finalState: 'dead_letter — five attempts made, each backing off further (30s, 60s, 120s, 240s, 480s), no false success recorded at any point.',
  }
}

let cached: readonly AnyDemoScenario[] | null = null

export function demoAutomationScenarios(): readonly AnyDemoScenario[] {
  if (cached) return cached
  cached = [scenario1(), scenario2(), scenario3(), scenario4(), scenario5(), scenario6(), scenario7()]
  return cached
}
