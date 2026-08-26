import { describe, expect, it } from 'vitest'
import { buildFactBundle, deriveReferences, serializeFactBundle } from '@/lib/ai/factBundle'
import { buildOfflineAnswer } from '@/lib/ai/offlineAnswer'
import { buildAnthropicRequest } from '@/lib/ai/anthropicRequest'
import { buildAdvertisingScorecard, buildCampaignFact, classifyCampaign, groupCampaignRows, latestCampaignIdentity, sumCampaignRows } from '@/lib/analytics/advertisingAnalytics'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import { resolvePeriod } from '@/lib/orders/salesAggregation'
import type { AdvertisingRow } from '@/lib/analytics/liveAdvertisingFacts'
import type { AdvertisingIntelligence, CampaignIntelligence } from '@/lib/analytics/repository'
import type { CEOCommandCentre } from '@/lib/ceo/types'
import type { FactBundle } from '@/lib/ai/types'

/**
 * Milestone 14's chat integration. `bundle.advertisingCampaigns` is
 * exactly the same "code-derived, model never invents/parses this"
 * discipline every other bundle field already follows — these tests prove
 * a real classification survives the round trip through `buildFactBundle`
 * into a string a provider can read, and that the "no tools field" Milestone
 * 12 guarantee is unaffected by any of it (there is no advertising-specific
 * request path — the same `buildAnthropicRequest` handles every topic).
 */

const NOW = '2026-08-24T09:00:00.000Z'
const PERIOD = resolvePeriod('last_30_days', new Date(NOW))

function row(overrides: Partial<AdvertisingRow> = {}): AdvertisingRow {
  return {
    channel: 'amazon_uk', productId: 'p1', campaignName: 'Wasteful Campaign', externalId: 'camp-1',
    periodDate: '2026-08-01', spendMinor: 0, revenueMinor: 0, clicks: 0, impressions: 0, conversions: 0,
    dailyBudgetMinor: null, isPaused: false, provider: 'amazon_ads', externalAccountId: 'acct-1',
    ...overrides,
  }
}

function wastedCampaign(): CampaignIntelligence {
  const rows = Array.from({ length: 14 }, (_, i) => row({ periodDate: `2026-08-${10 + i}`, impressions: 900, clicks: 30, spendMinor: 20000, revenueMinor: 0, conversions: 0 }))
  const groups = groupCampaignRows(rows)
  const [key, groupRows] = [...groups.entries()][0]
  const identity = latestCampaignIdentity(key, groupRows)
  const fact = buildCampaignFact(identity, sumCampaignRows(groupRows), 'GBP', PERIOD.start, PERIOD.end)
  const classification = classifyCampaign(fact, DEMO_AUTOMATION_SETTINGS, null)
  return { fact, classification }
}

function adIntelligence(campaigns: readonly CampaignIntelligence[]): AdvertisingIntelligence {
  return { isDemo: false, period: PERIOD, campaigns, scorecard: buildAdvertisingScorecard(campaigns, 100000, 'GBP'), demoScenarios: [] }
}

function minimalCEO(): CEOCommandCentre {
  return {
    isDemo: false, generatedAt: NOW,
    executiveSummary: {
      isDemo: false, periodLabel: 'Last 30 days',
      revenue: { value: null, status: 'unavailable', source: 'test' }, netRevenue: { value: null, status: 'unavailable', source: 'test' },
      orders: { value: null, status: 'unavailable', source: 'test' }, averageOrderValue: { value: null, status: 'unavailable', source: 'test' },
      refundsValue: { value: null, status: 'unavailable', source: 'test' }, refundRatePct: { value: null, status: 'unavailable', source: 'test' },
      returnRatePct: { value: null, status: 'unavailable', source: 'test' },
      knownNetMarginPct: null, profitDataComplete: false,
    } as never,
    priorities: [], businessHealth: { areas: [], overall: 'unknown' },
    financialPerformance: { channels: [], lossMakingProducts: [], topRevenueProducts: [], topProfitProducts: [] } as never,
    supplierHealth: [], fulfilmentHealth: {} as never, marketReadiness: [], automationHealth: {} as never,
    approvals: [], complianceIssues: [], advertisingIntelligence: adIntelligence([]),
    dataQuality: {} as never, recentActivity: [], demoScenarios: [], dataSourceFailures: [],
  }
}

