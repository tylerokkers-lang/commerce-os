/**
 * The deterministic Product Intelligence recommendation (Milestone: product
 * intelligence, Phase 4).
 *
 * Genuinely a different question from `deriveChannelRecommendation`
 * (`@/lib/marketplaces/channelRecommendation.ts`, SELL/WATCH/HOLD/REVIEW/
 * REMOVE): that function answers "is this specific product/channel
 * combination ready to publish right now", derived from the publication
 * gate's pass/fail requirements. This one answers the upstream question —
 * "is this product commercially worth carrying at all" — derived from
 * quality, profitability, compliance, capital and opportunity data before
 * a channel or a listing necessarily exists yet. Neither derives from the
 * other; both are advisory inputs a human weighs when setting the real
 * product/channel decisions (`product_decision`/`channel_product_decisions`).
 *
 * The ladder below is a fixed, ordered set of rules — never a weighted
 * score threshold alone, and never overridable by an AI opinion. Each
 * rule either returns a verdict immediately (with a reason) or falls
 * through to the next.
 */

import type { ComplianceRiskInput } from './riskScore'

export type ProductRecommendation = 'strong_candidate' | 'candidate' | 'review_required' | 'low_priority' | 'do_not_sell' | 'unconfigured'

export interface RecommendationInputs {
  /**
   * Milestone: business-settings configuration layer. `false` whenever the
   * margin/quality/opportunity/risk/VAT thresholds behind this
   * recommendation are `DEMO_AUTOMATION_SETTINGS` placeholders rather than
   * a real, operator-saved `business_settings` row (or the specific VAT
   * rate a VAT-registered business needs but hasn't set yet) — checked
   * first, before any of the checks below, so a placeholder threshold can
   * never produce a confident CANDIDATE/STRONG_CANDIDATE verdict.
   */
  businessSettingsConfigured: boolean
  /**
   * Milestone: economic-model cost completeness (0047). Human-readable
   * reasons `businessSettingsConfigured` is `false` — from
   * `resolveBusinessConfiguration().missingRequired` — folded into the
   * reason string so an operator is told exactly what is still missing,
   * never just "unconfigured." Empty when `businessSettingsConfigured` is
   * `true`.
   */
  missingRequiredSettings: readonly string[]
  profitabilityGatePasses: boolean
  profitabilityFailureReason: string | null
  supplierAssigned: boolean
  worstComplianceVerdict: ComplianceRiskInput | null
  qualityScore: number
  minQualityScore: number
  riskScore: number
  maxRiskScore: number
  capitalStatus: 'not_configured' | 'data_incomplete' | 'insufficient_capital' | 'within_buffer' | 'sufficient'
  capitalEfficiencyScore: number | null
  opportunityScore: number
  minOpportunityScore: number
  /** The threshold above which a fully-clearing product is called a strong candidate rather than merely a candidate. Must be >= minOpportunityScore. */
  strongOpportunityScore: number
}

export interface RecommendationResult {
  recommendation: ProductRecommendation
  reason: string
}

const LABELS: Record<ProductRecommendation, string> = {
  strong_candidate: 'Strong candidate',
  candidate: 'Candidate',
  review_required: 'Review required',
  low_priority: 'Low priority',
  do_not_sell: 'Do not sell',
  unconfigured: 'Unconfigured',
}

export const RECOMMENDATION_LABELS = LABELS

const LOW_CAPITAL_EFFICIENCY_THRESHOLD = 30

export function recommendProduct(inputs: RecommendationInputs): RecommendationResult {
  if (!inputs.businessSettingsConfigured) {
    const missing = inputs.missingRequiredSettings.length > 0 ? ` Specifically missing: ${inputs.missingRequiredSettings.join(' ')}` : ''
    return {
      recommendation: 'unconfigured',
      reason: `The margin, quality, opportunity and risk thresholds behind this figure are placeholder defaults, not a real business decision, until every required business setting is saved.${missing} Configure business settings before treating this as a real recommendation.`,
    }
  }

  if (!inputs.profitabilityGatePasses) {
    return {
      recommendation: 'do_not_sell',
      reason: inputs.profitabilityFailureReason ?? 'The profitability gate does not pass at any price currently on file.',
    }
  }

  if (!inputs.supplierAssigned) {
    return { recommendation: 'do_not_sell', reason: 'No supplier is assigned to this product, so it cannot be fulfilled.' }
  }

  if (inputs.worstComplianceVerdict === 'fail') {
    return { recommendation: 'review_required', reason: 'Compliance has failed on at least one assessed channel and needs a human decision.' }
  }

  if (inputs.worstComplianceVerdict === 'not_assessed' || inputs.worstComplianceVerdict === null) {
    return { recommendation: 'review_required', reason: 'Compliance has not been assessed for this product yet.' }
  }

  if (inputs.qualityScore < inputs.minQualityScore) {
    return {
      recommendation: 'review_required',
      reason: `Product data quality (${inputs.qualityScore}/100) is below the configured minimum of ${inputs.minQualityScore} — the other scores can't be trusted until the missing data is filled in.`,
    }
  }

  if (inputs.riskScore > inputs.maxRiskScore) {
    return {
      recommendation: 'review_required',
      reason: `Risk score (${inputs.riskScore}/100) is above the configured maximum of ${inputs.maxRiskScore}.`,
    }
  }

  if (inputs.capitalStatus === 'insufficient_capital') {
    return {
      recommendation: 'low_priority',
      reason: 'Available operating capital, after the safety buffer, is not enough to fund even one order of this product right now.',
    }
  }

  if (inputs.capitalEfficiencyScore !== null && inputs.capitalEfficiencyScore < LOW_CAPITAL_EFFICIENCY_THRESHOLD) {
    return {
      recommendation: 'low_priority',
      reason: `Capital efficiency (${inputs.capitalEfficiencyScore}/100) is low — this product ties up a lot of cash relative to what it returns, compared with a typical dropshipping order.`,
    }
  }

  if (inputs.opportunityScore < inputs.minOpportunityScore) {
    return {
      recommendation: 'low_priority',
      reason: `Opportunity score (${inputs.opportunityScore}/100) is below the configured minimum of ${inputs.minOpportunityScore}.`,
    }
  }

  if (inputs.opportunityScore >= inputs.strongOpportunityScore) {
    return {
      recommendation: 'strong_candidate',
      reason: `Clears every check: profitable, supplied, compliant, quality score ${inputs.qualityScore}/100, risk score ${inputs.riskScore}/100, and an opportunity score of ${inputs.opportunityScore}/100.`,
    }
  }

  return {
    recommendation: 'candidate',
    reason: `Clears every check with an opportunity score of ${inputs.opportunityScore}/100 — above the ${inputs.minOpportunityScore} minimum but below the ${inputs.strongOpportunityScore} strong-candidate threshold.`,
  }
}
