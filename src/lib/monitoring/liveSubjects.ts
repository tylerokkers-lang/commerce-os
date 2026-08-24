import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { aggregateSalesWindow, computeWindowBounds, REFUND_REASONS_COUNTED_AS_RETURNS, type OrderLineFact, type RefundFact } from '@/lib/orders/salesAggregation'
import type { SubjectDiscoveryResult, SubjectProvider } from './runner'
import type { Database } from '@/lib/supabase/database.types'
import type { SupplierMonitorSubject } from './monitors/supplierMonitor'
import type { SupplierOperationsSubject } from './monitors/supplierOperationsMonitor'
import type { MarketplaceListingSubject } from './monitors/marketplaceMonitor'
import type { ComplianceMonitorSubject } from './monitors/complianceMonitor'
import type { ProfitabilityMonitorSubject } from './monitors/profitabilityMonitor'
import type { PerformanceMonitorSubject, PerformanceWindow } from './monitors/performanceMonitor'
import type { FxPairSubject } from './monitors/fxMonitor'
import { MARKET_CATALOG } from '@/lib/markets/catalog'

/**
 * Live production subject discovery (Milestone 8.5 §1–2), completing the
 * honest gap Milestone 8 documented: this is where "which entities should
 * be checked" becomes a real, org-scoped, paginated database query for
 * every registered monitor, rather than a caller-supplied list.
 *
 * Every discovery function below follows the same shape: paginate a
 * bounded number of pages (`MAX_PAGES` * `PAGE_SIZE` rows — a real ceiling
 * for the current expected scale, not an unbounded "load everything"
 * query; a genuine "which rows are actually due" predicate pushed into SQL
 * is the next optimisation, not built here), and never let one source's
 * failure lose another's results — errors are collected and returned
 * alongside whatever subjects were gathered, per `SubjectDiscoveryResult`,
 * so `runner.ts` can report `partial_success` honestly instead of either
 * crashing or silently under-reporting coverage.
 *
 * Archived/removed products (`product_stage = 'removed'`) are excluded by
 * default — there is no "explicitly configured" override yet, so this
 * exclusion is unconditional, which is the safer default.
 */

const PAGE_SIZE = 500
const MAX_PAGES = 20 // 10,000 rows per monitor per run — see module comment.

type SupabaseQueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

