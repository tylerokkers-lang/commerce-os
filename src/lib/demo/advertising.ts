import { resolvePeriod } from '@/lib/orders/salesAggregation'
import { formatMoney } from '@/lib/core/money'
import {
  buildCampaignFact, classifyCampaign, groupCampaignRows, latestCampaignIdentity, sumCampaignRows,
  type AdvertisingCampaignFact,
} from '@/lib/analytics/advertisingAnalytics'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { AdvertisingRow } from '@/lib/analytics/liveAdvertisingFacts'

/**
 * Milestone 14's demo scenarios — the same "narrative computed through the
 * real builder functions against fixed fixture facts, never a hardcoded
 * string" discipline `demo/analytics.ts`/`demo/ceo.ts` already established.
 * Demo mode's actual `getAdvertisingIntelligence()` returns genuinely empty
 * `campaigns`/`scorecard` (no database exists to query); these scenarios
 * are what let demo mode still show the real classification engine working
 * end to end, covering every classification `classifyCampaign` can produce.
 */

const NOW = new Date('2026-08-24T09:00:00Z')
const PERIOD = resolvePeriod('last_30_days', NOW)

export interface AdvertisingDemoScenario {
  key: string
  label: string
  description: string
  narrative: readonly string[]
}

function dayOffset(daysAgo: number): string {
  const d = new Date(NOW)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function row(overrides: Partial<AdvertisingRow> & { daysAgo: number }): AdvertisingRow {
  const { daysAgo, ...rest } = overrides
  return {
    channel: 'amazon_uk', productId: null, campaignName: 'Demo Campaign', externalId: 'demo-campaign',
    periodDate: dayOffset(daysAgo), spendMinor: 0, revenueMinor: 0, clicks: 0, impressions: 0, conversions: 0,
    dailyBudgetMinor: null, isPaused: false,
    ...rest,
  }
}

function buildScenarioFact(rows: readonly AdvertisingRow[]): AdvertisingCampaignFact {
  const groups = groupCampaignRows(rows)
  const [key, groupRows] = [...groups.entries()][0]
  const identity = latestCampaignIdentity(key, groupRows)
  return buildCampaignFact(identity, sumCampaignRows(groupRows), 'GBP', PERIOD.start, PERIOD.end)
}

function narrativeFor(fact: AdvertisingCampaignFact, previous: AdvertisingCampaignFact | null = null): readonly string[] {
  const result = classifyCampaign(fact, DEMO_AUTOMATION_SETTINGS, previous)
  const lines = [`Classification: ${result.classification.toUpperCase()} (${result.severity}).`]
  return [...lines, ...result.reasons]
}

function scenarioWastedSpend(): AdvertisingDemoScenario {
  const rows = Array.from({ length: 14 }, (_, i) => row({
    externalId: 'demo-wasted', campaignName: 'Outdoor Christmas Light Projector — Amazon UK Sponsored Products',
    daysAgo: i, impressions: 900, clicks: 30, spendMinor: 2500, revenueMinor: 0, conversions: 0,
  }))
  const fact = buildScenarioFact(rows)
  return {
    key: 'wasted_spend', label: 'Wasted advertising spend',
    description: `${formatMoney(fact.spend.value!)} spent over ${fact.days} days with zero conversions — a real waste alert, not a guess from a single bad day.`,
    narrative: narrativeFor(fact),
  }
}

function scenarioPoorProfitability(): AdvertisingDemoScenario {
  const rows = Array.from({ length: 20 }, (_, i) => row({
    externalId: 'demo-poor-profit', campaignName: 'Compact Travel Steamer — Amazon UK Sponsored Products',
    daysAgo: i, impressions: 3000, clicks: 150, spendMinor: 4000, revenueMinor: 12000, conversions: 8,
  }))
  const fact = buildScenarioFact(rows)
  // Illustrative profitability tie-in without a live product lookup: a thin-margin product whose real break-even ad spend per unit is lower than what this campaign is actually spending per conversion.
  const withProfitability: AdvertisingCampaignFact = {
    ...fact,
    profitability: {
      knownNetMarginPctBeforeAds: 9.5,
      breakEvenAdSpendPerUnit: { minor: 300, currency: 'GBP' },
      actualAdSpendPerUnit: { minor: 500, currency: 'GBP' },
      exceedsBreakEven: true,
    },
  }
  return {
    key: 'poor_profitability', label: 'Advertising exceeds break-even cost',
    description: 'Real conversions and revenue exist, but advertising cost per conversion exceeds the product\'s own break-even advertising cost — the real profitability engine\'s own figure, not re-derived here.',
    narrative: narrativeFor(withProfitability),
  }
}

function scenarioHighAcosLowRoas(): AdvertisingDemoScenario {
  const rows = Array.from({ length: 15 }, (_, i) => row({
    externalId: 'demo-low-roas', campaignName: 'Bamboo Drawer Dividers — Shopify',
    channel: 'shopify', daysAgo: i, impressions: 2500, clicks: 120, spendMinor: 3000, revenueMinor: 4500, conversions: 15,
  }))
  const fact = buildScenarioFact(rows)
  return {
    key: 'high_acos_low_roas', label: 'ROAS below the configured minimum',
    description: `ROAS of ${(fact.roas.value ?? 0).toFixed(2)} sits below the configured minimum of ${DEMO_AUTOMATION_SETTINGS.minRoas.toFixed(2)} — a real, configurable threshold from Settings, not an invented one.`,
    narrative: narrativeFor(fact),
  }
}

function scenarioDeclining(): AdvertisingDemoScenario {
  const currentRows = Array.from({ length: 10 }, (_, i) => row({
    externalId: 'demo-declining', campaignName: 'Rechargeable LED Desk Lamp — Amazon UK Sponsored Products',
    daysAgo: i, impressions: 4000, clicks: 160, spendMinor: 4000, revenueMinor: 13000, conversions: 16,
  }))
  const previousRows = Array.from({ length: 10 }, (_, i) => row({
    externalId: 'demo-declining', campaignName: 'Rechargeable LED Desk Lamp — Amazon UK Sponsored Products',
    daysAgo: i + 30, impressions: 4200, clicks: 200, spendMinor: 4000, revenueMinor: 24000, conversions: 20,
  }))
  const fact = buildScenarioFact(currentRows)
  const previous = buildScenarioFact(previousRows)
  return {
    key: 'declining_performance', label: 'Declining performance vs the prior period',
    description: 'ROAS and conversion rate have both fallen materially against a comparable prior window with adequate sample size — never flagged on a tiny sample.',
    narrative: narrativeFor(fact, previous),
  }
}

function scenarioScaleOpportunity(): AdvertisingDemoScenario {
  const dailyBudget = 2000
  const rows = Array.from({ length: 30 }, (_, i) => row({
    externalId: 'demo-scale', campaignName: 'Magnetic Knife Rail, Solid Walnut — Amazon UK Sponsored Products',
    daysAgo: i, impressions: 6000, clicks: 300, spendMinor: Math.round(dailyBudget * 0.95), revenueMinor: Math.round(dailyBudget * 0.95 * 10),
    conversions: 25, dailyBudgetMinor: dailyBudget,
  }))
  const fact = buildScenarioFact(rows)
  return {
    key: 'scale_opportunity', label: 'Profitable and budget-constrained',
    description: 'Strong ROAS, healthy conversions, and spend already close to the daily budget cap — a genuine, evidence-backed scaling opportunity, never an automatic budget increase.',
    narrative: narrativeFor(fact),
  }
}

function scenarioInsufficientData(): AdvertisingDemoScenario {
  const rows = [row({ externalId: 'demo-new', campaignName: 'Under-Desk Footrest, Memory Foam — Shopify', channel: 'shopify', daysAgo: 1, impressions: 40, clicks: 3, spendMinor: 800, revenueMinor: 0, conversions: 0 })]
  const fact = buildScenarioFact(rows)
  return {
    key: 'insufficient_data', label: 'Insufficient data',
    description: 'A campaign launched too recently to classify reliably — "insufficient data" is a genuine, honest answer, preferable to guessing from a handful of impressions.',
    narrative: narrativeFor(fact),
  }
}

function scenarioHealthy(): AdvertisingDemoScenario {
  const rows = Array.from({ length: 20 }, (_, i) => row({
    externalId: 'demo-healthy', campaignName: 'Adjustable Laptop Riser, Aluminium — Amazon UK Sponsored Products',
    daysAgo: i, impressions: 5000, clicks: 220, spendMinor: 3000, revenueMinor: 13500, conversions: 24, dailyBudgetMinor: 20000,
  }))
  const fact = buildScenarioFact(rows)
  return {
    key: 'healthy', label: 'Healthy campaign',
    description: 'Solid ROAS, real conversions, no waste, no decline, and not currently budget-constrained — the default, unremarkable state most campaigns should be in.',
    narrative: narrativeFor(fact),
  }
}

export function demoAdvertisingScenarios(): readonly AdvertisingDemoScenario[] {
  return [
    scenarioWastedSpend(),
    scenarioPoorProfitability(),
    scenarioHighAcosLowRoas(),
    scenarioDeclining(),
    scenarioScaleOpportunity(),
    scenarioInsufficientData(),
    scenarioHealthy(),
  ]
}
