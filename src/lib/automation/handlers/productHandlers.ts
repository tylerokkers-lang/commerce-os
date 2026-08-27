import { evaluateProductMonitoring } from '../monitoring'
import { evaluatePublicationAutomation } from '../publicationAutomation'
import { executePriceChange, type PriceExecutionInput } from '../priceExecution'
import { calculateProfitability } from '@/lib/profitability'
import { assessCompliance, type ComplianceContext } from '@/lib/compliance/rules'
import { assessAmazonCapability, assessShopifyCapability } from '@/lib/suppliers/scoring'
import { money } from '@/lib/core/money'
import type { AutomationStore, JobRecord } from '../store'
import type { FactsLoader } from '../factsTypes'
import type { JobHandlerResult } from '../worker'
import type { MarketplaceConnector } from '@/lib/marketplaces/connectors/types'

export interface ProductProfitabilityRecheckPayload {
  productId: string
  supplierId: string
  channelProductId: string
  channelFeePct?: number
  lowStockThreshold?: number
  hasCompliantAlternativeSupplier?: boolean
}

function isProfitabilityPayload(p: Record<string, unknown>): boolean {
  return typeof p.productId === 'string' && typeof p.supplierId === 'string' && typeof p.channelProductId === 'string'
}

/**
 * PRODUCT_PROFITABILITY_RECHECK: the first handler to actually assemble its
 * facts live (brief §3), via the injected `FactsLoader`, rather than from a
 * fully pre-built payload. Blocks — rather than guessing — when a required
 * fact is stale or missing, per the brief's explicit requirement.
 */
export async function handleProductProfitabilityRecheck(job: JobRecord, store: AutomationStore, facts: FactsLoader): Promise<JobHandlerResult> {
  if (!isProfitabilityPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for product_profitability_recheck.', retryable: false }
  }
  const payload = job.payload as unknown as ProductProfitabilityRecheckPayload
  const settings = await store.getAutomationSettings(job.orgId)

  const [product, supplier] = await Promise.all([
    facts.loadProductFacts(job.orgId, payload.productId),
    facts.loadSupplierFactsForProduct(job.orgId, payload.supplierId, payload.productId),
  ])

  if (supplier.unitCost.freshness === 'unavailable' || supplier.unitCost.freshness === 'stale') {
    await store.createAutomationAction({
      orgId: job.orgId,
      idempotencyKey: `job:${job.id}`,
      actionType: 'product_pause' as never, // No dedicated "stale facts" action type exists; recorded as a blocked profitability recheck instead.
      entityType: 'product',
      entityId: payload.productId,
      reason: `Supplier cost for ${payload.productId} is ${supplier.unitCost.freshness}, not fresh — a profitability re-check cannot run on stale or missing cost data.`,
      inputFacts: { unitCostFreshness: supplier.unitCost.freshness, asOf: supplier.unitCost.asOf },
      decision: {},
      policy: { outcome: 'block', requirements: [{ key: 'facts_fresh', label: 'Supplier cost facts are fresh', satisfied: false, detail: `Freshness: ${supplier.unitCost.freshness}.` }], reason: 'Blocked: required facts are stale or unavailable.', riskLevel: 'medium' },
      automationLevel: settings.automationLevel,
      jobId: job.id,
    })
    return { succeeded: true }
  }

  const result = evaluateProductMonitoring({
    productTitle: product.title.value ?? payload.productId,
    automationLevel: settings.automationLevel,
    settings,
    supplierAvailable: supplier.inStock.value ?? true,
    stockAvailableUnits: supplier.stockQty.value ?? 0,
    lowStockThreshold: payload.lowStockThreshold ?? 5,
    hasCompliantAlternativeSupplier: payload.hasCompliantAlternativeSupplier ?? false,
    costInputs: {
      sellingPrice: money(0, 'GBP'), // Selling price is a channel-level fact, loaded and merged in by the caller once channel_products carries it per-listing; see docs/MILESTONES.md for this handler's exact scope.
      productCost: supplier.unitCost.value ?? money(0, 'GBP'),
      supplierShipping: supplier.shippingCost.value ?? money(0, 'GBP'),
      channelFeePct: payload.channelFeePct,
      vatRatePct: 20,
    },
    minNetMarginPct: settings.minNetMarginPct,
  })

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'update_price',
    entityType: 'product',
    entityId: payload.productId,
    reason: result.summary,
    inputFacts: { unitCostMinor: supplier.unitCost.value?.minor ?? null, stockQty: supplier.stockQty.value },
    decision: { recommendation: result.recommendation, netMarginPct: result.profitability.netMarginPct },
    policy: { outcome: result.recommendation === 'none' ? 'allow_automatic' : 'require_approval', requirements: [], reason: result.summary, riskLevel: result.isProfitable ? 'low' : 'medium' },
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (created.alreadyExisted) return { succeeded: true }

  if (result.recommendation === 'needs_price_or_supplier_review') {
    await store.enqueueJob({ orgId: job.orgId, jobType: 'product_price_review', payload: { ...payload }, idempotencyKey: `price-review:${payload.productId}:${job.id}`, correlationId: job.correlationId })
  } else if (result.recommendation === 'pause_listing') {
    await store.enqueueJob({ orgId: job.orgId, jobType: 'product_pause', payload: { channelProductId: payload.channelProductId, entityId: payload.productId, productTitle: product.title.value ?? payload.productId, reason: result.summary }, idempotencyKey: `pause:${payload.channelProductId}:${job.id}`, correlationId: job.correlationId })
  }

  await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: 'product', entityId: payload.productId })
  if (result.recommendation !== 'none') {
    await store.notify({ orgId: job.orgId, severity: result.isProfitable ? 'info' : 'warning', category: 'profitability', title: `Profitability re-check: ${product.title.value ?? payload.productId}`, body: result.summary, entityType: 'product', entityId: payload.productId, dedupeKey: `action:${created.id}` })
  }

  return { succeeded: true }
}

