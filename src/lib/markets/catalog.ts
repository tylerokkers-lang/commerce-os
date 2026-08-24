import { getMarketplaceConnector, deriveMarketplaceStatus, type MarketplaceRuntimeState } from '@/lib/marketplaces/connectors/registry'
import type { MarketDescriptor, MarketStatusSnapshot } from './types'

/**
 * The global marketplace catalog (Milestone 9 §2) — a closed, versioned
 * registry, the same shape and the same reasoning as
 * `marketplaces/connectors/registry.ts`: this describes which
 * country/marketplace combinations exist in the world and what this
 * codebase can honestly do with each one, not a live discovery of
 * anything. A market's actual status (`resolveMarketStatus` below) is
 * never stored here — it is derived at read time from the real connector,
 * so it can never drift from the truth after credentials are configured.
 *
 * Deliberately not exhaustive. The brief is explicit: do not build every
 * marketplace connector, and do not pretend the architecture already knows
 * every country's rules. This catalog exists to prove the *shape* extends
 * without a schema or type redesign — adding a new market is one object
 * literal, not a migration.
 */
export const MARKET_CATALOG: readonly MarketDescriptor[] = [
  {
    marketKey: 'amazon_uk', label: 'Amazon UK', countryCode: 'GB', countryLabel: 'United Kingdom',
    currency: 'GBP', marketplacePlatform: 'amazon', locale: 'en-GB',
    connectorKey: 'amazon_uk', channelKey: 'amazon_uk',
    note: 'The real Amazon SP-API connector exists (Milestone 4) — its actual status is read live from the connector, the same as /marketplaces.',
  },
  {
    marketKey: 'shopify_uk', label: 'Shopify (UK store)', countryCode: 'GB', countryLabel: 'United Kingdom',
    currency: 'GBP', marketplacePlatform: 'shopify', locale: 'en-GB',
    connectorKey: 'shopify', channelKey: 'shopify',
    note: 'The real Shopify Admin API connector exists (Milestone 4) — its actual status is read live from the connector.',
  },
  {
    marketKey: 'shopify_us', label: 'Shopify (US store)', countryCode: 'US', countryLabel: 'United States',
    currency: 'USD', marketplacePlatform: 'shopify', locale: 'en-US',
    connectorKey: null, channelKey: null,
    note: 'Shopify itself is not country-locked, but a US-priced storefront/market has not been configured for this business — no channel exists for it yet.',
  },
  {
    marketKey: 'amazon_us', label: 'Amazon US', countryCode: 'US', countryLabel: 'United States',
    currency: 'USD', marketplacePlatform: 'amazon', locale: 'en-US',
    connectorKey: null, channelKey: null,
    note: 'No Amazon US seller account or connector exists yet — a genuinely separate marketplace registration from Amazon UK, not the same account.',
  },
  {
    marketKey: 'amazon_de', label: 'Amazon Germany', countryCode: 'DE', countryLabel: 'Germany',
    currency: 'EUR', marketplacePlatform: 'amazon', locale: 'de-DE',
    connectorKey: null, channelKey: null,
    note: 'No Amazon Germany seller registration or connector exists yet.',
  },
  {
    marketKey: 'ebay_uk', label: 'eBay UK', countryCode: 'GB', countryLabel: 'United Kingdom',
    currency: 'GBP', marketplacePlatform: 'ebay', locale: 'en-GB',
    connectorKey: null, channelKey: null,
    note: 'No eBay connector has been built yet.',
  },
  {
    marketKey: 'walmart_us', label: 'Walmart Marketplace (US)', countryCode: 'US', countryLabel: 'United States',
    currency: 'USD', marketplacePlatform: 'walmart', locale: 'en-US',
    connectorKey: null, channelKey: null,
    note: 'No Walmart Marketplace connector has been built yet.',
  },
  {
    marketKey: 'etsy_us', label: 'Etsy (US)', countryCode: 'US', countryLabel: 'United States',
    currency: 'USD', marketplacePlatform: 'etsy', locale: 'en-US',
    connectorKey: null, channelKey: null,
    note: 'No Etsy connector has been built yet.',
  },
  {
    marketKey: 'tiktok_shop_uk', label: 'TikTok Shop (UK)', countryCode: 'GB', countryLabel: 'United Kingdom',
    currency: 'GBP', marketplacePlatform: 'tiktok_shop', locale: 'en-GB',
    connectorKey: null, channelKey: null,
    note: 'No TikTok Shop connector has been built yet.',
  },
] as const

export function getMarket(marketKey: string): MarketDescriptor | undefined {
  return MARKET_CATALOG.find((m) => m.marketKey === marketKey)
}

export function listMarkets(): readonly MarketDescriptor[] {
  return MARKET_CATALOG
}

/**
 * The one place a market's live/demo/not_configured/planned status is
 * decided — reusing `deriveMarketplaceStatus` (Milestone 4) rather than a
 * second status-derivation function. A market with no `connectorKey` is
 * always `planned`; a market whose connector cannot be found in the
 * registry (should not happen — defensive only) is treated identically.
 */
const EMPTY_RUNTIME_STATE: MarketplaceRuntimeState = {
  lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0, listingCount: 0, orderCount: 0,
}

export async function resolveMarketStatus(market: MarketDescriptor, runtimeState: MarketplaceRuntimeState = EMPTY_RUNTIME_STATE): Promise<MarketStatusSnapshot> {
  const checkedAt = new Date().toISOString()
  if (!market.connectorKey) return { market, status: 'planned', checkedAt }

  const connector = getMarketplaceConnector(market.connectorKey)
  if (!connector) return { market, status: 'planned', checkedAt }

  const status = await deriveMarketplaceStatus(connector, runtimeState)
  return { market, status, checkedAt }
}
