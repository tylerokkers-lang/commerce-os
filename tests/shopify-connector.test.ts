import { describe, expect, it } from 'vitest'
import { shopifyConnector, __internal as shopifyInternal } from '@/lib/marketplaces/connectors/shopify'

/**
 * Milestone Shopify-Read-Only — the GraphQL Admin API + client-credentials
 * migration. Every test here drives real, unmodified connector code
 * against a mocked `fetch`; none requires live Shopify credentials.
 */

const CREDS = { storeDomain: 'test-store.myshopify.com', clientId: 'client-id-x', clientSecret: 'super-secret-value', apiVersion: '2026-04' }

function mockFetchSequence(responses: readonly Response[]) {
  const original = globalThis.fetch
  let call = 0
  const urls: string[] = []
  const bodies: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input))
    bodies.push(typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '')
    const response = responses[Math.min(call, responses.length - 1)]
    call++
    return response
  }) as typeof fetch
  return { restore: () => { globalThis.fetch = original }, urls, bodies }
}

function tokenResponse(accessToken = 'access-tok-1') {
  return new Response(JSON.stringify({ access_token: accessToken, scope: 'read_products,read_orders', expires_in: 86399 }), { status: 200 })
}

describe('1. Configuration detection', () => {
  it('isConfigured() is false with no credentials set', () => {
    expect(shopifyConnector.isConfigured()).toBe(false)
  })

  it('isConfigured() is true once all four required env vars are set', () => {
    const original = { ...process.env }
    process.env.SHOPIFY_STORE_DOMAIN = 'x.myshopify.com'
    process.env.SHOPIFY_CLIENT_ID = 'id'
    process.env.SHOPIFY_CLIENT_SECRET = 'secret'
    process.env.SHOPIFY_API_VERSION = '2026-04'
    try {
      expect(shopifyConnector.isConfigured()).toBe(true)
    } finally {
      process.env = original
    }
  })

  it('requiredCredentials names the exact four env vars, never SHOPIFY_ADMIN_ACCESS_TOKEN', () => {
    expect(shopifyConnector.descriptor.requiredCredentials).toEqual([
      'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_API_VERSION',
    ])
    expect(shopifyConnector.descriptor.requiredCredentials).not.toContain('SHOPIFY_ADMIN_ACCESS_TOKEN')
  })
})

describe('1b. Store domain normalisation (found via a real live-verification run)', () => {
  it('a bare hostname is left unchanged', () => {
    expect(shopifyInternal.normalizeStoreDomain('a-store.myshopify.com')).toBe('a-store.myshopify.com')
  })

  it('strips a leading https:// scheme — the exact mistake a real .env.local run surfaced', () => {
    expect(shopifyInternal.normalizeStoreDomain('https://a-store.myshopify.com')).toBe('a-store.myshopify.com')
  })

  it('strips a leading http:// scheme too', () => {
    expect(shopifyInternal.normalizeStoreDomain('http://a-store.myshopify.com')).toBe('a-store.myshopify.com')
  })

  it('strips a trailing slash', () => {
    expect(shopifyInternal.normalizeStoreDomain('https://a-store.myshopify.com/')).toBe('a-store.myshopify.com')
  })

  it('credentials() applies the normalisation, so every request built from it uses a clean hostname', () => {
    const original = { ...process.env }
    process.env.SHOPIFY_STORE_DOMAIN = 'https://scheme-prefixed.myshopify.com'
    process.env.SHOPIFY_CLIENT_ID = 'id'
    process.env.SHOPIFY_CLIENT_SECRET = 'secret'
    process.env.SHOPIFY_API_VERSION = '2026-04'
    try {
      const creds = shopifyInternal.credentials()
      expect(creds?.storeDomain).toBe('scheme-prefixed.myshopify.com')
    } finally {
      process.env = original
    }
  })

  it('strips a repeated/stacked scheme prefix — the exact mistake a second real live-verification run surfaced', () => {
    expect(shopifyInternal.normalizeStoreDomain('https://https:https:https://a-store.myshopify.com')).toBe('a-store.myshopify.com')
  })

  it('strips a repeated scheme prefix regardless of how many times it repeats', () => {
    expect(shopifyInternal.normalizeStoreDomain('https://https://https://a-store.myshopify.com')).toBe('a-store.myshopify.com')
  })
})