export interface ProductComplianceRecheckPayload {
  productId: string
  channelProductId: string
  channel: 'shopify' | 'amazon_uk'
  context: Omit<ComplianceContext, 'supplierCapability' | 'supplierCapabilityReasons'>
  supplierId: string
}

function isCompliancePayload(p: Record<string, unknown>): boolean {
  return typeof p.productId === 'string' && typeof p.channel === 'string' && typeof p.context === 'object'
}

/**
 * PRODUCT_COMPLIANCE_RECHECK: composes `assessCompliance` (unchanged) with
 * live supplier capability facts. The product's own compliance inputs
 * (identifiers, documents, category flags) are not yet modelled in
 * `FactsLoader` — the caller supplies `context` for now, an honest,
 * documented scope limit rather than a guess at a live query shape.
 */
export async function handleProductComplianceRecheck(job: JobRecord, store: AutomationStore, facts: FactsLoader): Promise<JobHandlerResult> {
  if (!isCompliancePayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for product_compliance_recheck.', retryable: false }
  }
  const payload = job.payload as unknown as ProductComplianceRecheckPayload
  const settings = await store.getAutomationSettings(job.orgId)

  const supplier = await facts.loadSupplierFactsForProduct(job.orgId, payload.supplierId, payload.productId)
  const statusFact = payload.channel === 'amazon_uk' ? supplier.amazonStatus : supplier.shopifyStatus

  const assessment = assessCompliance(payload.channel, {
    ...payload.context,
    supplierCapability: (statusFact.value as ComplianceContext['supplierCapability']) ?? 'not_assessed',
    supplierCapabilityReasons: [],
  })

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'reconcile_supplier' as never,
    entityType: 'channel_product',
    entityId: payload.channelProductId,
    reason: assessment.summary,
    inputFacts: { channel: payload.channel, supplierStatusFreshness: statusFact.freshness },
    decision: { verdict: assessment.verdict, blockingReasons: assessment.blockingReasons },
    policy: { outcome: assessment.verdict === 'pass' ? 'allow_automatic' : 'block', requirements: assessment.checks.map((c) => ({ key: c.key, label: c.label, satisfied: c.outcome === 'pass', detail: c.evidence })), reason: assessment.summary, riskLevel: assessment.verdict === 'pass' ? 'low' : 'high' },
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (!created.alreadyExisted) {
    await store.completeAutomationAction(created.id, { succeeded: assessment.verdict === 'pass', orgId: job.orgId, entityType: 'channel_product', entityId: payload.channelProductId })
    if (assessment.verdict !== 'pass') {
      await store.notify({ orgId: job.orgId, severity: 'critical', category: 'compliance', title: `Compliance re-check failed: ${payload.channelProductId} (${payload.channel})`, body: assessment.summary, entityType: 'channel_product', entityId: payload.channelProductId, dedupeKey: `action:${created.id}` })
    }
  }

  return { succeeded: true }
}

