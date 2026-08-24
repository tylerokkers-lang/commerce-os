import { describe, expect, it } from 'vitest'
import { buildRecommendations } from '@/lib/ai/actions/recommend'
import type { FactBundle } from '@/lib/ai/types'

const NOW = '2026-08-24T09:00:00.000Z'

function emptyBundle(overrides: Partial<FactBundle> = {}): FactBundle {
  return {
    generatedAt: NOW, isDemo: false, orgName: 'Test Co', dataSourceFailures: [], currencyCautions: [],
    overallHealth: 'healthy', healthAreas: [], executiveSummary: [],
    priorities: [], complianceIssues: [], channels: [], topOpportunities: [], opportunitySummary: null,
    supplierRisk: [], pendingApprovals: [], products: [],
    ...overrides,
  }
}

describe('buildRecommendations: empty datasets', () => {
  it('an entirely empty, healthy business produces zero recommendations, never a throw', () => {
    expect(() => buildRecommendations(emptyBundle())).not.toThrow()
    expect(buildRecommendations(emptyBundle())).toHaveLength(0)
  })
})

describe('buildRecommendations: loss-making products become UPDATE_PRICE recommendations', () => {
  it('only products with a known, negative margin become a recommendation — unknown margin is never treated as loss-making', () => {
    const bundle = emptyBundle({
      products: [
        { id: 'p1', sku: 'A', title: 'Product A', category: null, stage: 'approved', channels: [{ channel: 'amazon_uk', label: 'Amazon UK', knownNetMarginPct: -10, netProfitMinor: -200 }] },
        { id: 'p2', sku: 'B', title: 'Product B', category: null, stage: 'approved', channels: [{ channel: 'shopify', label: 'Shopify', knownNetMarginPct: null, netProfitMinor: null }] },
        { id: 'p3', sku: 'C', title: 'Product C', category: null, stage: 'approved', channels: [{ channel: 'shopify', label: 'Shopify', knownNetMarginPct: 15, netProfitMinor: 300 }] },
      ],
    })
    const recs = buildRecommendations(bundle)
    const priceRecs = recs.filter((r) => r.type === 'UPDATE_PRICE')
    expect(priceRecs).toHaveLength(1)
    expect(priceRecs[0].targetEntityId).toBe('p1')
    expect(priceRecs[0].requiresApproval).toBe(true)
    expect(priceRecs[0].executable).toBe(true)
  })

  it('worst margin sorts first', () => {
    const bundle = emptyBundle({
      products: [
        { id: 'p1', sku: 'A', title: 'Mild loss', category: null, stage: 'approved', channels: [{ channel: 'amazon_uk', label: 'Amazon UK', knownNetMarginPct: -2, netProfitMinor: -20 }] },
        { id: 'p2', sku: 'B', title: 'Severe loss', category: null, stage: 'approved', channels: [{ channel: 'amazon_uk', label: 'Amazon UK', knownNetMarginPct: -30, netProfitMinor: -600 }] },
      ],
    })
    const recs = buildRecommendations(bundle).filter((r) => r.type === 'UPDATE_PRICE')
    expect(recs[0].targetEntityId).toBe('p2')
  })

  it('a loss-making product that is also compliance-blocked carries that status on the recommendation, never hidden', () => {
    const bundle = emptyBundle({
      products: [{ id: 'p1', sku: 'A', title: 'Product A', category: null, stage: 'approved', channels: [{ channel: 'amazon_uk', label: 'Amazon UK', knownNetMarginPct: -10, netProfitMinor: -200 }] }],
      complianceIssues: [{ productId: 'p1', sku: 'A', title: 'Product A', channel: 'amazon_uk', verdict: 'fail', blockingReasons: ['x'] }],
    })
    const recs = buildRecommendations(bundle).filter((r) => r.type === 'UPDATE_PRICE')
    expect(recs[0].complianceStatus).toBe('blocked')
  })
})

describe('buildRecommendations: compliance issues become review recommendations, never bypassed', () => {
  it('a blocked (fail) issue is never marked executable — a compliance block is never something the AI proposes bypassing', () => {
    const bundle = emptyBundle({
      complianceIssues: [{ productId: 'p1', sku: 'A', title: 'Product A', channel: 'amazon_uk', verdict: 'fail', blockingReasons: ['Cannot ship as seller of record.'] }],
    })
    const recs = buildRecommendations(bundle)
    const complianceRec = recs.find((r) => r.targetEntityId === 'p1')!
    expect(complianceRec.executable).toBe(false)
    expect(complianceRec.requiresApproval).toBe(false)
    expect(complianceRec.complianceStatus).toBe('blocked')
    expect(complianceRec.href).toBe('/compliance')
  })

  it('a review_required issue is distinguished from a fail', () => {
    const bundle = emptyBundle({
      complianceIssues: [{ productId: 'p1', sku: 'A', title: 'Product A', channel: 'amazon_uk', verdict: 'review_required', blockingReasons: [] }],
    })
    const recs = buildRecommendations(bundle)
    expect(recs.find((r) => r.targetEntityId === 'p1')!.complianceStatus).toBe('review_required')
  })
})

describe('buildRecommendations: supplier risk', () => {
  it('a low-scoring supplier is recommended for review, never an automatic switch', () => {
    const bundle = emptyBundle({
      supplierRisk: [{ id: 's1', name: 'Risky Supplier', score: 20, shopifyStatus: 'approved', amazonStatus: 'blocked', statusReason: null, onTimeRatePct: 50 }],
    })
    const recs = buildRecommendations(bundle)
    const supplierRec = recs.find((r) => r.type === 'REVIEW_SUPPLIER')!
    expect(supplierRec).toBeDefined()
    expect(supplierRec.executable).toBe(false)
    expect(supplierRec.targetEntityId).toBe('s1')
  })

  it('a healthy, unblocked supplier is not recommended', () => {
    const bundle = emptyBundle({
      supplierRisk: [{ id: 's1', name: 'Good Supplier', score: 90, shopifyStatus: 'approved', amazonStatus: 'approved', statusReason: null, onTimeRatePct: 98 }],
    })
    expect(buildRecommendations(bundle).some((r) => r.type === 'REVIEW_SUPPLIER')).toBe(false)
  })
})

describe('buildRecommendations: every recommendation is fully labelled', () => {
  it('every recommendation carries a category-labelled supporting fact where facts are provided', () => {
    const bundle = emptyBundle({
      products: [{ id: 'p1', sku: 'A', title: 'Product A', category: null, stage: 'approved', channels: [{ channel: 'amazon_uk', label: 'Amazon UK', knownNetMarginPct: -10, netProfitMinor: -200 }] }],
    })
    const recs = buildRecommendations(bundle)
    for (const r of recs) {
      for (const f of r.supportingFacts) {
        expect(['fact', 'calculated', 'ai_interpretation', 'recommendation', 'assumption']).toContain(f.category)
      }
    }
  })
})
