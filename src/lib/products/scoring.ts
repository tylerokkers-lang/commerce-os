import { toMajor, type Money } from '@/lib/core/money'

/**
 * Opportunity scoring (§8).
 *
 * The score is never a black box. Every one of the nineteen components is
 * calculated separately, stored with its own weight, basis and data source, and
 * the final number is nothing more than their weighted mean.
 *
 * Two design decisions matter more than the weights:
 *
 *   1. A missing signal is not scored as fifty. It is excluded, the remaining
 *      weights are renormalised, and confidence falls. Treating absent data as
 *      average manufactures certainty that does not exist.
 *
 *   2. High regulatory or IP risk caps the total. A product cannot score its
 *      way past a legal problem by being popular.
 */

export const WEIGHTS_VERSION = 'opportunity-weights@1'

export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown'

/** Where a signal came from, which drives how much confidence it earns. */
export type SignalSource =
  | 'official_api'
  | 'licensed_dataset'
  | 'permitted_public'
  | 'supplier_feed'
  | 'manual_entry'
  | 'simulated'
  | 'derived'

export interface ScoringSignals {
  // --- Demand -------------------------------------------------------------
  /** Monthly search volume for the primary term. */
  monthlySearchVolume?: number
  /** Change in search interest over the last 90 days, as a percentage. */
  searchTrendPct?: number
  /** Units per month the category leader appears to move. */
  estimatedMonthlyUnits?: number
  /** How long the trend has been rising, in months. Longevity, not spikes. */
  trendDurationMonths?: number
  /** 0 = flat year round, 1 = entirely concentrated in one season. */
  seasonalityIndex?: number

  // --- Competition --------------------------------------------------------
  /** Established sellers already offering something equivalent. */
  competitorCount?: number
  /** Review count of the strongest competitor: the real barrier to entry. */
  topCompetitorReviewCount?: number

  // --- Economics ----------------------------------------------------------
  sellingPrice: Money
  supplierCost: Money
  /** Unit cost plus inbound shipping and packaging. */
  landedCost: Money
  /** From the profitability engine. Never recalculated here. */
  contributionMarginPct: number | null

  // --- Logistics ----------------------------------------------------------
  deliveryDaysMax?: number
  /** Supplier shipping as a share of selling price, 0-1. */
  shippingCostShare?: number

  // --- Risk ---------------------------------------------------------------
  returnRatePct?: number
  /** 0 = uniformly negative reviews, 1 = uniformly positive. */
  reviewSentiment?: number
  /** 0 = no meaningful complaints, 1 = severe and frequent. */
  complaintSeverity?: number
  /** 0 = single moulded part, 1 = multi-part powered assembly. */
  productComplexity?: number
  regulatoryRisk?: RiskLevel
  ipRisk?: RiskLevel
  /** Supplier score, 0-100, from the supplier scoring engine. */
  supplierReliability?: number

  /** Which source produced each signal, keyed by signal name. */
  sources?: Partial<Record<string, SignalSource>>
}

export interface ComponentScore {
  key: string
  label: string
  /** 0-100 after normalisation. Null when the signal was not available. */
  score: number | null
  weight: number
  /** score x normalised weight. Zero when unavailable. */
  contribution: number
  /** True when a lower raw value produces a higher score. */
  inverted: boolean
  /** How this component was derived, in words. */
  basis: string
  source: SignalSource | 'unavailable'
}

export type ScoreBand = 'exceptional' | 'strong' | 'test' | 'watch' | 'reject'

export interface ScoreThresholds {
  exceptional: number
  strong: number
  test: number
  watch: number
}

/** Configurable per business (§8 — thresholds must not be fixed in code). */
export const DEFAULT_THRESHOLDS: ScoreThresholds = {
  exceptional: 90,
  strong: 80,
  test: 70,
  watch: 60,
}

export interface OpportunityScore {
  total: number
  band: ScoreBand
  bandLabel: string
  /** 0-1. How much of the weighting was backed by real data, adjusted for source quality. */
  confidence: number
  confidenceLabel: string
  components: readonly ComponentScore[]
  /** The strongest reasons in favour, strongest first. */
  reasons: readonly string[]
  /** Everything working against it, or unknown about it. */
  risks: readonly string[]
  dataSources: readonly SignalSource[]
  /** Share of total weight backed by an available signal, 0-1. */
  coverage: number
  /** Set when a hard risk rule capped the total below the weighted result. */
  cap: { appliedAt: number; reason: string } | null
  weightsVersion: string
  scoredAt: string
}

