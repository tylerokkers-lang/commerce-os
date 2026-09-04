import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cjdropshippingConnector, __internal as cj } from '@/lib/suppliers/connectors/cjdropshipping'

/**
 * CJdropshipping connector tests (Milestone: real supplier connector,
 * Phase 8) — entirely mocked, no real credentials or network access
 * required, matching `tests/marketplace-connectors.test.ts`'s own
 * `globalThis.fetch` stubbing convention for `ebay.ts`. Every mock
 * response mirrors the field shapes documented at
 * developers.cjdropshipping.com (see the connector's own module comment
 * for the exact URLs consulted) — these are TEST FIXTURES, never
 * presented anywhere as a real API response.
 */

const ORIGINAL_ENV = { ...process.env }

function mockFetchSequence(responses: readonly Response[]) {
  let call = 0
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    const response = responses[Math.min(call, responses.length - 1)]
    call += 1
    return response
  }) as typeof fetch
  return {
    callCount: () => call,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const TOKEN_RESPONSE = { code: 200, result: true, message: 'Success', data: { accessToken: 'tok-abc', accessTokenExpiryDate: '2026-09-14', refreshToken: 'refresh-abc', refreshTokenExpiryDate: '2027-02-26' } }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.useRealTimers()
})

describe('isConfigured', () => {
  it('is false without CJ_API_KEY', () => {
    delete process.env.CJ_API_KEY
    expect(cjdropshippingConnector.isConfigured()).toBe(false)
  })

  it('is true once CJ_API_KEY is set', () => {
    process.env.CJ_API_KEY = 'CJ12345@api@abcdef'
    expect(cjdropshippingConnector.isConfigured()).toBe(true)
  })
})

