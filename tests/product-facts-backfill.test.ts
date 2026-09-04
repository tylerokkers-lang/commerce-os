import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Milestone: CJ import data-persistence fix, extended by the
 * product-catalogue correction milestone (supplier URL & clean naming)
 * and the supplier product verification link milestone.
 * `backfillProductFactsFromResearch` is the self-heal path for a product
 * imported *before* `importCandidate` started copying real discovery-time
 * facts across into `products`/`supplier_products` — wired into
 * `recalculateProductIntelligence` (`products/actions.ts`) the same way
 * `establishChannelFulfilmentSupplier` already self-heals the fulfilment
 * supplier link. `server-only`, so exercised here through a minimal,
 * hand-rolled Supabase stub — same technique `tests/automation-jobs.test.ts`
 * already uses for equally un-importable server-only orchestration code.
 */

vi.mock('server-only', () => ({}))

const createServerSupabaseMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => createServerSupabaseMock() }))

const getConnectorMock = vi.fn()
vi.mock('@/lib/suppliers/connectors/registry', () => ({ getConnector: (key: string) => getConnectorMock(key) }))

function makeSelectChain(row: unknown) {
  const chain: Record<string, unknown> = {}
  chain.eq = () => chain
  chain.maybeSingle = () => Promise.resolve({ data: row, error: null })
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.eq = () => chain
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve, reject)
  return chain
}

interface Fixtures {
  productResearch: { candidate_title: string; category: string | null; notes: string | null; supplier_id: string | null; raw_signals: unknown } | null
  product: { title: string; supplier_title: string | null; description: string | null; weight_grams: number | null; length_mm: number | null; width_mm: number | null; height_mm: number | null } | null
  supplierProduct: { supplier_sku: string | null; lead_time_days: number | null; stock_qty: number | null; source_url: string | null; source_url_type: string | null; connector_key: string | null; connector_product_ref: string | null } | null
}

function buildSupabaseStub(fixtures: Fixtures) {
  const updates: { products: Record<string, unknown>[]; supplier_products: Record<string, unknown>[] } = { products: [], supplier_products: [] }
  const stub = {
    from(table: string) {
      return {
        select() {
          if (table === 'product_research') return makeSelectChain(fixtures.productResearch)
          if (table === 'products') return makeSelectChain(fixtures.product)
          if (table === 'supplier_products') return makeSelectChain(fixtures.supplierProduct)
          throw new Error(`unexpected select on "${table}"`)
        },
        update(patch: Record<string, unknown>) {
          if (table === 'products') updates.products.push(patch)
          else if (table === 'supplier_products') updates.supplier_products.push(patch)
          else throw new Error(`unexpected update on "${table}"`)
          return makeUpdateChain()
        },
      }
    },
  }
  return { stub, updates }
}

/** Matches the real `SupplierConnector` shape closely enough to exercise `resolvesProductSourceLink` gating correctly. */
function makeConnectorMock(opts: {
  readProductDetail: () => Promise<{ ok: boolean; value?: { productUrl: string | null }; error?: string }>
  resolvesProductSourceLink?: boolean
  getProductSourceLink?: () => Promise<{ ok: boolean; value?: { type: 'product' | 'search'; url: string }; error?: string }>
}) {
  return {
    isConfigured: () => true,
    descriptor: { capabilities: { resolvesProductSourceLink: opts.resolvesProductSourceLink ?? false } },
    readProductDetail: opts.readProductDetail,
    getProductSourceLink: opts.getProductSourceLink ?? (async () => ({ ok: false, error: 'not configured for this test' })),
  }
}