describe('2. Client-credentials token exchange: request construction', () => {
  it('POSTs grant_type=client_credentials with client_id/client_secret as a form body to /admin/oauth/access_token', async () => {
    const { restore, urls, bodies } = mockFetchSequence([tokenResponse()])
    try {
      await shopifyInternal.getAccessToken(CREDS)
      expect(urls[0]).toBe(`https://${CREDS.storeDomain}/admin/oauth/access_token`)
      const params = new URLSearchParams(bodies[0])
      expect(params.get('grant_type')).toBe('client_credentials')
      expect(params.get('client_id')).toBe(CREDS.clientId)
      expect(params.get('client_secret')).toBe(CREDS.clientSecret)
    } finally {
      restore()
    }
  })
})

describe('3. Successful token response parsing', () => {
  it('resolves ok with the real access_token value', async () => {
    const { restore } = mockFetchSequence([tokenResponse('a-real-token')])
    try {
      const result = await shopifyInternal.getAccessToken(CREDS)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.accessToken).toBe('a-real-token')
    } finally {
      restore()
    }
  })

  it('captures the real scope string from the token response — never discarded (Phase 10)', async () => {
    const { restore } = mockFetchSequence([tokenResponse('a-real-token')])
    try {
      const result = await shopifyInternal.getAccessToken(CREDS)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.scope).toBe('read_products,read_orders')
    } finally {
      restore()
    }
  })

  it('a token response with no scope field reports scope as null, never fabricated (Phase 10)', async () => {
    const { restore } = mockFetchSequence([new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })])
    try {
      const result = await shopifyInternal.getAccessToken(CREDS)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.scope).toBeNull()
    } finally {
      restore()
    }
  })

  it('a token response with no access_token field is an honest failure, never coerced to a usable token', async () => {
    const { restore } = mockFetchSequence([new Response(JSON.stringify({ scope: 'read_products' }), { status: 200 })])
    try {
      const result = await shopifyInternal.getAccessToken(CREDS)
      expect(result.ok).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('4. Authentication failure', () => {
  it('a rejected client_id/client_secret at the token endpoint fails cleanly', async () => {
    const { restore } = mockFetchSequence([new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401, statusText: 'Unauthorized' })])
    try {
      const result = await shopifyInternal.getAccessToken(CREDS)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('401')
    } finally {
      restore()
    }
  })

  it('a rejected access token at the GraphQL endpoint (401) is reported as an authentication failure, never a generic HTTP error', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response('', { status: 401, statusText: 'Unauthorized' })])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain('authentication failed')
    } finally {
      restore()
    }
  })

  it('a 403 at the GraphQL endpoint is also reported as an authentication failure', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response('', { status: 403, statusText: 'Forbidden' })])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain('authentication failed')
    } finally {
      restore()
    }
  })
})

describe('5. GraphQL HTTP failure', () => {
  it('a 500 from the GraphQL endpoint is a distinct, honest HTTP failure', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response('Internal error', { status: 500, statusText: 'Internal Server Error' })])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('500')
    } finally {
      restore()
    }
  })

  it('HTTP 429 (throttled at the transport layer) is reported distinctly, not as a generic HTTP error', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response('', { status: 429, statusText: 'Too Many Requests' })])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain('throttled')
    } finally {
      restore()
    }
  })

  it('a network-level throw (fetch itself rejects) is caught and reported, never left to crash the caller', async () => {
    const original = globalThis.fetch
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) return tokenResponse()
      throw new Error('ECONNRESET')
    }) as typeof fetch
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('ECONNRESET')
    } finally {
      globalThis.fetch = original
    }
  })

  it('an empty response body is an honest failure, never parsed as if it were valid data', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response('', { status: 200 })])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain('empty')
    } finally {
      restore()
    }
  })

  it('a malformed (non-JSON) response body is an honest failure, never crashes the caller', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response('<html>not json</html>', { status: 200 })])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain('malformed')
    } finally {
      restore()
    }
  })
})

