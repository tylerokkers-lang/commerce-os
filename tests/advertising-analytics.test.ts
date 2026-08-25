import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { money } from '@/lib/core/money'
import { isKnown } from '@/lib/analytics/types'
import {
  buildAdvertisingScorecard, buildCampaignFact, buildRealAdvertisingAnalytics, classifyCampaign,
  groupCampaignRows, latestCampaignIdentity, resolveCampaignProfitability, sumCampaignRows,
  type AdvertisingCampaignFact,
} from '@/lib/analytics/advertisingAnalytics'
import type { AdvertisingRow } from '@/lib/analytics/liveAdvertisingFacts'
import type { ProductChannelProfitAnalytics } from '@/lib/analytics/profitAnalytics'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'

const WINDOW_START = '2026-07-25T00:00:00.000Z'
const WINDOW_END = '2026-08-24T00:00:00.000Z'

function row(overrides: Partial<AdvertisingRow> = {}): AdvertisingRow {
  return {
    channel: 'amazon_uk', productId: 'p1', campaignName: 'Test Campaign', externalId: 'camp-1',
    periodDate: '2026-08-01', spendMinor: 0, revenueMinor: 0, clicks: 0, impressions: 0, conversions: 0,
    dailyBudgetMinor: null, isPaused: false, provider: 'amazon_ads', externalAccountId: 'acct-1',
    ...overrides,
  }
}

function fact(overrides: Partial<AdvertisingRow>[] = [{}]): AdvertisingCampaignFact {
  const rows = overrides.map((o) => row(o))
  const groups = groupCampaignRows(rows)
  const [key, groupRows] = [...groups.entries()][0]
  const identity = latestCampaignIdentity(key, groupRows)
  const totals = sumCampaignRows(groupRows)
  return buildCampaignFact(identity, totals, 'GBP', WINDOW_START, WINDOW_END)
}

describe('groupCampaignRows / latestCampaignIdentity: real entities only', () => {
  it('groups by channel + externalId, never merging two channels sharing an id', () => {
    const rows = [row({ channel: 'amazon_uk', externalId: 'x' }), row({ channel: 'shopify', externalId: 'x' })]
    const groups = groupCampaignRows(rows)
    expect(groups.size).toBe(2)
  })

  it('excludes a row with no external id — never attributed to a guessed campaign', () => {
    const rows = [row({ externalId: null })]
    expect(groupCampaignRows(rows).size).toBe(0)
  })

  it('takes the most recent row for current state (campaign name, paused, budget)', () => {
    const rows = [
      row({ periodDate: '2026-08-01', campaignName: 'Old Name', isPaused: false, dailyBudgetMinor: 1000 }),
      row({ periodDate: '2026-08-05', campaignName: 'New Name', isPaused: true, dailyBudgetMinor: 2000 }),
    ]
    const identity = latestCampaignIdentity('amazon_uk:camp-1', rows)
    expect(identity.campaignName).toBe('New Name')
    expect(identity.isPaused).toBe(true)
    expect(identity.dailyBudgetMinor).toBe(2000)
  })

  it('a missing campaign name falls back to the real external id — never a blank or invented label', () => {
    const rows = [row({ campaignName: null, externalId: 'camp-42' })]
    const identity = latestCampaignIdentity('amazon_uk:camp-42', rows)
    expect(identity.campaignName).toBe('camp-42')
  })
})