describe('backfillProductFactsFromResearch', () => {
  beforeEach(() => {
    createServerSupabaseMock.mockReset()
    getConnectorMock.mockReset()
    getConnectorMock.mockReturnValue(undefined) // no connector configured, by default — the resolution branch is skipped
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('fills currently-null description/specs/lead-time/stock/name-split from the promoted candidate\'s real notes and raw_signals', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: {
        candidate_title: "Twist Outer Wear V-neck Sweater Needle Woven Women's Cardigan",
        category: "Women's Clothing > Tops & Sets > Sweaters",
        notes: 'A real, 1796-character supplier description.',
        supplier_id: 'sup-1',
        raw_signals: { weightGrams: 420, lengthMm: 300, widthMm: 200, heightMm: 50, stockQty: 12, deliveryDaysMax: 7 },
      },
      product: { title: "Twist Outer Wear V-neck Sweater Needle Woven Women's Cardigan", supplier_title: null, description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: null, stock_qty: null, source_url: null, source_url_type: null, connector_key: null, connector_product_ref: null },
    })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.updatedProduct).toBe(true)
    expect(result.updatedSupplierOffer).toBe(true)
    expect(updates.products).toEqual([
      {
        description: 'A real, 1796-character supplier description.',
        weight_grams: 420,
        length_mm: 300,
        width_mm: 200,
        height_mm: 50,
        supplier_title: "Twist Outer Wear V-neck Sweater Needle Woven Women's Cardigan",
        title: "Women's V-Neck Knit Cardigan",
      },
    ])
    // Established project convention: a single lead_time_days column stands
    // in for the delivery-day range as its maximum, never an average.
    expect(updates.supplier_products).toEqual([{ lead_time_days: 7, stock_qty: 12 }])
  })

  it('never overwrites a description/weight already on file, but still fills the still-null dimension fields from the same raw_signals — and leaves supplier_products untouched once both its fields are already known', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: {
        candidate_title: 'A different description from discovery — must not clobber the one already on file.',
        category: null,
        notes: 'A different description from discovery — must not clobber the one already on file.',
        supplier_id: 'sup-1',
        raw_signals: { weightGrams: 999, lengthMm: 300, widthMm: 200, heightMm: 50, stockQty: 999, deliveryDaysMax: 99 },
      },
      product: { title: 'Operator-retitled product', supplier_title: 'Already split previously', description: 'Operator-written description already on file.', weight_grams: 500, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: 3, stock_qty: 10, source_url: 'https://example.com/already-known', source_url_type: 'product', connector_key: 'cjdropshipping', connector_product_ref: 'ref-1' },
    })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.updatedProduct).toBe(true)
    // supplier_title already set -> title/supplier_title never touched again, only the still-null dimension fields fill.
    expect(updates.products).toEqual([{ length_mm: 300, width_mm: 200, height_mm: 50 }])
    expect(result.updatedSupplierOffer).toBe(false)
    expect(updates.supplier_products).toHaveLength(0) // every field already known — no write at all
  })

  it('a product with no promoted candidate on file (e.g. manually added) backfills nothing and never crashes', async () => {
    const { stub, updates } = buildSupabaseStub({ productResearch: null, product: null, supplierProduct: null })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result).toEqual({ updatedProduct: false, updatedSupplierOffer: false, recoveredUrlLive: false, resolvedSearchLink: false })
    expect(updates.products).toHaveLength(0)
    expect(updates.supplier_products).toHaveLength(0)
  })

  it('a candidate with no supplier assigned never attempts a supplier_products update', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: 'x', category: null, notes: null, supplier_id: null, raw_signals: { deliveryDaysMax: 5, stockQty: 3 } },
      product: { title: 'x', supplier_title: 'x', description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: null,
    })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.updatedSupplierOffer).toBe(false)
    expect(updates.supplier_products).toHaveLength(0)
  })

  it('missing raw_signals fields stay genuinely unknown rather than becoming a false-positive fill', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: 'x', category: null, notes: null, supplier_id: 'sup-1', raw_signals: null },
      product: { title: 'x', supplier_title: 'x', description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: null, stock_qty: null, source_url: null, source_url_type: null, connector_key: null, connector_product_ref: null },
    })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result).toEqual({ updatedProduct: false, updatedSupplierOffer: false, recoveredUrlLive: false, resolvedSearchLink: false })
    expect(updates.products).toHaveLength(0)
    expect(updates.supplier_products).toHaveLength(0)
  })

  it('a discovery-time sourceUrl/sourceUrlType is backfilled onto supplier_products when the columns are still null', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: 'x', category: null, notes: null, supplier_id: 'sup-1', raw_signals: { sourceUrl: 'https://cjdropshipping.com/product/real.html', sourceUrlType: 'product', connectorKey: 'cjdropshipping', connectorProductRef: 'ref-1' } },
      product: { title: 'x', supplier_title: 'x', description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: null, stock_qty: null, source_url: null, source_url_type: null, connector_key: null, connector_product_ref: null },
    })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.updatedSupplierOffer).toBe(true)
    expect(result.recoveredUrlLive).toBe(false) // it was already on file from discovery — no live call needed
    expect(updates.supplier_products).toEqual([{ connector_key: 'cjdropshipping', connector_product_ref: 'ref-1', source_url: 'https://cjdropshipping.com/product/real.html', source_url_type: 'product' }])
    expect(getConnectorMock).not.toHaveBeenCalled()
  })

  it('attempts a live, read-only connector refetch when no URL is on file anywhere, and uses it (type "product") if the connector genuinely returns one', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: 'x', category: null, notes: null, supplier_id: 'sup-1', raw_signals: { connectorKey: 'cjdropshipping', connectorProductRef: 'ref-1' } },
      product: { title: 'x', supplier_title: 'x', description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: null, stock_qty: null, source_url: null, source_url_type: null, connector_key: null, connector_product_ref: null },
    })
    createServerSupabaseMock.mockResolvedValue(stub)
    getConnectorMock.mockReturnValue(makeConnectorMock({ readProductDetail: async () => ({ ok: true, value: { productUrl: 'https://cjdropshipping.com/product/refetched.html' } }) }))

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.recoveredUrlLive).toBe(true)
    expect(result.resolvedSearchLink).toBe(false)
    expect(updates.supplier_products).toEqual([{ connector_key: 'cjdropshipping', connector_product_ref: 'ref-1', source_url: 'https://cjdropshipping.com/product/refetched.html', source_url_type: 'product' }])
  })

  it('falls back to the connector\'s official search route (type "search") when no real product URL is found and the connector supports it — the real, confirmed CJ case', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: 'x', category: null, notes: null, supplier_id: 'sup-1', raw_signals: { connectorKey: 'cjdropshipping', connectorProductRef: 'ref-1' } },
      product: { title: 'x', supplier_title: 'x', description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: null, stock_qty: null, source_url: null, source_url_type: null, connector_key: null, connector_product_ref: null },
    })
    createServerSupabaseMock.mockResolvedValue(stub)
    getConnectorMock.mockReturnValue(
      makeConnectorMock({
        readProductDetail: async () => ({ ok: true, value: { productUrl: null } }),
        resolvesProductSourceLink: true,
        getProductSourceLink: async () => ({ ok: true, value: { type: 'search', url: 'https://m.cjdropshipping.com/search?keyWord=CJYD1' } }),
      }),
    )

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.recoveredUrlLive).toBe(false)
    expect(result.resolvedSearchLink).toBe(true)
    expect(updates.supplier_products).toEqual([{ connector_key: 'cjdropshipping', connector_product_ref: 'ref-1', source_url: 'https://m.cjdropshipping.com/search?keyWord=CJYD1', source_url_type: 'search' }])
  })

  it('a connector that does not support resolvesProductSourceLink is never asked for a search link — leaves source_url null, never fabricated', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: 'x', category: null, notes: null, supplier_id: 'sup-1', raw_signals: { connectorKey: 'cjdropshipping', connectorProductRef: 'ref-1' } },
      product: { title: 'x', supplier_title: 'x', description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: null, stock_qty: null, source_url: null, source_url_type: null, connector_key: null, connector_product_ref: null },
    })
    createServerSupabaseMock.mockResolvedValue(stub)
    const getProductSourceLinkSpy = vi.fn()
    getConnectorMock.mockReturnValue(
      makeConnectorMock({
        readProductDetail: async () => ({ ok: true, value: { productUrl: null } }),
        resolvesProductSourceLink: false,
        getProductSourceLink: getProductSourceLinkSpy,
      }),
    )

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.recoveredUrlLive).toBe(false)
    expect(result.resolvedSearchLink).toBe(false)
    expect(getProductSourceLinkSpy).not.toHaveBeenCalled()
    expect(updates.supplier_products).toEqual([{ connector_key: 'cjdropshipping', connector_product_ref: 'ref-1' }])
  })

  it('a connector call that throws is swallowed — the backfill still completes rather than failing entirely', async () => {
    const { stub } = buildSupabaseStub({
      productResearch: { candidate_title: 'x', category: null, notes: null, supplier_id: 'sup-1', raw_signals: { connectorKey: 'cjdropshipping', connectorProductRef: 'ref-1' } },
      product: { title: 'x', supplier_title: 'x', description: null, weight_grams: null, length_mm: null, width_mm: null, height_mm: null },
      supplierProduct: { supplier_sku: 'CJYD1', lead_time_days: null, stock_qty: null, source_url: null, source_url_type: null, connector_key: null, connector_product_ref: null },
    })
    createServerSupabaseMock.mockResolvedValue(stub)
    getConnectorMock.mockReturnValue(
      makeConnectorMock({
        readProductDetail: async () => {
          throw new Error('network exploded')
        },
      }),
    )

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    await expect(backfillProductFactsFromResearch('org-1', 'prod-1')).resolves.toEqual({ updatedProduct: false, updatedSupplierOffer: true, recoveredUrlLive: false, resolvedSearchLink: false })
  })

  it('an already-cleaned product (supplier_title already set) never has its title regenerated again, even if raw_signals would otherwise produce a different name', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: "Men's Sports Looped Pile Shorts", category: "Men's Clothing > Bottoms > Casual Pants", notes: null, supplier_id: 'sup-1', raw_signals: null },
      product: { title: 'Men\'s Sports Loopback Shorts', supplier_title: "Men's Sports Looped Pile Shorts", description: 'already set', weight_grams: 1, length_mm: 1, width_mm: 1, height_mm: 1 },
      supplierProduct: null,
    })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.updatedProduct).toBe(false)
    expect(updates.products).toHaveLength(0)
  })

  it('an operator-retitled product (title no longer matches the raw supplier text) never has its title overwritten by the naming engine', async () => {
    const { stub, updates } = buildSupabaseStub({
      productResearch: { candidate_title: "Men's Sports Looped Pile Shorts", category: "Men's Clothing > Bottoms > Casual Pants", notes: null, supplier_id: 'sup-1', raw_signals: null },
      product: { title: 'A totally custom operator title', supplier_title: null, description: 'x', weight_grams: 1, length_mm: 1, width_mm: 1, height_mm: 1 },
      supplierProduct: null,
    })
    createServerSupabaseMock.mockResolvedValue(stub)

    const { backfillProductFactsFromResearch } = await import('@/lib/suppliers/discovery/factsBackfill')
    const result = await backfillProductFactsFromResearch('org-1', 'prod-1')

    expect(result.updatedProduct).toBe(true)
    // supplier_title is still backfilled (a real, always-safe fact to record) — but `title` itself is left exactly as the operator set it.
    expect(updates.products).toEqual([{ supplier_title: "Men's Sports Looped Pile Shorts" }])
  })
})