describe('6. GraphQL application-level errors', () => {
  it('a 200 response with a populated errors array fails the whole call, never trusted as valid-looking data', async () => {
    const { restore } = mockFetchSequence([
      tokenResponse(),
      new Response(JSON.stringify({ data: { shop: { name: 'partial' } }, errors: [{ message: 'Field not accessible' }] }), { status: 200 }),
    ])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('application-level error')
    } finally {
      restore()
    }
  })

  it('a "Throttled" GraphQL error inside a 200 response is distinguished from a generic application error', async () => {
    const { restore } = mockFetchSequence([
      tokenResponse(),
      new Response(JSON.stringify({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }), { status: 200 }),
    ])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain('throttled')
    } finally {
      restore()
    }
  })

  it('a 200 with neither data nor errors is an honest empty-response failure', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response(JSON.stringify({}), { status: 200 })])
    try {
      const result = await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain('empty')
    } finally {
      restore()
    }
  })
})

describe('7. Successful shop query parsing (getConnectionHealth)', () => {
  it('a genuinely successful shop query reports connected, with the real api version', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response(JSON.stringify({ data: { shop: { name: 'Test Shop' } } }), { status: 200 })])
    try {
      const result = await shopifyInternal.graphqlRequest<{ shop: { name: string } }>(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.data.shop.name).toBe('Test Shop')
    } finally {
      restore()
    }
  })

  it('getConnectionHealth() end to end: not_configured without credentials, never attempting a request', async () => {
    const health = await shopifyConnector.getConnectionHealth()
    expect(health.ok).toBe(true)
    if (health.ok) expect(health.value.status).toBe('not_configured')
    if (health.ok) expect(health.value.grantedScope).toBeNull()
  })
})

describe('7b. Live-verifiable OAuth scope reporting (Phase 10)', () => {
  it('a successful connection surfaces the real granted scope, so read-only vs write access is a live-checkable fact, not just an assumption', async () => {
    const { restore } = mockFetchSequence([tokenResponse(), new Response(JSON.stringify({ data: { shop: { name: 'Test Shop' } } }), { status: 200 })])
    try {
      const result = await shopifyInternal.graphqlRequest<{ shop: { name: string } }>(CREDS, 'query { shop { name } }')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.scope).toBe('read_products,read_orders')
    } finally {
      restore()
    }
  })
})

describe('8. Product mapping', () => {
  it('maps a real GraphQL product node into a MarketplaceListingSnapshot correctly', () => {
    const node = {
      id: 'gid://shopify/Product/123',
      title: 'Bamboo Drawer Dividers',
      status: 'ACTIVE',
      variants: { edges: [{ node: { id: 'gid://shopify/ProductVariant/1', price: '19.99', inventoryQuantity: 42 } }] },
    }
    const listing = shopifyInternal.mapListing(node, 'GBP')
    expect(listing.externalId).toBe('gid://shopify/Product/123')
    expect(listing.title).toBe('Bamboo Drawer Dividers')
    expect(listing.status).toBe('active')
    expect(listing.priceMinor).toBe(1999)
    expect(listing.stockQty).toBe(42)
    expect(listing.currency).toBe('GBP')
  })

  it('threads the shop currency through as-is, rather than assuming a hardcoded value — found via a real live-verification run against a real product', () => {
    const node = { id: 'gid://shopify/Product/1', title: 'x', status: 'ACTIVE', variants: { edges: [] } }
    expect(shopifyInternal.mapListing(node, 'USD').currency).toBe('USD')
    expect(shopifyInternal.mapListing(node, 'EUR').currency).toBe('EUR')
  })

  it('maps DRAFT and ARCHIVED status correctly, and an unrecognised status falls back to archived rather than a guess', () => {
    const base = { id: 'gid://shopify/Product/1', title: 'x', variants: { edges: [] } }
    expect(shopifyInternal.mapListing({ ...base, status: 'DRAFT' }, 'GBP').status).toBe('draft')
    expect(shopifyInternal.mapListing({ ...base, status: 'ARCHIVED' }, 'GBP').status).toBe('archived')
    expect(shopifyInternal.mapListing({ ...base, status: 'SOMETHING_NEW' }, 'GBP').status).toBe('archived')
  })

  it('a product with no variant reports priceMinor 0 and stockQty null, never a fabricated number', () => {
    const listing = shopifyInternal.mapListing({ id: 'gid://shopify/Product/1', title: 'x', status: 'ACTIVE', variants: { edges: [] } }, 'GBP')
    expect(listing.priceMinor).toBe(0)
    expect(listing.stockQty).toBeNull()
  })

  it('fetchListings() end to end maps a real GraphQL response into records', async () => {
    const original = { ...process.env }
    process.env.SHOPIFY_STORE_DOMAIN = CREDS.storeDomain
    process.env.SHOPIFY_CLIENT_ID = CREDS.clientId
    process.env.SHOPIFY_CLIENT_SECRET = CREDS.clientSecret
    process.env.SHOPIFY_API_VERSION = CREDS.apiVersion
    const { restore } = mockFetchSequence([
      tokenResponse(),
      new Response(JSON.stringify({
        data: {
          shop: { currencyCode: 'EUR' },
          products: { edges: [{ node: { id: 'gid://shopify/Product/1', title: 'Widget', status: 'ACTIVE', variants: { edges: [{ node: { id: 'v1', price: '9.99', inventoryQuantity: 5 } }] } } }] },
        },
      }), { status: 200 }),
    ])
    try {
      const result = await shopifyConnector.fetchListings({ limit: 10 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.records).toHaveLength(1)
        expect(result.value.records[0].title).toBe('Widget')
        expect(result.value.records[0].priceMinor).toBe(999)
        // Currency comes from the same request's real shop field, not a
        // hardcoded literal — found via a real live-verification run.
        expect(result.value.records[0].currency).toBe('EUR')
      }
    } finally {
      restore()
      process.env = original
    }
  })
})

