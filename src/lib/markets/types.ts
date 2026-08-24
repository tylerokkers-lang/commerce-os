import type { CurrencyCode } from '@/lib/core/money'
import type { ChannelKey, ComplianceVerdict } from '@/lib/core/domain'
import type { MarketplaceConnectionStatus } from '@/lib/marketplaces/connectors/types'

/**
 * The global market model (Milestone 9 §1).
 *
 * A "market" is a country + currency + marketplace-platform combination —
 * deliberately more than a bare country string, and deliberately distinct
 * from the existing `channel_key` enum ('shopify' | 'amazon_uk'), which
 * names the two channels this business actually operates *today*.
 * `channel_key` is not extended or reworked here: a market's `channelKey`
 * is populated only when it corresponds to one of those two real, already
 * operational channels; every other market (Amazon Germany, Amazon US,
 * eBay UK, …) has `channelKey: null` and is evaluated on facts and
 * catalog-declared capability alone, never assumed to have a working
 * connector.
 */

/**
 * Reuses `MarketplaceConnectionStatus` (Milestone 4's own
 * `connected|demo|not_configured|degraded|error`) rather than inventing a
 * parallel vocabulary, plus one addition — `planned` — for a market this
 * codebase has no connector implementation for at all. `status` is never
 * stored statically on a market: it is derived at read time from the real
 * connector's own current state (`deriveMarketplaceStatus`), exactly like
 * `/automation`'s production-readiness card and `/marketplaces` already
 * do, so a market can never claim to be `live`/`demo` after credentials
 * are configured or revoked without the catalog itself changing.
 */
export type MarketConnectorStatus = MarketplaceConnectionStatus | 'planned'

export interface MarketDescriptor {
  /** Stable key, e.g. "amazon_uk", "amazon_de", "shopify_us", "ebay_uk". Not a channel_key — see module comment. */
  marketKey: string
  label: string
  countryCode: string // ISO 3166-1 alpha-2
  countryLabel: string
  currency: CurrencyCode
  marketplacePlatform: string // 'amazon' | 'shopify' | 'ebay' | 'walmart' | 'etsy' | 'tiktok_shop'
  locale: string
  /**
   * The real connector this market can use, when one exists. Populated
   * only for markets this codebase has an actual `MarketplaceConnector`
   * for (today: 'shopify', 'amazon_uk') — never set for a market whose
   * connector is merely planned.
   */
  connectorKey: string | null
  /** The existing operational channel this market corresponds to, if any — see module comment. */
  channelKey: ChannelKey | null
  /** Why this market has no connector yet, or a note on the one it does have. Always present, even for a fully live market, so the UI never has to fall back to silence. */
  note: string
}

export interface MarketStatusSnapshot {
  market: MarketDescriptor
  status: MarketConnectorStatus
  checkedAt: string
}

/**
 * A compliance result scoped to exactly one market — structurally distinct
 * from `ComplianceAssessment` (the existing, UK-channel-scoped type from
 * `compliance/rules.ts`) so the two can never be confused with each other
 * or collapsed into a single global verdict.
 */
export interface MarketComplianceResult {
  productId: string
  marketKey: string
  countryCode: string
  verdict: ComplianceVerdict
  checks: readonly { key: string; label: string; outcome: 'pass' | 'fail' | 'unknown' | 'not_applicable'; evidence: string; remediable: boolean }[]
  blockingReasons: readonly string[]
  missingFacts: readonly string[]
  rulesetVersion: string
  assessedAt: string
  /** Which underlying ruleset produced this — 'delegated' when it reused the existing UK engine, 'no_ruleset' when no country ruleset is registered yet (honest UNKNOWN, never a guess), never a third silent option. */
  source: 'delegated' | 'no_ruleset'
}
