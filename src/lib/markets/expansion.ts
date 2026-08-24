import type { CurrencyCode } from '@/lib/core/money'
import type { MarketComplianceResult, MarketDescriptor, MarketConnectorStatus } from './types'
import type { MarketProfitabilityResult } from './marketProfitability'
import type { SupplierMarketCapabilityFacts } from './supplierMarketFacts'

/**
 * International expansion intelligence (Milestone 9 §6–7).
 *
 * A pure, deterministic, rule-based engine — no AI model, no invented
 * recommendation. Every input is an already-computed fact or result from
 * an existing engine (`assessMarketCompliance`, `projectMarketProfitability`,
 * a real `SupplierMarketCapabilityFacts` read, a real connector status);
 * this module only combines them into one explainable verdict, in a fixed
 * priority order a reviewer can read top to bottom:
 *
 *   1. A fatal fact (compliance fail, supplier cannot ship, profitability
 *      fails outright) blocks the market — the score is still computed and
 *      shown for context, but it can never override a fatal block. This is
 *      checked BEFORE the score is consulted for anything.
 *   2. A genuinely missing fact (compliance never assessed, supplier
 *      capability never observed, profitability could not be computed)
 *      yields `insufficient_facts` — never silently treated as a pass.
 *   3. Only once every fact is both present and non-fatal does the score
 *      decide `ready` vs `promising` vs `requires_review`.
 */

export const EXPANSION_ENGINE_VERSION = 'market-expansion@1'

export type ExpansionRecommendation = 'ready' | 'promising' | 'requires_review' | 'blocked' | 'insufficient_facts'

export interface ExpansionScoreComponent {
  key: string
  label: string
  /** null means this component could not be scored — a missing fact, not a zero. */
  score: number | null
  weight: number
  reason: string
  factsUsed: readonly string[]
  missingFacts: readonly string[]
}

export interface ExpansionAssessment {
  productId: string
  marketKey: string
  countryCode: string
  currency: CurrencyCode
  recommendation: ExpansionRecommendation
  /** 0-100, renormalised across whichever components were actually scoreable. Never used to override a fatal blocker above. */
  score: number
  components: readonly ExpansionScoreComponent[]
  compliance: MarketComplianceResult
  profitability: MarketProfitabilityResult | null
  supplierCapability: SupplierMarketCapabilityFacts
  marketplaceStatus: MarketConnectorStatus
  blockers: readonly string[]
  missingFacts: readonly string[]
  engineVersion: string
  assessedAt: string
}

const READY_SCORE_THRESHOLD = 80
const PROMISING_SCORE_THRESHOLD = 60

function scaleLinear(value: number, worst: number, best: number): number {
  if (best === worst) return value >= best ? 100 : 0
  const t = (value - worst) / (best - worst)
  return Math.round(Math.max(0, Math.min(1, t)) * 100)
}

function profitabilityComponent(profitability: MarketProfitabilityResult | null): ExpansionScoreComponent {
  if (!profitability) {
    return { key: 'profitability', label: 'Profitability', score: null, weight: 35, reason: 'Profitability could not be computed — a required cost fact is missing.', factsUsed: [], missingFacts: ['market profitability projection'] }
  }
  const marginPct = profitability.native.netMarginPct
  if (marginPct === null) {
    return { key: 'profitability', label: 'Profitability', score: null, weight: 35, reason: 'No net revenue to compute a margin from.', factsUsed: [], missingFacts: ['net revenue'] }
  }
  const score = scaleLinear(marginPct, 0, 25) // 0% margin scores 0; 25%+ scores 100.
  return {
    key: 'profitability', label: 'Profitability', score, weight: 35,
    reason: profitability.gate.passes
      ? `Net margin ${marginPct}% in ${profitability.currency}, clears the profitability gate.`
      : `Net margin ${marginPct}% in ${profitability.currency} — ${profitability.gate.failures[0] ?? 'fails the profitability gate'}.`,
    factsUsed: ['native profitability projection'], missingFacts: [],
  }
}

