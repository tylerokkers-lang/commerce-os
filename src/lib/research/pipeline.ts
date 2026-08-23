import { add, toMajor, type Money } from '@/lib/core/money'
import { compareChannels, type ChannelComparison } from '@/lib/profitability/channels'
import {
  assessCompliance,
  canEnterLaunchQueue,
  type ComplianceAssessment,
} from '@/lib/compliance/rules'
import {
  assessAmazonCapability,
  assessShopifyCapability,
  rankSuppliers,
  type ChannelCapability,
  type RankedSupplier,
  type SupplierScore,
  type SupplierSignals,
} from '@/lib/suppliers/scoring'
import {
  DEFAULT_THRESHOLDS,
  scoreOpportunity,
  type OpportunityScore,
  type ScoreThresholds,
  type ScoringSignals,
  type SignalSource,
} from '@/lib/products/scoring'
import { analyseComplaints, type ComplaintAnalysis } from './complaints'
import {
  differentiationCost,
  suggestDifferentiation,
  type DifferentiationSuggestion,
} from './differentiation'
import type { IdentifierRecord } from '@/lib/products/identifiers'
import type { ChannelKey, ProductStage } from '@/lib/core/domain'
import type { ResearchCandidate } from './providers/types'

/**
 * The evaluation pipeline (§8, §9, §14).
 *
 * Runs a research candidate through every gate in the order the business
 * actually needs them:
 *
 *   complaints -> differentiation -> supplier -> profitability per channel
 *   -> compliance per channel -> score -> recommendation
 *
 * Supplier comes before compliance because most Amazon compliance answers
 * depend on what the supplier can do. Compliance comes before the
 * recommendation because a compliance failure is not something a good score can
 * outweigh.
 *
 * Nothing in here spends money, places an order, or lists a product. It
 * produces a recommendation and a queue position; execution stays behind the
 * approval gates (§15 of the milestone brief, §47 of the specification).
 */

export interface SupplierCandidate {
  id: string
  name: string
  country: string | null
  platform: string | null
  signals: SupplierSignals
}

export interface EvaluationContext {
  /** Margin floors from business settings. */
  minGrossMarginPct: number
  minNetMarginPct: number
  /** Opportunity score below which a candidate is not worth testing. */
  minOpportunityScore: number
  /** 0 when the business is not VAT registered. Never assumed to be 20. */
  vatRatePct: number
  maxDeliveryDays: number
  blockedCategories: readonly string[]
  ownBrands: readonly string[]
  restrictedBrands: readonly string[]
  scoreThresholds?: ScoreThresholds
  /** Suppliers that could plausibly supply this candidate. */
  suppliers: readonly SupplierCandidate[]
  /** How much the signals from this provider are worth as evidence. */
  signalSource: SignalSource
}

export interface SupplierSelection {
  chosen: SupplierCandidate | null
  chosenScore: SupplierScore | null
  ranked: readonly RankedSupplier<SupplierCandidate>[]
  shopify: ChannelCapability | null
  amazon: ChannelCapability | null
  /** Explains why the chosen supplier won, especially when it was not cheapest. */
  rationale: string
}

export type RecommendedAction = 'test' | 'watch' | 'reject' | 'review' | 'source_supplier'

export interface Recommendation {
  action: RecommendedAction
  /** The lifecycle stage this candidate should move to next. */
  nextStage: ProductStage
  headline: string
  /** Why, in the owner's terms. Always populated. */
  reasons: readonly string[]
  /** What could go wrong, and what is unknown. Always populated. */
  risks: readonly string[]
  dataSources: readonly string[]
  confidence: number
  confidenceLabel: string
  /** Channels this could legitimately launch on today. */
  eligibleChannels: readonly ChannelKey[]
  /** Channels that are blocked, with the reason. */
  blockedChannels: readonly { channel: ChannelKey; reason: string }[]
  /** True for anything that would commit money or create a live listing. */
  requiresOwnerApproval: boolean
  /** Concrete things to obtain that would unblock this candidate. */
  outstandingRequirements: readonly { label: string; remedy: string }[]
  lastUpdated: string
}

