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
import { planStageChange } from '@/lib/products/transitions'
import { assessCandidateLifecycleReview, type RecheckKind } from '../candidateLifecycleAutomation'

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

export interface CandidateLifecycleReviewPayload {
  productId: string
  /** The channel whose persisted compliance/profitability verdicts gate this candidate. */
  channel: string
  /** The supplier recorded as fulfilling this product on this channel. `null`/absent leaves every supplier requirement UNKNOWN — never assumed. */
  supplierId?: string | null
}

function isCandidateLifecycleReviewPayload(p: Record<string, unknown>): boolean {
  return typeof p.productId === 'string' && typeof p.channel === 'string'
}

/**
 * Milestone: continuous candidate lifecycle. Injected because
 * `products/lifecycleFactRefresh.ts` is `server-only` (it reaches Supabase
 * and `next/headers` transitively) — the same reason
 * `AdvertisingHandlerDeps.runSync` is injected rather than imported.
 * Production supplies the real refresher in `scheduledJobBatch.ts`; tests
 * supply a real in-memory one, never a mock of the decision itself.
 */
export interface LifecycleHandlerDeps {
  refreshLifecycleFacts: (orgId: string, productId: string, channel: string) => Promise<{ ok: boolean; error?: string }>
  /** Milestone: close the production autonomy gap — the existing `computeProductIntelligence` engine, injected for the same `server-only` reason. */
  refreshProductIntelligence?: (orgId: string, productId: string) => Promise<{ ok: boolean; error?: string }>
}

/**
 * CANDIDATE_LIFECYCLE_REVIEW: the job `candidateIntelligenceMonitor.ts`
 * enqueues, and the one place a candidate advances along the pre-launch
 * lifecycle.
 *
 * Every fact is re-read here, at execution time, rather than trusted from
 * the enqueue-time payload — facts genuinely change between a monitor
 * detecting something and a worker acting on it, and a transition decided
 * on stale facts is exactly the failure this re-read prevents.
 *
 * The decision itself is `assessCandidateLifecycleReview` (pure), which
 * assembles a three-state gate state and asks `lifecycle.ts`'s own
 * `checkGates`/`nextStages` what may follow. This handler only carries out
 * whatever that decided:
 *
 *   - advance permitted -> write the stage change, audit, notify
 *   - blocked by UNKNOWN facts -> enqueue the real recheck that could
 *     resolve them, so the next cycle retries with a real answer
 *   - blocked by a genuine FAIL -> record the reason, notify, never retry
 *     in a loop
 *
 * `actionType: 'alert_owner'` — no dedicated action type exists for a
 * lifecycle-bookkeeping decision (the same precedent as the stale-facts
 * branch of `handleProductProfitabilityRecheck` above, which reuses
 * `product_pause` for an equally uncategorised case). Still fully
 * policy-gated: the global kill switch and the unconfigured-business-
 * settings fail-closed rule both apply exactly as they do to every other
 * automated action, even though this one is non-monetary and never touches
 * a marketplace or a supplier.
 */