/**
 * Milestone: supplier product verification link, Part L (data integrity).
 * Static guard, independent of the mocked-Supabase tests above: proves
 * `backfillProductFactsFromResearch` never even reads or writes the
 * fields that must remain immutable — supplier cost, currency, SKU, the
 * Commerce OS clean title once set, and anything Shopify/marketplace
 * related. Not just "the tests above didn't happen to assert this" but
 * "the source code has no path that could".
 */
describe('backfillProductFactsFromResearch: data-integrity guard (static)', () => {
  const source = readFileSync('src/lib/suppliers/discovery/factsBackfill.ts', 'utf8')

  it('never selects or writes unit_cost_minor, shipping_cost_minor, or currency — supplier economics are immutable here', () => {
    expect(source).not.toMatch(/unit_cost_minor/)
    expect(source).not.toMatch(/shipping_cost_minor/)
    expect(source).not.toMatch(/currency/)
  })

  it('never writes supplier_sku — a supplier identity fact this module only ever reads', () => {
    expect(source).not.toMatch(/patch\.supplier_sku|supplier_sku:/)
  })

  it('never references any Shopify/marketplace/order/payment table or column', () => {
    // "fulfilment" alone is deliberately excluded — it appears in this
    // file's own module comment referencing the unrelated, already-audited
    // `establishChannelFulfilmentSupplier` self-heal (which product/
    // supplier assignment, never an actual shipment). The real safety
    // property this guards is that no marketplace/order/payment table is
    // ever touched.
    for (const forbidden of ['channel_products', 'shopify', 'external_id', 'price_minor', 'from(\'orders\'', 'payments']) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
