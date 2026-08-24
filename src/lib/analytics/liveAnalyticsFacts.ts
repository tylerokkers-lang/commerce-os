import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { paginate } from '@/lib/supabase/paginate'
import {
  aggregateSalesWindow, REFUND_REASONS_COUNTED_AS_RETURNS,
  type OrderLineFact, type RefundFact, type SalesWindowMetrics, type Period,
} from '@/lib/orders/salesAggregation'
import type { PriceCostInput } from './profitAnalytics'
import type { SupplierHealthInput } from './supplierAnalytics'
import type { FulfilmentRecordFact } from './fulfilmentAnalytics'
import type { ChannelKey, ComplianceVerdict } from '@/lib/core/domain'
import type { CurrencyCode } from '@/lib/core/money'

/**
 * Live analytics data assembly (Milestone 10 §18–19) — the one server-only
 * caller that turns org-scoped Supabase queries into the fact shapes the
 * pure `analytics/*.ts` modules consume, the same split
 * `monitoring/liveSubjects.ts` established: pure aggregation stays testable
 * without a database, and only this file touches Postgres. Every query is
 * bounded via the shared `paginate` helper and scoped by `org_id` — no
 * cross-org read is possible from any function here.
 */

const ACTIVE_PRODUCT_STAGE_EXCLUSIONS = ['removed']

export interface OrgSalesFacts {
  currency: CurrencyCode
  current: SalesWindowMetrics
  previous: SalesWindowMetrics | null
  byChannel: Partial<Record<ChannelKey, { current: SalesWindowMetrics; previous: SalesWindowMetrics | null }>>
  /** True only when the org genuinely has zero orders ever, not just zero in this window — lets a caller distinguish "empty period" from "empty business." */
  hasAnyOrdersEver: boolean
  /**
   * Non-empty only when at least one order in the queried window is priced
   * in a currency other than the org's own `base_currency` (Milestone 11
   * §5/§8's explicit currency-safety requirement — every `orders` row
   * carries its own `currency` column, so this is a real, checkable fact,
   * not a theoretical concern). `aggregateSalesWindow` sums raw minor-unit
   * numbers with no currency awareness of its own, so silently feeding it
   * a mix would silently combine, say, GBP and USD as if they were the
   * same money. The caller (`getAnalyticsDashboard`) must report the
   * affected figures as `unavailable` rather than aggregate them.
   */
  mixedCurrencies: readonly CurrencyCode[]
}

/** Exported so `liveAdvertisingFacts.ts` (Milestone 14) resolves the org's base currency the same way every other live fact loader in this module already does, rather than a second copy. */
export async function loadOrgCurrency(orgId: string): Promise<CurrencyCode> {
  const supabase = createServiceSupabase()
  const { data } = await supabase.from('organisations').select('base_currency').eq('id', orgId).maybeSingle()
  return (data?.base_currency ?? 'GBP') as CurrencyCode
}

/**
 * Loads every order line and refund an org has ever recorded, bounded by
 * `paginate`'s ceiling, then aggregates the requested period and its
 * previous-equivalent window in memory via the existing, unit-tested
 * `aggregateSalesWindow` — one real query pair, reused for every period
 * variant a caller wants, rather than a bespoke SQL query per period.
 */