/** Weights sum to 100. Margin carries the most because margin is the point. */
export const COMPONENT_WEIGHTS: Readonly<Record<string, number>> = {
  estimatedMargin: 14,
  demand: 9,
  demandGrowth: 8,
  competition: 7,
  supplierReliability: 7,
  returnRisk: 6,
  ipRisk: 6,
  shippingSpeed: 5,
  estimatedSales: 5,
  regulatoryRisk: 5,
  reviewSentiment: 4,
  trendStrength: 4,
  customerComplaints: 4,
  landedCostRatio: 3,
  supplierCostRatio: 3,
  pricePositioning: 3,
  shippingCost: 3,
  seasonality: 2,
  productComplexity: 2,
}

/** How much a signal from each source is trusted, 0-1. */
const SOURCE_CONFIDENCE: Record<SignalSource, number> = {
  official_api: 1,
  licensed_dataset: 0.9,
  permitted_public: 0.7,
  supplier_feed: 0.8,
  manual_entry: 0.6,
  derived: 0.85,
  // Simulated data is honest about being worth nothing as evidence. A demo
  // opportunity therefore never reports high confidence, which is correct.
  simulated: 0.35,
}

const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value))

/** Maps a value onto 0-100 between a floor and a ceiling. */
const linear = (value: number, floor: number, ceiling: number): number =>
  clamp(((value - floor) / (ceiling - floor)) * 100)

/** As above, but higher raw values score lower. */
const inverseLinear = (value: number, best: number, worst: number): number =>
  clamp(((worst - value) / (worst - best)) * 100)

const RISK_SCORES: Record<RiskLevel, number> = {
  low: 95,
  medium: 55,
  // Never zero: a high-risk product is capped elsewhere, and a zero here would
  // hide the rest of the picture rather than flag the specific problem.
  high: 15,
  unknown: 40,
}

interface Definition {
  key: string
  label: string
  inverted: boolean
  compute: (signals: ScoringSignals) => { score: number; basis: string } | null
}

