import { amazonConnector } from './amazon'
import { amazonDemoConnector } from './amazonDemo'
import { ebayConnector } from './ebay'
import { ebayDemoConnector } from './ebayDemo'
import { shopifyConnector } from './shopify'
import { shopifyDemoConnector } from './shopifyDemo'
import type { MarketplaceConnector, MarketplaceConnectorSummary, MarketplaceConnectionStatus } from './types'

/**
 * The marketplace connector registry (Milestone 4; eBay added Milestone 21).
 *
 * A real connector and a demo connector for each of Shopify, Amazon UK and
 * eBay. The real ones report `not_configured` in this environment because no
 * credentials exist; the demo ones always report `demo`. Neither is ever
 * substituted for the other — the registry, and every caller, always knows
 * which kind of connector it is holding.
 */

const CONNECTORS = new Map<string, MarketplaceConnector>([
  [shopifyConnector.descriptor.key, shopifyConnector],
  [shopifyDemoConnector.descriptor.key, shopifyDemoConnector],
  [amazonConnector.descriptor.key, amazonConnector],
  [amazonDemoConnector.descriptor.key, amazonDemoConnector],
  [ebayConnector.descriptor.key, ebayConnector],
  [ebayDemoConnector.descriptor.key, ebayDemoConnector],
])

export const listMarketplaceConnectors = (): readonly MarketplaceConnector[] => [...CONNECTORS.values()]
export const getMarketplaceConnector = (key: string): MarketplaceConnector | undefined => CONNECTORS.get(key)

/** The connector to use for a channel, given whether the session is in demo mode. */
export function connectorForChannel(
  channel: 'shopify' | 'amazon_uk' | 'ebay',
  isDemo: boolean,
): MarketplaceConnector {
  const key = isDemo ? `${channel}_demo` : channel
  const connector = CONNECTORS.get(key)
  if (!connector) throw new Error(`No connector registered for ${key}`)
  return connector
}

export interface MarketplaceRuntimeState {
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  consecutiveFailures: number
  listingCount: number
  orderCount: number
}

const EMPTY_STATE: MarketplaceRuntimeState = {
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  consecutiveFailures: 0,
  listingCount: 0,
  orderCount: 0,
}

function missingCredentials(connector: MarketplaceConnector): readonly string[] {
  return connector.descriptor.requiredCredentials.filter((name) => {
    const value = process.env[name]
    return !value || value.trim().length === 0
  })
}

/**
 * Derives the five-state status from observable facts.
 *
 * A demo connector always reports `demo`. A real connector reports
 * `not_configured` without credentials, `error` after a failure, `degraded`
 * after a partial success, and `connected` only once it has genuinely
 * succeeded — never asserted, always derived.
 */
export async function deriveMarketplaceStatus(
  connector: MarketplaceConnector,
  state: MarketplaceRuntimeState,
): Promise<MarketplaceConnectionStatus> {
  if (connector.descriptor.key.endsWith('_demo')) return 'demo'
  if (!connector.isConfigured()) return 'not_configured'

  const health = await connector.getConnectionHealth()
  if (!health.ok) return 'error'
  if (health.value.status === 'error') return 'error'
  if (state.consecutiveFailures > 0) return 'degraded'
  return health.value.status
}

export async function marketplaceConnectorSummary(
  connector: MarketplaceConnector,
  state: MarketplaceRuntimeState = EMPTY_STATE,
): Promise<MarketplaceConnectorSummary> {
  const status = await deriveMarketplaceStatus(connector, state)
  const health = connector.isConfigured() || status === 'demo' ? await connector.getConnectionHealth() : null

  return {
    key: connector.descriptor.key,
    label: connector.descriptor.label,
    description: connector.descriptor.description,
    channel: connector.descriptor.channel,
    capabilities: connector.descriptor.capabilities,
    status,
    isConfigured: connector.isConfigured(),
    missingCredentials: missingCredentials(connector),
    rateLimit: connector.descriptor.rateLimit,
    usagePolicy: connector.descriptor.usagePolicy,
    apiVersion: health?.ok ? health.value.apiVersion : null,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastError: state.lastError,
    consecutiveFailures: state.consecutiveFailures,
    listingCount: state.listingCount,
    orderCount: state.orderCount,
  }
}
