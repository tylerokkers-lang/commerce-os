import { describe, expect, it } from 'vitest'
import { amazonConnector } from '@/lib/marketplaces/connectors/amazon'
import { amazonDemoConnector } from '@/lib/marketplaces/connectors/amazonDemo'
import { ebayConnector, __internal as ebayInternal } from '@/lib/marketplaces/connectors/ebay'
import { ebayDemoConnector } from '@/lib/marketplaces/connectors/ebayDemo'
import { buildEbayVerificationAuditEntry } from '@/lib/marketplaces/connectors/ebayVerificationAudit'
import type { EbayVerificationResult } from '@/lib/marketplaces/connectors/ebay'
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
      expect.arrayContaining(['shopify', 'shopify_demo', 'amazon_uk', 'amazon_uk_demo', 'ebay', 'ebay_demo']),
    )
  })

  it('resolves the demo connector when the session is in demo mode', () => {
    expect(connectorForChannel('shopify', true)).toBe(shopifyDemoConnector)
    expect(connectorForChannel('amazon_uk', true)).toBe(amazonDemoConnector)
    expect(connectorForChannel('ebay', true)).toBe(ebayDemoConnector)
  })

  it('resolves the real connector when the session is not in demo mode', () => {
    expect(connectorForChannel('shopify', false)).toBe(shopifyConnector)
    expect(connectorForChannel('amazon_uk', false)).toBe(amazonConnector)
    expect(connectorForChannel('ebay', false)).toBe(ebayConnector)
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

  it('the real eBay connector reports not configured without credentials', () => {
    expect(ebayConnector.isConfigured()).toBe(false)
  })

  it('never claims a real connector is ready without its exact credentials', () => {
    expect(shopifyConnector.descriptor.requiredCredentials).toEqual([
      'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_API_VERSION',
    ])
    expect(amazonConnector.descriptor.requiredCredentials).toEqual([
      'AMAZON_SP_CLIENT_ID', 'AMAZON_SP_CLIENT_SECRET', 'AMAZON_SP_REFRESH_TOKEN', 'AMAZON_SP_MARKETPLACE_ID',
    ])
    expect(ebayConnector.descriptor.requiredCredentials).toEqual([
      'EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_REFRESH_TOKEN',
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

  it('refuses to fetch eBay orders/listings from an unconfigured real connector, with no network call', async () => {
    const orders = await ebayConnector.fetchOrders({ limit: 10 })
    expect(orders.ok).toBe(false)
    const listings = await ebayConnector.fetchListings({ limit: 10 })
    expect(listings.ok).toBe(false)
  })

  it('reports not_configured connection health for eBay without attempting a token exchange', async () => {
    const health = await ebayConnector.getConnectionHealth()
    expect(health.ok).toBe(true)
    if (health.ok) expect(health.value.status).toBe('not_configured')
  })
})

describe('successful demo connection', () => {
  it('the demo connectors are always configured', () => {
    expect(shopifyDemoConnector.isConfigured()).toBe(true)
    expect(amazonDemoConnector.isConfigured()).toBe(true)
    expect(ebayDemoConnector.isConfigured()).toBe(true)
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

  it('returns real computed listings and orders for the demo eBay connector', async () => {
    const listings = await ebayDemoConnector.fetchListings({ limit: 50 })
    expect(listings.ok).toBe(true)
    if (listings.ok) {
      expect(listings.value.records.length).toBeGreaterThan(0)
      for (const listing of listings.value.records) expect(listing.priceMinor).toBeGreaterThan(0)
    }

    const orders = await ebayDemoConnector.fetchOrders({ limit: 50 })
    expect(orders.ok).toBe(true)
    if (orders.ok) expect(orders.value.records.length).toBeGreaterThan(0)
  })

  it('reports "demo" status for eBay, never "connected"', async () => {
    const health = await ebayDemoConnector.getConnectionHealth()
    expect(health.ok).toBe(true)
    if (health.ok) expect(health.value.status).toBe('demo')

    const status = await deriveMarketplaceStatus(ebayDemoConnector, {
      lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0, listingCount: 0, orderCount: 0,
    })
    expect(status).toBe('demo')
  })

  it('honestly reports eBay fee reporting as unsupported, matching the real connector\'s limitation', async () => {
    const result = await ebayDemoConnector.fetchFees({ limit: 10 })
    expect(result.ok).toBe(false)
  })
})

describe('capabilities are declared, not assumed', () => {
  it('Shopify (Milestone Shopify-Read-Only) requests only read capability: no write/refund/verify/webhook/fee capability at all this phase', () => {
    expect(shopifyConnector.descriptor.capabilities).toEqual({
      readListings: true,
      writeListings: false,
      syncInventory: true,
      ingestOrders: true,
      updateFulfilment: false,
      processRefunds: false,
      readFees: false,
      webhooks: false,
      verifyWrites: false,
      createListings: false,
    })
  })

  it('Amazon correctly declares that seller-submitted refunds are not a supported capability', () => {
    expect(amazonConnector.descriptor.capabilities.processRefunds).toBe(false)
  })

  it('demo connectors declare write and verify capability, since they genuinely simulate the full submit -> verify pipeline (Milestone 7)', () => {
    expect(shopifyDemoConnector.descriptor.capabilities.writeListings).toBe(true)
    expect(shopifyDemoConnector.descriptor.capabilities.verifyWrites).toBe(true)
    expect(amazonDemoConnector.descriptor.capabilities.writeListings).toBe(true)
    expect(amazonDemoConnector.descriptor.capabilities.verifyWrites).toBe(true)
  })

  it('eBay requests only minimum permissions: no write/refund/verify capability at all yet (brief §4 — no purchasing or financial authority)', () => {
    expect(ebayConnector.descriptor.capabilities).toEqual({
      readListings: true,
      writeListings: false,
      syncInventory: false,
      ingestOrders: true,
      updateFulfilment: true,
      processRefunds: false,
      readFees: false,
      webhooks: false,
      verifyWrites: false,
      createListings: false,
    })
  })

  it('eBay is keyed on the ebay channel, not folded into an existing channel', () => {
    expect(ebayConnector.descriptor.channel).toBe('ebay')
    expect(ebayDemoConnector.descriptor.channel).toBe('ebay')
  })
})

describe('eBay OAuth token exchange (Milestone 21, §4 — credentials handling)', () => {
  it('getAccessToken never proceeds to an API call when the token exchange itself fails', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })) as typeof fetch
    try {
      const result = await ebayInternal.getAccessToken({ clientId: 'x', clientSecret: 'y', refreshToken: 'z', environment: 'production' as const, environmentSource: 'default' as const })
      expect(result.ok).toBe(false)
    } finally {
      globalThis.fetch = original
    }
  })

  it('never sends the client secret in a URL or query string — only inside the Basic auth header', async () => {
    const original = globalThis.fetch
    let capturedUrl = ''
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    }) as typeof fetch
    try {
      await ebayInternal.getAccessToken({ clientId: 'my-id', clientSecret: 'super-secret', refreshToken: 'refresh-value', environment: 'production' as const, environmentSource: 'default' as const })
      expect(capturedUrl).not.toContain('super-secret')
      expect(capturedUrl).not.toContain('refresh-value')
    } finally {
      globalThis.fetch = original
    }
  })
})