export async function handleCandidateLifecycleReview(job: JobRecord, store: AutomationStore, facts: FactsLoader): Promise<JobHandlerResult> {
  if (!isCandidateLifecycleReviewPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for candidate_lifecycle_review.', retryable: false }
  }
  const payload = job.payload as unknown as CandidateLifecycleReviewPayload
  const settings = await store.getAutomationSettings(job.orgId)

  const [intel, product, verdicts] = await Promise.all([
    facts.loadProductIntelligenceFacts(job.orgId, payload.productId),
    facts.loadProductFacts(job.orgId, payload.productId),
    facts.loadLifecycleVerdictFacts(job.orgId, payload.productId, payload.channel),
  ])

  // The supplier whose economics and approval status gate this candidate is
  // whichever supplier the channel listing records as fulfilling it. When
  // there is none, the supplier requirements stay UNKNOWN — never assumed.
  const supplierId = payload.supplierId ?? null
  const supplier = supplierId ? await facts.loadSupplierFactsForProduct(job.orgId, supplierId, payload.productId) : null
  const supplierStatusFact = payload.channel === 'amazon_uk' ? supplier?.amazonStatus : supplier?.shopifyStatus

  const assessment = assessCandidateLifecycleReview(
    {
      stage: product.stage.value,
      intelligenceRecommendation: intel.recommendation.value,
      intelligenceFreshness: intel.recommendation.freshness,
      supplierChannelStatus: supplierStatusFact?.value ?? null,
      supplierStatusFreshness: supplierStatusFact?.freshness ?? 'unavailable',
      supplierOfferFreshness: supplier?.unitCost.freshness ?? 'unavailable',
      complianceVerdict: verdicts.compliance.value,
      complianceFreshness: verdicts.compliance.freshness,
      profitabilityVerdict: verdicts.profitability.value,
      profitabilityFreshness: verdicts.profitability.freshness,
      businessSettingsConfigured: settings.businessSettingsConfigured,
    },
    settings,
  )
  const { advance, gateState, rechecks, policy } = assessment
  const anchors = {
    complianceAsOf: verdicts.compliance.asOf,
    profitabilityAsOf: verdicts.profitability.asOf,
    intelligenceAsOf: intel.recommendation.asOf,
  }

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'alert_owner',
    entityType: 'product',
    entityId: payload.productId,
    reason: policy.reason,
    inputFacts: {
      channel: payload.channel,
      stage: product.stage.value,
      recommendation: intel.recommendation.value,
      complianceVerdict: verdicts.compliance.value,
      complianceFreshness: verdicts.compliance.freshness,
      profitabilityVerdict: verdicts.profitability.value,
      profitabilityFreshness: verdicts.profitability.freshness,
    },
    decision: {
      wouldAdvanceTo: advance.to,
      unknownRequirements: gateState.unknownKeys,
      failedRequirements: gateState.failedKeys,
    },
    policy,
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (created.alreadyExisted) return { succeeded: true }

  // Blocked by policy (kill switch, unconfigured business settings, or a
  // domain gate that genuinely refused). Recorded, never executed.
  if (policy.outcome !== 'allow_automatic') {
    await store.completeAutomationAction(created.id, { succeeded: false, error: 'Blocked by automation policy.', orgId: job.orgId, entityType: 'product', entityId: payload.productId })

    // An UNKNOWN fact is work to do, not a verdict. Schedule the real
    // recheck that could resolve it so the next cycle can retry — but only
    // when the kill switch itself is not what blocked us, since scheduling
    // work while automation is paused would defeat the pause.
    if (advance.blockedOnlyByUnknowns && shouldScheduleRechecks(policy, settings)) {
      await enqueueRechecks(job, store, payload, rechecks, anchors)
    } else if (gateState.failedKeys.length > 0) {
      await store.notify({
        orgId: job.orgId, severity: 'warning', category: 'discovery',
        title: `Candidate blocked: ${payload.productId}`,
        body: advance.reason,
        entityType: 'product', entityId: payload.productId,
        // Keyed on what actually failed, not on the run — a candidate
        // blocked for the same reason every cycle notifies once, not daily.
        dedupeKey: `candidate-blocked:${job.orgId}:${payload.productId}:${payload.channel}:${gateState.failedKeys.join(',')}`,
      })
    }
    return { succeeded: true }
  }

  if (!advance.to) {
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: 'product', entityId: payload.productId })
    if (advance.blockedOnlyByUnknowns && shouldScheduleRechecks(policy, settings)) await enqueueRechecks(job, store, payload, rechecks, anchors)
    return { succeeded: true }
  }

  const plan = planStageChange({
    orgId: job.orgId,
    productId: payload.productId,
    from: product.stage.value as never,
    to: advance.to,
    reason: `Automatic: ${advance.reason}`,
    actorType: 'system',
    // The same gate state the decision was made on, re-checked inside
    // `planStageChange` itself — so a transition can never be written
    // without the lifecycle's own prerequisites being satisfied, even if
    // this handler had a bug.
    gates: gateState.lifecycleGates,
    evidence: { channel: payload.channel, requirements: gateState.requirements.map((r) => ({ key: r.key, verdict: r.verdict })) },
  })
  if (!plan.ok) {
    // The product moved on its own between the event firing and this job
    // running (a human changed its stage, or another worker advanced it) —
    // a safe no-op, never an error.
    await store.completeAutomationAction(created.id, { succeeded: true, error: plan.error, orgId: job.orgId, entityType: 'product', entityId: payload.productId })
    return { succeeded: true }
  }

  const applied = await store.applyProductStageChange(plan.value)
  await store.completeAutomationAction(created.id, { succeeded: applied.succeeded, error: applied.error, orgId: job.orgId, entityType: 'product', entityId: payload.productId })
  if (applied.succeeded) {
    await store.notify({
      orgId: job.orgId, severity: 'info', category: 'discovery',
      title: `${payload.productId} advanced to ${advance.to}`,
      body: advance.reason,
      entityType: 'product', entityId: payload.productId,
      dedupeKey: `action:${created.id}`,
    })
  }
  return { succeeded: true }
}