export async function loadOrgSalesFacts(orgId: string, period: Period, previousPeriod: Period | null): Promise<OrgSalesFacts> {
  const supabase = createServiceSupabase()
  const currency = await loadOrgCurrency(orgId)

  const earliestBound = previousPeriod ? previousPeriod.start : period.start

  const orders = await paginate<{ id: string; channel: ChannelKey; status: string; subtotal_minor: number; placed_at: string; currency: string }>((from, to) =>
    supabase.from('orders').select('id, channel, status, subtotal_minor, placed_at, currency').eq('org_id', orgId).gte('placed_at', earliestBound).lte('placed_at', period.end).range(from, to),
  )
  const { count: anyOrderCount } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', orgId)

  // A real, checkable fact from `orders.currency` — never assumed. Any
  // order priced outside the org's own base currency makes a blind sum
  // across the window unsafe; the caller must report `unavailable` for
  // the affected figures rather than silently combine them.
  const mixedCurrencies = [...new Set(orders.rows.map((o) => o.currency))].filter((c) => c !== currency) as CurrencyCode[]

  if (orders.rows.length === 0) {
    const empty: SalesWindowMetrics = { unitsSold: 0, ordersCount: 0, grossRevenueMinor: 0, refundsMinor: 0, refundsCount: 0, returnsCount: 0, netRevenueMinor: 0, averageOrderValueMinor: null, salesVelocityPerDay: 0, adSpendMinor: 0, windowStart: period.start, windowEnd: period.end }
    return { currency, current: empty, previous: previousPeriod ? { ...empty, windowStart: previousPeriod.start, windowEnd: previousPeriod.end } : null, byChannel: {}, hasAnyOrdersEver: (anyOrderCount ?? 0) > 0, mixedCurrencies: [] }
  }

  const orderIds = orders.rows.map((o) => o.id)
  const orderById = new Map(orders.rows.map((o) => [o.id, o]))

  const items = await paginate<{ order_id: string; quantity: number; line_total_minor: number }>((from, to) =>
    supabase.from('order_items').select('order_id, quantity, line_total_minor').eq('org_id', orgId).in('order_id', orderIds).range(from, to),
  )
  const refunds = await paginate<{ order_id: string; amount_minor: number; reason: string; created_at: string }>((from, to) =>
    supabase.from('refunds').select('order_id, amount_minor, reason, created_at').eq('org_id', orgId).in('order_id', orderIds).range(from, to),
  )

  const linesAll: OrderLineFact[] = items.rows
    .map((item) => {
      const order = orderById.get(item.order_id)
      if (!order) return null
      return { orderId: item.order_id, orderStatus: order.status, orderSubtotalMinor: order.subtotal_minor, placedAt: order.placed_at, quantity: item.quantity, lineTotalMinor: item.line_total_minor }
    })
    .filter((l): l is OrderLineFact => l !== null)
  const refundsAll: RefundFact[] = refunds.rows.map((r) => ({ orderId: r.order_id, amountMinor: r.amount_minor, isReturn: REFUND_REASONS_COUNTED_AS_RETURNS.has(r.reason), createdAt: r.created_at }))

  const current = aggregateSalesWindow(linesAll, refundsAll, new Date(period.start), new Date(period.end))
  const previous = previousPeriod ? aggregateSalesWindow(linesAll, refundsAll, new Date(previousPeriod.start), new Date(previousPeriod.end)) : null

  const byChannel: OrgSalesFacts['byChannel'] = {}
  const channels = new Set(orders.rows.map((o) => o.channel))
  for (const channel of channels) {
    const orderIdsForChannel = new Set(orders.rows.filter((o) => o.channel === channel).map((o) => o.id))
    const channelLines = linesAll.filter((l) => orderIdsForChannel.has(l.orderId))
    const channelRefunds = refundsAll.filter((r) => orderIdsForChannel.has(r.orderId))
    byChannel[channel] = {
      current: aggregateSalesWindow(channelLines, channelRefunds, new Date(period.start), new Date(period.end)),
      previous: previousPeriod ? aggregateSalesWindow(channelLines, channelRefunds, new Date(previousPeriod.start), new Date(previousPeriod.end)) : null,
    }
  }

  return { currency, current, previous, byChannel, hasAnyOrdersEver: (anyOrderCount ?? 0) > 0, mixedCurrencies }
}

export interface ProductProfitFactRow {
  productId: string
  channel: ChannelKey
  category: string | null
  sellingPriceMinor: number | null
  sellingPriceCurrency: CurrencyCode
  productCostMinor: number | null
  productCostCurrency: CurrencyCode
  supplierShippingMinor: number | null
}

/**
 * One row per (active product, listed channel) — the preferred supplier's
 * live cost against that channel's live listing price, the same join
 * `monitoring/liveSubjects.ts`'s `discoverSupplierProductChannelJoins`
 * already established for the profitability monitor, reused here rather
 * than re-derived.
 */
