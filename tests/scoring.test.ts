import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import {
  COMPONENT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  explainScore,
  scoreOpportunity,
  type ScoringSignals,
} from '@/lib/products/scoring'

const CLOCK = new Date('2026-08-22T09:00:00Z')

/** A healthy candidate with every signal present. */
const strong: ScoringSignals = {
  monthlySearchVolume: 20000,
  searchTrendPct: 35,
  estimatedMonthlyUnits: 2000,
  trendDurationMonths: 20,
  seasonalityIndex: 0.15,
  competitorCount: 8,
  topCompetitorReviewCount: 900,
  sellingPrice: fromMajor(30),
  supplierCost: fromMajor(7),
  landedCost: fromMajor(10),
  contributionMarginPct: 32,
  deliveryDaysMax: 3,
  shippingCostShare: 0.07,
  returnRatePct: 2.5,
  reviewSentiment: 0.85,
  complaintSeverity: 0.1,
  productComplexity: 0.1,
  regulatoryRisk: 'low',
  ipRisk: 'low',
  supplierReliability: 88,
  sources: { demand: 'official_api', estimatedMargin: 'derived' },
}

describe('opportunity scoring', () => {
  it('weights sum to exactly 100', () => {
    const total = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
  })

  it('scores all nineteen components the brief asks for', () => {
    const result = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.components).toHaveLength(19)
    expect(new Set(result.components.map((c) => c.key)).size).toBe(19)
  })

  it('rates a strong candidate highly and bands it', () => {
    const result = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.total).toBeGreaterThanOrEqual(80)
    expect(['exceptional', 'strong']).toContain(result.band)
  })

  it('is not a black box: every component carries its own basis and source', () => {
    const result = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    for (const component of result.components) {
      expect(component.basis.length).toBeGreaterThan(10)
      expect(component.weight).toBeGreaterThan(0)
      expect(component.source).toBeTruthy()
    }
  })

  it('the total is the sum of the component contributions', () => {
    const result = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    const summed = result.components.reduce((sum, c) => sum + c.contribution, 0)
    expect(Math.round(summed)).toBe(result.total)
  })

  // --- Missing data -------------------------------------------------------

  it('excludes a missing signal rather than scoring it as average', () => {
    const withoutDemand = { ...strong }
    delete (withoutDemand as Partial<ScoringSignals>).monthlySearchVolume
    const result = scoreOpportunity(withoutDemand as ScoringSignals, DEFAULT_THRESHOLDS, CLOCK)

    const demand = result.components.find((c) => c.key === 'demand')!
    expect(demand.score).toBeNull()
    expect(demand.contribution).toBe(0)
    expect(demand.source).toBe('unavailable')
  })

  it('renormalises the remaining weights so an absent signal does not drag the score down', () => {
    const partial = { ...strong }
    delete (partial as Partial<ScoringSignals>).monthlySearchVolume
    delete (partial as Partial<ScoringSignals>).estimatedMonthlyUnits
    const full = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    const reduced = scoreOpportunity(partial as ScoringSignals, DEFAULT_THRESHOLDS, CLOCK)

    // Removing two strong signals lowers confidence, not the score itself.
    expect(reduced.confidence).toBeLessThan(full.confidence)
    expect(Math.abs(reduced.total - full.total)).toBeLessThan(8)
  })

  it('lowers coverage and confidence as data goes missing', () => {
    const sparse: ScoringSignals = {
      sellingPrice: fromMajor(30),
      supplierCost: fromMajor(7),
      landedCost: fromMajor(10),
      contributionMarginPct: 30,
    }
    const result = scoreOpportunity(sparse, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.coverage).toBeLessThan(0.6)
    expect(result.confidence).toBeLessThan(0.6)
    expect(result.risks.join(' ')).toMatch(/had no data/)
  })

  // --- Source quality -----------------------------------------------------

  it('trusts simulated data far less than a first-party API', () => {
    const simulatedSources = Object.fromEntries(
      Object.keys(COMPONENT_WEIGHTS).map((key) => [key, 'simulated' as const]),
    )
    const officialSources = Object.fromEntries(
      Object.keys(COMPONENT_WEIGHTS).map((key) => [key, 'official_api' as const]),
    )

    const simulated = scoreOpportunity({ ...strong, sources: simulatedSources }, DEFAULT_THRESHOLDS, CLOCK)
    const official = scoreOpportunity({ ...strong, sources: officialSources }, DEFAULT_THRESHOLDS, CLOCK)

    // Same score, very different confidence: invented data must not produce
    // conviction.
    expect(simulated.total).toBe(official.total)
    expect(simulated.confidence).toBeLessThan(0.5)
    expect(official.confidence).toBeGreaterThan(0.9)
  })

  // --- Risk caps ----------------------------------------------------------

  it('caps a high IP risk candidate no matter how good it otherwise looks', () => {
    const result = scoreOpportunity({ ...strong, ipRisk: 'high' }, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.total).toBeLessThanOrEqual(45)
    expect(result.cap).not.toBeNull()
    expect(result.cap?.reason).toMatch(/IP risk is high/)
    expect(result.risks[0]).toMatch(/IP risk is high/)
  })

  it('caps a high regulatory risk candidate', () => {
    const result = scoreOpportunity({ ...strong, regulatoryRisk: 'high' }, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.total).toBeLessThanOrEqual(55)
    expect(result.cap?.reason).toMatch(/regulatory risk is high/)
  })

  it('treats unknown risk as a real unknown, not as low', () => {
    const known = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    const unknown = scoreOpportunity({ ...strong, ipRisk: 'unknown' }, DEFAULT_THRESHOLDS, CLOCK)
    expect(unknown.total).toBeLessThan(known.total)

    const component = unknown.components.find((c) => c.key === 'ipRisk')!
    expect(component.basis).toMatch(/not been assessed/)
  })

  // --- Directionality -----------------------------------------------------

  it('scores inverted components so that worse raw values score lower', () => {
    const lowReturns = scoreOpportunity({ ...strong, returnRatePct: 1 }, DEFAULT_THRESHOLDS, CLOCK)
    const highReturns = scoreOpportunity({ ...strong, returnRatePct: 18 }, DEFAULT_THRESHOLDS, CLOCK)
    expect(highReturns.total).toBeLessThan(lowReturns.total)

    const component = lowReturns.components.find((c) => c.key === 'returnRisk')!
    expect(component.inverted).toBe(true)
  })

  it('penalises heavy seasonality', () => {
    const evenDemand = scoreOpportunity({ ...strong, seasonalityIndex: 0.1 }, DEFAULT_THRESHOLDS, CLOCK)
    const seasonal = scoreOpportunity({ ...strong, seasonalityIndex: 0.9 }, DEFAULT_THRESHOLDS, CLOCK)
    expect(seasonal.total).toBeLessThan(evenDemand.total)

    const component = seasonal.components.find((c) => c.key === 'seasonality')!
    expect(component.basis).toMatch(/ties up cash/)
  })

  it('prefers a durable trend to a spike', () => {
    const spike = scoreOpportunity({ ...strong, trendDurationMonths: 1 }, DEFAULT_THRESHOLDS, CLOCK)
    const durable = scoreOpportunity({ ...strong, trendDurationMonths: 24 }, DEFAULT_THRESHOLDS, CLOCK)
    expect(durable.total).toBeGreaterThan(spike.total)
  })

  it('treats an entrenched competitor as a harder barrier than many small ones', () => {
    const entrenched = scoreOpportunity(
      { ...strong, competitorCount: 5, topCompetitorReviewCount: 40000 },
      DEFAULT_THRESHOLDS,
      CLOCK,
    )
    const fragmented = scoreOpportunity(
      { ...strong, competitorCount: 5, topCompetitorReviewCount: 40 },
      DEFAULT_THRESHOLDS,
      CLOCK,
    )
    expect(entrenched.total).toBeLessThan(fragmented.total)
  })

  // --- Explanations -------------------------------------------------------

  it('always produces reasons and risks a person can act on', () => {
    const result = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.reasons.length).toBeGreaterThan(0)
    for (const reason of result.reasons) expect(reason).toContain(':')
  })

  it('names the data sources it used', () => {
    const result = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.dataSources.length).toBeGreaterThan(0)
    expect(result.dataSources).toContain('official_api')
  })

  it('stamps the weights version and the time it was calculated', () => {
    const result = scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.weightsVersion).toBe('opportunity-weights@1')
    expect(result.scoredAt).toBe(CLOCK.toISOString())
  })

  it('explainScore renders score, confidence, reasons, risks and sources', () => {
    const text = explainScore(scoreOpportunity(strong, DEFAULT_THRESHOLDS, CLOCK), 'Test Product')
    expect(text).toMatch(/Test Product scores \d+\/100/)
    expect(text).toMatch(/confidence/)
    expect(text).toMatch(/In favour:/)
    expect(text).toMatch(/covering \d+% of the scoring weight/)
  })

  it('applies configurable band thresholds rather than fixed ones', () => {
    const strict = scoreOpportunity(strong, { exceptional: 99, strong: 98, test: 97, watch: 96 }, CLOCK)
    const lenient = scoreOpportunity(strong, { exceptional: 10, strong: 5, test: 4, watch: 3 }, CLOCK)
    expect(strict.band).toBe('reject')
    expect(lenient.band).toBe('exceptional')
    // Same score either way: only the banding moved.
    expect(strict.total).toBe(lenient.total)
  })

  it('never returns a score outside 0 to 100', () => {
    const awful: ScoringSignals = {
      monthlySearchVolume: 1,
      searchTrendPct: -90,
      estimatedMonthlyUnits: 1,
      trendDurationMonths: 0,
      seasonalityIndex: 1,
      competitorCount: 500,
      topCompetitorReviewCount: 500000,
      sellingPrice: fromMajor(2),
      supplierCost: fromMajor(1.9),
      landedCost: fromMajor(2.5),
      contributionMarginPct: -80,
      deliveryDaysMax: 60,
      shippingCostShare: 0.9,
      returnRatePct: 70,
      reviewSentiment: 0,
      complaintSeverity: 1,
      productComplexity: 1,
      regulatoryRisk: 'high',
      ipRisk: 'high',
      supplierReliability: 0,
    }
    const result = scoreOpportunity(awful, DEFAULT_THRESHOLDS, CLOCK)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
    expect(result.band).toBe('reject')
  })
})