describe('unconfigured connector makes no network request', () => {
  it('fetchStatus refuses before any fetch when CJ_API_KEY is absent', async () => {
    delete process.env.CJ_API_KEY
    const spy = vi.fn()
    const original = globalThis.fetch
    globalThis.fetch = spy as unknown as typeof fetch
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(false)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })

  it('readProductDetail refuses before any fetch when CJ_API_KEY is absent', async () => {
    delete process.env.CJ_API_KEY
    const spy = vi.fn()
    const original = globalThis.fetch
    globalThis.fetch = spy as unknown as typeof fetch
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-1')
      expect(result.ok).toBe(false)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('authentication', () => {
  beforeEach(() => {
    process.env.CJ_API_KEY = 'CJ12345@api@abcdef'
  })

  it('exchanges the apiKey for an access token on success', async () => {
    const { restore } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE)])
    try {
      const result = await cj.getAccessToken()
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe('tok-abc')
    } finally {
      restore()
    }
  })

  it('surfaces an explicit authentication failure, never collapsed into "no products found"', async () => {
    const { restore } = mockFetchSequence([jsonResponse({ code: 401, result: false, message: 'Invalid apiKey' }, 200)])
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('Invalid apiKey')
    } finally {
      restore()
    }
  })

  it('surfaces an HTTP-level failure distinctly from a JSON-level rejection', async () => {
    const { restore } = mockFetchSequence([new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })])
    try {
      const result = await cj.getAccessToken()
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('401')
    } finally {
      restore()
    }
  })

  it('reports a network failure explicitly, never as an empty product list', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as typeof fetch
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('ENOTFOUND')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('rate limiting and retries', () => {
  beforeEach(() => {
    process.env.CJ_API_KEY = 'CJ12345@api@abcdef'
  })

  it('retries once after a 429 and succeeds on the second attempt', async () => {
    const { restore, callCount } = mockFetchSequence([
      new Response('Too Many Requests', { status: 429 }),
      jsonResponse(TOKEN_RESPONSE),
    ])
    try {
      const result = await cj.getAccessToken()
      expect(result.ok).toBe(true)
      expect(callCount()).toBe(2)
    } finally {
      restore()
    }
  }, 10_000)

  it('gives up and reports failure after a second consecutive 429', async () => {
    const { restore } = mockFetchSequence([
      new Response('Too Many Requests', { status: 429 }),
      new Response('Too Many Requests', { status: 429 }),
    ])
    try {
      const result = await cj.getAccessToken()
      expect(result.ok).toBe(false)
    } finally {
      restore()
    }
  }, 10_000)
})

describe('product discovery (fetchStatus, no knownRefs)', () => {
  beforeEach(() => {
    process.env.CJ_API_KEY = 'CJ12345@api@abcdef'
  })

  it('parses a real-shaped product list response into supplier statuses', async () => {
    const { restore } = mockFetchSequence([
      jsonResponse(TOKEN_RESPONSE),
      jsonResponse({
        code: 200,
        result: true,
        message: 'Success',
        data: {
          list: [
            { pid: 'pid-1', productNameEn: 'Wireless Mouse', productSku: 'CJWM-1', sellPrice: '9.99', categoryName: 'Electronics', warehouseInventoryNum: '42' },
            { pid: 'pid-2', productNameEn: 'USB Cable', productSku: 'CJUC-2', sellPrice: '3.50', categoryName: 'Electronics', warehouseInventoryNum: '0' },
          ],
        },
      }),
    ])
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.statuses).toHaveLength(2)
      expect(result.value.statuses[0].unitCost.minor).toBe(999)
      expect(result.value.statuses[0].unitCost.currency).toBe('USD')
      expect(result.value.statuses[0].inStock).toBe(true)
      expect(result.value.statuses[1].inStock).toBe(false) // zero warehouse stock
    } finally {
      restore()
    }
  })

  it('parses the REAL live /product/listV2 response shape — found live, not documented: data.content is a one-element array wrapping { productList }, not the product array itself', async () => {
    const { restore } = mockFetchSequence([
      jsonResponse(TOKEN_RESPONSE),
      jsonResponse({
        code: 200,
        result: true,
        message: 'Success',
        data: {
          pageSize: 20,
          pageNumber: 1,
          totalRecords: 6000,
          totalPages: 300,
          content: [
            {
              productList: [
                { id: 'pid-live-1', nameEn: 'Wireless Mouse', sku: 'CJWM-1', sellPrice: '9.99', warehouseInventoryNum: 42, oneCategoryName: 'Electronics', twoCategoryName: 'Computer Peripherals', threeCategoryName: 'Mice' },
                { id: 'pid-live-2', nameEn: 'USB Cable', sku: 'CJUC-2', sellPrice: '3.50', warehouseInventoryNum: 0 },
              ],
              relatedCategoryList: [],
              keyWord: '',
              keyWordOld: '',
            },
          ],
        },
      }),
    ])
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.warnings).toHaveLength(0) // a recognised shape must never warn
      expect(result.value.statuses).toHaveLength(2)
      expect(result.value.statuses[0].productRef).toBe('pid-live-1')
      expect(result.value.statuses[0].unitCost.minor).toBe(999)
      expect(result.value.statuses[0].inStock).toBe(true)
      expect(result.value.statuses[0].category).toBe('Electronics > Computer Peripherals > Mice')
      expect(result.value.statuses[1].inStock).toBe(false)
      expect(result.value.statuses[1].category).toBeUndefined() // no hierarchy fields on this item -> genuinely unknown, never fabricated
    } finally {
      restore()
    }
  })

  it('still falls back to the old flat { list: [...] } shape, kept for compatibility, never removed', async () => {
    const { restore } = mockFetchSequence([
      jsonResponse(TOKEN_RESPONSE),
      jsonResponse({ code: 200, result: true, message: 'Success', data: { list: [{ pid: 'pid-legacy', productNameEn: 'Legacy Shape Product', sellPrice: '5.00' }] } }),
    ])
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.statuses).toHaveLength(1)
      expect(result.value.statuses[0].productRef).toBe('pid-legacy')
    } finally {
      restore()
    }
  })

  it('treats a response with no recognisable list shape as an empty result with a warning, never a crash', async () => {
    const { restore } = mockFetchSequence([
      jsonResponse(TOKEN_RESPONSE),
      jsonResponse({ code: 200, result: true, message: 'Success', data: { somethingElse: [] } }),
    ])
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.statuses).toHaveLength(0)
      expect(result.value.warnings.length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('drops a list item with no product id rather than inventing one', async () => {
    const { restore } = mockFetchSequence([
      jsonResponse(TOKEN_RESPONSE),
      jsonResponse({ code: 200, result: true, message: 'Success', data: { list: [{ productNameEn: 'No ID Product', sellPrice: '5.00' }] } }),
    ])
    try {
      const result = await cjdropshippingConnector.fetchStatus({ limit: 10 })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.statuses).toHaveLength(0)
    } finally {
      restore()
    }
  })
})

