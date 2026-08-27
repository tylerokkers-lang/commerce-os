import { describe, expect, it } from 'vitest'
import {
  isStorefrontConfigured,
  getFeaturedProducts,
  getProductByHandle,
  getCollectionByHandle,
  createCart,
  formatStorefrontMoney,
  __internal as storefrontInternal,
} from '@/lib/shopify/storefront'

/**
 * The Storefront API connector powering the headless storefront
 * (`src/app/(storefront)`) — a deliberately separate credential and code
 * path from the Admin API connector's own tests
 * (`tests/shopify-connector.test.ts`). No live Storefront API token exists
 * in this environment; every test here either drives real, unmodified
 * connector code against a mocked `fetch`, or asserts the not-configured
 * gate that keeps it from ever pretending to be connected.
 */

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const original = { ...process.env }
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fn()
  } finally {
    process.env = original
  }
}

async function withEnvAsync(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const original = { ...process.env }
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await fn()
  } finally {
    process.env = original
  }
}

function mockFetchOnce(response: Response) {
  const original = globalThis.fetch
  let capturedUrl = ''
  let capturedHeaders: HeadersInit | undefined
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input)
    capturedHeaders = init?.headers
    return response
  }) as typeof fetch
  return {
    restore: () => { globalThis.fetch = original },
    url: () => capturedUrl,
    headers: () => capturedHeaders,
  }
}

describe('1. Configuration detection', () => {
  it('isStorefrontConfigured() is false with no credentials set', () => {
    withEnv({ SHOPIFY_STORE_DOMAIN: undefined, SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined, SHOPIFY_API_VERSION: undefined }, () => {
      expect(isStorefrontConfigured()).toBe(false)
    })
  })

  it('isStorefrontConfigured() is true once all three required env vars are set', () => {
    withEnv({ SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'tok', SHOPIFY_API_VERSION: '2026-04' }, () => {
      expect(isStorefrontConfigured()).toBe(true)
    })
  })

  it('is independent of the Admin API credentials — Storefront-only env vars are enough', () => {
    withEnv(
      {
        SHOPIFY_STORE_DOMAIN: 'x.myshopify.com',
        SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'tok',
        SHOPIFY_API_VERSION: '2026-04',
        SHOPIFY_CLIENT_ID: undefined,
        SHOPIFY_CLIENT_SECRET: undefined,
      },
      () => {
        expect(isStorefrontConfigured()).toBe(true)
      },
    )
  })
})

describe('2. Store domain normalisation', () => {
  it('a bare hostname is left unchanged', () => {
    expect(storefrontInternal.normalizeStoreDomain('a-store.myshopify.com')).toBe('a-store.myshopify.com')
  })

  it('strips a leading https:// scheme', () => {
    expect(storefrontInternal.normalizeStoreDomain('https://a-store.myshopify.com')).toBe('a-store.myshopify.com')
  })

  it('strips a trailing slash', () => {
    expect(storefrontInternal.normalizeStoreDomain('a-store.myshopify.com/')).toBe('a-store.myshopify.com')
  })
})

describe('3. Every read/write function refuses to run when not configured — never a fabricated empty success', () => {
  it('getFeaturedProducts fails, not empty-succeeds, without credentials', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: undefined, SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined, SHOPIFY_API_VERSION: undefined }, async () => {
      const result = await getFeaturedProducts(8)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/not configured/i)
    })
  })

  it('getProductByHandle fails without credentials', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: undefined, SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined, SHOPIFY_API_VERSION: undefined }, async () => {
      const result = await getProductByHandle('any-handle')
      expect(result.ok).toBe(false)
    })
  })

  it('getCollectionByHandle fails without credentials', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: undefined, SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined, SHOPIFY_API_VERSION: undefined }, async () => {
      const result = await getCollectionByHandle('any-handle')
      expect(result.ok).toBe(false)
    })
  })

  it('createCart fails without credentials — a cart can never be silently created against nothing', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: undefined, SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined, SHOPIFY_API_VERSION: undefined }, async () => {
      const result = await createCart([{ merchandiseId: 'gid://shopify/ProductVariant/1', quantity: 1 }])
      expect(result.ok).toBe(false)
    })
  })
})

