import { calculatedMetric, factMetric, isKnown, unavailableMetric, type Metric } from './types'
import { formatMoney, money, type CurrencyCode, type Money } from '@/lib/core/money'
import type { ChannelKey } from '@/lib/core/domain'
import type { AdvertisingRow } from './liveAdvertisingFacts'
import type { ProductChannelProfitAnalytics } from './profitAnalytics'
import type { AutomationSettings } from '@/lib/automation/settingsTypes'

/**
 * Advertising analytics architecture (Milestone 10 §9).
 *
 * No advertising connector exists anywhere in this codebase yet — no
 * Amazon Ads, Meta, Google, or TikTok Ads credentials, no ad-spend table,
 * no live sync. `orders/salesAggregation.ts`'s `adSpendMinor` has always
 * been hardcoded to 0 for exactly this reason (see its own module
 * comment, Milestone 8.5). This module exists only to give a *future*
 * connector a real interface to satisfy — the same "define the interface
 * now, implement it once real credentials exist" pattern every connector
 * in this codebase already follows (`marketplaces/connectors/types.ts`,
 * `suppliers/connectors/*`) — and to make the current absence honest
 * everywhere it is displayed, rather than silently showing £0.
 */

export type AdvertisingPlatform = 'amazon_ads' | 'meta_ads' | 'google_ads' | 'tiktok_ads'

export interface AdvertisingConnectorDescriptor {
  platform: AdvertisingPlatform
  label: string
  /** Always false today — no connector implementation exists. Never set true without a real one behind it. */
  isConfigured: false
  status: 'not_configured'
}

export const ADVERTISING_PLATFORMS: readonly AdvertisingConnectorDescriptor[] = [
  { platform: 'amazon_ads', label: 'Amazon Ads', isConfigured: false, status: 'not_configured' },
  { platform: 'meta_ads', label: 'Meta Ads', isConfigured: false, status: 'not_configured' },
  { platform: 'google_ads', label: 'Google Ads', isConfigured: false, status: 'not_configured' },
  { platform: 'tiktok_ads', label: 'TikTok Ads', isConfigured: false, status: 'not_configured' },
]

/** The metric shape a real connector will eventually populate — every field `unavailable` today, on purpose. */
export interface AdvertisingAnalytics {
  spend: Metric<number>
  impressions: Metric<number>
  clicks: Metric<number>
  ctrPct: Metric<number>
  cpc: Metric<number>
  conversions: Metric<number>
  roas: Metric<number>
  acosPct: Metric<number>
  tacosPct: Metric<number>
  attributedRevenue: Metric<number>
  /** How much advertising spend erodes net profit, once a real spend figure exists — `calculateProfitability`'s own `adSpendPerUnit` input is the one place this is ever actually subtracted from margin; this module never re-derives that arithmetic. */
  profitImpact: Metric<number>
}

const REASON = 'No advertising connector is configured — this is genuinely unknown, not zero spend.'

export function unavailableAdvertisingAnalytics(): AdvertisingAnalytics {
  return {
    spend: unavailableMetric(REASON), impressions: unavailableMetric(REASON), clicks: unavailableMetric(REASON),
    ctrPct: unavailableMetric(REASON), cpc: unavailableMetric(REASON), conversions: unavailableMetric(REASON),
    roas: unavailableMetric(REASON), acosPct: unavailableMetric(REASON), tacosPct: unavailableMetric(REASON),
    attributedRevenue: unavailableMetric(REASON), profitImpact: unavailableMetric(REASON),
  }
}

/**
 * Campaign intelligence (Milestone 14) — the `advertising` table has
 * existed, fully migrated and RLS-enabled, since the original schema
 * (`0008_intelligence.sql`), but nothing in this codebase ever read from
 * it until now. Everything below is pure (no I/O) and operates on
 * `AdvertisingRow[]` that `liveAdvertisingFacts.ts` — the one server-only
 * caller — has already loaded, the same "pure aggregation, separate live
 * loader" split every other `analytics/*.ts` module already follows.
 *
 * A campaign is `(channel, externalId)` aggregated across every
 * `period_date` row in the requested window — the table's own unique key
 * is per-day, so "one campaign" is never a single row.
 */

const MIN_IMPRESSIONS_FOR_SIGNIFICANCE = 100
const MIN_CLICKS_FOR_CONVERSION_SIGNIFICANCE = 20
/** "Significant spend" for waste detection scales with the org's own configured daily limit — 3 days' worth, so a single anomalous day never triggers a waste alert on its own. */
const WASTE_SPEND_MULTIPLIER_OF_DAILY_LIMIT = 3
const MIN_DAYS_FOR_TREND_COMPARISON = 7