/**
 * Whether scheduling a recheck could actually change anything.
 *
 * Two cases where it cannot, and where scheduling anyway would mean doing
 * real work every cycle forever for a guaranteed-identical answer:
 *
 *   - The kill switch is on. Queueing work while paused defeats the pause.
 *   - Business settings are unconfigured. Every threshold behind every
 *     verdict is then a placeholder, `recommendProduct` returns
 *     `unconfigured` by construction, and recomputing would produce exactly
 *     the same non-answer. The blocker there is configuration, not staleness.
 */
function shouldScheduleRechecks(
  policy: { requirements: readonly { key: string; satisfied: boolean }[] },
  settings: { businessSettingsConfigured: boolean },
): boolean {
  const killSwitched = policy.requirements.some((r) => (r.key === 'automation_not_paused' || r.key === 'automation_state_known') && !r.satisfied)
  return !killSwitched && settings.businessSettingsConfigured
}

/**
 * Schedules the real work that could turn an UNKNOWN fact into a real one.
 *
 * The idempotency key matters more than it looks. `enqueueJob` deduplicates
 * against EVERY job ever recorded for a key, not just pending ones, so a
 * key that is stable forever would let a recheck run exactly once in the
 * lifetime of a product and never again — the loop would silently stop
 * being continuous. Each key therefore includes the freshness anchor it is
 * trying to supersede: while a fact stays stale and unchanged, every cycle
 * produces the same key and dedupes to one outstanding job; the moment the
 * fact is genuinely refreshed, its anchor moves and a future staleness is a
 * genuinely new key. That is what makes this both non-repetitive and
 * non-terminal.
 */
async function enqueueRechecks(
  job: JobRecord,
  store: AutomationStore,
  payload: CandidateLifecycleReviewPayload,
  rechecks: readonly RecheckKind[],
  anchors: { complianceAsOf: string | null; profitabilityAsOf: string | null; intelligenceAsOf: string | null },
): Promise<void> {
  for (const kind of rechecks) {
    if (kind === 'lifecycle_facts') {
      await store.enqueueJob({
        orgId: job.orgId,
        jobType: 'candidate_facts_refresh',
        payload: { productId: payload.productId, channel: payload.channel },
        idempotencyKey: `candidate-facts-refresh:${payload.productId}:${payload.channel}:${anchors.complianceAsOf ?? 'never'}|${anchors.profitabilityAsOf ?? 'never'}`,
        correlationId: job.correlationId,
      })
    } else {
      await store.enqueueJob({
        orgId: job.orgId,
        jobType: 'candidate_intelligence_refresh',
        payload: { productId: payload.productId },
        idempotencyKey: `candidate-intelligence-refresh:${payload.productId}:${anchors.intelligenceAsOf ?? 'never'}`,
        correlationId: job.correlationId,
      })
    }
  }
}

/**
 * CANDIDATE_INTELLIGENCE_REFRESH: recomputes one product's opportunity/
 * quality/risk scores and its recommendation through the existing
 * `computeProductIntelligence` engine (`products/intelligence/assemble.ts`)
 * — never a second scoring engine, and never a guessed score.
 *
 * This closes the last human-only link in the candidate loop. Until this
 * existed, intelligence was recomputed only when someone imported a
 * candidate or clicked "recalculate", so a candidate whose score went stale
 * could never become fresh again on its own and would sit blocked forever.
 *
 * Makes no marketplace write of any kind. The engine does read Shopify's
 * Storefront API when a product already has an `external_id`, which is a
 * read; a pre-launch candidate has none, so in practice it touches nothing
 * external at all.
 */