async function paginate<T>(fetchPage: (from: number, to: number) => SupabaseQueryResult<T>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await fetchPage(from, to)
    if (error) return { rows, error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return { rows, error: null }
}

type ChannelListingStatus = Database['public']['Enums']['channel_listing_status']
type ProductStage = Database['public']['Enums']['product_stage']

const ACTIVE_PRODUCT_STAGE_EXCLUSIONS: readonly ProductStage[] = ['removed']
const MARKETPLACE_LIVE_STATUSES: readonly ChannelListingStatus[] = ['live']
const COMPLIANCE_EXCLUDED_STATUSES: readonly ChannelListingStatus[] = ['not_listed', 'removed']

/** Shared join: preferred supplier offers for active products, mapped to their channel listing — the base data both the supplier-stock/price monitor and the profitability monitor discover subjects from. */
async function discoverSupplierProductChannelJoins(orgId: string): Promise<{
  rows: { supplierId: string; productId: string; channelProductId: string }[]
  errors: string[]
}> {
  const supabase = createServiceSupabase()
  const errors: string[] = []

  const offers = await paginate<{ supplier_id: string; product_id: string }>((from, to) =>
    supabase.from('supplier_products').select('supplier_id, product_id').eq('org_id', orgId).eq('is_preferred', true).range(from, to),
  )
  if (offers.error) errors.push(`supplier_products: ${offers.error}`)

  const products = await paginate<{ id: string }>((from, to) =>
    supabase.from('products').select('id').eq('org_id', orgId).not('stage', 'in', `(${ACTIVE_PRODUCT_STAGE_EXCLUSIONS.join(',')})`).range(from, to),
  )
  if (products.error) errors.push(`products: ${products.error}`)
  const activeProductIds = new Set(products.rows.map((p) => p.id))

  const listings = await paginate<{ id: string; product_id: string }>((from, to) =>
    supabase.from('channel_products').select('id, product_id').eq('org_id', orgId).range(from, to),
  )
  if (listings.error) errors.push(`channel_products: ${listings.error}`)
  const channelProductByProduct = new Map(listings.rows.map((l) => [l.product_id, l.id]))

  const rows = offers.rows
    .filter((o) => activeProductIds.has(o.product_id))
    .map((o) => {
      const channelProductId = channelProductByProduct.get(o.product_id)
      return channelProductId ? { supplierId: o.supplier_id, productId: o.product_id, channelProductId } : null
    })
    .filter((r): r is { supplierId: string; productId: string; channelProductId: string } => r !== null)

  return { rows, errors }
}

async function discoverSupplierStockAndPrice(orgId: string): Promise<SubjectDiscoveryResult<SupplierMonitorSubject>> {
  const { rows, errors } = await discoverSupplierProductChannelJoins(orgId)
  const subjects = rows.map((r): SupplierMonitorSubject => ({ supplierId: r.supplierId, productId: r.productId, channelProductId: r.channelProductId, entityId: r.productId }))
  return { subjects, errors }
}

async function discoverProfitabilitySafetyNet(orgId: string): Promise<SubjectDiscoveryResult<ProfitabilityMonitorSubject>> {
  const { rows, errors } = await discoverSupplierProductChannelJoins(orgId)
  const subjects = rows.map((r): ProfitabilityMonitorSubject => ({ supplierId: r.supplierId, productId: r.productId, channelProductId: r.channelProductId }))
  return { subjects, errors }
}

async function discoverSupplierOperations(orgId: string): Promise<SubjectDiscoveryResult<SupplierOperationsSubject>> {
  const supabase = createServiceSupabase()
  const { rows, error } = await paginate<{ id: string }>((from, to) => supabase.from('suppliers').select('id').eq('org_id', orgId).range(from, to))
  return { subjects: rows.map((r) => ({ supplierId: r.id })), errors: error ? [`suppliers: ${error}`] : [] }
}

/** channel_id -> the connector key its own connector registry uses (`channels.key` is `channel_key`, which is exactly the live connector's own descriptor key — see `marketplaces/connectors/registry.ts`). Not hardcoded to Shopify: whichever channels the org has rows for are discovered, so a future third `channel_key` value needs no change here. */
async function loadChannelKeyMap(orgId: string): Promise<{ map: Map<string, string>; error: string | null }> {
  const supabase = createServiceSupabase()
  const { rows, error } = await paginate<{ id: string; key: string }>((from, to) => supabase.from('channels').select('id, key').eq('org_id', orgId).range(from, to))
  return { map: new Map(rows.map((c) => [c.id, c.key])), error }
}

async function discoverMarketplaceListingSync(orgId: string): Promise<SubjectDiscoveryResult<MarketplaceListingSubject>> {
  const supabase = createServiceSupabase()
  const errors: string[] = []

  const { map: channelKeyById, error: channelsError } = await loadChannelKeyMap(orgId)
  if (channelsError) errors.push(`channels: ${channelsError}`)

  const listings = await paginate<{ id: string; channel_id: string; price_minor: number | null; status: string; updated_at: string }>((from, to) =>
    supabase.from('channel_products').select('id, channel_id, price_minor, status, updated_at').eq('org_id', orgId).in('status', MARKETPLACE_LIVE_STATUSES).range(from, to),
  )
  if (listings.error) errors.push(`channel_products: ${listings.error}`)

  const subjects = listings.rows
    .map((row): MarketplaceListingSubject | null => {
      const connectorKey = channelKeyById.get(row.channel_id)
      if (!connectorKey) return null // Should not happen (FK-enforced) — defensively skipped rather than guessed.
      return { connectorKey, ours: { channelProductRef: row.id, priceMinor: row.price_minor ?? 0, status: row.status, recordedAt: row.updated_at } }
    })
    .filter((s): s is MarketplaceListingSubject => s !== null)

  return { subjects, errors }
}

async function discoverComplianceFreshness(orgId: string): Promise<SubjectDiscoveryResult<ComplianceMonitorSubject>> {
  const supabase = createServiceSupabase()
  const errors: string[] = []

  const { map: channelKeyById, error: channelsError } = await loadChannelKeyMap(orgId)
  if (channelsError) errors.push(`channels: ${channelsError}`)

  const listings = await paginate<{ id: string; product_id: string; channel_id: string; fulfilment_supplier_id: string | null }>((from, to) =>
    supabase.from('channel_products').select('id, product_id, channel_id, fulfilment_supplier_id').eq('org_id', orgId).not('status', 'in', `(${COMPLIANCE_EXCLUDED_STATUSES.join(',')})`).range(from, to),
  )
  if (listings.error) errors.push(`channel_products: ${listings.error}`)

  const products = await paginate<{ id: string; stage: string; updated_at: string }>((from, to) =>
    supabase.from('products').select('id, stage, updated_at').eq('org_id', orgId).range(from, to),
  )
  if (products.error) errors.push(`products: ${products.error}`)
  const productById = new Map(products.rows.map((p) => [p.id, p]))

  const complianceRecords = await paginate<{ product_id: string; channel: string; supplier_id: string | null; assessed_at: string }>((from, to) =>
    supabase.from('compliance_records').select('product_id, channel, supplier_id, assessed_at').eq('org_id', orgId).range(from, to),
  )
  if (complianceRecords.error) errors.push(`compliance_records: ${complianceRecords.error}`)
  const recordByKey = new Map(complianceRecords.rows.map((r) => [`${r.product_id}:${r.channel}`, r]))

  const now = Date.now()
  const subjects = listings.rows
    .map((listing): ComplianceMonitorSubject | null => {
      const channelKey = channelKeyById.get(listing.channel_id)
      if (channelKey !== 'shopify' && channelKey !== 'amazon_uk') return null // Unknown/unconfigured channel — nothing to assess against.
      const product = productById.get(listing.product_id)
      if (!product || product.stage === 'removed') return null

      const record = recordByKey.get(`${listing.product_id}:${channelKey}`)
      const daysSinceLastAssessment = record ? Math.floor((now - new Date(record.assessed_at).getTime()) / (1000 * 60 * 60 * 24)) : null
      const productDetailsChangedSinceApproval = record ? new Date(product.updated_at).getTime() > new Date(record.assessed_at).getTime() : false

      return {
        channelProductId: listing.id, productId: listing.product_id, channel: channelKey, supplierId: listing.fulfilment_supplier_id ?? '',
        context: { approvedSupplierId: record?.supplier_id ?? null, fulfillingSupplierId: listing.fulfilment_supplier_id, daysSinceLastAssessment, productDetailsChangedSinceApproval },
        complianceContext: {},
      }
    })
    .filter((s): s is ComplianceMonitorSubject => s !== null)

  return { subjects, errors }
}

const SALES_WINDOW_HOURS_DEFAULT = 24 * 7 // 7 days — overridable via `sales_performance:window_hours` in `config_values`, read by the caller before this module is invoked; kept here as the fallback only.

async function discoverSalesPerformance(orgId: string, windowHours: number = SALES_WINDOW_HOURS_DEFAULT, now: Date = new Date()): Promise<SubjectDiscoveryResult<PerformanceMonitorSubject>> {
  const supabase = createServiceSupabase()
  const errors: string[] = []

  const listings = await paginate<{ id: string; product_id: string; fulfilment_supplier_id: string | null }>((from, to) =>
    supabase.from('channel_products').select('id, product_id, fulfilment_supplier_id').eq('org_id', orgId).in('status', MARKETPLACE_LIVE_STATUSES).range(from, to),
  )
  if (listings.error) errors.push(`channel_products: ${listings.error}`)
  if (listings.rows.length === 0) return { subjects: [], errors }

  // Fall back to the preferred supplier where a listing has no fulfilment
  // supplier explicitly recorded — the same join `discoverSupplierProductChannelJoins` uses.
  const { rows: preferredJoins } = await discoverSupplierProductChannelJoins(orgId)
  const preferredSupplierByProduct = new Map(preferredJoins.map((r) => [r.productId, r.supplierId]))

  const productIds = [...new Set(listings.rows.map((l) => l.product_id))]
  const { current, previous } = computeWindowBounds(now, windowHours)

  const orderItems = await paginate<{ order_id: string; product_id: string | null; quantity: number; line_total_minor: number }>((from, to) =>
    supabase.from('order_items').select('order_id, product_id, quantity, line_total_minor').eq('org_id', orgId).in('product_id', productIds).range(from, to),
  )
  if (orderItems.error) errors.push(`order_items: ${orderItems.error}`)
  if (orderItems.rows.length === 0) return { subjects: [], errors } // No sales data at all for any of these products — nothing to compare, not a guess.

  const orderIds = [...new Set(orderItems.rows.map((i) => i.order_id))]
  const orders = await paginate<{ id: string; status: string; subtotal_minor: number; placed_at: string }>((from, to) =>
    supabase.from('orders').select('id, status, subtotal_minor, placed_at').eq('org_id', orgId).in('id', orderIds).gte('placed_at', previous.start.toISOString()).range(from, to),
  )
  if (orders.error) errors.push(`orders: ${orders.error}`)
  const orderById = new Map(orders.rows.map((o) => [o.id, o]))

  const refunds = await paginate<{ order_id: string; amount_minor: number; reason: string; created_at: string }>((from, to) =>
    supabase.from('refunds').select('order_id, amount_minor, reason, created_at').eq('org_id', orgId).in('order_id', orderIds).range(from, to),
  )
  if (refunds.error) errors.push(`refunds: ${refunds.error}`)

  const linesByProduct = new Map<string, OrderLineFact[]>()
  for (const item of orderItems.rows) {
    if (!item.product_id) continue // A line whose product was since deleted — nothing to attribute it to.
    const order = orderById.get(item.order_id)
    if (!order) continue // Outside the window or otherwise not loaded — not a match.
    const list = linesByProduct.get(item.product_id) ?? []
    list.push({ orderId: item.order_id, orderStatus: order.status, orderSubtotalMinor: order.subtotal_minor, placedAt: order.placed_at, quantity: item.quantity, lineTotalMinor: item.line_total_minor })
    linesByProduct.set(item.product_id, list)
  }

  const refundsByOrder = new Map<string, RefundFact[]>()
  for (const r of refunds.rows) {
    const list = refundsByOrder.get(r.order_id) ?? []
    list.push({ orderId: r.order_id, amountMinor: r.amount_minor, isReturn: REFUND_REASONS_COUNTED_AS_RETURNS.has(r.reason), createdAt: r.created_at })
    refundsByOrder.set(r.order_id, list)
  }
  // Refunds attributed to a product via any order that contains it — an
  // approximation documented in `salesAggregation.ts`'s module comment
  // (no per-line refund attribution exists in this schema).
  const refundsByProduct = new Map<string, RefundFact[]>()
  for (const [productId, lines] of linesByProduct) {
    const orderIdsForProduct = new Set(lines.map((l) => l.orderId))
    const productRefunds = [...orderIdsForProduct].flatMap((oid) => refundsByOrder.get(oid) ?? [])
    refundsByProduct.set(productId, productRefunds)
  }

  const toPerformanceWindow = (metrics: ReturnType<typeof aggregateSalesWindow>): PerformanceWindow => ({
    unitsSold: metrics.unitsSold, revenueMinor: metrics.grossRevenueMinor, returnsCount: metrics.returnsCount, refundsCount: metrics.refundsCount,
    adSpendMinor: metrics.adSpendMinor, windowStart: metrics.windowStart, windowEnd: metrics.windowEnd,
    netRevenueMinor: metrics.netRevenueMinor, salesVelocityPerDay: metrics.salesVelocityPerDay,
  })

  const subjects = listings.rows
    .filter((l, i, arr) => arr.findIndex((x) => x.product_id === l.product_id) === i) // One subject per product, not per listing.
    .map((listing): PerformanceMonitorSubject | null => {
      const supplierId = listing.fulfilment_supplier_id ?? preferredSupplierByProduct.get(listing.product_id)
      if (!supplierId) return null // No known supplier to attribute a chained profitability recheck to.
      const lines = linesByProduct.get(listing.product_id) ?? []
      const productRefunds = refundsByProduct.get(listing.product_id) ?? []
      return {
        productId: listing.product_id, supplierId, channelProductId: listing.id,
        currentWindow: toPerformanceWindow(aggregateSalesWindow(lines, productRefunds, current.start, current.end)),
        previousWindow: toPerformanceWindow(aggregateSalesWindow(lines, productRefunds, previous.start, previous.end)),
        adSpendLimitMinor: null, // No live ad-spend data source exists yet (documented in HANDOVER.md).
      }
    })
    .filter((s): s is PerformanceMonitorSubject => s !== null)

  return { subjects, errors }
}

/**
 * FX pairs worth watching (Milestone 9 §10): the org's own reporting
 * currency (`business_settings.base_currency`) against every distinct
 * currency the market catalog actually uses — real, bounded, and derived
 * from data this codebase already has, rather than a hardcoded currency
 * list or an "org markets" table this milestone deliberately did not
 * build (see `catalog.ts`'s module comment).
 */
async function discoverFxPairs(orgId: string): Promise<SubjectDiscoveryResult<FxPairSubject>> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.from('organisations').select('base_currency').eq('id', orgId).maybeSingle()
  if (error) return { subjects: [], errors: [`organisations: ${error.message}`] }

  const base = (data?.base_currency ?? 'GBP') as FxPairSubject['base']
  const quoteCurrencies = new Set(MARKET_CATALOG.map((m) => m.currency).filter((c) => c !== base))
  return { subjects: [...quoteCurrencies].map((quote) => ({ base, quote })), errors: [] }
}

