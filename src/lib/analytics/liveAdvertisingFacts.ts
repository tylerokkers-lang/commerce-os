import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { paginate } from '@/lib/supabase/paginate'
import { loadOrgCurrency } from './liveAnalyticsFacts'
import type { ChannelKey } from '@/lib/core/domain'
import type { CurrencyCode } from '@/lib/core/money'
import type { Period } from '@/lib/orders/salesAggregation'

/**
 * Live advertising data assembly (Milestone 14) — the one server-only
 * caller that reads the `advertising` table (migration `0008_intelligence.sql`,
 * §27/§33 of the original brief) into the fact shape
 * `analytics/advertisingAnalytics.ts`'s pure aggregation/classification
 * functions consume. Same split as every other `live*Facts.ts` module in
 * this directory: pure aggregation stays testable without a database, and
 * only this file touches Postgres.
 *
 * The `advertising` table has existed, fully migrated and RLS-enabled,
 * since the very first schema — but until this milestone nothing in
 * `src/` ever queried it. It is one row per campaign per day
 * (`unique (org_id, channel, external_id, period_date)`), so "one
 * campaign" is `(channel, external_id)` aggregated across every
 * `period_date` row in the requested window, not a single row.
 *
 * **Currency**: the table has no `currency` column of its own (unlike
 * `orders`/`channel_products`, which do) — every figure is treated as the
 * org's own `base_currency`, resolved the same way every other live
 * loader in this directory already does (`loadOrgCurrency`). This is a
 * real, documented limitation, not a currency-safety gap of the kind
 * Milestone 11 fixed: there is only ever one currency slot in this data
 * model, so nothing here can *mix* two different currencies in one sum —
 * a genuinely multi-currency ad account is a schema limitation for a
 * later milestone to address (see `docs/SECURITY.md`'s Milestone 14
 * section), not something this module can silently get wrong today.
 */

export interface AdvertisingRow {
  channel: ChannelKey
  productId: string | null
  campaignName: string | null
  externalId: string | null
  periodDate: string
  spendMinor: number
  revenueMinor: number
  clicks: number
  impressions: number
  conversions: number
  dailyBudgetMinor: number | null
  isPaused: boolean
}

export interface AdvertisingFacts {
  rows: readonly AdvertisingRow[]
  currency: CurrencyCode
}

/**
 * Every row from `period.start` (or `previousPeriod.start` when supplied,
 * so a caller can compute a trailing comparison window in one read) through
 * `period.end` — bounded, paginated, org-scoped exactly like
 * `loadOrgSalesFacts`/`loadProductChannelProfitFacts` beside it.
 */
export async function loadAdvertisingFacts(orgId: string, period: Period, previousPeriod: Period | null): Promise<AdvertisingFacts> {
  const supabase = createServiceSupabase()
  const currency = await loadOrgCurrency(orgId)
  const earliestBound = previousPeriod ? previousPeriod.start : period.start

  const result = await paginate<{
    channel: ChannelKey; product_id: string | null; campaign_name: string | null; external_id: string | null
    period_date: string; spend_minor: number; revenue_minor: number; clicks: number; impressions: number
    conversions: number; daily_budget_minor: number | null; is_paused: boolean
  }>((from, to) =>
    supabase
      .from('advertising')
      .select('channel, product_id, campaign_name, external_id, period_date, spend_minor, revenue_minor, clicks, impressions, conversions, daily_budget_minor, is_paused')
      .eq('org_id', orgId)
      .gte('period_date', earliestBound.slice(0, 10))
      .lte('period_date', period.end.slice(0, 10))
      .order('period_date', { ascending: true })
      .range(from, to),
  )

  const rows: AdvertisingRow[] = result.rows.map((r) => ({
    channel: r.channel, productId: r.product_id, campaignName: r.campaign_name, externalId: r.external_id,
    periodDate: r.period_date, spendMinor: r.spend_minor, revenueMinor: r.revenue_minor, clicks: r.clicks,
    impressions: r.impressions, conversions: r.conversions, dailyBudgetMinor: r.daily_budget_minor, isPaused: r.is_paused,
  }))

  return { rows, currency }
}