export interface EvaluatedOpportunity {
  candidate: ResearchCandidate
  complaints: ComplaintAnalysis
  differentiation: readonly DifferentiationSuggestion[]
  /** The subset actually priced into the profitability projection. */
  committedDifferentiation: readonly DifferentiationSuggestion[]
  differentiationCost: Money
  supplier: SupplierSelection
  channels: ChannelComparison
  compliance: Record<ChannelKey, ComplianceAssessment>
  score: OpportunityScore
  recommendation: Recommendation
}

const CHANNELS: readonly ChannelKey[] = ['shopify', 'amazon_uk']

/**
 * Chooses a supplier.
 *
 * Ranks on the composite score rather than price, and says so explicitly when
 * the cheapest option was not selected, because that is exactly the decision a
 * reader will want to check.
 */
export function selectSupplier(
  candidate: ResearchCandidate,
  suppliers: readonly SupplierCandidate[],
  now: Date,
): SupplierSelection {
  if (suppliers.length === 0) {
    return {
      chosen: null,
      chosenScore: null,
      ranked: [],
      shopify: null,
      amazon: null,
      rationale:
        'No supplier has been identified for this product yet, so landed cost, delivery time and channel eligibility are all still unknown.',
    }
  }

  const ranked = rankSuppliers(
    suppliers.map((supplier) => ({ supplier, signals: supplier.signals })),
    now,
  )
  const best = ranked[0]

  const cheapest = [...suppliers].sort(
    (a, b) =>
      a.signals.unitCost.minor + a.signals.shippingCost.minor -
      (b.signals.unitCost.minor + b.signals.shippingCost.minor),
  )[0]

  const chosenLanded = best.supplier.signals.unitCost.minor + best.supplier.signals.shippingCost.minor
  const cheapestLanded = cheapest.signals.unitCost.minor + cheapest.signals.shippingCost.minor

  let rationale: string
  if (best.supplier.id === cheapest.id) {
    rationale = `${best.supplier.name} scores ${best.score.total}/100 and is also the cheapest option.`
  } else {
    const premium = toMajor({ minor: chosenLanded - cheapestLanded, currency: 'GBP' })
    rationale =
      `${best.supplier.name} scores ${best.score.total}/100 against ${cheapest.name}'s ` +
      `${ranked.find((r) => r.supplier.id === cheapest.id)?.score.total ?? 0}/100, and was chosen despite costing ` +
      `£${premium.toFixed(2)} more per unit. ${best.score.strengths[0] ?? 'It performs better on the criteria that drive refunds and marketplace metrics.'}`
  }

  return {
    chosen: best.supplier,
    chosenScore: best.score,
    ranked,
    shopify: assessShopifyCapability(best.supplier.signals),
    amazon: assessAmazonCapability(best.supplier.signals),
    rationale,
  }
}

function buildIdentifiers(candidate: ResearchCandidate): readonly IdentifierRecord[] {
  // A research candidate has no identifiers of its own. They arrive from the
  // manufacturer or supplier once the product is real, which is precisely why
  // the Amazon GTIN check fails at this stage rather than being waved through.
  const raw = candidate.raw as { identifiers?: IdentifierRecord[] }
  return raw.identifiers ?? []
}