export const getLiveSubjects: SubjectProvider = async (orgId, monitorKey) => {
  try {
    switch (monitorKey) {
      case 'supplier_stock_and_price': return await discoverSupplierStockAndPrice(orgId)
      case 'supplier_operations': return await discoverSupplierOperations(orgId)
      case 'marketplace_listing_sync': return await discoverMarketplaceListingSync(orgId)
      case 'compliance_freshness': return await discoverComplianceFreshness(orgId)
      case 'profitability_safety_net': return await discoverProfitabilitySafetyNet(orgId)
      case 'sales_performance': return await discoverSalesPerformance(orgId)
      case 'fx_rates': return await discoverFxPairs(orgId)
      // `market_expansion` genuinely has no live discovery yet: a
      // MarketMonitorSubject needs a full `ComplianceContext` assembled
      // from live product/supplier/IP-risk facts — the same class of gap
      // Milestone 7 documented for `product_compliance_recheck`'s own
      // context assembly, not built here. The monitor, engine and job
      // handler are all real and fully tested; only "which products to
      // evaluate against which markets today" is undiscovered live.
      case 'market_expansion': return { subjects: [], errors: [] }
      default: return { subjects: [], errors: [] }
    }
  } catch (error) {
    // A whole-source failure (e.g. the database is unreachable for this
    // monitor's very first query) is still reported as a discovery error,
    // never thrown — `runner.ts` folds this into a `partial_success`/`failed`
    // run rather than crashing the scheduler sweep.
    return { subjects: [], errors: [`${monitorKey}: ${error instanceof Error ? error.message : String(error)}`] }
  }
}