export async function handleCandidateIntelligenceRefresh(
  job: JobRecord,
  store: AutomationStore,
  _facts: FactsLoader,
  _connectors?: unknown,
  _marketDeps?: unknown,
  _advertisingDeps?: unknown,
  lifecycleDeps?: LifecycleHandlerDeps,
): Promise<JobHandlerResult> {
  const payload = job.payload as unknown as { productId?: string }
  if (typeof payload.productId !== 'string') {
    return { succeeded: false, error: 'Malformed payload for candidate_intelligence_refresh.', retryable: false }
  }
  if (!lifecycleDeps?.refreshProductIntelligence) {
    return { succeeded: false, error: 'No product-intelligence refresher is wired into this worker.', retryable: false }
  }

  const settings = await store.getAutomationSettings(job.orgId)
  // Recomputing a score changes no external state and spends nothing, but a
  // pause means the system stops acting on its own — including stopping the
  // work it schedules for itself.
  if (settings.automationPaused || !settings.automationStateKnown) {
    return { succeeded: true }
  }

  const result = await lifecycleDeps.refreshProductIntelligence(job.orgId, payload.productId)
  if (!result.ok) {
    // A failed recompute writes nothing: the previously stored score stays
    // exactly as it was, and the gate keeps reading UNKNOWN rather than
    // inheriting a fabricated verdict.
    return { succeeded: false, error: result.error ?? 'The product intelligence refresh failed.', retryable: true }
  }
  return { succeeded: true }
}

/**
 * CANDIDATE_FACTS_REFRESH: runs the real compliance and profitability
 * assessment for one (product, channel) and persists both verdicts. The
 * assessment itself is `refreshCandidateLifecycleFacts`
 * (`products/lifecycleFactRefresh.ts`), injected because it is
 * `server-only`; this handler adds only the job plumbing around it.
 *
 * Deliberately does NOT re-enqueue a lifecycle review on success: the next
 * monitoring cycle picks the candidate up again and re-evaluates it with
 * the now-fresh facts. Chaining the two here would create a job that
 * schedules a job that schedules a job, with no monitor in between to
 * decide whether it is still worth doing.
 */
export async function handleCandidateFactsRefresh(
  job: JobRecord,
  store: AutomationStore,
  _facts: FactsLoader,
  _connectors?: unknown,
  _marketDeps?: unknown,
  _advertisingDeps?: unknown,
  lifecycleDeps?: LifecycleHandlerDeps,
): Promise<JobHandlerResult> {
  const payload = job.payload as unknown as { productId?: string; channel?: string }
  if (typeof payload.productId !== 'string' || typeof payload.channel !== 'string') {
    return { succeeded: false, error: 'Malformed payload for candidate_facts_refresh.', retryable: false }
  }
  if (!lifecycleDeps?.refreshLifecycleFacts) {
    return { succeeded: false, error: 'No lifecycle fact refresher is wired into this worker.', retryable: false }
  }

  const settings = await store.getAutomationSettings(job.orgId)
  // Reading facts is not an automated *action* on the business — it makes
  // no external call, spends nothing and changes no marketplace state — but
  // it must still stop when the owner has paused automation, since the
  // whole point of a pause is that the system stops acting on its own.
  if (settings.automationPaused || !settings.automationStateKnown) {
    return { succeeded: true }
  }

  const result = await lifecycleDeps.refreshLifecycleFacts(job.orgId, payload.productId, payload.channel)
  if (!result.ok) {
    // A failed refresh writes nothing at all (see `lifecycleFactRefresh.ts`)
    // — a previously valid verdict is never overwritten by a failure — and
    // is retryable, since the cause is usually transient.
    return { succeeded: false, error: result.error ?? 'The lifecycle fact refresh failed.', retryable: true }
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