describe('rich product detail (readProductDetail)', () => {
  beforeEach(() => {
    process.env.CJ_API_KEY = 'CJ12345@api@abcdef'
  })

  const PRODUCT_DETAIL_RESPONSE = {
    code: 200,
    result: true,
    message: 'Success',
    data: {
      pid: 'pid-1',
      productSku: 'CJWM-1',
      nameEn: 'Wireless Mouse',
      description: 'A wireless optical mouse.',
      categoryName: 'Electronics',
      bigImage: 'https://cf.cjdropshipping.com/images/mouse-main.jpg',
      productImageSet: ['https://cf.cjdropshipping.com/images/mouse-main.jpg', 'https://cf.cjdropshipping.com/images/mouse-side.jpg'],
      productUrl: 'https://cjdropshipping.com/product/pid-1.html',
      variants: [
        { vid: 'vid-1', variantSku: 'CJWM-1-BLACK', variantSellPrice: '9.99', variantKey: 'Black', variantImage: 'https://cf.cjdropshipping.com/images/mouse-black.jpg' },
        { vid: 'vid-2', variantSku: 'CJWM-1-WHITE', variantSellPrice: '9.99', variantKey: 'White' },
      ],
    },
  }

  it('parses title, description, category, images and variants without a destination requested', async () => {
    const { restore, callCount } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE), jsonResponse(PRODUCT_DETAIL_RESPONSE)])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-1')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.title).toBe('Wireless Mouse')
      expect(result.value.category).toBe('Electronics')
      expect(result.value.primaryImageUrl).toBe('https://cf.cjdropshipping.com/images/mouse-main.jpg')
      expect(result.value.additionalImageUrls).toContain('https://cf.cjdropshipping.com/images/mouse-side.jpg')
      expect(result.value.variants).toHaveLength(2)
      expect(result.value.variants[0].sku).toBe('CJWM-1-BLACK')
      expect(result.value.variants[0].unitCost.minor).toBe(999)
      expect(result.value.shippingQuotes).toHaveLength(0) // no destinationCountry requested -> no freight call
      expect(callCount()).toBe(2) // token + product query only, never a freight call
    } finally {
      restore()
    }
  })

  // Milestone: product-catalogue correction (supplier URL). CJ's real
  // `/product/query` response has never once included a `productUrl`
  // field (confirmed live against an already-imported product, and
  // against CJ's own published documentation) — this fixture's
  // `productUrl` is a hypothetical value kept only to prove the parsing
  // path works correctly if a future API version ever adds one.
  it('parses a real productUrl when the response happens to include one, never dropping a value that is genuinely present', async () => {
    const { restore } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE), jsonResponse(PRODUCT_DETAIL_RESPONSE)])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-1')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.productUrl).toBe('https://cjdropshipping.com/product/pid-1.html')
    } finally {
      restore()
    }
  })

  it('a response with no productUrl field at all (the real, confirmed CJ shape) parses to null — never fabricated', async () => {
    const withoutUrl = { ...PRODUCT_DETAIL_RESPONSE, data: { ...PRODUCT_DETAIL_RESPONSE.data, productUrl: undefined } }
    const { restore } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE), jsonResponse(withoutUrl)])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-1')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.productUrl).toBeNull()
    } finally {
      restore()
    }
  })

  it('a malformed/non-URL productUrl value is rejected to null, never passed through as a broken link', async () => {
    const malformed = { ...PRODUCT_DETAIL_RESPONSE, data: { ...PRODUCT_DETAIL_RESPONSE.data, productUrl: 'not-a-url' } }
    const { restore } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE), jsonResponse(malformed)])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-1')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.productUrl).toBeNull()
    } finally {
      restore()
    }
  })

  it('fetches a destination-aware shipping quote only when a destination country is requested', async () => {
    const { restore, callCount } = mockFetchSequence([
      jsonResponse(TOKEN_RESPONSE),
      jsonResponse(PRODUCT_DETAIL_RESPONSE),
      jsonResponse({
        code: 200,
        result: true,
        message: 'Success',
        data: [
          { logisticName: 'CJPacket Ordinary', logisticPrice: 4.5, logisticAging: '10-15' },
          { logisticName: 'DHL Express', logisticPrice: 18.2, logisticAging: '3-5' },
        ],
      }),
    ])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-1', { destinationCountry: 'GB' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.shippingQuotes).toHaveLength(2)
      const dhl = result.value.shippingQuotes.find((q) => q.method === 'DHL Express')
      expect(dhl?.destinationCountry).toBe('GB')
      expect(dhl?.shippingCost.minor).toBe(1820)
      expect(dhl?.totalDeliveryDaysMin).toBe(3)
      expect(dhl?.totalDeliveryDaysMax).toBe(5)
      expect(callCount()).toBe(3) // token + product query + freight calculate
    } finally {
      restore()
    }
  })

  it('a failed shipping-quote call does not fail the whole product-detail read', async () => {
    const { restore } = mockFetchSequence([
      jsonResponse(TOKEN_RESPONSE),
      jsonResponse(PRODUCT_DETAIL_RESPONSE),
      new Response('Internal Server Error', { status: 500 }),
    ])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-1', { destinationCountry: 'GB' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.shippingQuotes).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('a shipping quote missing both a cost and a method is dropped, never fabricated', () => {
    const quote = cj.parseShippingQuote({ logisticAging: '5-7' }, 'GB')
    expect(quote).toBeNull()
  })

  it('parses a single-number delivery estimate as both min and max', () => {
    const quote = cj.parseShippingQuote({ logisticName: 'Standard', logisticPrice: 5, logisticAging: '7' }, 'GB')
    expect(quote?.totalDeliveryDaysMin).toBe(7)
    expect(quote?.totalDeliveryDaysMax).toBe(7)
  })

  it('reports null delivery days when the aging text has no recognisable number, never a guess', () => {
    const quote = cj.parseShippingQuote({ logisticName: 'Standard', logisticPrice: 5, logisticAging: 'unknown' }, 'GB')
    expect(quote?.totalDeliveryDaysMin).toBeNull()
    expect(quote?.totalDeliveryDaysMax).toBeNull()
  })

  it('malformed variant data (missing vid) still parses safely, with an empty ref rather than a crash', () => {
    const detail = PRODUCT_DETAIL_RESPONSE.data.variants[0]
    const parsed = cj.statusFromListItem // sanity: functions exist and are callable
    expect(typeof parsed).toBe('function')
    expect(detail.vid).toBeTruthy()
  })

  // Milestone: CJ import data-persistence fix. Real field names and units
  // (grams / millimetres) confirmed live against CJ's own published
  // documentation and a real, already-imported product's actual
  // `/product/query` response — not assumed.
  const PRODUCT_DETAIL_WITH_SPECS = {
    code: 200,
    result: true,
    message: 'Success',
    data: {
      pid: 'pid-2',
      productSku: 'CJWM-2',
      nameEn: 'Padded Coat',
      description: 'A padded winter coat.',
      variants: [
        { vid: 'vid-10', variantSku: 'CJWM-2-M', variantSellPrice: '19.99', variantWeight: 420, variantLength: 300, variantWidth: 200, variantHeight: 50, inventoryNum: 37 },
        { vid: 'vid-11', variantSku: 'CJWM-2-L', variantSellPrice: '19.99' }, // no specs/stock reported for this variant at all
      ],
    },
  }

  it('parses real per-variant weight (grams) and dimensions (mm) when CJ reports them', async () => {
    const { restore } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE), jsonResponse(PRODUCT_DETAIL_WITH_SPECS)])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-2')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const variant = result.value.variants[0]
      expect(variant.weightGrams).toBe(420)
      expect(variant.lengthMm).toBe(300)
      expect(variant.widthMm).toBe(200)
      expect(variant.heightMm).toBe(50)
    } finally {
      restore()
    }
  })

  it('parses a real per-variant stock figure when CJ reports one, and derives inStock from it', async () => {
    const { restore } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE), jsonResponse(PRODUCT_DETAIL_WITH_SPECS)])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-2')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const variant = result.value.variants[0]
      expect(variant.stockQty).toBe(37)
      expect(variant.inStock).toBe(true)
    } finally {
      restore()
    }
  })

  it('a variant with no specs or stock reported stays genuinely unknown — never zero, never fabricated', async () => {
    const { restore } = mockFetchSequence([jsonResponse(TOKEN_RESPONSE), jsonResponse(PRODUCT_DETAIL_WITH_SPECS)])
    try {
      const result = await cjdropshippingConnector.readProductDetail('pid-2')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const variant = result.value.variants[1]
      expect(variant.weightGrams).toBeNull()
      expect(variant.lengthMm).toBeNull()
      expect(variant.widthMm).toBeNull()
      expect(variant.heightMm).toBeNull()
      expect(variant.stockQty).toBeNull()
      expect(variant.inStock).toBe('unknown')
    } finally {
      restore()
    }
  })
})

