import { describe, expect, it } from 'vitest'
import { demoEvaluations, demoSupplierScores } from '@/lib/demo/research'
import { DEMO_SUPPLIERS } from '@/lib/demo/suppliers'
import { demoRedundancyPreview } from '@/lib/demo/redundancy'

/**
 * The demo dataset is not hand-authored: it is the real pipeline's output on
 * fixed inputs. These checks guard the properties that make the demo worth
 * showing, most of which were real bugs caught by actually running the
 * pipeline against the demo data during this milestone.
 */

describe('demo evaluations exercise every gate the brief describes', () => {
  const evaluations = demoEvaluations()

  it('produces at least one result for every recommendation type', () => {
    const actions = new Set(evaluations.map((e) => e.recommendation.action))
    expect(actions.has('test')).toBe(true)
    expect(actions.has('reject')).toBe(true)
  })

  it('includes at least one candidate blocked for high IP risk', () => {
    expect(evaluations.some((e) => e.compliance.amazon_uk.ip.level === 'high')).toBe(true)
  })

  it('includes at least one candidate that is fully eligible on one channel while blocked on the other', () => {
    const divergent = evaluations.filter(
      (e) => e.recommendation.eligibleChannels.length > 0 && e.recommendation.blockedChannels.length > 0,
    )
    expect(divergent.length).toBeGreaterThan(0)
  })

  it('includes at least one candidate whose compliance verdict differs by channel', () => {
    // The weaker but still real form of divergence: Amazon's stricter rules
    // (seller of record, GTIN) can fail a product that Shopify's do not, even
    // before profitability is considered.
    const divergent = evaluations.filter(
      (e) => e.compliance.shopify.verdict !== e.compliance.amazon_uk.verdict,
    )
    expect(divergent.length).toBeGreaterThan(0)
  })

  it('includes at least one regulated product with a documentation requirement', () => {
    expect(evaluations.some((e) => e.compliance.amazon_uk.requiresDocumentation)).toBe(true)
  })

  it('never reports high confidence, because every source is simulated', () => {
    for (const evaluated of evaluations) {
      expect(evaluated.score.confidence).toBeLessThan(0.75)
    }
  })

  it('is deterministic across repeated calls', () => {
    const first = demoEvaluations()
    const second = demoEvaluations()
    expect(first.map((e) => e.score.total)).toEqual(second.map((e) => e.score.total))
  })

  it('every evaluation carries a non-empty recommendation and reasoning', () => {
    for (const evaluated of evaluations) {
      expect(evaluated.recommendation.headline.length).toBeGreaterThan(10)
      expect(evaluated.score.scoredAt).toBeTruthy()
    }
  })

  it('scores every component the scoring engine defines, for every candidate', () => {
    for (const evaluated of evaluations) {
      expect(evaluated.score.components).toHaveLength(19)
    }
  })
})

describe('demo suppliers exercise the per-channel distinction', () => {
  const scores = demoSupplierScores()

  it('scores every demo supplier', () => {
    expect(scores.size).toBe(DEMO_SUPPLIERS.length)
  })

  it('keeps the AliExpress supplier the cheapest and the worst scored', () => {
    const aliexpress = DEMO_SUPPLIERS.find((s) => s.platform === 'aliexpress')!
    const others = DEMO_SUPPLIERS.filter((s) => s.platform !== 'aliexpress')

    const aliexpressLanded = aliexpress.signals.unitCost.minor + aliexpress.signals.shippingCost.minor
    for (const other of others) {
      const otherLanded = other.signals.unitCost.minor + other.signals.shippingCost.minor
      expect(aliexpressLanded).toBeLessThan(otherLanded)
    }

    const aliexpressScore = scores.get(aliexpress.id)!.total
    for (const other of others) {
      expect(aliexpressScore).toBeLessThan(scores.get(other.id)!.total)
    }
  })
})

describe('demo supplier redundancy exercises a real decision, not a fixture', () => {
  it('produces a decision for the scenario supplier', () => {
    const decision = demoRedundancyPreview('sup-1')
    expect(decision).not.toBeNull()
  })

  it('returns null for a supplier with no worked scenario', () => {
    expect(demoRedundancyPreview('sup-2')).toBeNull()
    expect(demoRedundancyPreview('does-not-exist')).toBeNull()
  })

  it('asks for approval under the demo business\'s default automation level', () => {
    const decision = demoRedundancyPreview('sup-1')!
    expect(decision.requiresOwnerApproval).toBe(true)
    expect(decision.outcome).not.toBe('switch_automatically')
  })

  it('considers the real alternative supplier from the demo catalogue', () => {
    const decision = demoRedundancyPreview('sup-1')!
    expect(decision.assessed.length).toBeGreaterThan(0)
    expect(decision.assessed.some((a) => a.candidate.id === 'sup-3')).toBe(true)
  })

  it('is deterministic across repeated calls', () => {
    const first = demoRedundancyPreview('sup-1')!
    const second = demoRedundancyPreview('sup-1')!
    expect(first.outcome).toBe(second.outcome)
    expect(first.assessed.map((a) => a.score.total)).toEqual(second.assessed.map((a) => a.score.total))
  })
})