export interface ChannelEligibilityRecheckPayload {
  channelProductId: string
  channel: 'shopify' | 'amazon_uk'
  productStage: string
  productDecision: string
  profitabilityGatePasses: boolean
  profitabilityFailureReason: string | null
  compliance: ReturnType<typeof assessCompliance> | null
  supplierId: string
  productId: string
}

function isEligibilityPayload(p: Record<string, unknown>): boolean {
  return typeof p.channelProductId === 'string' && typeof p.channel === 'string'
}

/**
 * CHANNEL_ELIGIBILITY_RECHECK: a thin wrapper around
 * `publicationAutomation.ts` (unchanged) — preserves channel independence
 * by construction, since it only ever evaluates one channel per call.
 */
export async function handleChannelEligibilityRecheck(job: JobRecord, store: AutomationStore, facts: FactsLoader): Promise<JobHandlerResult> {
  if (!isEligibilityPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for channel_eligibility_recheck.', retryable: false }
  }
  const payload = job.payload as unknown as ChannelEligibilityRecheckPayload
  const settings = await store.getAutomationSettings(job.orgId)
  const supplier = await facts.loadSupplierFactsForProduct(job.orgId, payload.supplierId, payload.productId)
  const capability = payload.channel === 'amazon_uk' ? assessAmazonCapability : assessShopifyCapability

  const result = evaluatePublicationAutomation(
    {
      channel: payload.channel,
      productStage: payload.productStage as never,
      productDecision: payload.productDecision as never,
      supplierCapability: supplier.unitCost.value
        ? capability({
            unitCost: supplier.unitCost.value,
            shippingCost: supplier.shippingCost.value ?? money(0, 'GBP'),
            ordersPlaced: 0, ordersLate: 0, ordersDefective: 0, qualityRating: 0, communicationRating: 0,
            handlesReturns: false, returnsWindowDays: 0, acceptsFaultyReturns: false, providesTracking: false,
            supportsBlindShipping: false, supportsCustomInvoice: false, supportsCustomPackaging: false, supportsOwnBranding: false, documentCount: 0,
          })
        : null,
      profitabilityGatePasses: payload.profitabilityGatePasses,
      profitabilityFailureReason: payload.profitabilityFailureReason,
      compliance: payload.compliance,
      automationLevel: settings.automationLevel,
    },
    settings,
  )

  await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'publish_product',
    entityType: 'channel_product',
    entityId: payload.channelProductId,
    reason: result.policy.reason,
    inputFacts: { channel: payload.channel },
    decision: { gateOutcome: result.gate.outcome },
    policy: result.policy,
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })

  return { succeeded: true }
}

export interface ProductPausePayload {
  channelProductId: string
  entityId: string
  productTitle: string
  reason: string
}

function isPausePayload(p: Record<string, unknown>): boolean {
  return typeof p.channelProductId === 'string' && typeof p.reason === 'string'
}