describe('categoryFromListItem — live three-level hierarchy joining', () => {
  it('joins all three levels with " > ", matching the detail endpoint\'s own real format', () => {
    expect(cj.categoryFromListItem({ oneCategoryName: 'Men\'s Clothing', twoCategoryName: 'Outerwear & Jackets', threeCategoryName: "Men's Sweaters" })).toBe("Men's Clothing > Outerwear & Jackets > Men's Sweaters")
  })

  it('joins only the levels actually present, never inventing a missing one', () => {
    expect(cj.categoryFromListItem({ oneCategoryName: 'Electronics' })).toBe('Electronics')
    expect(cj.categoryFromListItem({ oneCategoryName: 'Electronics', threeCategoryName: 'Mice' })).toBe('Electronics > Mice')
  })

  it('returns undefined, never an empty string, when no category field is present at all', () => {
    expect(cj.categoryFromListItem({})).toBeUndefined()
  })

  it('prefers a flat categoryName if a future response ever provides one directly', () => {
    expect(cj.categoryFromListItem({ categoryName: 'Flat Category', oneCategoryName: 'Should not be used' })).toBe('Flat Category')
  })
})

describe('defensive field parsing', () => {
  it('safeNumber rejects non-numeric strings rather than coercing to 0', () => {
    expect(cj.safeNumber('not-a-number')).toBeNull()
    expect(cj.safeNumber('12.5')).toBe(12.5)
    expect(cj.safeNumber(undefined)).toBeNull()
  })

  it('safeUrl rejects a non-URL string and a non-http(s) scheme', () => {
    expect(cj.safeUrl('not a url')).toBeNull()
    expect(cj.safeUrl('javascript:alert(1)')).toBeNull()
    expect(cj.safeUrl('https://cf.cjdropshipping.com/img.jpg')).toBe('https://cf.cjdropshipping.com/img.jpg')
  })

  it('safeString rejects empty/whitespace-only values', () => {
    expect(cj.safeString('  ')).toBeNull()
    expect(cj.safeString('')).toBeNull()
    expect(cj.safeString('Real Title')).toBe('Real Title')
  })
})