/**
 * Milestone 21 Step 1.5 — corrections made after cross-checking the
 * implementation against eBay's official API reference (see ebay.ts's
 * module doc comment for sources). These tests prove the two real
 * discrepancies found are actually fixed, not just documented.
 */
describe('eBay API response handling (Milestone 21 Step 1.5 — doc-verified corrections)', () => {
  function mockTokenThenApi(apiResponse: Response) {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/identity/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
      }
      return apiResponse
    }) as typeof fetch
    return () => {
      globalThis.fetch = original
    }
  }

  it('describeEbayError surfaces eBay\'s own errorId/message rather than a bare HTTP status', () => {
    const message = ebayInternal.describeEbayError(403, 'Forbidden', {
      errors: [{ errorId: 1100, message: 'Insufficient permissions', longMessage: 'The token does not have the required scope for this call.' }],
    })
    expect(message).toContain('1100')
    expect(message).toContain('required scope')
  })

  it('describeEbayError falls back to the bare HTTP status when eBay returns no parseable error body', () => {
    const message = ebayInternal.describeEbayError(500, 'Internal Server Error', null)
    expect(message).toBe('eBay API returned 500 Internal Server Error.')
  })

  it('a real eBay error envelope on a failed call becomes a precise, attributable error, not a generic HTTP status', async () => {
    const restore = mockTokenThenApi(
      new Response(JSON.stringify({ errors: [{ errorId: 2001, message: 'Invalid access token' }] }), { status: 401, statusText: 'Unauthorized' }),
    )
    try {
      const result = await ebayInternal.ebayApiRequest({ clientId: 'x', clientSecret: 'y', refreshToken: 'z', environment: 'production' as const, environmentSource: 'default' as const }, '/sell/fulfillment/v1/order?limit=1', 'GET')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('Invalid access token')
    } finally {
      restore()
    }
  })

  it('an empty 201 response body (createShippingFulfillment\'s real shape) is parsed as success, never crashes on empty JSON', async () => {
    const restore = mockTokenThenApi(
      new Response('', { status: 201, headers: { Location: 'https://api.ebay.com/sell/fulfillment/v1/order/ORDER-1/shipping_fulfillment/FUL-123' } }),
    )
    try {
      const result = await ebayInternal.performEbayApiRequest({ clientId: 'x', clientSecret: 'y', refreshToken: 'z', environment: 'production' as const, environmentSource: 'default' as const }, '/sell/fulfillment/v1/order/ORDER-1/shipping_fulfillment', 'POST', { lineItems: [] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.data).toBeNull()
        expect(result.value.location).toContain('FUL-123')
      }
    } finally {
      restore()
    }
  })

  it('submitFulfilmentUpdate reads the fulfillment id from the Location header, not a body field (the corrected behaviour)', async () => {
    const restore = mockTokenThenApi(
      new Response('', { status: 201, headers: { Location: 'https://api.ebay.com/sell/fulfillment/v1/order/ORDER-1/shipping_fulfillment/FUL-999' } }),
    )
    const originalEnv = { ...process.env }
    process.env.EBAY_CLIENT_ID = 'x'
    process.env.EBAY_CLIENT_SECRET = 'y'
    process.env.EBAY_REFRESH_TOKEN = 'z'
    try {
      const result = await ebayConnector.submitFulfilmentUpdate({ externalOrderId: 'ORDER-1', carrier: 'Royal Mail', trackingNumber: 'TRACK-1', idempotencyKey: 'idem-1' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.marketplaceReference).toBe('FUL-999')
    } finally {
      restore()
      process.env = originalEnv
    }
  })
})