describe('buildFactBundle: advertising facts (Milestone 14)', () => {
  it('a real classification survives into the bundle, never re-derived', () => {
    const ceo = minimalCEO()
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], advertisingIntelligence: adIntelligence([wastedCampaign()]), now: NOW })
    expect(bundle.advertisingCampaigns).toHaveLength(1)
    expect(bundle.advertisingCampaigns[0].classification).toBe('wasted_spend')
    expect(bundle.advertisingCampaigns[0].campaignName).toBe('Wasteful Campaign')
  })

  it('unavailable ROAS/ACOS remain explicit unavailable strings, never a coerced number', () => {
    const zeroSpend = row({ spendMinor: 0, revenueMinor: 0, impressions: 100, clicks: 5 })
    const groups = groupCampaignRows([zeroSpend])
    const [key, groupRows] = [...groups.entries()][0]
    const identity = latestCampaignIdentity(key, groupRows)
    const fact = buildCampaignFact(identity, sumCampaignRows(groupRows), 'GBP', PERIOD.start, PERIOD.end)
    const classification = classifyCampaign(fact, DEMO_AUTOMATION_SETTINGS, null)
    const ceo = minimalCEO()
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], advertisingIntelligence: adIntelligence([{ fact, classification }]), now: NOW })
    expect(bundle.advertisingCampaigns[0].roas).toContain('unavailable')
  })

  it('no advertising data at all produces an empty, non-throwing bundle', () => {
    const ceo = minimalCEO()
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], now: NOW })
    expect(bundle.advertisingCampaigns).toHaveLength(0)
    expect(bundle.advertisingScorecard).toBeNull()
    expect(() => serializeFactBundle(bundle)).not.toThrow()
  })

  it('references only a non-healthy campaign, and the chip is code-derived (real campaignKey, real href)', () => {
    const ceo = minimalCEO()
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], advertisingIntelligence: adIntelligence([wastedCampaign()]), now: NOW })
    const refs = deriveReferences(bundle)
    const adRef = refs.find((r) => r.type === 'advertising_campaign')
    expect(adRef).toBeDefined()
    expect(adRef!.id).toBe('amazon_uk:camp-1')
    expect(adRef!.href).toBe('/advertising')
  })

  it('serializes into text a provider can read, naming the classification and channel separately', () => {
    const ceo = minimalCEO()
    const bundle = buildFactBundle({ ceo, orgName: 'Test Co', opportunities: [], opportunitySummary: null, suppliers: [], advertisingIntelligence: adIntelligence([wastedCampaign()]), now: NOW })
    const text = serializeFactBundle(bundle)
    expect(text).toContain('WASTED_SPEND')
    expect(text).toContain('Amazon UK')
    expect(text).not.toContain('amazon_uk:')
  })
})

describe('buildOfflineAnswer: advertising section', () => {
  function bundleWith(campaigns: FactBundle['advertisingCampaigns'], scorecard: FactBundle['advertisingScorecard'] = null): FactBundle {
    return {
      generatedAt: NOW, isDemo: false, orgName: 'Test Co', dataSourceFailures: [], currencyCautions: [],
      overallHealth: 'healthy', healthAreas: [], executiveSummary: [],
      priorities: [], complianceIssues: [], channels: [], topOpportunities: [], opportunitySummary: null,
      supplierRisk: [], pendingApprovals: [], products: [], advertisingCampaigns: campaigns, advertisingScorecard: scorecard,
    }
  }

  it('a wasted-spend campaign is surfaced by name with its classification, never silently omitted', () => {
    const bundle = bundleWith([{ campaignKey: 'amazon_uk:camp-1', campaignName: 'Wasteful Campaign', channel: 'amazon_uk', isPaused: false, spend: '£280.00', attributedRevenue: '£0.00', roas: 'unavailable — x', acosPct: 'unavailable — x', classification: 'wasted_spend', severity: 'critical', reasons: ['x'], externalCampaignId: 'camp-1', provider: 'amazon_ads', externalAccountId: 'acct-1', dailyBudgetMinor: 5000, productId: 'p1' }])
    const answer = buildOfflineAnswer(bundle, 'Which campaigns are wasting the most money?')
    expect(answer).toContain('Wasteful Campaign')
    expect(answer).toContain('WASTED_SPEND')
  })

  it('an all-healthy set of campaigns says so explicitly, never omitting the section as if there were no data', () => {
    const bundle = bundleWith([{ campaignKey: 'x', campaignName: 'Good Campaign', channel: 'shopify', isPaused: false, spend: '£100.00', attributedRevenue: '£500.00', roas: '5.00', acosPct: '20.0%', classification: 'healthy', severity: 'info', reasons: [], externalCampaignId: 'x', provider: 'meta_ads', externalAccountId: 'acct-1', dailyBudgetMinor: 3000, productId: null }])
    const answer = buildOfflineAnswer(bundle, 'What is my advertising ROAS?')
    expect(answer).toContain('healthy')
  })

  it('no campaign data at all says so honestly', () => {
    const answer = buildOfflineAnswer(bundleWith([]), 'What is my advertising ROAS?')
    expect(answer).toContain('No advertising campaign data')
  })

  it('never throws on empty/garbage input', () => {
    expect(() => buildOfflineAnswer(bundleWith([]), '')).not.toThrow()
  })
})

describe('Security: no tools field, regardless of advertising content (Milestone 12 guarantee, reinforced for Milestone 14)', () => {
  it('a system prompt containing real advertising campaign data still produces a request with no tools field', () => {
    const request = buildAnthropicRequest('facts include: Wasteful Campaign on Amazon UK: WASTED_SPEND', [{ role: 'user', content: 'Which campaigns are wasting money?' }])
    expect(request).not.toHaveProperty('tools')
    expect(JSON.stringify(request)).not.toContain('"tools"')
  })
})
