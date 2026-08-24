import { getMarket } from '@/lib/markets/catalog'
import { assessMarketCompliance } from '@/lib/markets/countryCompliance'
import { getMarketCostProfile } from '@/lib/markets/marketCostProfiles'
import { projectMarketProfitability, resolveMarketProjectionInput, type ForeignCostInput } from '@/lib/markets/marketProfitability'
import { evaluateMarketExpansion } from '@/lib/markets/expansion'
import { resolveMarketStatus } from '@/lib/markets/catalog'
import { fxRateFact } from '@/lib/fx/types'
import type { ComplianceContext } from '@/lib/compliance/rules'
import type { CurrencyCode } from '@/lib/core/money'
import type { AutomationStore, JobRecord } from '../store'
import type { JobHandlerResult } from '../worker'
import type { SupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFacts'
import type { FxRateStore } from '@/lib/fx/types'
import type { MarketExpansionRepository } from '@/lib/markets/repository'

/**
 * Milestone 9 job handlers — MARKET_RECHECK and FX_RECHECK.
 *
 * Neither handler ever enables a market, publishes a listing, or launches
 * a product internationally. Both only recompute the real engines
 * (`assessMarketCompliance`, `projectMarketProfitability`,
 * `evaluateMarketExpansion`), persist the result as the next version in
 * `market_expansion_assessments`, and — only when the recommendation is
 * genuinely `ready` — request the owner's approval via the existing
 * `request_approval` action type. Nothing in this file executes an
 * international launch; that remains a human decision, per the brief's
 * explicit "the default posture should be conservative."
 */

export interface MarketRecheckPayload {
  productId: string
  marketKey: string
  supplierId: string
  complianceContext: ComplianceContext
  profitabilityInput: ForeignCostInput
  comparisonCurrency?: CurrencyCode
}

function isMarketRecheckPayload(p: Record<string, unknown>): boolean {
  return typeof p.productId === 'string' && typeof p.marketKey === 'string' && typeof p.supplierId === 'string' && typeof p.complianceContext === 'object' && p.complianceContext !== null && typeof p.profitabilityInput === 'object' && p.profitabilityInput !== null
}

export interface MarketHandlerDeps {
  supplierMarketFacts: SupplierMarketFactsLoader
  fxStore: FxRateStore
  marketRepository: MarketExpansionRepository
}

export async function handleMarketRecheck(job: JobRecord, store: AutomationStore, _facts: unknown, _connectors: unknown, marketDeps?: MarketHandlerDeps): Promise<JobHandlerResult> {
  if (!isMarketRecheckPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for market_recheck.', retryable: false }
  }
  if (!marketDeps) return { succeeded: false, error: 'market_recheck requires marketDeps (supplierMarketFacts, fxStore, marketRepository), which was not provided.', retryable: false }
  const deps = marketDeps
  const payload = job.payload as unknown as MarketRecheckPayload
  const market = getMarket(payload.marketKey)
  if (!market) return { succeeded: false, error: `No market registered for "${payload.marketKey}".`, retryable: false }

  const settings = await store.getAutomationSettings(job.orgId)
  const compliance = assessMarketCompliance(market, payload.productId, payload.complianceContext)
  const supplierCapability = await deps.supplierMarketFacts.loadSupplierMarketCapability(job.orgId, payload.supplierId, market.countryCode)

  const costProfile = getMarketCostProfile(market.marketKey)
  let profitability = null
  if (costProfile) {
    const now = new Date()
    const costCurrency = payload.profitabilityInput.productCostForeign.currency
    const costFxFact = costCurrency === market.currency
      ? fxRateFact({ base: costCurrency, quote: market.currency, rate: 1, source: 'identity', observedAt: now.toISOString(), retrievedAt: now.toISOString() }, 'automation', now)
      : fxRateFact(await deps.fxStore.getLatestRate(job.orgId, costCurrency as never, market.currency as never), 'automation', now)
    const resolvedInput = resolveMarketProjectionInput(payload.profitabilityInput, market.currency, costFxFact)

    if (resolvedInput.ok) {
      let comparison: Parameters<typeof projectMarketProfitability>[3]
      if (payload.comparisonCurrency) {
        const rate = await deps.fxStore.getLatestRate(job.orgId, market.currency as never, payload.comparisonCurrency as never)
        comparison = { currency: payload.comparisonCurrency, fxFact: fxRateFact(rate, 'automation', now) }
      }
      profitability = projectMarketProfitability(resolvedInput.value, costProfile, { minGrossMarginPct: 10, minNetMarginPct: 5 }, comparison)
    }
  }

  const marketplaceStatusSnapshot = await resolveMarketStatus(market)
  const assessment = evaluateMarketExpansion({
    productId: payload.productId, market, compliance, profitability, supplierCapability,
    marketplaceStatus: marketplaceStatusSnapshot.status,
  })

  await deps.marketRepository.recordExpansionAssessment(job.orgId, assessment, payload as unknown as Record<string, unknown>)

  await store.recordAudit({
    orgId: job.orgId, action: 'AUTOMATION_ACTION_CREATED', entityType: 'market_product', entityId: `${payload.productId}:${market.marketKey}`,
    actorType: 'system', reason: `Market re-check for ${market.label}: ${assessment.recommendation} (score ${assessment.score}/100).`,
  })

  if (assessment.recommendation === 'ready') {
    const created = await store.createAutomationAction({
      orgId: job.orgId, idempotencyKey: `job:${job.id}`, actionType: 'request_approval',
      entityType: 'market_product', entityId: `${payload.productId}:${market.marketKey}`,
      reason: `${market.label} is now assessed as ready: compliance passes, the market is profitable, the supplier can fulfil, and a connector is available. Every real fact clears — this still requires your approval before anything changes.`,
      inputFacts: { marketKey: market.marketKey, score: assessment.score, nativeMarginPct: profitability?.native.netMarginPct ?? null },
      decision: { recommendation: assessment.recommendation, components: assessment.components },
      policy: { outcome: 'require_approval', requirements: assessment.components.map((c) => ({ key: c.key, label: c.label, satisfied: c.score !== null && c.score >= 60, detail: c.reason })), reason: 'International expansion is never automatic, regardless of score.', riskLevel: 'medium' },
      automationLevel: settings.automationLevel, jobId: job.id,
    })
    if (!created.alreadyExisted) {
      await store.notify({
        orgId: job.orgId, severity: 'info', category: 'expansion', title: `${market.label} is ready for expansion`,
        body: `Score ${assessment.score}/100. Compliance, profitability, supplier fulfilment and marketplace readiness all clear. Approval required before anything changes.`,
        entityType: 'market_product', entityId: `${payload.productId}:${market.marketKey}`, dedupeKey: `action:${created.id}`,
      })
    }
  } else if (assessment.blockers.length > 0) {
    await store.notify({
      orgId: job.orgId, severity: 'warning', category: 'expansion', title: `${market.label}: expansion blocked`,
      body: assessment.blockers[0], entityType: 'market_product', entityId: `${payload.productId}:${market.marketKey}`,
      dedupeKey: `market_blocked:${payload.productId}:${market.marketKey}:${assessment.assessedAt}`,
    })
  }

  return { succeeded: true }
}

export interface FxRecheckPayload {
  base: string
  quote: string
  previousRate: number
  newRate: number
}

function isFxRecheckPayload(p: Record<string, unknown>): boolean {
  return typeof p.base === 'string' && typeof p.quote === 'string' && typeof p.newRate === 'number'
}

/**
 * FX_RECHECK: a significant exchange-rate movement was observed. This
 * handler does not recompute any product's profitability itself — it
 * finds every (product, market) pair whose most recent expansion
 * assessment used this currency pair (via `market_expansion_assessments`,
 * never a second discovery mechanism) and chains a `market_recheck` for
 * each, which is where the real recompute happens. Mirrors
 * `handleSupplierPriceChange`'s own "notice, then chain" shape exactly.
 */
export async function handleFxRecheck(job: JobRecord, store: AutomationStore, _facts: unknown, _connectors: unknown, marketDeps?: MarketHandlerDeps): Promise<JobHandlerResult> {
  if (!isFxRecheckPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for fx_recheck.', retryable: false }
  }
  if (!marketDeps) return { succeeded: false, error: 'fx_recheck requires marketDeps (supplierMarketFacts, fxStore, marketRepository), which was not provided.', retryable: false }
  const deps = marketDeps
  const payload = job.payload as unknown as FxRecheckPayload
  const changePct = payload.previousRate > 0 ? ((payload.newRate - payload.previousRate) / payload.previousRate) * 100 : 0

  await store.recordAudit({
    orgId: job.orgId, action: 'AUTOMATION_ACTION_CREATED', entityType: 'fx_pair', entityId: `${payload.base}:${payload.quote}`,
    actorType: 'system', reason: `${payload.base}->${payload.quote} moved ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% (${payload.previousRate} -> ${payload.newRate}); rechecking affected markets.`,
  })

  const affected = await deps.marketRepository.findAssessmentsUsingCurrency(job.orgId, payload.base, payload.quote)
  for (const target of affected) {
    await store.enqueueJob({
      orgId: job.orgId, jobType: 'market_recheck',
      payload: target.recheckPayload,
      idempotencyKey: `fx-recheck:${target.productId}:${target.marketKey}:${job.id}`,
      correlationId: job.correlationId,
    })
  }

  return { succeeded: true }
}