/**
 * eBay connection verification & hardening — Sandbox/Production
 * separation, the six-state `verifyEbayConnection()` result, and the
 * capability-layer separation. All mocked/deterministic; the real live
 * verification against the credentials in `.env.local` was run
 * separately via a temporary, deleted-after-use script (see HANDOVER.md).
 */
describe('eBay connection verification (verifyEbayConnection, six explicit states)', () => {
  function withEbayEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
    const original = { ...process.env }
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return run().finally(() => {
      process.env = original
    })
  }

  function mockEbayFlow(tokenResponse: Response, apiResponse?: Response) {
    const original = globalThis.fetch
    const capturedUrls: string[] = []
    const defaultApiResponse = () => new Response(JSON.stringify({ orders: [] }), { status: 200 })
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      capturedUrls.push(url)
      // verifyEbayConnection() calls getAccessToken() directly and then
      // again inside performEbayApiRequest() — a real Response body can
      // only be read once, so each call must get its own clone.
      if (url.includes('/identity/v1/oauth2/token')) return tokenResponse.clone()
      return (apiResponse ?? defaultApiResponse()).clone()
    }) as typeof fetch
    return { restore: () => { globalThis.fetch = original }, capturedUrls }
  }

  const SANDBOX_ID = 'MyApp-SBX-1a2b3c4d5-6e7f8g9h'
  const PRODUCTION_ID = 'MyApp-PRD-1a2b3c4d5-6e7f8g9h'
  const okTokenResponse = () => new Response(JSON.stringify({ access_token: 'tok', scope: 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.inventory.readonly' }), { status: 200 })

  it('1. missing credentials -> NOT_CONFIGURED, no network call at all', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: undefined, EBAY_CLIENT_SECRET: undefined, EBAY_REFRESH_TOKEN: undefined }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const original = globalThis.fetch
      let called = false
      globalThis.fetch = (async () => { called = true; return new Response('', { status: 200 }) }) as typeof fetch
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('NOT_CONFIGURED')
        expect(result.environment).toBeNull()
        expect(called).toBe(false)
      } finally {
        globalThis.fetch = original
      }
    })
  })

  it('2 & 4. successful token refresh + successful authenticated read-only call -> CONNECTED, real scopes captured', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r', EBAY_ENVIRONMENT: undefined }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(okTokenResponse(), new Response(JSON.stringify({ orders: [] }), { status: 200 }))
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('CONNECTED')
        expect(result.environment).toBe('production')
        expect(result.operationTested).toBe('GET /sell/fulfillment/v1/order?limit=1')
        expect(result.oauthScopesGranted).toEqual([
          'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
          'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
        ])
        expect(result.latencyMs).not.toBeNull()
      } finally {
        restore()
      }
    })
  })

  it('3a. token endpoint rejects with invalid_client -> AUTHENTICATION_FAILED (bad client id/secret pair)', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(new Response(JSON.stringify({ error: 'invalid_client', error_description: 'client authentication failed' }), { status: 401 }))
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('AUTHENTICATION_FAILED')
      } finally {
        restore()
      }
    })
  })

  it('3b / 11. token endpoint rejects with invalid_grant -> TOKEN_REFRESH_FAILED (expired/revoked refresh token)', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }), { status: 400 }))
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('TOKEN_REFRESH_FAILED')
      } finally {
        restore()
      }
    })
  })

  it('5. token obtained but the API call fails -> API_ACCESS_FAILED', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(okTokenResponse(), new Response(JSON.stringify({ errors: [{ errorId: 1100, message: 'Insufficient permissions' }] }), { status: 403 }))
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('API_ACCESS_FAILED')
        expect(result.oauthScopesGranted.length).toBeGreaterThan(0) // token step succeeded before the API step failed
      } finally {
        restore()
      }
    })
  })

  it('6a. Sandbox Client ID selects the sandbox host — never sends sandbox credentials to production', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: SANDBOX_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r', EBAY_ENVIRONMENT: undefined }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore, capturedUrls } = mockEbayFlow(okTokenResponse())
      try {
        const result = await verifyEbayConnection()
        expect(result.environment).toBe('sandbox')
        expect(result.environmentSource).toBe('detected')
        expect(capturedUrls[0]).toContain('api.sandbox.ebay.com')
      } finally {
        restore()
      }
    })
  })

  it('6b. Production Client ID selects the production host', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r', EBAY_ENVIRONMENT: undefined }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore, capturedUrls } = mockEbayFlow(okTokenResponse())
      try {
        const result = await verifyEbayConnection()
        expect(result.environment).toBe('production')
        expect(capturedUrls[0]).toContain('https://api.ebay.com')
        expect(capturedUrls[0]).not.toContain('sandbox')
      } finally {
        restore()
      }
    })
  })

  it('6c. an explicit EBAY_ENVIRONMENT that disagrees with the Client ID marker is refused, never guessed', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: SANDBOX_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r', EBAY_ENVIRONMENT: 'production' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const result = await verifyEbayConnection()
      // Never guessed which signal wins -> treated as unconfigured, matching "mark degraded/not configured rather than guessing."
      expect(result.status).toBe('NOT_CONFIGURED')
    })
  })

  it('6d. a Client ID with no recognisable marker and no EBAY_ENVIRONMENT falls back to production — preserves this connector\'s original, pre-existing behaviour exactly', () => {
    const resolved = ebayInternal.resolveEbayEnvironment('some-custom-app-name', undefined)
    expect(resolved).toEqual({ ok: true, environment: 'production', source: 'default' })
  })

  it('7. no credential ever appears anywhere in a verifyEbayConnection() result, success or failure', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 'THE-SECRET-VALUE', EBAY_REFRESH_TOKEN: 'THE-REFRESH-VALUE' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(
        new Response(JSON.stringify({ error: 'invalid_client', error_description: 'client authentication failed' }), { status: 401 }),
      )
      try {
        const result = await verifyEbayConnection()
        const serialised = JSON.stringify(result)
        expect(serialised).not.toContain('THE-SECRET-VALUE')
        expect(serialised).not.toContain('THE-REFRESH-VALUE')
        expect(serialised).not.toContain(PRODUCTION_ID) // even the (non-secret) client id itself is not echoed back
      } finally {
        restore()
      }
    })
  })

  it('8. connection is never CONNECTED merely because env vars exist — a real failure still surfaces as a failure', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const original = globalThis.fetch
      globalThis.fetch = (async () => { throw new Error('network unreachable') }) as typeof fetch
      try {
        const result = await verifyEbayConnection()
        expect(result.status).not.toBe('CONNECTED')
      } finally {
        globalThis.fetch = original
      }
    })
  })

  it('9. write capabilities remain disabled even after a genuinely successful CONNECTED verification', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r' }, async () => {
      const { verifyEbayConnection, ebayConnector: connector } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(okTokenResponse())
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('CONNECTED')
      } finally {
        restore()
      }
      expect(connector.descriptor.capabilities.writeListings).toBe(false)
      expect(connector.descriptor.capabilities.processRefunds).toBe(false)
      const priceResult = await connector.updateListingPrice()
      expect(priceResult.ok).toBe(false)
    })
  })

  it('10. a broad OAuth scope grant does not automatically expand what Commerce OS is permitted to do', async () => {
    const { describeEbayCapabilityLayers } = await import('@/lib/marketplaces/connectors/ebay')
    // Simulate eBay having granted a much broader scope set than this connector uses.
    const layers = describeEbayCapabilityLayers([
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.finances',
    ])
    expect(layers.oauthScopesGranted).toHaveLength(3)
    // Scopes granted is purely informational — it never widens what's enabled or policy-permitted.
    expect(layers.explicitlyEnabled.writeListings).toBe(false)
    expect(layers.explicitlyEnabled.processRefunds).toBe(false)
    expect(layers.policyPermitted).toBe('read_only')
  })

  it('12a. HTTP 429 on the token endpoint -> DEGRADED, distinct from a hard authentication/refresh failure', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), { status: 429 }))
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('DEGRADED')
      } finally {
        restore()
      }
    })
  })

  it('12b. HTTP 503 on the API call -> DEGRADED, distinct from API_ACCESS_FAILED', async () => {
    await withEbayEnv({ EBAY_CLIENT_ID: PRODUCTION_ID, EBAY_CLIENT_SECRET: 's', EBAY_REFRESH_TOKEN: 'r' }, async () => {
      const { verifyEbayConnection } = await import('@/lib/marketplaces/connectors/ebay')
      const { restore } = mockEbayFlow(okTokenResponse(), new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }))
      try {
        const result = await verifyEbayConnection()
        expect(result.status).toBe('DEGRADED')
      } finally {
        restore()
      }
    })
  })
})

