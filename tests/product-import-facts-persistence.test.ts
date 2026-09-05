import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Static regression guard for the CJ import data-persistence fix
 * (Milestone: economic/quality audit follow-up). `ingestion.ts` is
 * `server-only` (imports `createServerSupabase` transitively), so it
 * cannot be imported directly here — same technique
 * `product-intelligence-pricing-dependency.test.ts` and
 * `product-server-actions-shape.test.ts` already use for equally
 * un-importable server-only orchestration files.
 *
 * The audit found real description, delivery-day, and per-variant
 * weight/dimension/stock data being captured at discovery time
 * (`product_research`) and then silently dropped on import — `products`
 * and `supplier_products` stayed null in fields `qualityScore.ts` reads,
 * making the scorer interpret genuinely-captured-but-lost data as
 * "the supplier gave us nothing."
 */

const INGESTION_PATH = 'src/lib/suppliers/discovery/ingestion.ts'

describe('importCandidate: real discovery-time facts are persisted, never dropped', () => {
  const source = readFileSync(INGESTION_PATH, 'utf8')

  it('candidate.notes (the real supplier description) is persisted into products.description', () => {
    expect(source).toMatch(/description:\s*candidate\.notes/)
  })

  it('real per-variant weight/dimensions are persisted into products.weight_grams/length_mm/width_mm/height_mm, never inferred or invented', () => {
    expect(source).toMatch(/weight_grams:\s*candidate\.raw_signals\?\.weightGrams\s*\?\?\s*null/)
    expect(source).toMatch(/length_mm:\s*candidate\.raw_signals\?\.lengthMm\s*\?\?\s*null/)
    expect(source).toMatch(/width_mm:\s*candidate\.raw_signals\?\.widthMm\s*\?\?\s*null/)
    expect(source).toMatch(/height_mm:\s*candidate\.raw_signals\?\.heightMm\s*\?\?\s*null/)
  })

  it('the real captured delivery estimate is persisted into supplier_products.lead_time_days, following the established deliveryDaysMax convention (never an invented average)', () => {
    expect(source).toMatch(/lead_time_days:\s*candidate\.raw_signals\?\.deliveryDaysMax\s*\?\?\s*null/)
  })

  it('a real captured stock figure is persisted into supplier_products.stock_qty, null (never zero) when genuinely unavailable', () => {
    expect(source).toMatch(/stock_qty:\s*candidate\.raw_signals\?\.stockQty\s*\?\?\s*null/)
  })

  it('real per-variant weight is persisted into product_variants.weight_grams', () => {
    expect(source).toMatch(/weight_grams:\s*variant\.weightGrams\s*\?\?\s*null/)
  })

  it('supplier facts (cost, shipping, currency, SKU) are read from the candidate\'s own real values, never rewritten by this fix', () => {
    // Part B: the import layer persists supplier facts, it never rewrites them.
    expect(source).toMatch(/unit_cost_minor:\s*candidate\.estimated_unit_cost_minor/)
    expect(source).toMatch(/shipping_cost_minor:\s*candidate\.estimated_shipping_minor\s*\?\?\s*0/)
    expect(source).toMatch(/currency:\s*candidate\.currency/)
    expect(source).toMatch(/supplier_sku:\s*candidate\.supplier_sku/)
  })

  it('the supplier product URL is persisted into supplier_products.source_url, never constructed from a guessed pattern', () => {
    expect(source).toMatch(/source_url:\s*candidate\.raw_signals\?\.sourceUrl\s*\?\?\s*null/)
  })

  it('the URL type (exact product page vs. supplier search route) is persisted alongside the URL itself — never left implicit', () => {
    expect(source).toMatch(/source_url_type:\s*candidate\.raw_signals\?\.sourceUrlType\s*\?\?\s*null/)
  })

  it('the connector and its own product reference are persisted onto supplier_products, not left reachable only via product_research.raw_signals', () => {
    expect(source).toMatch(/connector_key:\s*candidate\.raw_signals\?\.connectorKey\s*\?\?\s*null/)
    expect(source).toMatch(/connector_product_ref:\s*candidate\.raw_signals\?\.connectorProductRef\s*\?\?\s*null/)
  })

  it('last_verified_at is set only when this offer genuinely came from a real connector read, never backdated for a manually-entered candidate', () => {
    // Milestone: autonomous decision & capability layer, Part 6 — supplier
    // intelligence provenance. The column existed since Milestone 3 but no
    // real code path ever set it before this.
    expect(source).toMatch(/last_verified_at:\s*candidate\.raw_signals\?\.connectorKey\s*\?\s*new Date\(\)\.toISOString\(\)\s*:\s*null/)
  })

  it('the original supplier title is preserved verbatim into products.supplier_title, separate from the generated clean title', () => {
    expect(source).toMatch(/supplier_title:\s*candidate\.candidate_title/)
  })

  it('products.title is the generated clean name, never the raw supplier title directly', () => {
    // Both the products insert and the PRODUCT_ADDED audit entry must use
    // the generated clean name — the audit entry mirrors what was
    // genuinely written, never a stale reference to the raw title.
    const titleAssignments = source.match(/\btitle:\s*(naming\.name|candidate\.candidate_title)/g) ?? []
    expect(titleAssignments.length).toBeGreaterThan(0)
    expect(titleAssignments.every((a) => a.includes('naming.name'))).toBe(true)
  })

  it('the clean name is generated via generateCleanProductName, using the candidate\'s own title and category as its only inputs — nothing invented at the call site', () => {
    expect(source).toMatch(/generateCleanProductName\(\{\s*supplierTitle:\s*candidate\.candidate_title,\s*category:\s*candidate\.category\s*\}\)/)
  })

  it('the candidate select statement actually fetches notes, so candidate.notes is never silently undefined at the point description is assigned', () => {
    // `.maybeSingle<CandidateRow>()` is the unique marker for
    // `importCandidate`'s own candidate read — this file has several other
    // `product_research` selects (capture, reject) that must not be confused with it.
    const selectCall = source.match(/\.select\('([^']+)'\)\s*\n\s*\.eq\('org_id', orgId\)\s*\n\s*\.eq\('id', candidateId\)\s*\n\s*\.maybeSingle<CandidateRow>\(\)/)
    expect(selectCall).not.toBeNull()
    expect(selectCall![1].split(',').map((s) => s.trim())).toContain('notes')
  })
})
