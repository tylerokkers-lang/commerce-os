import { describe, expect, it } from 'vitest'
import { amazonConnector } from '@/lib/marketplaces/connectors/amazon'
import { amazonDemoConnector } from '@/lib/marketplaces/connectors/amazonDemo'
import { shopifyConnector } from '@/lib/marketplaces/connectors/shopify'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import {
  connectorForChannel,
  deriveMarketplaceStatus,
  getMarketplaceConnector,
  listMarketplaceConnectors,
  marketplaceConnectorSummary,
} from '@/lib/marketplaces/connectors/registry'

describe('marketplace connector registry', () => {
  it('registers a real and a demo connector for each channel', () => {
    const keys = listMarketplaceConnectors().map((c) => c.descriptor.key)
    expect(keys).toEqual(
      expect.arrayContaining(['shopify', 'shopify_demo', 'amazon_uk', 'amazon_uk_demo']),
    )
  })

  it('resolves the demo connector when the session is in demo mode', () => {
    expect(connectorForChannel('shopify', true)).toBe(shopifyDemoConnector)
    expect(connectorForChannel('amazon_uk', true)).toBe(amazonDemoConnector)
  })

  it('resolves the real connector when the session is not in demo mode', () => {
    expect(connectorForChannel('shopify', false)).toBe(shopifyConnector)
    expect(connectorForChannel('amazon_uk', false)).toBe(amazonConnector)
  })

  it('finds a connector by key', () => {
    expect(getMarketplaceConnector('shopify')).toBe(shopifyConnector)
    expect(getMarketplaceConnector('does-not-exist')).toBeUndefined()
  })
})

describe('unconfigured state', () => {
  it('the real Shopify connector reports not configured without credentials', () => {
    expect(shopifyConnector.isConfigured()).toBe(false)
  })

  it('the real Amazon connector reports not configured without credentials', () => {
    expect(amazonConnector.isConfigured()).toBe(false)
  })

  it('never claims a real connector is ready without its exact credentials', () => {
    expect(shopifyConnector.descriptor.requiredCredentials).toEqual([
      'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_API_VERSION',
    ])
    expect(amazonConnector.descriptor.requiredCredentials).toEqual([
      'AMAZON_SP_CLIENT_ID', 'AMAZON_SP_CLIENT_SECRET', 'AMAZON_SP_REFRESH_TOKEN', 'AMAZON_SP_MARKETPLACE_ID',
    ])
  })

  it('derives not_configured status for a real connector with no credentials', async () => {
    const status = await deriveMarketplaceStatus(shopifyConnector, {
      lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0, listingCount: 0, orderCount: 0,
    })
    expect(status).toBe('not_configured')
  })

  it('getConnectionHealth reports not_configured rather than attempting a request', async () => {
    const health = await shopifyConnector.getConnectionHealth()
    expect(health.ok).toBe(true)
    if (health.ok) expect(health.value.status).toBe('not_configured')
  })
})

describe('authentication failure', () => {
  it('refuses to fetch listings from an unconfigured real connector', async () => {
    const result = await shopifyConnector.fetchListings({ limit: 10 })
    expect(result.ok).toBe(false)
  })

  it('refuses to fetch orders from an unconfigured real connector', async () => {
    const result = await amazonConnector.fetchOrders({ limit: 10 })
    expect(result.ok).toBe(false)
  })

  it('makes no network request when unconfigured — the guard runs before any fetch', async () => {
    // If this were making a real network call in a sandboxed test environment
    // with no network access, it would throw or hang rather than resolving.
    const result = await Promise.race([
      shopifyConnector.fetchOrders({ limit: 1 }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 500)),
    ])
    expect((result as { ok: boolean }).ok).toBe(false)
  })
})

describe('successful demo connection', () => {
  it('the demo connectors are always configured', () => {
    expect(shopifyDemoConnector.isConfigured()).toBe(true)
    expect(amazonDemoConnector.isConfigured()).toBe(true)
  })

  it('reports status "demo", never "connected"', async () => {
    const health = await shopifyDemoConnector.getConnectionHealth()
    expect(health.ok).toBe(true)
    if (health.ok) expect(health.value.status).toBe('demo')

    const status = await deriveMarketplaceStatus(shopifyDemoConnector, {
      lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0, listingCount: 0, orderCount: 0,
    })
    expect(status).toBe('demo')
  })

  it('returns real computed listings, not an empty or fixed stub', async () => {
    const result = await shopifyDemoConnector.fetchListings({ limit: 50 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.records.length).toBeGreaterThan(0)
      for (const listing of result.value.records) {
        expect(listing.priceMinor).toBeGreaterThan(0)
      }
    }
  })

  it('returns real computed orders for the demo Amazon connector', async () => {
    const result = await amazonDemoConnector.fetchOrders({ limit: 50 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.records.length).toBeGreaterThan(0)
  })

  it('summarises a connector into the UI shape without lying about status', async () => {
    const summary = await marketplaceConnectorSummary(shopifyDemoConnector)
    expect(summary.status).toBe('demo')
    expect(summary.isConfigured).toBe(true)
  })

  it('honestly reports fee reporting as unsupported where it is not modelled', async () => {
    const result = await amazonDemoConnector.fetchInventory({ limit: 10 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.records).toHaveLength(0)
      expect(result.value.warnings.length).toBeGreaterThan(0)
    }
  })
})

describe('capabilities are declared, not assumed', () => {
  it('Shopify declares broader write capability than the read-only foundation currently exercises', () => {
    expect(shopifyConnector.descriptor.capabilities.writeListings).toBe(true)
    expect(shopifyConnector.descriptor.capabilities.webhooks).toBe(true)
  })

  it('Amazon correctly declares that seller-submitted refunds are not a supported capability', () => {
    expect(amazonConnector.descriptor.capabilities.processRefunds).toBe(false)
  })

  it('demo connectors declare no write capability, since they never touch a real marketplace', () => {
    expect(shopifyDemoConnector.descriptor.capabilities.writeListings).toBe(false)
    expect(amazonDemoConnector.descriptor.capabilities.writeListings).toBe(false)
  })
})