export interface CampaignIdentity {
  campaignKey: string
  channel: ChannelKey
  externalId: string
  campaignName: string
  productId: string | null
  isPaused: boolean
  dailyBudgetMinor: number | null
  /** Milestone 16 — which ad platform ran this campaign, and its account on that platform. Null for hand-entered/demo/pre-Milestone-15 rows, never guessed. Distinct from `channel` — see `advertising/connectors/types.ts`'s `NormalizedCampaignFact` comment for why the two are never conflated. */
  provider: string | null
  externalAccountId: string | null
}

export interface CampaignRawTotals {
  spendMinor: number
  revenueMinor: number
  clicks: number
  impressions: number
  conversions: number
  days: number
}

/** Groups rows into one bucket per real campaign — never invented, never merged across channels (a Shopify and an Amazon UK campaign sharing an external id are still two distinct campaigns). */
export function groupCampaignRows(rows: readonly AdvertisingRow[]): Map<string, AdvertisingRow[]> {
  const groups = new Map<string, AdvertisingRow[]>()
  for (const row of rows) {
    if (!row.externalId) continue // A row with no campaign identifier cannot be attributed to a specific campaign — excluded, never guessed.
    const key = `${row.channel}:${row.externalId}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return groups
}

/** The campaign's current identity/state — taken from its most recent row, since `is_paused`/`daily_budget_minor`/`campaign_name` can change day to day and only the latest is "current." */
export function latestCampaignIdentity(campaignKey: string, rows: readonly AdvertisingRow[]): CampaignIdentity {
  const latest = [...rows].sort((a, b) => (a.periodDate < b.periodDate ? 1 : -1))[0]
  const [channel, externalId] = campaignKey.split(':') as [ChannelKey, string]
  return {
    campaignKey, channel, externalId,
    campaignName: latest.campaignName ?? externalId,
    productId: latest.productId,
    isPaused: latest.isPaused,
    dailyBudgetMinor: latest.dailyBudgetMinor,
    provider: latest.provider,
    externalAccountId: latest.externalAccountId,
  }
}

/** Sums every row in the group — a real total, since every row summed is a real observed day. */
export function sumCampaignRows(rows: readonly AdvertisingRow[]): CampaignRawTotals {
  const days = new Set(rows.map((r) => r.periodDate)).size
  return rows.reduce(
    (acc, r) => ({
      spendMinor: acc.spendMinor + r.spendMinor,
      revenueMinor: acc.revenueMinor + r.revenueMinor,
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
      conversions: acc.conversions + r.conversions,
      days,
    }),
    { spendMinor: 0, revenueMinor: 0, clicks: 0, impressions: 0, conversions: 0, days },
  )
}

export interface AdvertisingCampaignFact {
  identity: CampaignIdentity
  currency: CurrencyCode
  windowStart: string
  windowEnd: string
  days: number

  impressions: Metric<number>
  clicks: Metric<number>
  spend: Metric<Money>
  attributedRevenue: Metric<Money>
  conversions: Metric<number>

  ctrPct: Metric<number>
  cpc: Metric<Money>
  conversionRatePct: Metric<number>
  roas: Metric<number>
  acosPct: Metric<number>
  /** Cost per acquisition — spend / conversions. `unavailable` (never a fabricated figure) when there are no conversions to divide by. */
  cpa: Metric<Money>
  /** Average order value attributed to this campaign's conversions — attributed revenue / conversions. `unavailable` when there are no conversions, not a coerced £0. */
  averageOrderValue: Metric<Money>

  /** Only populated when the campaign has a known `productId` with real, live price/cost data — see `resolveCampaignProfitability` below. Never reconstructed independently of `profitability/channels.ts`'s real engine. */
  profitability: {
    knownNetMarginPctBeforeAds: number | null
    breakEvenAdSpendPerUnit: Money
    actualAdSpendPerUnit: Money | null
    exceedsBreakEven: boolean | null
  } | null

  sampleSizeAdequate: boolean
}

const ratio = (numerator: number, denominator: number): number | null => (denominator > 0 ? numerator / denominator : null)

/** Builds one campaign's full fact record from its raw totals — pure, no profitability tie-in (that needs a live product lookup, done separately by `resolveCampaignProfitability`, and merged in by the repository layer). */
export function buildCampaignFact(identity: CampaignIdentity, totals: CampaignRawTotals, currency: CurrencyCode, windowStart: string, windowEnd: string): AdvertisingCampaignFact {
  const source = 'advertising table (Milestone 14)'
  const ctr = ratio(totals.clicks, totals.impressions)
  const cpc = ratio(totals.spendMinor, totals.clicks)
  const convRate = ratio(totals.conversions, totals.clicks)
  const roas = ratio(totals.revenueMinor, totals.spendMinor)
  const acos = ratio(totals.spendMinor, totals.revenueMinor)
  const cpa = ratio(totals.spendMinor, totals.conversions)
  const aov = ratio(totals.revenueMinor, totals.conversions)

  return {
    identity, currency, windowStart, windowEnd, days: totals.days,
    impressions: factMetric(totals.impressions, source),
    clicks: factMetric(totals.clicks, source),
    spend: factMetric(money(totals.spendMinor, currency), source),
    attributedRevenue: factMetric(money(totals.revenueMinor, currency), source),
    conversions: factMetric(totals.conversions, source),
    ctrPct: ctr === null ? unavailableMetric('No impressions recorded in this window.') : calculatedMetric(ctr * 100, 'clicks / impressions'),
    cpc: cpc === null ? unavailableMetric('No clicks recorded in this window.') : calculatedMetric(money(Math.round(cpc), currency), 'spend / clicks'),
    conversionRatePct: convRate === null ? unavailableMetric('No clicks recorded in this window.') : calculatedMetric(convRate * 100, 'conversions / clicks'),
    roas: roas === null ? unavailableMetric('No spend recorded in this window.') : calculatedMetric(roas, 'attributed revenue / spend'),
    acosPct: acos === null ? unavailableMetric('No attributed revenue in this window.') : calculatedMetric(acos * 100, 'spend / attributed revenue'),
    cpa: cpa === null ? unavailableMetric('No conversions recorded in this window.') : calculatedMetric(money(Math.round(cpa), currency), 'spend / conversions'),
    averageOrderValue: aov === null ? unavailableMetric('No conversions recorded in this window.') : calculatedMetric(money(Math.round(aov), currency), 'attributed revenue / conversions'),
    profitability: null,
    sampleSizeAdequate: totals.impressions >= MIN_IMPRESSIONS_FOR_SIGNIFICANCE || totals.clicks >= MIN_CLICKS_FOR_CONVERSION_SIGNIFICANCE,
  }
}

/**
 * Ties a campaign to the real profitability engine — never a second one.
 * `channelProfit` is exactly what `analytics/profitAnalytics.ts`'s
 * `buildProductChannelProfitAnalytics` already computes for this
 * product+channel (the same object `/opportunities/[id]` and the CEO
 * dashboard's loss-making-product detection already use); this function
 * only reads its already-real `breakEvenAdSpend` (a per-unit `Money` the
 * engine itself derived from contribution before advertising) and
 * compares it against this campaign's *actual* per-unit ad spend
 * (spend / conversions — a real, observed ratio, not modelled). Currency
 * is checked explicitly before comparing; a mismatch is reported, never
 * silently combined.
 */
export function resolveCampaignProfitability(fact: AdvertisingCampaignFact, channelProfit: ProductChannelProfitAnalytics | null): AdvertisingCampaignFact['profitability'] {
  if (!channelProfit || !isKnown(channelProfit.projection)) return null
  const profitability = channelProfit.projection.value.profitability
  const breakEven = profitability.breakEvenAdSpend

  if (!isKnown(fact.conversions) || fact.conversions.value === 0 || !isKnown(fact.spend)) {
    return { knownNetMarginPctBeforeAds: profitability.netMarginPct, breakEvenAdSpendPerUnit: breakEven, actualAdSpendPerUnit: null, exceedsBreakEven: null }
  }
  if (fact.spend.value.currency !== breakEven.currency) {
    // A genuine cross-currency mismatch between the campaign's assumed base currency and the product's listing currency — never combined, never guessed.
    return { knownNetMarginPctBeforeAds: profitability.netMarginPct, breakEvenAdSpendPerUnit: breakEven, actualAdSpendPerUnit: null, exceedsBreakEven: null }
  }

  const actualPerUnitMinor = Math.round(fact.spend.value.minor / fact.conversions.value)
  const actualAdSpendPerUnit = money(actualPerUnitMinor, fact.spend.value.currency)
  return {
    knownNetMarginPctBeforeAds: profitability.netMarginPct,
    breakEvenAdSpendPerUnit: breakEven,
    actualAdSpendPerUnit,
    exceedsBreakEven: actualPerUnitMinor > breakEven.minor,
  }
}

export type CampaignClassification =
  | 'wasted_spend' | 'poor_profitability' | 'high_acos_low_roas' | 'scale_opportunity'
  | 'declining_performance' | 'healthy' | 'insufficient_data'

export type CampaignSeverity = 'critical' | 'high' | 'medium' | 'opportunity' | 'info'

export interface CampaignClassificationResult {
  classification: CampaignClassification
  severity: CampaignSeverity
  reasons: readonly string[]
}

/** The one place a campaign's classification is decided — deterministic, every branch traceable to a measured fact or an explicit, named threshold. Never an LLM call. */
export function classifyCampaign(fact: AdvertisingCampaignFact, settings: AutomationSettings, previous: AdvertisingCampaignFact | null): CampaignClassificationResult {
  if (!fact.sampleSizeAdequate) {
    return {
      classification: 'insufficient_data', severity: 'info',
      reasons: [`Fewer than ${MIN_IMPRESSIONS_FOR_SIGNIFICANCE} impressions and ${MIN_CLICKS_FOR_CONVERSION_SIGNIFICANCE} clicks in this window — too little data for a reliable classification.`],
    }
  }

  const wasteThresholdMinor = settings.maxDailyAdSpendMinor * WASTE_SPEND_MULTIPLIER_OF_DAILY_LIMIT
  const spendMinor = isKnown(fact.spend) ? fact.spend.value.minor : 0
  const conversions = isKnown(fact.conversions) ? fact.conversions.value : 0
  const revenueMinor = isKnown(fact.attributedRevenue) ? fact.attributedRevenue.value.minor : 0

  if (spendMinor >= wasteThresholdMinor && (conversions === 0 || revenueMinor === 0)) {
    return {
      classification: 'wasted_spend', severity: 'critical',
      reasons: [`${formatMoney(money(spendMinor, fact.currency))} spent over ${fact.days} day(s) with ${conversions === 0 ? 'zero conversions' : 'no attributed revenue'} — against a configured significant-spend threshold of ${formatMoney(money(wasteThresholdMinor, fact.currency))}.`],
    }
  }

  if (fact.profitability?.exceedsBreakEven === true) {
    return {
      classification: 'poor_profitability', severity: 'high',
      reasons: [`Actual advertising cost per conversion (${formatMoney(fact.profitability.actualAdSpendPerUnit!)}) exceeds this product's break-even advertising cost (${formatMoney(fact.profitability.breakEvenAdSpendPerUnit)}) — advertising is consuming more than the product's own contribution.`],
    }
  }

  if (isKnown(fact.roas) && fact.roas.value < settings.minRoas) {
    return {
      classification: 'high_acos_low_roas', severity: 'high',
      reasons: [`ROAS is ${fact.roas.value.toFixed(2)}, below the configured minimum of ${settings.minRoas.toFixed(2)}${isKnown(fact.acosPct) ? ` (ACOS ${fact.acosPct.value.toFixed(1)}%)` : ''}.`],
    }
  }

  if (previous && previous.sampleSizeAdequate && fact.days >= MIN_DAYS_FOR_TREND_COMPARISON) {
    const reasons: string[] = []
    if (isKnown(fact.cpc) && isKnown(previous.cpc) && previous.cpc.value.minor > 0 && fact.cpc.value.minor > previous.cpc.value.minor * 1.25) {
      reasons.push(`CPC rose from ${formatMoney(previous.cpc.value)} to ${formatMoney(fact.cpc.value)}.`)
    }
    if (isKnown(fact.conversionRatePct) && isKnown(previous.conversionRatePct) && previous.conversionRatePct.value > 0 && fact.conversionRatePct.value < previous.conversionRatePct.value * 0.75) {
      reasons.push(`Conversion rate fell from ${previous.conversionRatePct.value.toFixed(1)}% to ${fact.conversionRatePct.value.toFixed(1)}%.`)
    }
    if (isKnown(fact.roas) && isKnown(previous.roas) && fact.roas.value < previous.roas.value * 0.75) {
      reasons.push(`ROAS fell from ${previous.roas.value.toFixed(2)} to ${fact.roas.value.toFixed(2)}.`)
    }
    if (reasons.length > 0) return { classification: 'declining_performance', severity: 'medium', reasons }
  }

  const knownRoas = isKnown(fact.roas) ? fact.roas.value : null
  const roasHealthy = knownRoas !== null && knownRoas >= settings.minRoas * 1.5
  const profitableWithAds = fact.profitability ? fact.profitability.exceedsBreakEven === false : null
  const nearBudgetCap = fact.identity.dailyBudgetMinor !== null && isKnown(fact.spend) && fact.days > 0
    ? (fact.spend.value.minor / fact.days) >= fact.identity.dailyBudgetMinor * 0.9
    : false

  if (roasHealthy && knownRoas !== null && profitableWithAds !== false && conversions > 0 && nearBudgetCap) {
    return {
      classification: 'scale_opportunity', severity: 'opportunity',
      reasons: [`ROAS of ${knownRoas.toFixed(2)} is well above the configured minimum of ${settings.minRoas.toFixed(2)}, conversions are healthy, and spend is already close to the daily budget cap — the campaign may be budget-constrained.`],
    }
  }

  return { classification: 'healthy', severity: 'info', reasons: [] }
}

export type AdvertisingHealthStatus = 'healthy' | 'scale_opportunity' | 'review' | 'at_risk' | 'critical' | 'insufficient_data'

export interface AdvertisingScorecard {
  overall: AdvertisingHealthStatus
  totalCampaigns: number
  byClassification: Record<CampaignClassification, number>
  totalSpend: Metric<Money>
  totalAttributedRevenue: Metric<Money>
  totalImpressions: Metric<number>
  totalClicks: Metric<number>
  totalConversions: Metric<number>
  overallCtrPct: Metric<number>
  overallCpc: Metric<Money>
  overallRoas: Metric<number>
  overallAcosPct: Metric<number>
  /** Total spend / total conversions across every campaign — `unavailable` when there are no conversions to divide by, never a fabricated £0. */
  overallCpa: Metric<Money>
  /** Total attributed revenue / total conversions across every campaign — `unavailable` when there are no conversions. */
  overallAverageOrderValue: Metric<Money>
  /** Total ad spend / total org sales revenue for the same window — org-wide TACOS, computed only here (never per-campaign, where it is not a meaningful figure) and only when both figures share the org's own base currency, which they always do by construction (`liveAdvertisingFacts.ts`/`liveAnalyticsFacts.ts` both resolve the same `base_currency`). */
  tacosPct: Metric<number>
}

const CLASSIFICATION_TO_STATUS: Record<CampaignClassification, AdvertisingHealthStatus> = {
  wasted_spend: 'critical', poor_profitability: 'at_risk', high_acos_low_roas: 'review',
  declining_performance: 'review', scale_opportunity: 'scale_opportunity', healthy: 'healthy', insufficient_data: 'insufficient_data',
}

const STATUS_RANK: Record<AdvertisingHealthStatus, number> = { healthy: 0, scale_opportunity: 1, insufficient_data: 2, review: 3, at_risk: 4, critical: 5 }

/** The overall status is always the single worst campaign's status — the same "never a separately invented blended score" rule `ceo/healthScorecard.ts` already established. */
export function buildAdvertisingScorecard(
  campaigns: readonly { fact: AdvertisingCampaignFact; classification: CampaignClassificationResult }[],
  orgRevenueMinor: number | null,
  currency: CurrencyCode,
): AdvertisingScorecard {
  const byClassification: Record<CampaignClassification, number> = {
    wasted_spend: 0, poor_profitability: 0, high_acos_low_roas: 0, scale_opportunity: 0, declining_performance: 0, healthy: 0, insufficient_data: 0,
  }
  let worst: AdvertisingHealthStatus = 'healthy'
  let totalSpendMinor = 0
  let totalRevenueMinor = 0
  let totalImpressions = 0
  let totalClicks = 0
  let totalConversions = 0
  let hasSpend = false
  let hasImpressions = false

  for (const { fact, classification: result } of campaigns) {
    byClassification[result.classification]++
    const status = CLASSIFICATION_TO_STATUS[result.classification]
    if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status
    if (isKnown(fact.spend)) { totalSpendMinor += fact.spend.value.minor; hasSpend = true }
    if (isKnown(fact.attributedRevenue)) totalRevenueMinor += fact.attributedRevenue.value.minor
    if (isKnown(fact.impressions)) { totalImpressions += fact.impressions.value; hasImpressions = true }
    if (isKnown(fact.clicks)) totalClicks += fact.clicks.value
    if (isKnown(fact.conversions)) totalConversions += fact.conversions.value
  }

  const source = 'advertising table (Milestone 14), summed across campaigns'
  return {
    overall: campaigns.length === 0 ? 'insufficient_data' : worst,
    totalCampaigns: campaigns.length,
    byClassification,
    totalSpend: hasSpend ? factMetric(money(totalSpendMinor, currency), source) : unavailableMetric('No campaigns with recorded spend in this window.'),
    totalAttributedRevenue: hasSpend ? factMetric(money(totalRevenueMinor, currency), source) : unavailableMetric('No campaigns with recorded spend in this window.'),
    totalImpressions: hasImpressions ? factMetric(totalImpressions, source) : unavailableMetric('No campaigns with recorded impressions in this window.'),
    totalClicks: hasImpressions ? factMetric(totalClicks, source) : unavailableMetric('No campaigns with recorded impressions in this window.'),
    totalConversions: hasImpressions ? factMetric(totalConversions, source) : unavailableMetric('No campaigns with recorded impressions in this window.'),
    overallCtrPct: hasImpressions && totalImpressions > 0 ? calculatedMetric((totalClicks / totalImpressions) * 100, 'total clicks / total impressions') : unavailableMetric('No impressions recorded in this window.'),
    overallCpc: hasSpend && totalClicks > 0 ? calculatedMetric(money(Math.round(totalSpendMinor / totalClicks), currency), 'total spend / total clicks') : unavailableMetric('No clicks recorded in this window.'),
    overallRoas: hasSpend && totalSpendMinor > 0 ? calculatedMetric(totalRevenueMinor / totalSpendMinor, 'total attributed revenue / total spend') : unavailableMetric('No spend recorded in this window.'),
    overallAcosPct: hasSpend && totalRevenueMinor > 0 ? calculatedMetric((totalSpendMinor / totalRevenueMinor) * 100, 'total spend / total attributed revenue') : unavailableMetric('No attributed revenue in this window.'),
    overallCpa: hasSpend && totalConversions > 0 ? calculatedMetric(money(Math.round(totalSpendMinor / totalConversions), currency), 'total spend / total conversions') : unavailableMetric('No conversions recorded in this window.'),
    overallAverageOrderValue: hasSpend && totalConversions > 0 ? calculatedMetric(money(Math.round(totalRevenueMinor / totalConversions), currency), 'total attributed revenue / total conversions') : unavailableMetric('No conversions recorded in this window.'),
    tacosPct: hasSpend && orgRevenueMinor !== null && orgRevenueMinor > 0
      ? calculatedMetric((totalSpendMinor / orgRevenueMinor) * 100, 'total ad spend / total org sales revenue, same base currency')
      : unavailableMetric('Org sales revenue for this window is unavailable or zero, or no advertising spend was recorded.'),
  }
}

/** `AdvertisingAnalytics` (Milestone 10's shape, unchanged) wraps money fields as bare `Metric<number>` rather than `Metric<Money>` — this converts a known `Metric<Money>` to its minor-unit number, preserving `unavailable` exactly as-is rather than ever coercing it to `0`. */
function toMinorMetric(m: Metric<Money>): Metric<number> {
  return isKnown(m) ? { ...m, value: m.value.minor } : { value: null, status: m.status, source: m.source, asOf: m.asOf }
}

/** The org-wide `AdvertisingAnalytics` summary (Milestone 10's shape) built from real campaign data — used by `getAnalyticsDashboard()`/`/automation` in place of the always-unavailable fallback whenever the org actually has advertising rows. */
export function buildRealAdvertisingAnalytics(scorecard: AdvertisingScorecard): AdvertisingAnalytics {
  return {
    spend: toMinorMetric(scorecard.totalSpend),
    impressions: scorecard.totalImpressions,
    clicks: scorecard.totalClicks,
    ctrPct: scorecard.overallCtrPct,
    cpc: toMinorMetric(scorecard.overallCpc),
    conversions: scorecard.totalConversions,
    roas: scorecard.overallRoas,
    acosPct: scorecard.overallAcosPct,
    tacosPct: scorecard.tacosPct,
    attributedRevenue: toMinorMetric(scorecard.totalAttributedRevenue),
    profitImpact: unavailableMetric('Org-wide profit impact requires an aggregate not yet computed sensibly across mixed products — see per-campaign profitability detail instead.'),
  }
}
