import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import type { QualityAssessment } from './qualityScore'
import type { RiskAssessment } from './riskScore'
import type { OpportunityScore } from '../scoring'
import type { CapitalAssessment } from './capitalRanking'
import type { CostLine } from '@/lib/profitability'
import type { ProductRecommendation } from './recommendation'

/**
 * Reads the current, already-computed product intelligence for a product —
 * never recomputes. `computeProductIntelligence` (`./assemble.ts`) is the
 * only thing that writes `product_intelligence`; this is a plain read of
 * whatever it last persisted, joined against the three score rows it
 * pointed at for their full breakdowns.
 */
export interface ProductIntelligenceRow {
  quality: QualityAssessment
  risk: RiskAssessment
  opportunity: OpportunityScore
  capital: CapitalAssessment
  profitabilityBreakdown: readonly CostLine[]
  recommendedPriceMinor: number | null
  minimumViablePriceMinor: number | null
  currency: string
  recommendation: ProductRecommendation
  recommendationReason: string
  computedAt: string
}

export async function getProductIntelligence(orgId: string, productId: string): Promise<ProductIntelligenceRow | null> {
  const supabase = await createServerSupabase()

  const { data } = await supabase
    .from('product_intelligence')
    .select(
      `capital_requirement_minor, capital_efficiency_score, capital_breakdown, profitability_breakdown,
       recommended_price_minor, minimum_viable_price_minor, currency, recommendation, recommendation_reason, computed_at,
       quality:product_health!product_intelligence_quality_score_id_fkey(score, band, components, weights_version, computed_at),
       opportunity:product_scores!product_intelligence_opportunity_score_id_fkey(total_score, band, components, weights_version, rationale, scored_at),
       risk:product_risk_scores!product_intelligence_risk_score_id_fkey(score, band, components, weights_version, computed_at)`,
    )
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .maybeSingle()

  if (!data) return null

  const quality = Array.isArray(data.quality) ? data.quality[0] : data.quality
  const opportunity = Array.isArray(data.opportunity) ? data.opportunity[0] : data.opportunity
  const risk = Array.isArray(data.risk) ? data.risk[0] : data.risk
  if (!quality || !opportunity || !risk) return null

  return {
    quality: {
      total: quality.score,
      band: quality.band as QualityAssessment['band'],
      bandLabel: quality.band,
      components: quality.components as never,
      coverage: 1,
      missing: [],
      weightsVersion: quality.weights_version,
      assessedAt: quality.computed_at,
    },
    risk: {
      total: risk.score,
      band: risk.band as RiskAssessment['band'],
      bandLabel: risk.band,
      components: risk.components as never,
      topConcerns: [],
      coverage: 1,
      weightsVersion: risk.weights_version,
      assessedAt: risk.computed_at,
    },
    opportunity: {
      total: opportunity.total_score,
      band: opportunity.band as OpportunityScore['band'],
      bandLabel: opportunity.band,
      confidence: 1,
      confidenceLabel: '',
      components: opportunity.components as never,
      reasons: opportunity.rationale ? [opportunity.rationale] : [],
      risks: [],
      dataSources: [],
      coverage: 1,
      cap: null,
      weightsVersion: opportunity.weights_version,
      scoredAt: opportunity.scored_at,
    },
    capital: data.capital_breakdown as never,
    profitabilityBreakdown: data.profitability_breakdown as never,
    recommendedPriceMinor: data.recommended_price_minor,
    minimumViablePriceMinor: data.minimum_viable_price_minor,
    currency: data.currency,
    recommendation: data.recommendation,
    recommendationReason: data.recommendation_reason,
    computedAt: data.computed_at,
  }
}