export async function loadProductChannelProfitFacts(orgId: string): Promise<{ rows: ProductProfitFactRow[]; currency: CurrencyCode }> {
  const supabase = createServiceSupabase()
  const currency = await loadOrgCurrency(orgId)

  const products = await paginate<{ id: string; category: string | null }>((from, to) =>
    supabase.from('products').select('id, category').eq('org_id', orgId).not('stage', 'in', `(${ACTIVE_PRODUCT_STAGE_EXCLUSIONS.join(',')})`).range(from, to),
  )
  if (products.rows.length === 0) return { rows: [], currency }
  const categoryByProduct = new Map(products.rows.map((p) => [p.id, p.category]))
  const activeProductIds = new Set(products.rows.map((p) => p.id))

  const listings = await paginate<{ product_id: string; channel_id: string; price_minor: number | null; currency: string }>((from, to) =>
    supabase.from('channel_products').select('product_id, channel_id, price_minor, currency').eq('org_id', orgId).range(from, to),
  )
  const channels = await paginate<{ id: string; key: string }>((from, to) => supabase.from('channels').select('id, key').eq('org_id', orgId).range(from, to))
  const channelKeyById = new Map(channels.rows.map((c) => [c.id, c.key]))

  const offers = await paginate<{ product_id: string; unit_cost_minor: number; shipping_cost_minor: number; currency: string; is_preferred: boolean }>((from, to) =>
    supabase.from('supplier_products').select('product_id, unit_cost_minor, shipping_cost_minor, currency, is_preferred').eq('org_id', orgId).eq('is_preferred', true).range(from, to),
  )
  const offerByProduct = new Map(offers.rows.map((o) => [o.product_id, o]))

  const rows: ProductProfitFactRow[] = listings.rows
    .filter((l) => activeProductIds.has(l.product_id))
    .map((listing): ProductProfitFactRow | null => {
      const channelKey = channelKeyById.get(listing.channel_id)
      if (channelKey !== 'shopify' && channelKey !== 'amazon_uk') return null
      const offer = offerByProduct.get(listing.product_id)
      return {
        productId: listing.product_id, channel: channelKey, category: categoryByProduct.get(listing.product_id) ?? null,
        sellingPriceMinor: listing.price_minor, sellingPriceCurrency: listing.currency as CurrencyCode,
        productCostMinor: offer?.unit_cost_minor ?? null, productCostCurrency: (offer?.currency ?? listing.currency) as CurrencyCode,
        supplierShippingMinor: offer?.shipping_cost_minor ?? null,
      }
    })
    .filter((r): r is ProductProfitFactRow => r !== null)

  return { rows, currency }
}

export function toPriceCostInput(row: ProductProfitFactRow, minNetMarginPct: number): PriceCostInput {
  return {
    category: row.category, sellingPriceMinor: row.sellingPriceMinor, sellingPriceCurrency: row.sellingPriceCurrency,
    productCostMinor: row.productCostMinor, productCostCurrency: row.productCostCurrency, supplierShippingMinor: row.supplierShippingMinor,
    returnRatePct: 3, minNetMarginPct,
  }
}

/**
 * Every supplier's live operational facts plus whichever open-event flags
 * `monitoring/repository.ts` already computed — the caller passes those in
 * rather than this module re-querying `domain_events` a second time.
 *
 * The `suppliers` table itself carries no operational figures; those live
 * on `supplier_products` (dispatch/cancellation/fulfilment-success, added
 * by Milestone 3's `0013_supplier_connectors.sql`) and `supplier_connectors`
 * (feed health) — the exact same two sources
 * `automation/facts.ts`'s `loadSupplierOperationalFacts` already reads,
 * reused here rather than re-derived.
 */
