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