const DEFINITIONS: readonly Definition[] = [
  {
    key: 'estimatedMargin',
    label: 'Estimated contribution margin',
    inverted: false,
    compute: (s) => {
      if (s.contributionMarginPct === null || s.contributionMarginPct === undefined) return null
      // 10% is the floor of viability, 40% is excellent for physical goods.
      return {
        score: linear(s.contributionMarginPct, 5, 40),
        basis: `${s.contributionMarginPct.toFixed(1)}% contribution margin from the profitability engine, scored against a 5% floor and a 40% ceiling.`,
      }
    },
  },
  {
    key: 'demand',
    label: 'Demand',
    inverted: false,
    compute: (s) => {
      if (s.monthlySearchVolume === undefined) return null
      // Log scale: 1,000 to 10,000 searches is a far bigger step than
      // 50,000 to 60,000.
      const logged = Math.log10(Math.max(s.monthlySearchVolume, 1))
      return {
        score: linear(logged, 2, 5),
        basis: `${s.monthlySearchVolume.toLocaleString('en-GB')} searches a month, scored on a log scale between 100 and 100,000.`,
      }
    },
  },
  {
    key: 'demandGrowth',
    label: 'Demand growth',
    inverted: false,
    compute: (s) => {
      if (s.searchTrendPct === undefined) return null
      return {
        score: linear(s.searchTrendPct, -20, 60),
        basis: `Search interest ${s.searchTrendPct >= 0 ? 'up' : 'down'} ${Math.abs(s.searchTrendPct).toFixed(0)}% over 90 days.`,
      }
    },
  },
  {
    key: 'competition',
    label: 'Competition',
    inverted: true,
    compute: (s) => {
      if (s.competitorCount === undefined) return null
      const countScore = inverseLinear(s.competitorCount, 3, 60)
      // A single entrenched competitor with thousands of reviews is a harder
      // barrier than twenty new ones, so review depth is weighted equally.
      const reviewScore =
        s.topCompetitorReviewCount === undefined
          ? countScore
          : inverseLinear(Math.log10(Math.max(s.topCompetitorReviewCount, 1)), 1, 4.5)
      return {
        score: (countScore + reviewScore) / 2,
        basis:
          s.topCompetitorReviewCount === undefined
            ? `${s.competitorCount} established competitors.`
            : `${s.competitorCount} established competitors, the strongest holding ${s.topCompetitorReviewCount.toLocaleString('en-GB')} reviews.`,
      }
    },
  },
  {
    key: 'supplierReliability',
    label: 'Supplier reliability',
    inverted: false,
    compute: (s) =>
      s.supplierReliability === undefined
        ? null
        : {
            score: clamp(s.supplierReliability),
            basis: `Supplier score of ${Math.round(s.supplierReliability)}/100 from the supplier scoring engine.`,
          },
  },
  {
    key: 'returnRisk',
    label: 'Return risk',
    inverted: true,
    compute: (s) =>
      s.returnRatePct === undefined
        ? null
        : {
            score: inverseLinear(s.returnRatePct, 1, 20),
            basis: `${s.returnRatePct.toFixed(1)}% expected return rate, scored against a 1% best case and 20% worst case.`,
          },
  },
  {
    key: 'ipRisk',
    label: 'Intellectual property risk',
    inverted: true,
    compute: (s) => {
      const level = s.ipRisk ?? 'unknown'
      return {
        score: RISK_SCORES[level],
        basis:
          level === 'unknown'
            ? 'IP risk has not been assessed, which is treated as a meaningful unknown rather than as low risk.'
            : `IP risk assessed as ${level}.`,
      }
    },
  },
  {
    key: 'shippingSpeed',
    label: 'Delivery speed',
    inverted: true,
    compute: (s) =>
      s.deliveryDaysMax === undefined
        ? null
        : {
            score: inverseLinear(s.deliveryDaysMax, 2, 21),
            basis: `Up to ${s.deliveryDaysMax} days to the customer.`,
          },
  },
  {
    key: 'estimatedSales',
    label: 'Estimated sales volume',
    inverted: false,
    compute: (s) => {
      if (s.estimatedMonthlyUnits === undefined) return null
      const logged = Math.log10(Math.max(s.estimatedMonthlyUnits, 1))
      return {
        score: linear(logged, 1, 3.5),
        basis: `Around ${s.estimatedMonthlyUnits.toLocaleString('en-GB')} units a month across the category.`,
      }
    },
  },
  {
    key: 'regulatoryRisk',
    label: 'Regulatory risk',
    inverted: true,
    compute: (s) => {
      const level = s.regulatoryRisk ?? 'unknown'
      return {
        score: RISK_SCORES[level],
        basis:
          level === 'unknown'
            ? 'Regulatory requirements have not been assessed.'
            : `Regulatory risk assessed as ${level}.`,
      }
    },
  },
  {
    key: 'reviewSentiment',
    label: 'Review sentiment',
    inverted: false,
    compute: (s) =>
      s.reviewSentiment === undefined
        ? null
        : {
            score: clamp(s.reviewSentiment * 100),
            basis: `Sentiment across sampled reviews scores ${(s.reviewSentiment * 100).toFixed(0)} out of 100.`,
          },
  },
  {
    key: 'trendStrength',
    label: 'Trend durability',
    inverted: false,
    compute: (s) =>
      s.trendDurationMonths === undefined
        ? null
        : {
            // A three-week spike and a two-year climb are different things.
            score: linear(s.trendDurationMonths, 1, 24),
            basis: `The trend has been running for ${s.trendDurationMonths} months, which separates a durable shift from a spike.`,
          },
  },
  {
    key: 'customerComplaints',
    label: 'Customer complaints',
    inverted: true,
    compute: (s) =>
      s.complaintSeverity === undefined
        ? null
        : {
            // Severe complaints about the category are a differentiation
            // opportunity, but they are still a risk to inherit.
            score: clamp(100 - s.complaintSeverity * 100),
            basis: `Complaint severity across sampled reviews scores ${(s.complaintSeverity * 100).toFixed(0)} out of 100, where higher means worse.`,
          },
  },
  {
    key: 'landedCostRatio',
    label: 'Landed cost ratio',
    inverted: true,
    compute: (s) => {
      if (s.sellingPrice.minor === 0) return null
      const ratio = s.landedCost.minor / s.sellingPrice.minor
      return {
        score: inverseLinear(ratio, 0.2, 0.7),
        basis: `Landed cost is ${(ratio * 100).toFixed(0)}% of the selling price.`,
      }
    },
  },
  {
    key: 'supplierCostRatio',
    label: 'Supplier cost ratio',
    inverted: true,
    compute: (s) => {
      if (s.sellingPrice.minor === 0) return null
      const ratio = s.supplierCost.minor / s.sellingPrice.minor
      return {
        score: inverseLinear(ratio, 0.15, 0.55),
        basis: `Unit cost is ${(ratio * 100).toFixed(0)}% of the selling price before shipping.`,
      }
    },
  },
  {
    key: 'pricePositioning',
    label: 'Price positioning',
    inverted: false,
    compute: (s) => {
      const price = toMajor(s.sellingPrice)
      if (price <= 0) return null
      // Below about £12 the fixed costs of an order eat the margin; above
      // about £60 conversion falls away without a brand behind it. The sweet
      // spot for an unbranded ecommerce product sits in between.
      const score =
        price < 12
          ? linear(price, 4, 12) * 0.7
          : price <= 60
            ? 100 - Math.abs(price - 30) * 1.2
            : inverseLinear(price, 60, 150)
      return {
        score: clamp(score),
        basis: `£${price.toFixed(2)} selling price. Between £12 and £60 fixed order costs and conversion are both manageable.`,
      }
    },
  },
  {
    key: 'shippingCost',
    label: 'Shipping cost',
    inverted: true,
    compute: (s) =>
      s.shippingCostShare === undefined
        ? null
        : {
            score: inverseLinear(s.shippingCostShare, 0.03, 0.3),
            basis: `Shipping is ${(s.shippingCostShare * 100).toFixed(0)}% of the selling price.`,
          },
  },
  {
    key: 'seasonality',
    label: 'Seasonality',
    inverted: true,
    compute: (s) =>
      s.seasonalityIndex === undefined
        ? null
        : {
            score: clamp(100 - s.seasonalityIndex * 100),
            basis:
              s.seasonalityIndex > 0.6
                ? `Heavily seasonal: ${(s.seasonalityIndex * 100).toFixed(0)}% of demand is concentrated in one part of the year, which ties up cash out of season.`
                : `Demand is reasonably even through the year (${(s.seasonalityIndex * 100).toFixed(0)}% concentration).`,
          },
  },
  {
    key: 'productComplexity',
    label: 'Product complexity',
    inverted: true,
    compute: (s) =>
      s.productComplexity === undefined
        ? null
        : {
            score: clamp(100 - s.productComplexity * 100),
            basis: `Complexity scores ${(s.productComplexity * 100).toFixed(0)} out of 100. More parts and more electronics mean more returns and more support.`,
          },
  },
]