/** Runs one candidate through every gate. */
export function evaluateCandidate(
  candidate: ResearchCandidate,
  context: EvaluationContext,
  now: Date = new Date(),
): EvaluatedOpportunity {
  // --- 1. What are customers complaining about? -----------------------------
  const complaints = analyseComplaints(candidate.reviewSample ?? [])
  const differentiation = suggestDifferentiation({ analysis: complaints })

  // Only the well-evidenced changes are costed into the plan, capped at three.
  // Loading every suggestion into the cost base would price the product as if
  // we intended to do all of them at once, which is not what anyone would do
  // and would fail products on a plan nobody proposed.
  const committed = differentiation.filter((d) => d.evidenceStrength !== 'weak').slice(0, 3)
  const diffCost = differentiationCost(committed)

  // --- 2. Who could supply it? ----------------------------------------------
  const supplier = selectSupplier(candidate, context.suppliers, now)

  // Where a supplier is known, its actual quote beats the provider's estimate.
  const unitCost = supplier.chosen?.signals.unitCost ?? candidate.estimatedUnitCost
  const shippingCost = supplier.chosen?.signals.shippingCost ?? candidate.estimatedShippingCost

  // Differentiation is not free. Building it into the cost base here means the
  // profitability gate sees the plan we would actually execute, not a cheaper
  // version of it that we have already decided against.
  const productCost = add(unitCost, diffCost)

  // --- 3. Does it make money, on each channel separately? -------------------
  const channels = compareChannels(
    {
      sellingPrice: candidate.estimatedSellingPrice,
      productCost,
      supplierShipping: shippingCost,
      returnRatePct: candidate.expectedReturnRatePct ?? 5,
      vatRatePct: context.vatRatePct,
      vatInclusive: true,
    },
    {
      category: candidate.category,
      sellingPrice: candidate.estimatedSellingPrice,
    },
    {
      minGrossMarginPct: context.minGrossMarginPct,
      minNetMarginPct: context.minNetMarginPct,
    },
  )

  // --- 4. Is it allowed, on each channel separately? ------------------------
  const identifiers = buildIdentifiers(candidate)
  const compliance = Object.fromEntries(
    CHANNELS.map((channel) => {
      const capability =
        channel === 'amazon_uk' ? supplier.amazon : supplier.shopify
      return [
        channel,
        assessCompliance(
          channel,
          {
            title: candidate.title,
            description: candidate.description,
            category: candidate.category,
            brand: candidate.brand,
            hasBattery: candidate.hasBattery,
            isElectrical: candidate.isElectrical,
            isChildrensProduct: candidate.isChildrensProduct,
            isFoodContact: candidate.isFoodContact,
            isCosmetic: candidate.isCosmetic,
            identifiers,
            supplierCapability: capability?.status ?? null,
            supplierCapabilityReasons: capability?.reasons ?? [],
            supplierName: supplier.chosen?.name ?? null,
            documents: [],
            blockedCategories: context.blockedCategories,
            ipInput: {
              title: candidate.title,
              description: candidate.description,
              brand: candidate.brand,
              ownBrands: context.ownBrands,
              category: candidate.category,
              supplierCountry: supplier.chosen?.country ?? candidate.supplierHint?.country ?? null,
              supplierPlatform: supplier.chosen?.platform ?? candidate.supplierHint?.platform ?? null,
              unitCostMinor: unitCost.minor,
              typicalRetailMinor: candidate.estimatedSellingPrice.minor,
              imagesFromSupplier:
                (candidate.raw as { imagesFromSupplier?: boolean }).imagesFromSupplier ?? true,
              hasBrandAuthorisation: false,
              restrictedBrands: context.restrictedBrands,
            },
          },
          now,
        ),
      ]
    }),
  ) as Record<ChannelKey, ComplianceAssessment>

  // --- 5. Score it, using what the earlier stages established ---------------
  const bestProjection = [...channels.projections].sort(
    (a, b) => b.profitability.netProfit.minor - a.profitability.netProfit.minor,
  )[0]

  const source = context.signalSource
  const signals: ScoringSignals = {
    monthlySearchVolume: candidate.monthlySearchVolume,
    searchTrendPct: candidate.searchTrendPct,
    estimatedMonthlyUnits: candidate.estimatedMonthlyUnits,
    trendDurationMonths: candidate.trendDurationMonths,
    seasonalityIndex: candidate.seasonalityIndex,
    competitorCount: candidate.competitorCount,
    topCompetitorReviewCount: candidate.topCompetitorReviewCount,

    sellingPrice: candidate.estimatedSellingPrice,
    supplierCost: unitCost,
    landedCost: bestProjection.landedCost,
    // Comes straight from the profitability engine. Never recomputed here.
    contributionMarginPct: bestProjection.profitability.netMarginPct,

    deliveryDaysMax:
      supplier.chosen?.signals.deliveryDaysMax ?? candidate.supplierHint?.deliveryDaysMax,
    shippingCostShare:
      candidate.estimatedSellingPrice.minor > 0
        ? shippingCost.minor / candidate.estimatedSellingPrice.minor
        : undefined,

    returnRatePct: candidate.expectedReturnRatePct,
    reviewSentiment: complaints.sampleSize > 0 ? complaints.sentiment : undefined,
    complaintSeverity: complaints.sampleSize > 0 ? complaints.overallSeverity : undefined,
    productComplexity: candidate.productComplexity,
    // A regulated product with its documentation on file is a manageable
    // medium risk. The same product without it is high: the duty exists either
    // way, and only the evidence is missing.
    regulatoryRisk: !compliance.amazon_uk.restrictedCategory
      ? 'low'
      : compliance.amazon_uk.checks.some(
            (c) => c.key.startsWith('document:') && c.outcome === 'pass',
          )
        ? 'medium'
        : 'high',
    ipRisk: compliance.amazon_uk.ip.level,
    supplierReliability: supplier.chosenScore?.total,

    sources: {
      monthlySearchVolume: source,
      searchTrendPct: source,
      estimatedMonthlyUnits: source,
      trendDurationMonths: source,
      seasonality: source,
      demand: source,
      demandGrowth: source,
      estimatedSales: source,
      competition: source,
      trendStrength: source,
      reviewSentiment: source,
      customerComplaints: source,
      returnRisk: source,
      productComplexity: source,
      shippingSpeed: supplier.chosen ? 'supplier_feed' : source,
      shippingCost: supplier.chosen ? 'supplier_feed' : source,
      supplierCostRatio: supplier.chosen ? 'supplier_feed' : source,
      supplierReliability: supplier.chosen ? 'derived' : source,
      estimatedMargin: 'derived',
      landedCostRatio: 'derived',
      pricePositioning: 'derived',
      regulatoryRisk: 'derived',
      ipRisk: 'derived',
    },
  }

  const score = scoreOpportunity(signals, context.scoreThresholds ?? DEFAULT_THRESHOLDS, now)

  // --- 6. Recommend ---------------------------------------------------------
  const recommendation = buildRecommendation({
    candidate,
    score,
    channels,
    compliance,
    supplier,
    complaints,
    context,
    now,
  })

  return {
    candidate,
    complaints,
    differentiation,
    committedDifferentiation: committed,
    differentiationCost: diffCost,
    supplier,
    channels,
    compliance,
    score,
    recommendation,
  }
}

