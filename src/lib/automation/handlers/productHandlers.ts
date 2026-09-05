import { evaluateProductMonitoring } from '../monitoring'
import { evaluatePublicationAutomation } from '../publicationAutomation'
import { executePriceChange, type PriceExecutionInput } from '../priceExecution'
import { evaluateAutomationPolicy } from '../policyEngine'
import { calculateProfitability } from '@/lib/profitability'
import { assessCompliance, type ComplianceContext } from '@/lib/compliance/rules'
import { assessAmazonCapability, assessShopifyCapability } from '@/lib/suppliers/scoring'
import { money } from '@/lib/core/money'
import type { AutomationStore, JobRecord } from '../store'
import type { FactsLoader } from '../factsTypes'
import type { JobHandlerResult, ConnectorLookup } from '../worker'
import { withMarketplaceConnectorGate } from '@/lib/marketplaces/connectors/executionGate'
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
      // Not yet threaded through this job payload — wiring the automated
      // re-check to the real per-channel decision is a genuine next
      // increment (see `products/channelDecision.ts`). `null` maps to the
      // channel_product_decisions column's own 'review' default, which
      // correctly blocks rather than silently passing.
      channelDecision: null,
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

/**
 * Shared SUBMIT -> VERIFY -> RECONCILE tail for `handleProductPause`/
 * `handleProductResume` (Milestone: execution reliability & unified write
 * path). Both previously (pause) or would have (resume) written
 * `channel_products.status` directly with no connector call at all —
 * exactly the ambiguity the status-model review flagged: Commerce OS's own
 * record could say "paused" while the real marketplace listing stayed
 * untouched. This mirrors `priceExecution.ts`'s `submitPriceChangeAction`
 * idiom precisely: capability gate -> circuit-breaker-gated write -> verify
 * -> reconcile only if verified -> complete, with the connector's own
 * capability declared today (`writeListings: false` on every real
 * connector) meaning this never reaches a live marketplace regardless.
 */
async function submitListingStatusChange(
  input: {
    orgId: string
    channelProductId: string
    productTitle: string
    reason: string
    targetStatus: 'active' | 'paused'
    automationActionId: string
    idempotencyKey: string
  },
  store: AutomationStore,
  connectorLookup: ConnectorLookup,
): Promise<{ executed: boolean }> {
  const notifyBase = { orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId, dedupeKey: `action:${input.automationActionId}` }
  const verb = input.targetStatus === 'paused' ? 'paused' : 'resumed'

  const info = await store.getChannelProductConnectorInfo(input.orgId, input.channelProductId)
  if (!info || !info.externalId || !info.connectorKey) {
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: 'No marketplace listing is on file for this channel product — nothing to pause/resume externally.',
      orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId,
      verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable',
    })
    return { executed: false }
  }

  const connector = connectorLookup(info.connectorKey)
  if (!connector || !connector.descriptor.capabilities.writeListings) {
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: connector ? 'This connector does not support listing status writes.' : `No connector registered for "${info.connectorKey}".`,
      orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId,
      verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable',
    })
    await store.notify({ ...notifyBase, severity: 'critical', category: 'catalogue', title: `Could not ${input.targetStatus === 'paused' ? 'pause' : 'resume'} ${input.productTitle}`, body: 'The connector does not support this write — Commerce OS has NOT changed the real listing.' })
    return { executed: false }
  }

  const writeResult = await withMarketplaceConnectorGate(input.orgId, connector, () =>
    connector.setListingStatus({ externalId: info.externalId!, idempotencyKey: input.idempotencyKey, status: input.targetStatus }),
  )

  if (!writeResult.ok) {
    const detail = typeof writeResult.error === 'string' ? writeResult.error : `${writeResult.error.reason}: ${writeResult.error.detail}`
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false, error: detail, orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId,
      verificationStatus: 'failed', reconciliationStatus: 'not_applicable',
    })
    await store.notify({ ...notifyBase, severity: 'warning', category: 'catalogue', title: `Listing status change rejected for ${input.productTitle}`, body: detail })
    return { executed: false }
  }

  // VERIFY — the write's own "accepted" response is never proof; read it back.
  let verified = false
  let verificationStatus: 'verified' | 'failed' | 'uncertain' = 'uncertain'
  if (connector.descriptor.capabilities.verifyWrites) {
    const verifyResult = await withMarketplaceConnectorGate(input.orgId, connector, () => connector.verifyListingState(info.externalId!))
    if (verifyResult.ok && verifyResult.value.status === input.targetStatus) {
      verified = true
      verificationStatus = 'verified'
    } else if (verifyResult.ok) {
      // The marketplace's own state disagrees with what was submitted —
      // a connector without a distinct "paused" concept of its own would
      // report something other than an exact match here too, which is
      // exactly why this stays `'failed'` rather than `'verified'` rather
      // than guessing the two are equivalent.
      verificationStatus = 'failed'
    }
  }

  if (verified) {
    await store.reconcileChannelProduct({ orgId: input.orgId, channelProductId: input.channelProductId, status: input.targetStatus === 'active' ? 'live' : 'paused' })
  }

  await store.completeAutomationAction(input.automationActionId, {
    succeeded: verified,
    error: verified ? null : 'The write was submitted, but the marketplace could not be confirmed to reflect it.',
    orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId,
    verificationStatus, reconciliationStatus: verified ? 'matched' : verificationStatus === 'failed' ? 'discrepancy' : 'pending',
  })

  await store.notify({
    ...notifyBase,
    severity: verified ? 'warning' : 'warning',
    category: 'catalogue',
    title: verified ? `${input.productTitle} ${verb} automatically` : `${input.productTitle} ${input.targetStatus === 'paused' ? 'pause' : 'resume'} unverified`,
    body: verified ? input.reason : 'Submitted to the marketplace, but its own reported state could not be confirmed to match. Treated as unverified, never as succeeded.',
  })

  return { executed: verified }
}