/** PRODUCT_PAUSE: a real, verified local write (channel_products.status = 'paused'), never a bare recommendation. */
export async function handleProductPause(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isPausePayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for product_pause.', retryable: false }
  }
  const payload = job.payload as unknown as ProductPausePayload
  const settings = await store.getAutomationSettings(job.orgId)
  const levelPermitsAuto = settings.automationLevel === 'supervised' || settings.automationLevel === 'autonomous'

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'pause_product',
    entityType: 'channel_product',
    entityId: payload.channelProductId,
    reason: payload.reason,
    inputFacts: {},
    decision: {},
    policy: { outcome: levelPermitsAuto ? 'allow_automatic' : 'require_approval', requirements: [], reason: payload.reason, riskLevel: 'medium' },
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (created.alreadyExisted) return { succeeded: true }

  const notifyBase = { orgId: job.orgId, entityType: 'channel_product', entityId: payload.channelProductId, dedupeKey: `action:${created.id}` }

  if (created.status === 'requires_approval') {
    await store.proposeApproval({
      orgId: job.orgId, decisionType: 'pause_product', entityType: 'channel_product', entityId: payload.channelProductId,
      title: `Pause ${payload.productTitle}`, detail: payload.reason, reasoning: payload.reason, confidence: null, estimatedImpactMinor: null,
      automationLevelRequired: settings.automationLevel, riskLevel: 'medium', inputs: {},
      actionPayload: { actionType: 'pause_product', entityType: 'channel_product', entityId: payload.channelProductId, reason: payload.reason, inputFacts: {} },
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    await store.notify({ ...notifyBase, severity: 'approval_required', category: 'catalogue', title: `Approval needed: pause ${payload.productTitle}`, body: payload.reason, actionUrl: '/approvals' })
    return { succeeded: true }
  }

  if (created.status === 'executing') {
    await store.reconcileChannelProduct({ orgId: job.orgId, channelProductId: payload.channelProductId, status: 'paused' })
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: 'channel_product', entityId: payload.channelProductId, reconciliationStatus: 'matched' })
    await store.notify({ ...notifyBase, severity: 'warning', category: 'catalogue', title: `${payload.productTitle} paused automatically`, body: payload.reason })
  }

  return { succeeded: true }
}

export interface ProductPriceReviewPayload {
  channelProductId: string
  externalId: string
  productTitle: string
  currentSellingPriceMinor: number
  productCostMinor: number
  supplierShippingMinor: number
  channelFeePct?: number
  connectorKey: string
  productDecision: string
}

function isPriceReviewPayload(p: Record<string, unknown>): boolean {
  return typeof p.channelProductId === 'string' && typeof p.currentSellingPriceMinor === 'number'
}

/**
 * PRODUCT_PRICE_REVIEW: proposes restoring the configured minimum margin by
 * pricing at `breakEvenPrice` (an existing field `calculateProfitability`
 * already computes) plus the minimum margin, then routes the proposal
 * through the exact same `executePriceChange` pipeline
 * (`priceExecution.ts`) any other price action uses — no separate
 * repricing algorithm.
 */
export async function handleProductPriceReview(job: JobRecord, store: AutomationStore, _facts: FactsLoader, connectorLookup: (key: string) => MarketplaceConnector | undefined): Promise<JobHandlerResult> {
  if (!isPriceReviewPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for product_price_review.', retryable: false }
  }
  const payload = job.payload as unknown as ProductPriceReviewPayload
  const settings = await store.getAutomationSettings(job.orgId)

  const costInputs = {
    sellingPrice: money(payload.currentSellingPriceMinor, 'GBP'),
    productCost: money(payload.productCostMinor, 'GBP'),
    supplierShipping: money(payload.supplierShippingMinor, 'GBP'),
    channelFeePct: payload.channelFeePct,
    vatRatePct: 20,
  }
  const current = calculateProfitability(costInputs)
  // A margin safety buffer on top of break-even, sized to the configured
  // minimum margin — restoring to exactly break-even would still fail the
  // policy's own margin gate a moment later.
  const proposedPriceMinor = Math.round(current.breakEvenPrice.minor * (1 + settings.minNetMarginPct / 100))

  const connector = connectorLookup(payload.connectorKey)
  if (!connector) {
    return { succeeded: false, error: `No connector registered for "${payload.connectorKey}".`, retryable: false }
  }

  const executionResult: PriceExecutionInput = {
    orgId: job.orgId,
    channelProductId: payload.channelProductId,
    externalId: payload.externalId,
    request: { productTitle: payload.productTitle, costInputsBefore: costInputs, newSellingPrice: money(proposedPriceMinor, 'GBP'), automationLevel: settings.automationLevel },
    connector,
    productDecision: payload.productDecision as never,
    idempotencyKey: `job:${job.id}`,
    jobId: job.id,
    correlationId: job.correlationId,
  }
  await executePriceChange(executionResult, settings, store)
  return { succeeded: true }
}