interface RecommendationInput {
  candidate: ResearchCandidate
  score: OpportunityScore
  channels: ChannelComparison
  compliance: Record<ChannelKey, ComplianceAssessment>
  supplier: SupplierSelection
  complaints: ComplaintAnalysis
  context: EvaluationContext
  now: Date
}

/**
 * Turns every gate's result into a single recommendation with its reasoning.
 *
 * The order of the checks is the order of authority: compliance outranks
 * money, money outranks the score, and the score only decides between
 * "test" and "watch" once the first two are satisfied.
 */
export function buildRecommendation(input: RecommendationInput): Recommendation {
  const { score, channels, compliance, supplier, complaints, context, now } = input

  const eligibleChannels: ChannelKey[] = []
  const blockedChannels: { channel: ChannelKey; reason: string }[] = []

  for (const channel of CHANNELS) {
    const gate = canEnterLaunchQueue(compliance[channel])
    const projection = channels.projections.find((p) => p.channel === channel)
    const profitable = projection?.gate.passes ?? false

    if (!gate.allowed) {
      blockedChannels.push({ channel, reason: gate.reason })
    } else if (!profitable) {
      blockedChannels.push({
        channel,
        reason: `Compliant, but fails the profitability gate: ${projection?.gate.failures[0] ?? 'margin below the configured minimum.'}`,
      })
    } else {
      eligibleChannels.push(channel)
    }
  }

  const reasons: string[] = [...score.reasons]
  const risks: string[] = [...score.risks]

  // Add the reasoning the score itself does not carry.
  const best = [...channels.projections].sort(
    (a, b) => b.profitability.netProfit.minor - a.profitability.netProfit.minor,
  )[0]
  reasons.unshift(
    `Best channel is ${best.label} at ${best.profitability.netMarginPct === null ? 'an unknown margin' : `${best.profitability.netMarginPct.toFixed(1)}% net margin`} after fees, returns and advertising.`,
  )
  if (supplier.chosen) {
    reasons.push(`Supplier: ${supplier.rationale}`)
  }
  if (complaints.findings.length > 0) {
    reasons.push(
      `Differentiation is available: ${complaints.findings[0].label.toLowerCase()} is the leading complaint in ${Math.round(complaints.findings[0].frequency * 100)}% of sampled reviews.`,
    )
  }

  for (const blocked of blockedChannels) {
    risks.unshift(`${blocked.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'}: ${blocked.reason}`)
  }

  let action: RecommendedAction
  let nextStage: ProductStage
  let headline: string

  // Anything a person has already decided, or must decide, outranks a plan.
  const fundamental = CHANNELS.flatMap((c) => compliance[c].fundamentalBlockers)
  // Things that could be obtained: a certificate, a GTIN, a better supplier.
  const remediable = CHANNELS.flatMap((c) => compliance[c].remediableBlockers)
  const needsReview = CHANNELS.some((c) => compliance[c].verdict === 'review_required')
  // Would it make money anywhere, if the paperwork were sorted out?
  const profitableSomewhere = channels.projections.some((p) => p.gate.passes)

  if (!supplier.chosen) {
    action = 'source_supplier'
    nextStage = 'supplier_review'
    headline = 'Find a supplier before going further. Cost, delivery and channel eligibility are all unknown without one.'
  } else if (eligibleChannels.length === 0 && fundamental.length > 0) {
    action = 'reject'
    nextStage = 'rejected'
    headline = `Blocked on every channel by something that cannot be obtained: ${fundamental[0].label.toLowerCase()}. Rejecting this now avoids spending more time on it.`
  } else if (eligibleChannels.length === 0 && !profitableSomewhere) {
    // No paperwork fixes a product that does not make money.
    action = 'reject'
    nextStage = 'rejected'
    headline = `Does not make money at the assumed price and cost. ${channels.summary}`
  } else if (eligibleChannels.length === 0 && remediable.length > 0) {
    // Fixable. Naming what to obtain is far more useful than a rejection.
    const wanted = [...new Set(remediable.map((c) => c.label.toLowerCase()))]
    action = 'review'
    nextStage = 'compliance_review'
    headline =
      wanted.length === 1
        ? `Viable on the numbers, but held until one requirement is resolved: ${wanted[0]}.`
        : `Viable on the numbers, but held until ${wanted.length} requirements are resolved: ${wanted.join(', ')}.`
  } else if (eligibleChannels.length === 0 && needsReview) {
    action = 'review'
    nextStage = 'compliance_review'
    headline = 'Needs a human decision on compliance before it can go any further.'
  } else if (eligibleChannels.length === 0) {
    action = 'reject'
    nextStage = 'rejected'
    headline = `Not viable on any channel. ${channels.summary}`
  } else if (score.total < context.minOpportunityScore) {
    action = 'watch'
    nextStage = 'researching'
    headline = `Viable on ${eligibleChannels.length === 2 ? 'both channels' : eligibleChannels[0] === 'amazon_uk' ? 'Amazon UK' : 'Shopify'}, but scores ${score.total} against a minimum of ${context.minOpportunityScore}. Worth watching rather than testing.`
  } else if (score.confidence < 0.4) {
    action = 'review'
    nextStage = 'researching'
    headline = `Scores ${score.total}, but on ${score.confidenceLabel.toLowerCase()} confidence data. Verify the demand and cost figures before committing to a test.`
  } else {
    action = 'test'
    nextStage = 'approved'
    headline = `Recommended for testing on ${eligibleChannels.map((c) => (c === 'amazon_uk' ? 'Amazon UK' : 'Shopify')).join(' and ')}.`
  }

  return {
    action,
    nextStage,
    headline,
    reasons,
    risks,
    dataSources: score.dataSources,
    confidence: score.confidence,
    confidenceLabel: score.confidenceLabel,
    eligibleChannels,
    blockedChannels,
    // Anything that would create a live listing or commit money needs the
    // owner. Watching, reviewing and rejecting do not.
    requiresOwnerApproval: action === 'test',
    outstandingRequirements: [
      ...new Map(
        remediable
          .filter((c) => c.remedy)
          .map((c) => [c.key, { label: c.label, remedy: c.remedy as string }]),
      ).values(),
    ],
    lastUpdated: now.toISOString(),
  }
}