describe('buildCampaignFact: unavailable is never zero, ratios never divide by zero', () => {
  it('zero impressions/clicks/spend/conversions across real rows is a genuine fact, not unavailable', () => {
    const f = fact([{ spendMinor: 0, impressions: 0, clicks: 0, conversions: 0 }])
    expect(f.spend.status).toBe('fact')
    expect(isKnown(f.spend) && f.spend.value.minor).toBe(0)
  })

  it('CTR is unavailable (not 0% or NaN) when there are no impressions', () => {
    const f = fact([{ impressions: 0, clicks: 5 }])
    expect(f.ctrPct.status).toBe('unavailable')
    expect(f.ctrPct.value).toBeNull()
  })

  it('ROAS is unavailable when there is no spend', () => {
    const f = fact([{ spendMinor: 0, revenueMinor: 500 }])
    expect(f.roas.status).toBe('unavailable')
  })

  it('ACOS is unavailable when there is no attributed revenue', () => {
    const f = fact([{ spendMinor: 500, revenueMinor: 0 }])
    expect(f.acosPct.status).toBe('unavailable')
  })

  it('a genuinely healthy campaign computes real ratios', () => {
    const f = fact([{ impressions: 1000, clicks: 50, spendMinor: 5000, revenueMinor: 20000, conversions: 10 }])
    expect(f.ctrPct.value).toBeCloseTo(5)
    expect(isKnown(f.roas) && f.roas.value).toBeCloseTo(4)
    expect(isKnown(f.acosPct) && f.acosPct.value).toBeCloseTo(25)
  })

  it('CPA (cost per acquisition) is unavailable, never a fabricated figure, when there are no conversions', () => {
    const f = fact([{ spendMinor: 5000, conversions: 0 }])
    expect(f.cpa.status).toBe('unavailable')
    expect(f.cpa.value).toBeNull()
  })

  it('CPA is spend / conversions when conversions are known', () => {
    const f = fact([{ spendMinor: 5000, conversions: 10 }])
    expect(isKnown(f.cpa) && f.cpa.value.minor).toBe(500)
  })

  it('average order value is unavailable, never a fabricated figure, when there are no conversions', () => {
    const f = fact([{ revenueMinor: 20000, conversions: 0 }])
    expect(f.averageOrderValue.status).toBe('unavailable')
    expect(f.averageOrderValue.value).toBeNull()
  })

  it('average order value is attributed revenue / conversions when conversions are known', () => {
    const f = fact([{ revenueMinor: 20000, conversions: 10 }])
    expect(isKnown(f.averageOrderValue) && f.averageOrderValue.value.minor).toBe(2000)
  })

  it('CPC/CPA/AOV are computed in the campaign\'s own currency, never mixed with GBP', () => {
    const rows = [row({ spendMinor: 5000, revenueMinor: 20000, conversions: 10, clicks: 50 })]
    const groups = groupCampaignRows(rows)
    const [key, groupRows] = [...groups.entries()][0]
    const identity = latestCampaignIdentity(key, groupRows)
    const totals = sumCampaignRows(groupRows)
    const f = buildCampaignFact(identity, totals, 'USD', WINDOW_START, WINDOW_END)
    expect(f.currency).toBe('USD')
    expect(isKnown(f.cpc) && f.cpc.value.currency).toBe('USD')
    expect(isKnown(f.cpa) && f.cpa.value.currency).toBe('USD')
    expect(isKnown(f.averageOrderValue) && f.averageOrderValue.value.currency).toBe('USD')
  })
})