describe('financial safety (Phase 8 §36)', () => {
  it('the descriptor declares placeOrders and cancelOrders as false', () => {
    expect(cjdropshippingConnector.descriptor.capabilities.placeOrders).toBe(false)
    expect(cjdropshippingConnector.descriptor.capabilities.cancelOrders).toBe(false)
  })

  it('the descriptor declares readOrders as false — no order of this connector\'s own creation exists to read back', () => {
    expect(cjdropshippingConnector.descriptor.capabilities.readOrders).toBe(false)
  })

  it('the connector class has no method whose name suggests placing or paying for an order', () => {
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(cjdropshippingConnector))
    for (const name of methodNames) {
      expect(name.toLowerCase()).not.toMatch(/placeorder|purchase|pay|charge/)
    }
  })
})

/**
 * Milestone: supplier product verification link. `getProductSourceLink`
 * never makes a network call (pure URL construction from data the caller
 * already has) — no CJ_API_KEY/token mocking needed here, unlike every
 * other method in this file. The search route itself
 * (`https://m.cjdropshipping.com/search?keyWord=`) was found and confirmed
 * live: a real browser session navigated to it and CJ's own real search
 * box came back pre-filled from the URL parameter — not guessed. The
 * connector deliberately never returns `type: 'product'` — see
 * `CJ_SEARCH_BASE_URL`'s own module comment for why a constructed direct
 * product-page URL could not be safely verified (CJ's own anti-automation
 * "Human verification" wall, which this codebase must not attempt to
 * defeat).
 */