/** Renders the recommendation as the block of text a person reads (§14). */
export function explainRecommendation(evaluated: EvaluatedOpportunity): string {
  const { recommendation: rec, score, candidate } = evaluated
  const lines: string[] = []

  lines.push(`${candidate.title}`)
  lines.push(`${rec.headline}`)
  lines.push('')
  lines.push(`Score: ${score.total}/100 (${score.bandLabel})`)
  lines.push(`Confidence: ${rec.confidenceLabel} (${Math.round(rec.confidence * 100)}%)`)

  lines.push('', 'Reasons:')
  for (const reason of rec.reasons.slice(0, 6)) lines.push(`  - ${reason}`)

  if (rec.risks.length > 0) {
    lines.push('', 'Risks:')
    for (const risk of rec.risks.slice(0, 6)) lines.push(`  - ${risk}`)
  }

  lines.push('', `Data sources: ${rec.dataSources.join(', ') || 'none'}`)
  lines.push(`Last updated: ${rec.lastUpdated}`)

  if (rec.requiresOwnerApproval) {
    lines.push('', 'This needs your approval. Nothing has been listed, ordered or spent.')
  }

  return lines.join('\n')
}

/** Convenience for ranking a batch of evaluations. */
export function rankOpportunities(
  evaluations: readonly EvaluatedOpportunity[],
): readonly EvaluatedOpportunity[] {
  return [...evaluations].sort((a, b) => {
    // Recommendations that can act come first, then by score.
    const rank = (e: EvaluatedOpportunity) =>
      ({ test: 0, review: 1, source_supplier: 2, watch: 3, reject: 4 })[e.recommendation.action]
    const byAction = rank(a) - rank(b)
    return byAction !== 0 ? byAction : b.score.total - a.score.total
  })
}

/** Total estimated monthly contribution if every eligible channel is used. */
export function estimatedMonthlyContribution(evaluated: EvaluatedOpportunity): Money | null {
  const units = evaluated.candidate.estimatedMonthlyUnits
  if (units === undefined || evaluated.recommendation.eligibleChannels.length === 0) return null

  const best = [...evaluated.channels.projections]
    .filter((p) => evaluated.recommendation.eligibleChannels.includes(p.channel))
    .sort((a, b) => b.profitability.netProfit.minor - a.profitability.netProfit.minor)[0]

  // A deliberately conservative share of category volume for a new entrant.
  const assumedShare = 0.02
  return {
    minor: Math.round(best.profitability.netProfit.minor * units * assumedShare),
    currency: best.profitability.netProfit.currency,
  }
}