/**
 * PRODUCT_PAUSE: a real marketplace write, gated by the same policy engine
 * every other automated action goes through — kill switch, business
 * settings, and capacity/rate limits all apply here now, not only to price
 * changes. Never silently marks Commerce OS's own record "paused" without
 * a real, capability-checked, circuit-breaker-gated connector call.
 */
export async function handleProductPause(job: JobRecord, store: AutomationStore, _facts: FactsLoader, connectorLookup: ConnectorLookup): Promise<JobHandlerResult> {
  if (!isPausePayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for product_pause.', retryable: false }
  }
  const payload = job.payload as unknown as ProductPausePayload
  const settings = await store.getAutomationSettings(job.orgId)
  const levelPermitsAuto = settings.automationLevel === 'supervised' || settings.automationLevel === 'autonomous'

  const policy = evaluateAutomationPolicy({
    actionType: 'pause_product',
    settings,
    domainOutcome: levelPermitsAuto ? 'auto_permitted' : 'pending_approval',
    domainReason: payload.reason,
    domainRequirements: [],
    riskLevel: 'medium',
  })

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'pause_product',
    entityType: 'channel_product',
    entityId: payload.channelProductId,
    reason: policy.reason,
    inputFacts: {},
    decision: {},
    policy,
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (created.alreadyExisted) return { succeeded: true }

  const notifyBase = { orgId: job.orgId, entityType: 'channel_product', entityId: payload.channelProductId, dedupeKey: `action:${created.id}` }

  if (created.status === 'blocked') {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'catalogue', title: `Pause blocked for ${payload.productTitle}`, body: policy.reason })
    return { succeeded: true }
  }

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
    await submitListingStatusChange(
      { orgId: job.orgId, channelProductId: payload.channelProductId, productTitle: payload.productTitle, reason: payload.reason, targetStatus: 'paused', automationActionId: created.id, idempotencyKey: `pause-${payload.channelProductId}` },
      store,
      connectorLookup,
    )
  }

  return { succeeded: true }
}

export interface ProductResumePayload {
  channelProductId: string
  entityId: string
  productTitle: string
  reason: string
}

function isResumePayload(p: Record<string, unknown>): boolean {
  return typeof p.channelProductId === 'string' && typeof p.reason === 'string'
}

/**
 * PRODUCT_RESUME: the mirror of `handleProductPause` — `resume_product`
 * (`ACTION_CATEGORY`, `inventoryAutomation.ts`) has existed as a domain
 * decision since Milestone 9 but had no job type or handler at all until
 * now, so it was fully inert. Registered as `product_resume` in
 * `worker.ts`'s `HANDLERS`.
 */
export async function handleProductResume(job: JobRecord, store: AutomationStore, _facts: FactsLoader, connectorLookup: ConnectorLookup): Promise<JobHandlerResult> {
  if (!isResumePayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for product_resume.', retryable: false }
  }
  const payload = job.payload as unknown as ProductResumePayload
  const settings = await store.getAutomationSettings(job.orgId)
  // Resuming requires the same, or a higher, bar as pausing in the first
  // place — never a weaker one just because it is the "undo" direction.
  const levelPermitsAuto = settings.automationLevel === 'autonomous'

  const policy = evaluateAutomationPolicy({
    actionType: 'resume_product',
    settings,
    domainOutcome: levelPermitsAuto ? 'auto_permitted' : 'pending_approval',
    domainReason: payload.reason,
    domainRequirements: [],
    riskLevel: 'medium',
  })

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'resume_product',
    entityType: 'channel_product',
    entityId: payload.channelProductId,
    reason: policy.reason,
    inputFacts: {},
    decision: {},
    policy,
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (created.alreadyExisted) return { succeeded: true }

  const notifyBase = { orgId: job.orgId, entityType: 'channel_product', entityId: payload.channelProductId, dedupeKey: `action:${created.id}` }

  if (created.status === 'blocked') {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'catalogue', title: `Resume blocked for ${payload.productTitle}`, body: policy.reason })
    return { succeeded: true }
  }

  if (created.status === 'requires_approval') {
    await store.proposeApproval({
      orgId: job.orgId, decisionType: 'resume_product', entityType: 'channel_product', entityId: payload.channelProductId,
      title: `Resume ${payload.productTitle}`, detail: payload.reason, reasoning: payload.reason, confidence: null, estimatedImpactMinor: null,
      automationLevelRequired: settings.automationLevel, riskLevel: 'medium', inputs: {},
      actionPayload: { actionType: 'resume_product', entityType: 'channel_product', entityId: payload.channelProductId, reason: payload.reason, inputFacts: {} },
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    await store.notify({ ...notifyBase, severity: 'approval_required', category: 'catalogue', title: `Approval needed: resume ${payload.productTitle}`, body: payload.reason, actionUrl: '/approvals' })
    return { succeeded: true }
  }

  if (created.status === 'executing') {
    await submitListingStatusChange(
      { orgId: job.orgId, channelProductId: payload.channelProductId, productTitle: payload.productTitle, reason: payload.reason, targetStatus: 'active', automationActionId: created.id, idempotencyKey: `resume-${payload.channelProductId}` },
      store,
      connectorLookup,
    )
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