function complianceComponent(compliance: MarketComplianceResult): ExpansionScoreComponent {
  if (compliance.verdict === 'not_assessed') {
    return { key: 'compliance', label: 'Compliance readiness', score: null, weight: 25, reason: compliance.missingFacts[0] ?? 'Not yet assessed for this market.', factsUsed: [], missingFacts: compliance.missingFacts }
  }
  const score = compliance.verdict === 'pass' ? 100 : compliance.verdict === 'review_required' ? 50 : 0
  return {
    key: 'compliance', label: 'Compliance readiness', score, weight: 25,
    reason: compliance.verdict === 'pass' ? 'All compliance checks pass for this market.' : compliance.blockingReasons[0] ?? `Compliance verdict: ${compliance.verdict}.`,
    factsUsed: compliance.checks.map((c) => c.key), missingFacts: [],
  }
}

function supplierComponent(capability: SupplierMarketCapabilityFacts): ExpansionScoreComponent {
  if (capability.canShip.freshness === 'unavailable' || capability.canShip.freshness === 'unknown' || capability.canShip.value === null) {
    return { key: 'supplier_fulfilment', label: 'Supplier fulfilment capability', score: null, weight: 25, reason: 'No supplier shipping capability has ever been recorded for this country.', factsUsed: [], missingFacts: ['supplier shipping capability for this country'] }
  }
  if (capability.canShip.value === false) {
    return { key: 'supplier_fulfilment', label: 'Supplier fulfilment capability', score: 0, weight: 25, reason: 'The preferred supplier cannot ship to this country.', factsUsed: ['supplier shipping capability'], missingFacts: [] }
  }
  const deliveryDays = capability.deliveryDaysMax.value
  const cancellationPct = capability.cancellationRatePct.value
  const deliveryScore = deliveryDays === null ? 70 : scaleLinear(-deliveryDays, -30, -3) // 3 days or fewer scores 100; 30+ days scores 0.
  const cancellationScore = cancellationPct === null ? 70 : scaleLinear(-cancellationPct, -20, 0) // 0% scores 100; 20%+ scores 0.
  const score = Math.round((deliveryScore + cancellationScore) / 2)
  return {
    key: 'supplier_fulfilment', label: 'Supplier fulfilment capability', score, weight: 25,
    reason: `Can ship${deliveryDays !== null ? `, ${deliveryDays} days delivery` : ''}${cancellationPct !== null ? `, ${cancellationPct}% cancellation rate` : ''}.`,
    factsUsed: ['supplier shipping capability', ...(deliveryDays !== null ? ['delivery days'] : []), ...(cancellationPct !== null ? ['cancellation rate'] : [])],
    missingFacts: [...(deliveryDays === null ? ['delivery estimate'] : []), ...(cancellationPct === null ? ['cancellation rate'] : [])],
  }
}

const MARKETPLACE_STATUS_SCORE: Record<MarketConnectorStatus, number> = {
  connected: 100, demo: 90, degraded: 50, not_configured: 40, planned: 20, error: 0,
}

function marketplaceComponent(status: MarketConnectorStatus): ExpansionScoreComponent {
  return {
    key: 'marketplace_readiness', label: 'Marketplace readiness', score: MARKETPLACE_STATUS_SCORE[status], weight: 10,
    reason: status === 'connected' || status === 'demo' ? 'A connector for this marketplace exists and is reachable.' : status === 'planned' ? 'No connector has been built for this marketplace yet.' : `Connector status: ${status}.`,
    factsUsed: ['marketplace connector status'], missingFacts: [],
  }
}

function fxComponent(profitability: MarketProfitabilityResult | null): ExpansionScoreComponent | null {
  if (!profitability?.comparison && !profitability?.comparisonUnavailableReason) return null // No comparison was requested — this component does not apply.
  if (profitability.comparisonUnavailableReason) {
    return { key: 'fx_stability', label: 'FX stability/freshness', score: null, weight: 5, reason: profitability.comparisonUnavailableReason, factsUsed: [], missingFacts: ['a fresh exchange rate'] }
  }
  const freshness = profitability.comparison!.freshness
  const score = freshness === 'fresh' ? 100 : freshness === 'stale' ? 40 : 0
  return { key: 'fx_stability', label: 'FX stability/freshness', score, weight: 5, reason: `Comparison exchange rate is ${freshness}.`, factsUsed: ['exchange rate'], missingFacts: [] }
}

