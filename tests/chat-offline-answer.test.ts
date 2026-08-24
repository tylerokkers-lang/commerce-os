import { describe, expect, it } from 'vitest'
import { buildOfflineAnswer } from '@/lib/ai/offlineAnswer'
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

describe('buildOfflineAnswer: factual grounding', () => {
  it('always states plainly that it is not using the language model', () => {
    const answer = buildOfflineAnswer(emptyBundle(), 'What needs my attention?')
    expect(answer).toContain('AI language reasoning is not connected')
  })

  it('never throws and never fabricates a figure for an empty business', () => {
    const answer = buildOfflineAnswer(emptyBundle(), 'How is the business doing?')
    expect(answer).toContain('HEALTHY')
    expect(answer).not.toMatch(/£\d/)
  })

  it('surfaces real priorities verbatim, in severity order as supplied', () => {
    const bundle = emptyBundle({
      priorities: [
        { id: 'p1', severity: 'critical', category: 'financial_risk', title: 'Revenue has dropped 40%.', detail: '', recommendedNextStep: 'Review /report.', source: 'analytics', actionHref: '/report' },
      ],
    })
    const answer = buildOfflineAnswer(bundle, 'What needs my attention?')
    expect(answer).toContain('Revenue has dropped 40%.')
    expect(answer).toContain('CRITICAL')
  })
})

describe('buildOfflineAnswer: financial questions read the executive summary', () => {
  it('surfaces the real executive-summary figures for a revenue question', () => {
    const bundle = emptyBundle({ executiveSummary: [{ label: 'Revenue (last 30 days)', value: '£12,345.00', status: 'fact' }] })
    const answer = buildOfflineAnswer(bundle, 'What is our revenue?')
    expect(answer).toContain('£12,345.00')
  })
})

describe('buildOfflineAnswer: unavailable data', () => {
  it('names a data-source failure rather than silently omitting it', () => {
    const bundle = emptyBundle({ dataSourceFailures: ['monitoring'] })
    const answer = buildOfflineAnswer(bundle, 'anything')
    expect(answer).toContain('monitoring')
  })

  it('states currency-safety limitations explicitly rather than guessing a number', () => {
    const bundle = emptyBundle({ currencyCautions: ['Overall revenue: Unavailable — mixed currencies cannot be safely aggregated (found GBP, USD).'] })
    const answer = buildOfflineAnswer(bundle, 'What is our revenue?')
    expect(answer).toContain('Currency limitations')
    expect(answer).toContain('mixed currencies')
  })
})

describe('buildOfflineAnswer: compliance visibility', () => {
  it('surfaces a blocked product with its channel and reason', () => {
    const bundle = emptyBundle({
      complianceIssues: [{ productId: 'p1', sku: 'CMO-1001', title: 'Vacuum', channel: 'amazon_uk', verdict: 'fail', blockingReasons: ['Cannot ship as seller of record.'] }],
    })
    const answer = buildOfflineAnswer(bundle, 'Why is this product blocked?')
    expect(answer).toContain('BLOCKED')
    expect(answer).toContain('Amazon UK')
    expect(answer).toContain('Cannot ship as seller of record.')
  })

  it('a channel with no compliance issues says so honestly, never omits the section', () => {
    const answer = buildOfflineAnswer(emptyBundle(), 'Any compliance issues?')
    expect(answer).toContain('No product is currently blocked or under review.')
  })
})

describe('buildOfflineAnswer: channel-specific responses', () => {
  it('keeps channel figures separate, never blended into one line', () => {
    const bundle = emptyBundle({
      channels: [
        { channel: 'shopify', label: 'Shopify', revenue: '£100.00', netRevenue: '£90.00', knownNetMarginPct: 20, lossMakingProductCount: 0 },
        { channel: 'amazon_uk', label: 'Amazon UK', revenue: '£50.00', netRevenue: '£40.00', knownNetMarginPct: null, lossMakingProductCount: 2 },
      ],
    })
    const answer = buildOfflineAnswer(bundle, 'Which marketplace is performing best?')
    expect(answer).toContain('Shopify: revenue £100.00')
    expect(answer).toContain('Amazon UK: revenue £50.00')
  })
})

describe('buildOfflineAnswer: keyword-based ordering is cosmetic only, never a claim of understanding', () => {
  it('a supplier-flavoured question still contains every other section — nothing is dropped, only reordered', () => {
    const bundle = emptyBundle({
      supplierRisk: [{ id: 's1', name: 'Risky Co', score: 20, shopifyStatus: 'approved', amazonStatus: 'blocked', statusReason: null, onTimeRatePct: 50 }],
      complianceIssues: [{ productId: 'p1', sku: 'X', title: 'X', channel: 'amazon_uk', verdict: 'fail', blockingReasons: [] }],
    })
    const answer = buildOfflineAnswer(bundle, 'Which suppliers are highest risk?')
    expect(answer.indexOf('Risky Co')).toBeLessThan(answer.indexOf('Compliance issues'))
    expect(answer).toContain('Compliance issues')
  })
})

describe('buildOfflineAnswer: empty datasets', () => {
  it('an entirely empty business returns a coherent, non-throwing answer', () => {
    expect(() => buildOfflineAnswer(emptyBundle(), '')).not.toThrow()
    const answer = buildOfflineAnswer(emptyBundle(), '')
    expect(answer.length).toBeGreaterThan(0)
  })
})