describe('resolveCampaignProfitability: reuses the real profitability engine, currency-safe', () => {
  function channelProfit(netMarginPct: number | null, breakEvenAdSpendMinor: number, currency: 'GBP' | 'USD' = 'GBP'): ProductChannelProfitAnalytics {
    return {
      productId: 'p1', channel: 'amazon_uk',
      sellingPrice: { value: money(2500, currency), status: 'fact', source: 'test' },
      productCost: { value: money(900, currency), status: 'fact', source: 'test' },
      projection: {
        status: 'calculated', source: 'test', value: {
          channel: 'amazon_uk', label: 'Amazon UK',
          profile: {} as never,
          profitability: {
            currency, netRevenue: money(0, currency), vat: money(0, currency), cogs: money(0, currency),
            grossProfit: money(0, currency), variableCosts: money(0, currency), contribution: money(0, currency),
            adSpend: money(0, currency), netProfit: money(0, currency),
            grossMarginPct: null, contributionMarginPct: null, netMarginPct,
            breakEvenPrice: money(0, currency), breakEvenAdSpend: money(breakEvenAdSpendMinor, currency), breakEvenAcosPct: null,
            cashRequiredPerUnit: money(0, currency), breakdown: [],
          },
          gate: { passes: true, failures: [], warnings: [] },
          landedCost: money(0, currency), assumptions: {},
        },
      },
    }
  }

  it('flags exceedsBreakEven when actual ad spend per conversion is above the real break-even figure', () => {
    const f = fact([{ spendMinor: 3000, conversions: 1 }]) // £30/conversion
    const result = resolveCampaignProfitability(f, channelProfit(15, 2000)) // break-even £20/unit
    expect(result?.exceedsBreakEven).toBe(true)
  })

  it('does not flag when actual ad spend is within the break-even figure', () => {
    const f = fact([{ spendMinor: 1000, conversions: 1 }]) // £10/conversion
    const result = resolveCampaignProfitability(f, channelProfit(15, 2000)) // break-even £20/unit
    expect(result?.exceedsBreakEven).toBe(false)
  })

  it('returns null actualAdSpendPerUnit (never a guess) when there are zero conversions', () => {
    const f = fact([{ spendMinor: 3000, conversions: 0 }])
    const result = resolveCampaignProfitability(f, channelProfit(15, 2000))
    expect(result?.actualAdSpendPerUnit).toBeNull()
    expect(result?.exceedsBreakEven).toBeNull()
  })

  it('CURRENCY SAFETY: a mismatched currency between campaign spend and product cost is never combined — reported as unresolvable, not guessed', () => {
    const f = fact([{ spendMinor: 3000, conversions: 1 }]) // campaign assumed GBP
    const result = resolveCampaignProfitability(f, channelProfit(15, 2000, 'USD')) // product priced in USD
    expect(result?.actualAdSpendPerUnit).toBeNull()
    expect(result?.exceedsBreakEven).toBeNull()
  })

  it('returns null entirely when no channel profitability is known', () => {
    const f = fact([{ spendMinor: 3000, conversions: 1 }])
    expect(resolveCampaignProfitability(f, null)).toBeNull()
  })
})