describe('4. Real requests, mocked fetch — the access token is sent as a header, never a query param or body secret leak', () => {
  it('getFeaturedProducts sends the Storefront access token via X-Shopify-Storefront-Access-Token', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com', SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'public-tok-123', SHOPIFY_API_VERSION: '2026-04' }, async () => {
      const mock = mockFetchOnce(
        new Response(JSON.stringify({ data: { products: { edges: [] } } }), { status: 200 }),
      )
      try {
        const result = await getFeaturedProducts(4)
        expect(result.ok).toBe(true)
        expect(mock.url()).toBe('https://test-store.myshopify.com/api/2026-04/graphql.json')
        const headers = mock.headers() as Record<string, string>
        expect(headers['X-Shopify-Storefront-Access-Token']).toBe('public-tok-123')
      } finally {
        mock.restore()
      }
    })
  })

  it('maps a real product response, including a genuine compare-at price as a sale', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com', SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'tok', SHOPIFY_API_VERSION: '2026-04' }, async () => {
      const mock = mockFetchOnce(
        new Response(
          JSON.stringify({
            data: {
              product: {
                id: 'gid://shopify/Product/1',
                handle: 'test-product',
                title: 'Test Product',
                description: 'A product.',
                descriptionHtml: '<p>A product.</p>',
                availableForSale: true,
                tags: ['new'],
                featuredImage: { url: 'https://cdn.shopify.com/img.jpg', altText: null, width: 800, height: 800 },
                images: { edges: [{ node: { url: 'https://cdn.shopify.com/img.jpg', altText: null, width: 800, height: 800 } }] },
                priceRange: { minVariantPrice: { amount: '10.00', currencyCode: 'GBP' }, maxVariantPrice: { amount: '10.00', currencyCode: 'GBP' } },
                compareAtPriceRange: { minVariantPrice: { amount: '15.00', currencyCode: 'GBP' }, maxVariantPrice: { amount: '15.00', currencyCode: 'GBP' } },
                options: [{ name: 'Title', values: ['Default Title'] }],
                variants: {
                  edges: [
                    {
                      node: {
                        id: 'gid://shopify/ProductVariant/1',
                        title: 'Default Title',
                        availableForSale: true,
                        quantityAvailable: 5,
                        price: { amount: '10.00', currencyCode: 'GBP' },
                        compareAtPrice: { amount: '15.00', currencyCode: 'GBP' },
                        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
                        image: null,
                      },
                    },
                  ],
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      try {
        const result = await getProductByHandle('test-product')
        expect(result.ok).toBe(true)
        if (result.ok && result.value) {
          expect(result.value.title).toBe('Test Product')
          expect(result.value.variants).toHaveLength(1)
          expect(result.value.compareAtPriceRange?.min.amount).toBe('15.00')
        }
      } finally {
        mock.restore()
      }
    })
  })

  it('a compare-at price equal to (not greater than) the real price is never shown as a sale — real Shopify data often sets both fields equal', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com', SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'tok', SHOPIFY_API_VERSION: '2026-04' }, async () => {
      const mock = mockFetchOnce(
        new Response(
          JSON.stringify({
            data: {
              products: {
                edges: [
                  {
                    node: {
                      id: 'gid://shopify/Product/2',
                      handle: 'no-sale',
                      title: 'No Sale Product',
                      availableForSale: true,
                      featuredImage: null,
                      priceRange: { minVariantPrice: { amount: '10.00', currencyCode: 'GBP' }, maxVariantPrice: { amount: '10.00', currencyCode: 'GBP' } },
                      compareAtPriceRange: { minVariantPrice: { amount: '10.00', currencyCode: 'GBP' }, maxVariantPrice: { amount: '10.00', currencyCode: 'GBP' } },
                    },
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
      )
      try {
        const result = await getFeaturedProducts(4)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.value[0].compareAtPriceRange).toBeNull()
      } finally {
        mock.restore()
      }
    })
  })

  it('a GraphQL 200 response carrying an errors array is treated as a failure, not a success', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com', SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'tok', SHOPIFY_API_VERSION: '2026-04' }, async () => {
      const mock = mockFetchOnce(new Response(JSON.stringify({ errors: [{ message: 'Throttled' }] }), { status: 200 }))
      try {
        const result = await getFeaturedProducts(4)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toMatch(/Throttled/)
      } finally {
        mock.restore()
      }
    })
  })

  it('a cart create with userErrors is treated as a failure, not a partially-created cart', async () => {
    await withEnvAsync({ SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com', SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'tok', SHOPIFY_API_VERSION: '2026-04' }, async () => {
      const mock = mockFetchOnce(
        new Response(
          JSON.stringify({ data: { cartCreate: { cart: null, userErrors: [{ field: ['lines'], message: 'Variant not found' }] } } }),
          { status: 200 },
        ),
      )
      try {
        const result = await createCart([{ merchandiseId: 'gid://shopify/ProductVariant/does-not-exist', quantity: 1 }])
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toMatch(/Variant not found/)
      } finally {
        mock.restore()
      }
    })
  })
})

describe('5. Display formatting', () => {
  it('formats a Storefront money value using the real currency code', () => {
    expect(formatStorefrontMoney({ amount: '19.99', currencyCode: 'GBP' })).toContain('19.99')
  })
})