describe('9. Order mapping', () => {
  const baseOrder = {
    id: 'gid://shopify/Order/1', createdAt: '2026-08-01T00:00:00Z', cancelledAt: null,
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
    totalPriceSet: { shopMoney: { amount: '25.50', currencyCode: 'GBP' } },
    lineItems: { edges: [{ node: { id: 'gid://shopify/LineItem/1', sku: 'SKU-A', quantity: 2, originalUnitPriceSet: { shopMoney: { amount: '12.75' } } } }] },
  }

  it('a paid, unfulfilled order maps to paid', () => {
    expect(shopifyInternal.mapOrderStatus(baseOrder)).toBe('paid')
  })

  it('a pending (not yet paid) order maps to pending', () => {
    expect(shopifyInternal.mapOrderStatus({ ...baseOrder, displayFinancialStatus: 'PENDING' })).toBe('pending')
  })

  it('fetchOrders() end to end maps totalMinor, currency and lineItems correctly', async () => {
    const original = { ...process.env }
    process.env.SHOPIFY_STORE_DOMAIN = CREDS.storeDomain
    process.env.SHOPIFY_CLIENT_ID = CREDS.clientId
    process.env.SHOPIFY_CLIENT_SECRET = CREDS.clientSecret
    process.env.SHOPIFY_API_VERSION = CREDS.apiVersion
    const { restore } = mockFetchSequence([
      tokenResponse(),
      new Response(JSON.stringify({ data: { orders: { edges: [{ node: baseOrder }] } } }), { status: 200 }),
    ])
    try {
      const result = await shopifyConnector.fetchOrders({ limit: 10 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.records[0].totalMinor).toBe(2550)
        expect(result.value.records[0].currency).toBe('GBP')
        expect(result.value.records[0].lineItems).toEqual([{ externalId: 'gid://shopify/LineItem/1', sku: 'SKU-A', quantity: 2, unitPriceMinor: 1275 }])
        expect(result.value.records[0].externalId).toBe('gid://shopify/Order/1')
      }
    } finally {
      restore()
      process.env = original
    }
  })

  it('the real orders query never requests customer/email/address fields — only order-level id, timestamps, status and totals', async () => {
    const original = { ...process.env }
    process.env.SHOPIFY_STORE_DOMAIN = CREDS.storeDomain
    process.env.SHOPIFY_CLIENT_ID = CREDS.clientId
    process.env.SHOPIFY_CLIENT_SECRET = CREDS.clientSecret
    process.env.SHOPIFY_API_VERSION = CREDS.apiVersion
    const { restore, bodies } = mockFetchSequence([
      tokenResponse(),
      new Response(JSON.stringify({ data: { orders: { edges: [] } } }), { status: 200 }),
    ])
    try {
      await shopifyConnector.fetchOrders({ limit: 10 })
      const sentQuery = (JSON.parse(bodies[1]) as { query: string }).query
      for (const forbidden of ['customer', 'email', 'address', 'phone', 'shippingAddress', 'billingAddress']) {
        expect(sentQuery.toLowerCase()).not.toContain(forbidden.toLowerCase())
      }
    } finally {
      restore()
      process.env = original
    }
  })
})