function combineScore(components: readonly ExpansionScoreComponent[]): number {
  const scored = components.filter((c) => c.score !== null)
  const availableWeight = scored.reduce((sum, c) => sum + c.weight, 0)
  if (availableWeight === 0) return 0
  const weighted = scored.reduce((sum, c) => sum + (c.score as number) * c.weight, 0)
  return Math.round(weighted / availableWeight)
}

export interface EvaluateExpansionInput {
  productId: string
  market: MarketDescriptor
  compliance: MarketComplianceResult
  profitability: MarketProfitabilityResult | null
  supplierCapability: SupplierMarketCapabilityFacts
  marketplaceStatus: MarketConnectorStatus
}

export function evaluateMarketExpansion(input: EvaluateExpansionInput, now: Date = new Date()): ExpansionAssessment {
  const { productId, market, compliance, profitability, supplierCapability, marketplaceStatus } = input

  const components = [
    profitabilityComponent(profitability),
    complianceComponent(compliance),
    supplierComponent(supplierCapability),
    marketplaceComponent(marketplaceStatus),
    fxComponent(profitability),
  ].filter((c): c is ExpansionScoreComponent => c !== null)

  const score = combineScore(components)

  const blockers: string[] = []
  const missingFacts: string[] = []

  const complianceFatal = compliance.verdict === 'fail'
  const supplierFatal = supplierCapability.canShip.value === false && supplierCapability.canShip.freshness !== 'unavailable' && supplierCapability.canShip.freshness !== 'unknown'
  const profitabilityFatal = profitability !== null && !profitability.gate.passes

  if (complianceFatal) blockers.push(...compliance.blockingReasons, ...(compliance.blockingReasons.length === 0 ? ['Compliance assessment failed for this market.'] : []))
  if (supplierFatal) blockers.push('The preferred supplier cannot ship to this country.')
  if (profitabilityFatal) blockers.push(...(profitability!.gate.failures))

  const complianceUnknown = compliance.verdict === 'not_assessed'
  const supplierUnknown = supplierCapability.canShip.freshness === 'unavailable' || supplierCapability.canShip.freshness === 'unknown'
  const profitabilityUnknown = profitability === null

  if (complianceUnknown) missingFacts.push(...compliance.missingFacts)
  if (supplierUnknown) missingFacts.push('Supplier shipping capability for this country has never been recorded.')
  if (profitabilityUnknown) missingFacts.push('Profitability could not be computed — a required cost fact is missing.')

  let recommendation: ExpansionRecommendation
  if (complianceFatal || supplierFatal || profitabilityFatal) {
    recommendation = 'blocked'
  } else if (missingFacts.length > 0) {
    recommendation = 'insufficient_facts'
  } else if (compliance.verdict === 'review_required') {
    recommendation = 'requires_review'
  } else if (marketplaceStatus === 'planned' || marketplaceStatus === 'not_configured' || marketplaceStatus === 'error' || marketplaceStatus === 'degraded') {
    // Operationally unreachable today, whatever else looks good — never `ready`.
    recommendation = score >= PROMISING_SCORE_THRESHOLD ? 'promising' : 'requires_review'
  } else if (score >= READY_SCORE_THRESHOLD) {
    recommendation = 'ready'
  } else if (score >= PROMISING_SCORE_THRESHOLD) {
    recommendation = 'promising'
  } else {
    recommendation = 'requires_review'
  }

  return {
    productId, marketKey: market.marketKey, countryCode: market.countryCode, currency: market.currency,
    recommendation, score, components,
    compliance, profitability, supplierCapability, marketplaceStatus,
    blockers, missingFacts,
    engineVersion: EXPANSION_ENGINE_VERSION, assessedAt: now.toISOString(),
  }
}