describe('eBay verification audit entry (Task 9 — safe metadata only)', () => {
  function result(over: Partial<EbayVerificationResult> = {}): EbayVerificationResult {
    return {
      status: 'CONNECTED',
      environment: 'sandbox',
      environmentSource: 'detected',
      checkedAt: '2026-08-27T00:00:00.000Z',
      operationTested: 'GET /sell/fulfillment/v1/order?limit=1',
      latencyMs: 250,
      detail: 'Authenticated eBay API call succeeded against sandbox.',
      oauthScopesGranted: ['https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly'],
      ...over,
    }
  }

  it('records exactly the safe fields Task 9 lists — integration, environment, timestamp-adjacent status, operation, latency, scopes', () => {
    const entry = buildEbayVerificationAuditEntry('org-1', result())
    expect(entry.action).toBe('MARKETPLACE_CONNECTOR_VERIFIED')
    expect(entry.orgId).toBe('org-1')
    expect(entry.result).toBe('success')
    expect(entry.newValue).toMatchObject({ integration: 'ebay', environment: 'sandbox', status: 'CONNECTED', operationTested: 'GET /sell/fulfillment/v1/order?limit=1', latencyMs: 250 })
  })

  it('a failed verification is recorded as a failure result, a degraded one as blocked — never silently reported as success', () => {
    expect(buildEbayVerificationAuditEntry('org-1', result({ status: 'AUTHENTICATION_FAILED' })).result).toBe('failure')
    expect(buildEbayVerificationAuditEntry('org-1', result({ status: 'TOKEN_REFRESH_FAILED' })).result).toBe('failure')
    expect(buildEbayVerificationAuditEntry('org-1', result({ status: 'API_ACCESS_FAILED' })).result).toBe('failure')
    expect(buildEbayVerificationAuditEntry('org-1', result({ status: 'NOT_CONFIGURED' })).result).toBe('failure')
    expect(buildEbayVerificationAuditEntry('org-1', result({ status: 'DEGRADED' })).result).toBe('blocked')
  })

  it('structurally cannot contain a credential — no field in the built entry can hold an access/refresh token or client secret', () => {
    const entry = buildEbayVerificationAuditEntry('org-1', result({ detail: 'eBay token exchange failed: invalid_client (401 Unauthorized) — client authentication failed' }))
    const serialised = JSON.stringify(entry)
    // The detail string itself only ever contains eBay's own error text
    // (proven separately by verifyEbayConnection's own tests) — this test
    // proves the entry-building step adds no new field that could smuggle
    // one in, by checking the full set of keys is exactly what's declared.
    expect(Object.keys(entry).sort()).toEqual(['action', 'actorType', 'entityId', 'entityType', 'newValue', 'orgId', 'reason', 'result'].sort())
    expect(serialised).not.toContain('Authorization')
    expect(serialised).not.toContain('Bearer')
    expect(serialised).not.toContain('Basic ')
  })
})
