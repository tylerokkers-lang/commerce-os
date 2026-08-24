import { unavailableMetric, type Metric } from './types'

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