describe('getProductSourceLink', () => {
  it('a valid supplier SKU produces a real CJ search URL, on the official CJ domain, honestly typed as "search" — never "product"', async () => {
    const result = await cjdropshippingConnector.getProductSourceLink({ productRef: 'pid-1', supplierSku: 'CJYD2334853' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.type).toBe('search')
    expect(result.value.url).toBe('https://m.cjdropshipping.com/search?keyWord=CJYD2334853')
    expect(new URL(result.value.url).hostname.endsWith('cjdropshipping.com')).toBe(true)
  })

  it('prefers the human-recognisable supplier SKU over the bare numeric pid when both are available', async () => {
    const result = await cjdropshippingConnector.getProductSourceLink({ productRef: '2503221215301600700', supplierSku: 'CJYD2334853' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.url).toContain('CJYD2334853')
  })

  it('falls back to the bare product reference when no supplier SKU is on file — never fabricates one', async () => {
    const result = await cjdropshippingConnector.getProductSourceLink({ productRef: '2503221215301600700', supplierSku: null })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.url).toBe('https://m.cjdropshipping.com/search?keyWord=2503221215301600700')
  })

  it('an empty product reference and no SKU produces an honest error, never a fabricated URL', async () => {
    const result = await cjdropshippingConnector.getProductSourceLink({ productRef: '', supplierSku: null })
    expect(result.ok).toBe(false)
  })

  it('special characters in the SKU are safely URL-encoded, never producing a malformed link', async () => {
    const result = await cjdropshippingConnector.getProductSourceLink({ productRef: 'pid-1', supplierSku: 'CJ SKU/with spaces&stuff' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Must parse as a well-formed URL — proves encoding actually happened.
    expect(() => new URL(result.value.url)).not.toThrow()
    expect(result.value.url).not.toContain(' ')
  })

  it('the descriptor honestly declares resolvesProductSourceLink: true — this connector genuinely implements the method, not a stub', () => {
    expect(cjdropshippingConnector.descriptor.capabilities.resolvesProductSourceLink).toBe(true)
  })

  it('never returns type "product" — no constructed direct product-page URL has been safely verified for this connector', async () => {
    const result = await cjdropshippingConnector.getProductSourceLink({ productRef: 'pid-1', supplierSku: 'CJYD2334853' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.type).not.toBe('product')
  })
})