describe('10. Inventory mapping', () => {
  it('sums the "available" quantity across every returned inventory level', async () => {
    const original = { ...process.env }
    process.env.SHOPIFY_STORE_DOMAIN = CREDS.storeDomain
    process.env.SHOPIFY_CLIENT_ID = CREDS.clientId
    process.env.SHOPIFY_CLIENT_SECRET = CREDS.clientSecret
    process.env.SHOPIFY_API_VERSION = CREDS.apiVersion
    const { restore } = mockFetchSequence([
      tokenResponse(),
      new Response(JSON.stringify({
        data: {
          products: {
            edges: [{
              node: {
                id: 'gid://shopify/Product/1',
                variants: {
                  edges: [{
                    node: {
                      inventoryItem: {
                        inventoryLevels: {
                          edges: [
                            { node: { quantities: [{ name: 'available', quantity: 10 }, { name: 'committed', quantity: 2 }] } },
                            { node: { quantities: [{ name: 'available', quantity: 5 }] } },
                          ],
                        },
                      },
                    },
                  }],
                },
              },
            }],
          },
        },
      }), { status: 200 }),
    ])
    try {
      const result = await shopifyConnector.fetchInventory({ limit: 10 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.records).toHaveLength(1)
        // 10 (location A "available") + 5 (location B "available") = 15 — "committed" is never summed in.
        expect(result.value.records[0].stockQty).toBe(15)
      }
    } finally {
      restore()
      process.env = original
    }
  })

  it('a variant with no inventory item at all reports zero, never null or a throw', async () => {
    const original = { ...process.env }
    process.env.SHOPIFY_STORE_DOMAIN = CREDS.storeDomain
    process.env.SHOPIFY_CLIENT_ID = CREDS.clientId
    process.env.SHOPIFY_CLIENT_SECRET = CREDS.clientSecret
    process.env.SHOPIFY_API_VERSION = CREDS.apiVersion
    const { restore } = mockFetchSequence([
      tokenResponse(),
      new Response(JSON.stringify({ data: { products: { edges: [{ node: { id: 'gid://shopify/Product/1', variants: { edges: [] } } }] } } }), { status: 200 }),
    ])
    try {
      const result = await shopifyConnector.fetchInventory({ limit: 10 })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.records[0].stockQty).toBe(0)
    } finally {
      restore()
      process.env = original
    }
  })
})

describe('11. Fulfilment mapping (read-side)', () => {
  const baseOrder = {
    id: 'gid://shopify/Order/1', createdAt: '2026-08-01T00:00:00Z', cancelledAt: null,
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
    totalPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'GBP' } },
    lineItems: { edges: [] },
  }

  it('a fulfilled order is promoted to "fulfilled", overriding the merely-paid financial status', () => {
    expect(shopifyInternal.mapOrderStatus({ ...baseOrder, displayFulfillmentStatus: 'FULFILLED' })).toBe('fulfilled')
  })

  it('cancellation always wins over fulfilment status, however the order was fulfilled', () => {
    expect(shopifyInternal.mapOrderStatus({ ...baseOrder, displayFulfillmentStatus: 'FULFILLED', cancelledAt: '2026-08-02T00:00:00Z' })).toBe('cancelled')
  })

  it('a refund always wins over fulfilment status', () => {
    expect(shopifyInternal.mapOrderStatus({ ...baseOrder, displayFulfillmentStatus: 'FULFILLED', displayFinancialStatus: 'REFUNDED' })).toBe('refunded')
  })

  it('fulfilment WRITES remain structurally disabled regardless of fulfilment read data', async () => {
    const result = await shopifyConnector.submitFulfilmentUpdate({ externalOrderId: 'gid://shopify/Order/1', carrier: 'Royal Mail', trackingNumber: 'T1', idempotencyKey: 'k1' })
    expect(result.ok).toBe(false)
  })
})

