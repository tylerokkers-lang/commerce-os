/**
 * Product Risk Score (Milestone: product intelligence, Phase 4).
 *
 * Deliberately its own number, not folded into the opportunity score:
 * `scoreOpportunity` (`../scoring.ts`) already weighs ipRisk/regulatoryRisk/
 * returnRisk/supplierReliability as market-opportunity inputs, but a
 * business also needs one plain "how risky is this specific product"
 * answer on its own, independent of how attractive the opportunity looks —
 * a high-margin product can still be a bad idea to carry if it's fragile,
 * slow to arrive, or leaning on a supplier with volatile stock.
 *
 * Unlike `scoreOpportunity`'s and `scoreProductQuality`'s components,
 * higher here means MORE risk, not less — matched by the doc comment on
 * `product_risk_scores` (migration 0037). This is never predicted with
 * false precision: every component is a plain read of a real signal, and
 * an unavailable signal is excluded and lowers confidence, never
 * defaulted to "medium."
 */

export const RISK_WEIGHTS_VERSION = 'product-risk-weights@1'

export type ComplianceRiskInput = 'pass' | 'review_required' | 'fail' | 'not_assessed'

export interface RiskSignals {
  /** 0-100 from the supplier scoring engine, when a supplier is assigned. */
  supplierReliabilityScore?: number
  /** Longest quoted delivery time in days, from the assigned supplier. */
  deliveryDaysMax?: number
  /** The least favourable compliance verdict across the channels this product has been assessed for. */
  worstComplianceVerdict?: ComplianceRiskInput
  /** The product quality score (0-100, higher is better) — poor data is itself a risk, since less can be verified. */
  qualityScore?: number
  /** Whether the supplier reports the item as currently in stock. */
  supplierInStock?: boolean
  /** Whether a concrete stock quantity is on file at all, rather than unknown. */
  supplierStockFigureKnown?: boolean
  /** Unit cost as a fraction of available operating capital, 0-1+, when both are known — how much of the business's cash a single bad batch would put at risk. */
  capitalExposureRatio?: number
}

export interface RiskComponent {
  key: string
  label: string
  /** 0-100, higher = more risk. Null when unavailable. */
  score: number | null
  weight: number
  contribution: number
  basis: string
}

export interface RiskAssessment {
  /** 0-100, higher = more risk. */
  total: number
  band: 'low' | 'medium' | 'high' | 'severe'
  bandLabel: string
  components: readonly RiskComponent[]
  topConcerns: readonly string[]
  coverage: number
  weightsVersion: string
  assessedAt: string
}

const WEIGHTS: Readonly<Record<string, number>> = {
  supplierReliability: 25,
  compliance: 25,
  deliveryTime: 15,
  dataQuality: 15,
  stockVolatility: 12,
  capitalExposure: 8,
}

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v))
const linear = (v: number, floor: number, ceiling: number) => clamp(((v - floor) / (ceiling - floor)) * 100)

const COMPLIANCE_RISK: Record<ComplianceRiskInput, number> = {
  pass: 10,
  review_required: 55,
  fail: 95,
  not_assessed: 60, // Unknown is treated as a meaningful risk, not as "probably fine".
}

interface Def {
  key: string
  label: string
  compute: (s: RiskSignals) => { score: number; basis: string } | null
}

const DEFINITIONS: readonly Def[] = [
  {
    key: 'supplierReliability',
    label: 'Supplier reliability',
    compute: (s) =>
      s.supplierReliabilityScore === undefined
        ? null
        : { score: clamp(100 - s.supplierReliabilityScore), basis: `Supplier scores ${Math.round(s.supplierReliabilityScore)}/100 for reliability.` },
  },
  {
    key: 'compliance',
    label: 'Compliance',
    compute: (s) => {
      const verdict = s.worstComplianceVerdict
      if (verdict === undefined) return null
      return {
        score: COMPLIANCE_RISK[verdict],
        basis:
          verdict === 'not_assessed'
            ? 'Compliance has not been assessed on any channel yet.'
            : `Worst compliance verdict across assessed channels is "${verdict}".`,
      }
    },
  },
  {
    key: 'deliveryTime',
    label: 'Delivery time',
    compute: (s) =>
      s.deliveryDaysMax === undefined
        ? null
        : { score: linear(s.deliveryDaysMax, 2, 30), basis: `Up to ${s.deliveryDaysMax} days to the customer.` },
  },
  {
    key: 'dataQuality',
    label: 'Data quality',
    compute: (s) =>
      s.qualityScore === undefined
        ? null
        : { score: clamp(100 - s.qualityScore), basis: `Product quality score is ${s.qualityScore}/100 — weaker data means less can be verified before selling.` },
  },
  {
    key: 'stockVolatility',
    label: 'Stock volatility',
    compute: (s) => {
      if (s.supplierStockFigureKnown === undefined) return null
      if (!s.supplierStockFigureKnown) return { score: 65, basis: 'No stock quantity is on file for the assigned supplier.' }
      if (s.supplierInStock === false) return { score: 90, basis: 'The assigned supplier currently reports this item as out of stock.' }
      return { score: 20, basis: 'The assigned supplier reports this item in stock with a known quantity.' }
    },
  },
  {
    key: 'capitalExposure',
    label: 'Capital exposure',
    compute: (s) =>
      s.capitalExposureRatio === undefined
        ? null
        : { score: linear(s.capitalExposureRatio, 0.01, 0.5), basis: `A single unit's cost is ${(s.capitalExposureRatio * 100).toFixed(1)}% of available operating capital.` },
  },
]

function bandFor(total: number): RiskAssessment['band'] {
  if (total >= 75) return 'severe'
  if (total >= 50) return 'high'
  if (total >= 25) return 'medium'
  return 'low'
}

const BAND_LABELS: Record<RiskAssessment['band'], string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  severe: 'Severe risk',
}

export function scoreProductRisk(signals: RiskSignals, now: Date = new Date()): RiskAssessment {
  const raw = DEFINITIONS.map((def) => ({ def, computed: def.compute(signals) }))

  const availableWeight = raw.filter((r) => r.computed !== null).reduce((sum, r) => sum + WEIGHTS[r.def.key], 0)
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
  const coverage = totalWeight === 0 ? 0 : availableWeight / totalWeight

  const components: RiskComponent[] = raw.map(({ def, computed }) => {
    const weight = WEIGHTS[def.key]
    const normalisedWeight = availableWeight === 0 ? 0 : weight / availableWeight
    return {
      key: def.key,
      label: def.label,
      score: computed === null ? null : Math.round(computed.score * 10) / 10,
      weight,
      contribution: computed === null ? 0 : computed.score * normalisedWeight,
      basis: computed?.basis ?? 'No data available for this component, so it was excluded from the score.',
    }
  })

  const total = Math.round(clamp(components.reduce((sum, c) => sum + c.contribution, 0)))

  const topConcerns = components
    .filter((c) => (c.score ?? 0) >= 55)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 4)
    .map((c) => `${c.label}: ${c.basis}`)

  return {
    total,
    band: bandFor(total),
    bandLabel: BAND_LABELS[bandFor(total)],
    components,
    topConcerns,
    coverage: Math.round(coverage * 100) / 100,
    weightsVersion: RISK_WEIGHTS_VERSION,
    assessedAt: now.toISOString(),
  }
}
