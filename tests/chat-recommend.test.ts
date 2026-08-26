import { describe, expect, it } from 'vitest'
import { buildRecommendations } from '@/lib/ai/actions/recommend'
import type { FactBundle } from '@/lib/ai/types'

const NOW = '2026-08-24T09:00:00.000Z'

function emptyBundle(overrides: Partial<FactBundle> = {}): FactBundle {
  return {
    generatedAt: NOW, isDemo: false, orgName: 'Test Co', dataSourceFailures: [], currencyCautions: [],
    overallHealth: 'healthy', healthAreas: [], executiveSummary: [],
    priorities: [], complianceIssues: [], channels: [], topOpportunities: [], opportunitySummary: null,
    supplierRisk: [], pendingApprovals: [], products: [], advertisingCampaigns: [], advertisingScorecard: null,
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

describe('buildRecommendations: advertising campaigns (Milestone 14)', () => {
  function campaign(overrides: Partial<FactBundle['advertisingCampaigns'][number]> = {}): FactBundle['advertisingCampaigns'][number] {
    return {
      campaignKey: 'amazon_uk:camp-1', campaignName: 'Wasteful Campaign', channel: 'amazon_uk', isPaused: false,
      spend: '£280.00', attributedRevenue: '£0.00', roas: 'unavailable — no revenue', acosPct: 'unavailable — no revenue',
      classification: 'wasted_spend', severity: 'critical', reasons: ['Spent with zero conversions.'],
      externalCampaignId: 'camp-1', provider: 'amazon_ads', externalAccountId: 'acct-1', dailyBudgetMinor: 5000, productId: 'p1',
      ...overrides,
    }
  }

  it('a non-healthy campaign becomes an executable REVIEW_CAMPAIGN recommendation', () => {
    const bundle = emptyBundle({ advertisingCampaigns: [campaign()] })
    const recs = buildRecommendations(bundle).filter((r) => r.type === 'REVIEW_CAMPAIGN')
    expect(recs).toHaveLength(1)
    expect(recs[0].targetEntityType).toBe('advertising_campaign')
    expect(recs[0].targetEntityId).toBe('amazon_uk:camp-1')
    expect(recs[0].requiresApproval).toBe(true)
    expect(recs[0].executable).toBe(true)
    expect(recs[0].href).toBe('/advertising')
  })

  it('a healthy campaign is never recommended', () => {
    const bundle = emptyBundle({ advertisingCampaigns: [campaign({ classification: 'healthy', severity: 'info', reasons: [] })] })
    expect(buildRecommendations(bundle).some((r) => r.type === 'REVIEW_CAMPAIGN')).toBe(false)
  })

  it('insufficient_data is never recommended — an honest "not enough data" result is not actionable', () => {
    const bundle = emptyBundle({ advertisingCampaigns: [campaign({ classification: 'insufficient_data', severity: 'info', reasons: ['Too few impressions.'] })] })
    expect(buildRecommendations(bundle).some((r) => r.type === 'REVIEW_CAMPAIGN')).toBe(false)
  })

  it('a scale_opportunity campaign is never a REVIEW_CAMPAIGN — it gets its own, more specific type', () => {
    const bundle = emptyBundle({ advertisingCampaigns: [campaign({ classification: 'scale_opportunity', severity: 'opportunity', reasons: ['ROAS well above minimum.'] })] })
    expect(buildRecommendations(bundle).some((r) => r.type === 'REVIEW_CAMPAIGN')).toBe(false)
  })
})

describe('buildRecommendations: scale_opportunity campaigns (Milestone 23)', () => {
  function campaign(overrides: Partial<FactBundle['advertisingCampaigns'][number]> = {}): FactBundle['advertisingCampaigns'][number] {
    return {
      campaignKey: 'amazon_uk:camp-1', campaignName: 'Star Performer', channel: 'amazon_uk', isPaused: false,
      spend: '£100.00', attributedRevenue: '£600.00', roas: '6.00', acosPct: '16.7%',
      classification: 'scale_opportunity', severity: 'opportunity', reasons: ['ROAS well above minimum.'],
      externalCampaignId: 'camp-1', provider: 'amazon_ads', externalAccountId: 'acct-1', dailyBudgetMinor: 5000, productId: 'p1',
      ...overrides,
    }
  }

  it('an unblocked scale_opportunity campaign becomes an executable INCREASE_BUDGET recommendation', () => {
    const bundle = emptyBundle({ advertisingCampaigns: [campaign()] })
    const recs = buildRecommendations(bundle).filter((r) => r.type === 'INCREASE_BUDGET')
    expect(recs).toHaveLength(1)
    expect(recs[0].targetEntityType).toBe('advertising_campaign')
    expect(recs[0].targetEntityId).toBe('amazon_uk:camp-1')
    expect(recs[0].requiresApproval).toBe(true)
    expect(recs[0].executable).toBe(true)
    expect(recs[0].complianceStatus).toBe('pass')
    expect(recs[0].href).toBe('/advertising')
  })

  it('a scale_opportunity campaign with no known productId still becomes INCREASE_BUDGET — there is genuinely nothing to check it against', () => {
    const bundle = emptyBundle({ advertisingCampaigns: [campaign({ productId: null })] })
    const recs = buildRecommendations(bundle).filter((r) => r.type === 'INCREASE_BUDGET')
    expect(recs).toHaveLength(1)
  })

  it('a scale_opportunity campaign whose product is compliance-BLOCKED on the same channel never becomes INCREASE_BUDGET — it becomes a REVIEW_PRODUCT pointing at /compliance instead', () => {
    const bundle = emptyBundle({
      advertisingCampaigns: [campaign()],
      complianceIssues: [{ productId: 'p1', sku: 'SKU-1', title: 'Star Performer Product', channel: 'amazon_uk', verdict: 'fail', blockingReasons: ['Missing certificate.'] }],
    })
    const recs = buildRecommendations(bundle)
    expect(recs.some((r) => r.type === 'INCREASE_BUDGET')).toBe(false)
    const blocked = recs.find((r) => r.type === 'REVIEW_PRODUCT' && r.targetEntityId === 'p1')
    expect(blocked).toBeDefined()
    expect(blocked!.requiresApproval).toBe(false)
    expect(blocked!.executable).toBe(false)
    expect(blocked!.complianceStatus).toBe('blocked')
    expect(blocked!.href).toBe('/compliance')
  })

  it('a compliance block on a DIFFERENT channel never blocks the scale recommendation — the check is channel-specific, never blanket', () => {
    const bundle = emptyBundle({
      advertisingCampaigns: [campaign()],
      complianceIssues: [{ productId: 'p1', sku: 'SKU-1', title: 'Star Performer Product', channel: 'shopify', verdict: 'fail', blockingReasons: ['Missing certificate.'] }],
    })
    const recs = buildRecommendations(bundle).filter((r) => r.type === 'INCREASE_BUDGET')
    expect(recs).toHaveLength(1)
  })

  it('a compliance review_required (not fail) never blocks the scale recommendation — only an active fail verdict does', () => {
    const bundle = emptyBundle({
      advertisingCampaigns: [campaign()],
      complianceIssues: [{ productId: 'p1', sku: 'SKU-1', title: 'Star Performer Product', channel: 'amazon_uk', verdict: 'review_required', blockingReasons: [] }],
    })
    const recs = buildRecommendations(bundle).filter((r) => r.type === 'INCREASE_BUDGET')
    expect(recs).toHaveLength(1)
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