describe('classifyCampaign: deterministic rules', () => {
  it('INSUFFICIENT DATA: too little sample size never yields a confident classification', () => {
    const f = fact([{ impressions: 5, clicks: 1, spendMinor: 100000 }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).toBe('insufficient_data')
  })

  it('WASTED SPEND: significant spend with zero conversions', () => {
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor * 4, conversions: 0, revenueMinor: 0 }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).toBe('wasted_spend')
    expect(result.severity).toBe('critical')
  })

  it('never declares waste on modest spend, even with zero conversions — avoids overreacting to a small sample', () => {
    const f = fact([{ impressions: 500, clicks: 30, spendMinor: 100, conversions: 0, revenueMinor: 0 }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).not.toBe('wasted_spend')
  })

  it('HIGH ACOS / LOW ROAS: below the configured minimum ROAS', () => {
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 15000, conversions: 20 }]) // ROAS 1.5, below default min 3
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).toBe('high_acos_low_roas')
  })

  it('HEALTHY: solid ROAS, no waste, no decline, not near budget cap', () => {
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 35000, conversions: 20, dailyBudgetMinor: null }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).toBe('healthy')
  })

  it('DECLINING PERFORMANCE: ROAS falls materially against a comparable previous window with adequate sample size', () => {
    // A current window that's still above the minimum ROAS (so it wouldn't be caught by the high-ACOS/low-ROAS rule) but has fallen sharply from a much healthier previous window.
    const currentHealthyButFalling = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 32000, conversions: 20 }]) // ROAS 3.2
    const currentWithDays = { ...currentHealthyButFalling, days: 10 }
    const previous = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 50000, conversions: 20 }]) // ROAS 5.0
    const result = classifyCampaign(currentWithDays, DEMO_AUTOMATION_SETTINGS, previous)
    expect(result.classification).toBe('declining_performance')
  })

  it('SCALE OPPORTUNITY: healthy ROAS, conversions, and spend near the daily budget cap', () => {
    const dailyBudget = 2000
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: dailyBudget * 30 * 0.95, revenueMinor: dailyBudget * 30 * 0.95 * 10, conversions: 20, dailyBudgetMinor: dailyBudget }])
    const withDays = { ...f, days: 30 }
    const result = classifyCampaign(withDays, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).toBe('scale_opportunity')
    expect(result.severity).toBe('opportunity')
  })

  it('never recommends scaling when budget is not actually constraining spend', () => {
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: 1000, revenueMinor: 10000, conversions: 20, dailyBudgetMinor: 100000 }])
    const withDays = { ...f, days: 30 }
    const result = classifyCampaign(withDays, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).not.toBe('scale_opportunity')
  })

  it('BOUNDARY: ROAS exactly equal to the configured minimum is NOT high_acos_low_roas — the rule is strictly below, not at-or-below', () => {
    // DEMO_AUTOMATION_SETTINGS.minRoas is 3.00; spend 10000, revenue 30000 => ROAS exactly 3.00.
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 30000, conversions: 20 }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).not.toBe('high_acos_low_roas')
  })

  it('BOUNDARY: ROAS one penny below the configured minimum IS high_acos_low_roas', () => {
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 29999, conversions: 20 }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).toBe('high_acos_low_roas')
  })

  it('BOUNDARY: daily spend exactly at the configured significant-spend waste threshold (3x max daily ad spend) with zero conversions IS wasted_spend', () => {
    const wasteThresholdMinor = DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor * 3
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: wasteThresholdMinor, conversions: 0, revenueMinor: 0 }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).toBe('wasted_spend')
  })

  it('BOUNDARY: one penny below the waste threshold with zero conversions is NOT wasted_spend', () => {
    const wasteThresholdMinor = DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor * 3
    const f = fact([{ impressions: 5000, clicks: 200, spendMinor: wasteThresholdMinor - 1, conversions: 0, revenueMinor: 0 }])
    const result = classifyCampaign(f, DEMO_AUTOMATION_SETTINGS, null)
    expect(result.classification).not.toBe('wasted_spend')
  })

  it('MULTIPLE CAMPAIGNS: two independent campaigns classify independently from their own facts, never blended', () => {
    const wasted = fact([{ externalId: 'camp-a', impressions: 5000, clicks: 200, spendMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor * 4, conversions: 0, revenueMinor: 0 }])
    const healthy = fact([{ externalId: 'camp-b', impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 35000, conversions: 20 }])
    expect(classifyCampaign(wasted, DEMO_AUTOMATION_SETTINGS, null).classification).toBe('wasted_spend')
    expect(classifyCampaign(healthy, DEMO_AUTOMATION_SETTINGS, null).classification).toBe('healthy')
  })
})