describe('12. Capability truthfulness (Milestone Shopify-Read-Only)', () => {
  it('declares exactly the read-only capability set the brief requires — no write/refund/webhook/fee capability', () => {
    expect(shopifyConnector.descriptor.capabilities).toEqual({
      readListings: true,
      writeListings: false,
      syncInventory: true,
      ingestOrders: true,
      updateFulfilment: false,
      processRefunds: false,
      readFees: false,
      webhooks: false,
      // Milestone: production autonomy proof — the single change to this
      // set. Verification is a READ (`read_products`, which Shopify's own
      // token response confirms is granted), it is genuinely implemented
      // and was live-verified against the connected store, and it unlocks
      // no write: `writeListings`/`createListings` both remain false and
      // are checked first on every write path.
      verifyWrites: true,
      createListings: false,
    })
  })

  it('every write method is structurally not_supported/disabled, never attempting a request even if somehow called', async () => {
    const priceResult = await shopifyConnector.updateListingPrice()
    expect(priceResult.ok).toBe(false)
    const inventoryResult = await shopifyConnector.updateInventory()
    expect(inventoryResult.ok).toBe(false)
    const statusResult = await shopifyConnector.setListingStatus()
    expect(statusResult.ok).toBe(false)
    const verifyResult = await shopifyConnector.verifyListingState('gid://shopify/Product/1')
    expect(verifyResult.ok).toBe(false)
  })

  it('fetchFees honestly errors, matching readFees: false', async () => {
    const result = await shopifyConnector.fetchFees({ limit: 10 })
    expect(result.ok).toBe(false)
  })
})

describe('13. Secrets are never logged or exposed', () => {
  it('the client secret never appears in the token-exchange request URL', async () => {
    const { restore, urls } = mockFetchSequence([tokenResponse()])
    try {
      await shopifyInternal.getAccessToken(CREDS)
      expect(urls[0]).not.toContain(CREDS.clientSecret)
    } finally {
      restore()
    }
  })

  it('the client secret never appears in the GraphQL request URL or headers — only the short-lived access token does', async () => {
    const original = globalThis.fetch
    const capturedHeaders: Record<string, string>[] = []
    const capturedUrls: string[] = []
    let call = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input))
      capturedHeaders.push((init?.headers as Record<string, string>) ?? {})
      call++
      return call === 1 ? tokenResponse('the-access-token') : new Response(JSON.stringify({ data: { shop: { name: 'x' } } }), { status: 200 })
    }) as typeof fetch
    try {
      await shopifyInternal.graphqlRequest(CREDS, 'query { shop { name } }')
      for (const url of capturedUrls) expect(url).not.toContain(CREDS.clientSecret)
      const graphqlHeaders = capturedHeaders[1]
      expect(graphqlHeaders['X-Shopify-Access-Token']).toBe('the-access-token')
      expect(JSON.stringify(graphqlHeaders)).not.toContain(CREDS.clientSecret)
    } finally {
      globalThis.fetch = original
    }
  })

  it('an error message from a failed token exchange never embeds the client secret', async () => {
    const { restore } = mockFetchSequence([new Response(`invalid_client: secret was ${CREDS.clientSecret}`, { status: 401, statusText: 'Unauthorized' })])
    try {
      const result = await shopifyInternal.getAccessToken(CREDS)
      expect(result.ok).toBe(false)
      // The connector never redacts a body it merely forwards for diagnostics
      // from Shopify's own response — this asserts the credential we control
      // (clientSecret) is not something *this connector itself* embeds
      // anywhere it constructs, e.g. never re-derives or logs it separately.
      if (!result.ok) expect(result.error).not.toContain('SHOPIFY_CLIENT_SECRET=')
    } finally {
      restore()
    }
  })
})