const BAND_LABELS: Record<ScoreBand, string> = {
  exceptional: 'Exceptional',
  strong: 'Strong',
  test: 'Worth testing',
  watch: 'Watch',
  reject: 'Reject',
}

function bandFor(total: number, thresholds: ScoreThresholds): ScoreBand {
  if (total >= thresholds.exceptional) return 'exceptional'
  if (total >= thresholds.strong) return 'strong'
  if (total >= thresholds.test) return 'test'
  if (total >= thresholds.watch) return 'watch'
  return 'reject'
}

function confidenceLabelFor(confidence: number): string {
  if (confidence >= 0.8) return 'High'
  if (confidence >= 0.6) return 'Moderate'
  if (confidence >= 0.4) return 'Low'
  return 'Very low'
}

/**
 * Scores an opportunity.
 *
 * The returned object is everything needed to explain the number to a person:
 * each component, its weight and basis, the reasons for and against, the data
 * sources involved and when it was calculated.
 */
export function scoreOpportunity(
  signals: ScoringSignals,
  thresholds: ScoreThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): OpportunityScore {
  const sources = signals.sources ?? {}

  const raw = DEFINITIONS.map((definition) => {
    const computed = definition.compute(signals)
    const source: SignalSource | 'unavailable' =
      computed === null ? 'unavailable' : (sources[definition.key] ?? 'derived')
    return { definition, computed, source }
  })

  const availableWeight = raw
    .filter((r) => r.computed !== null)
    .reduce((sum, r) => sum + COMPONENT_WEIGHTS[r.definition.key], 0)
  const totalWeight = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0)
  const coverage = totalWeight === 0 ? 0 : availableWeight / totalWeight

  const components: ComponentScore[] = raw.map(({ definition, computed, source }) => {
    const weight = COMPONENT_WEIGHTS[definition.key]
    // Renormalise across what is actually known, so absent signals neither
    // help nor hurt: they only reduce confidence.
    const normalisedWeight = availableWeight === 0 ? 0 : weight / availableWeight
    return {
      key: definition.key,
      label: definition.label,
      score: computed === null ? null : Math.round(computed.score * 10) / 10,
      weight,
      contribution: computed === null ? 0 : computed.score * normalisedWeight,
      inverted: definition.inverted,
      basis: computed?.basis ?? 'No data available for this component, so it was excluded from the score.',
      source,
    }
  })

  const weighted = components.reduce((sum, c) => sum + c.contribution, 0)
  let total = Math.round(clamp(weighted))

  // Hard caps. A product cannot score its way past a legal problem.
  let cap: OpportunityScore['cap'] = null
  if (signals.ipRisk === 'high') {
    if (total > 45) {
      cap = { appliedAt: 45, reason: 'Capped at 45 because IP risk is high. This needs a human decision, not a score.' }
      total = 45
    }
  } else if (signals.regulatoryRisk === 'high' && total > 55) {
    cap = { appliedAt: 55, reason: 'Capped at 55 because regulatory risk is high and the requirements are not yet established.' }
    total = 55
  }

  // Confidence combines how much is known with how much the sources are worth.
  const weightedSourceQuality =
    availableWeight === 0
      ? 0
      : raw
          .filter((r) => r.computed !== null)
          .reduce(
            (sum, r) =>
              sum +
              COMPONENT_WEIGHTS[r.definition.key] *
                SOURCE_CONFIDENCE[(r.source === 'unavailable' ? 'derived' : r.source) as SignalSource],
            0,
          ) / availableWeight

  const confidence = Math.round(coverage * weightedSourceQuality * 100) / 100

  // Reasons are the components that are both strong and carry real weight;
  // risks are anything weak, unknown, or explicitly flagged.
  const scored = components.filter((c) => c.score !== null)

  const reasons = scored
    .filter((c) => (c.score ?? 0) >= 65)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5)
    .map((c) => `${c.label}: ${c.basis}`)

  const risks: string[] = scored
    .filter((c) => (c.score ?? 100) < 50)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 5)
    .map((c) => `${c.label}: ${c.basis}`)

  const unavailable = components.filter((c) => c.score === null)
  if (unavailable.length > 0) {
    risks.push(
      `${unavailable.length} of ${components.length} components had no data (${unavailable
        .map((c) => c.label.toLowerCase())
        .join(', ')}), so confidence is reduced accordingly.`,
    )
  }
  if (cap) risks.unshift(cap.reason)

  const dataSources = [
    ...new Set(
      components
        .filter((c) => c.source !== 'unavailable')
        .map((c) => c.source as SignalSource),
    ),
  ]

  return {
    total,
    band: bandFor(total, thresholds),
    bandLabel: BAND_LABELS[bandFor(total, thresholds)],
    confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    components,
    reasons,
    risks,
    dataSources,
    coverage: Math.round(coverage * 100) / 100,
    cap,
    weightsVersion: WEIGHTS_VERSION,
    scoredAt: now.toISOString(),
  }
}

/**
 * Renders the score as the paragraph a person actually reads (§14).
 *
 * Kept beside the scoring so the explanation can never drift away from the
 * numbers it describes.
 */
export function explainScore(score: OpportunityScore, title: string): string {
  const lines: string[] = []
  lines.push(
    `${title} scores ${score.total}/100 (${score.bandLabel}) with ${score.confidenceLabel.toLowerCase()} confidence (${Math.round(score.confidence * 100)}%).`,
  )

  if (score.reasons.length > 0) {
    lines.push('', 'In favour:')
    for (const reason of score.reasons) lines.push(`  - ${reason}`)
  }
  if (score.risks.length > 0) {
    lines.push('', 'Risks:')
    for (const risk of score.risks) lines.push(`  - ${risk}`)
  }

  lines.push(
    '',
    `Based on ${score.dataSources.join(', ') || 'no'} data covering ${Math.round(score.coverage * 100)}% of the scoring weight. Calculated ${score.scoredAt}.`,
  )
  return lines.join('\n')
}