describe('buildAdvertisingScorecard: worst-campaign-wins, never a blended invented score', () => {
  it('overall status is the single worst campaign classification', () => {
    const healthy = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 35000, conversions: 20 }])
    const wasted = fact([{ externalId: 'camp-2', impressions: 5000, clicks: 200, spendMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor * 4, conversions: 0, revenueMinor: 0 }])
    const scorecard = buildAdvertisingScorecard(
      [
        { fact: healthy, classification: classifyCampaign(healthy, DEMO_AUTOMATION_SETTINGS, null) },
        { fact: wasted, classification: classifyCampaign(wasted, DEMO_AUTOMATION_SETTINGS, null) },
      ],
      100000, 'GBP',
    )
    expect(scorecard.overall).toBe('critical')
    expect(scorecard.byClassification.wasted_spend).toBe(1)
    expect(scorecard.byClassification.healthy).toBe(1)
  })

  it('an empty campaign list is honestly insufficient_data, never healthy-by-default', () => {
    const scorecard = buildAdvertisingScorecard([], null, 'GBP')
    expect(scorecard.overall).toBe('insufficient_data')
    expect(scorecard.totalCampaigns).toBe(0)
  })

  it('TACOS is unavailable when org revenue is not supplied, never a fabricated percentage', () => {
    const healthy = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 35000, conversions: 20 }])
    const scorecard = buildAdvertisingScorecard([{ fact: healthy, classification: classifyCampaign(healthy, DEMO_AUTOMATION_SETTINGS, null) }], null, 'GBP')
    expect(scorecard.tacosPct.status).toBe('unavailable')
  })

  it('TACOS is a real calculated figure when org revenue is known', () => {
    const healthy = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 35000, conversions: 20 }])
    const scorecard = buildAdvertisingScorecard([{ fact: healthy, classification: classifyCampaign(healthy, DEMO_AUTOMATION_SETTINGS, null) }], 100000, 'GBP')
    expect(scorecard.tacosPct.status).toBe('calculated')
    expect(scorecard.tacosPct.value).toBeCloseTo(10)
  })

  it('overall CPA/AOV are unavailable, never fabricated, when no campaign has any conversions', () => {
    const wasted = fact([{ impressions: 5000, clicks: 200, spendMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor * 4, conversions: 0, revenueMinor: 0 }])
    const scorecard = buildAdvertisingScorecard([{ fact: wasted, classification: classifyCampaign(wasted, DEMO_AUTOMATION_SETTINGS, null) }], null, 'GBP')
    expect(scorecard.overallCpa.status).toBe('unavailable')
    expect(scorecard.overallAverageOrderValue.status).toBe('unavailable')
  })

  it('overall CPA/AOV correctly sum conversions/spend/revenue across multiple campaigns, not just the first one', () => {
    const a = fact([{ externalId: 'camp-a', spendMinor: 5000, revenueMinor: 20000, conversions: 10 }])
    const b = fact([{ externalId: 'camp-b', spendMinor: 3000, revenueMinor: 12000, conversions: 5 }])
    const scorecard = buildAdvertisingScorecard(
      [
        { fact: a, classification: classifyCampaign(a, DEMO_AUTOMATION_SETTINGS, null) },
        { fact: b, classification: classifyCampaign(b, DEMO_AUTOMATION_SETTINGS, null) },
      ],
      null, 'GBP',
    )
    // Total spend 8000, total revenue 32000, total conversions 15.
    expect(isKnown(scorecard.overallCpa) && scorecard.overallCpa.value.minor).toBe(Math.round(8000 / 15))
    expect(isKnown(scorecard.overallAverageOrderValue) && scorecard.overallAverageOrderValue.value.minor).toBe(Math.round(32000 / 15))
  })
})

describe('buildRealAdvertisingAnalytics: converts to the Milestone 10 shape without ever coercing unavailable to zero', () => {
  it('unavailable money metrics remain unavailable after conversion to bare-number Metric', () => {
    const scorecard = buildAdvertisingScorecard([], null, 'GBP')
    const analytics = buildRealAdvertisingAnalytics(scorecard)
    expect(analytics.spend.status).toBe('unavailable')
    expect(analytics.spend.value).toBeNull()
  })

  it('a known spend total converts to its minor-unit number, not the Money object', () => {
    const healthy = fact([{ impressions: 5000, clicks: 200, spendMinor: 10000, revenueMinor: 35000, conversions: 20 }])
    const scorecard = buildAdvertisingScorecard([{ fact: healthy, classification: classifyCampaign(healthy, DEMO_AUTOMATION_SETTINGS, null) }], null, 'GBP')
    const analytics = buildRealAdvertisingAnalytics(scorecard)
    expect(analytics.spend.value).toBe(10000)
  })
})

describe('Safety gate: "threshold not configured" is structurally impossible, not just handled in application code', () => {
  const migrationSource = readFileSync(new URL('../supabase/migrations/0001_core.sql', import.meta.url), 'utf8')

  it('max_daily_ad_spend_minor is NOT NULL with a real default in the schema itself', () => {
    expect(migrationSource).toMatch(/max_daily_ad_spend_minor\s+bigint\s+not null\s+default\s+\d+/i)
  })

  it('min_roas is NOT NULL with a real default in the schema itself', () => {
    expect(migrationSource).toMatch(/min_roas\s+numeric\([\d,]+\)\s+not null\s+default\s+[\d.]+/i)
  })

  it('DEMO_AUTOMATION_SETTINGS (the fallback used when no business_settings row exists at all, or in demo mode) carries real, positive thresholds — never null, never zero', () => {
    expect(DEMO_AUTOMATION_SETTINGS.maxDailyAdSpendMinor).toBeGreaterThan(0)
    expect(DEMO_AUTOMATION_SETTINGS.minRoas).toBeGreaterThan(0)
  })
})