export async function loadSupplierHealthFacts(
  orgId: string,
  openEventFlags: { suppliersWithDispatchDelays: readonly string[]; suppliersWithCancellationIncrease: readonly string[]; suppliersWithFeedProblems: readonly string[] },
): Promise<readonly SupplierHealthInput[]> {
  const supabase = createServiceSupabase()

  const suppliers = await paginate<{ id: string }>((from, to) => supabase.from('suppliers').select('id').eq('org_id', orgId).range(from, to))
  if (suppliers.rows.length === 0) return []
  const supplierIds = suppliers.rows.map((s) => s.id)

  const connectors = await paginate<{ supplier_id: string; status: string }>((from, to) =>
    supabase.from('supplier_connectors').select('supplier_id, status').eq('org_id', orgId).in('supplier_id', supplierIds).range(from, to),
  )
  const connectorStatusBySupplier = new Map(connectors.rows.map((c) => [c.supplier_id, c.status]))

  const operationalFacts = await paginate<{ supplier_id: string; cancellation_rate_pct: number | null; fulfilment_success_rate_pct: number | null }>((from, to) =>
    supabase.from('supplier_products').select('supplier_id, cancellation_rate_pct, fulfilment_success_rate_pct').eq('org_id', orgId).in('supplier_id', supplierIds).range(from, to),
  )
  const factsBySupplier = new Map<string, { cancellation_rate_pct: number | null; fulfilment_success_rate_pct: number | null }[]>()
  for (const row of operationalFacts.rows) {
    const list = factsBySupplier.get(row.supplier_id) ?? []
    list.push(row)
    factsBySupplier.set(row.supplier_id, list)
  }

  const average = (values: readonly number[]): number | null => values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100

  return suppliers.rows.map((s): SupplierHealthInput => {
    const ownFacts = factsBySupplier.get(s.id) ?? []
    const cancellationRates = ownFacts.map((f) => f.cancellation_rate_pct).filter((v): v is number => v !== null)
    const successRates = ownFacts.map((f) => f.fulfilment_success_rate_pct).filter((v): v is number => v !== null)
    const connectorStatus = connectorStatusBySupplier.get(s.id) ?? null

    return {
      supplierId: s.id,
      connectorStatus,
      connectorStatusKnown: connectorStatus !== null,
      hasDispatchDelayEvent: openEventFlags.suppliersWithDispatchDelays.includes(s.id),
      hasCancellationIncreaseEvent: openEventFlags.suppliersWithCancellationIncrease.includes(s.id),
      hasFeedProblemEvent: openEventFlags.suppliersWithFeedProblems.includes(s.id),
      cancellationRatePct: average(cancellationRates),
      fulfilmentSuccessRatePct: average(successRates),
    }
  })
}

export async function loadFulfilmentFacts(orgId: string, period: Period): Promise<readonly FulfilmentRecordFact[]> {
  const supabase = createServiceSupabase()

  const fulfilments = await paginate<{ id: string; status: string; submitted_at: string | null; shipped_at: string | null; delivered_at: string | null }>((from, to) =>
    supabase.from('fulfilments').select('id, status, submitted_at, shipped_at, delivered_at').eq('org_id', orgId).gte('created_at', period.start).lte('created_at', period.end).range(from, to),
  )
  if (fulfilments.rows.length === 0) return []

  const fulfilmentIds = fulfilments.rows.map((f) => f.id)
  const shipments = await paginate<{ fulfilment_id: string; tracking_number: string | null; promised_by: string | null }>((from, to) =>
    supabase.from('shipments').select('fulfilment_id, tracking_number, promised_by').eq('org_id', orgId).in('fulfilment_id', fulfilmentIds).range(from, to),
  )
  const shipmentByFulfilment = new Map(shipments.rows.map((s) => [s.fulfilment_id, s]))

  return fulfilments.rows.map((f): FulfilmentRecordFact => {
    const shipment = shipmentByFulfilment.get(f.id)
    return {
      status: f.status, submittedAt: f.submitted_at, shippedAt: f.shipped_at, deliveredAt: f.delivered_at,
      promisedBy: shipment?.promised_by ?? null, trackingNumber: shipment?.tracking_number ?? null,
    }
  })
}

export type ComplianceVerdictRow = { product_id: string; channel: string; verdict: ComplianceVerdict }

export async function loadComplianceRiskProductIds(orgId: string): Promise<readonly string[]> {
  const supabase = createServiceSupabase()
  const { rows } = await paginate<ComplianceVerdictRow>((from, to) =>
    supabase.from('compliance_records').select('product_id, channel, verdict').eq('org_id', orgId).in('verdict', ['fail', 'review_required']).range(from, to),
  )
  return [...new Set(rows.map((r) => r.product_id))]
}
