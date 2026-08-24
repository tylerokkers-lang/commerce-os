/**
 * Real sales/performance aggregation (Milestone 8.5 §3), built on the
 * existing `orders`/`order_items`/`refunds` tables from Milestone 5 — no
 * new schema, no invented popularity metric. This module never assumes a
 * value where the source data does not exist: an order in a status that
 * never became a genuine sale (`pending`, `failed`) is excluded, and a
 * product with zero matching order lines simply aggregates to zero, which
 * is a fact ("no sales in this window"), not a gap papered over.
 *
 * Kept pure and DB-free on purpose — the aggregation arithmetic is the part
 * worth unit-testing without a live Supabase project; the query that
 * assembles `OrderLineFact`/`RefundFact` rows lives in
 * `monitoring/liveSubjects.ts`, the one server-only caller.
 */

/** Order statuses that represent a genuine sale, even if later refunded — a refund is tracked separately, not by pretending the sale never happened. */
export const COUNTED_ORDER_STATUSES = new Set([
  'paid', 'awaiting_fulfilment', 'partially_fulfilled', 'fulfilled', 'delivered', 'refunded', 'partially_refunded',
])

export interface OrderLineFact {
  orderId: string
  orderStatus: string
  /** The order's own subtotal, used only to allocate a whole-order refund proportionally across its lines. */
  orderSubtotalMinor: number
  placedAt: string
  quantity: number
  lineTotalMinor: number
}

export interface RefundFact {
  orderId: string
  amountMinor: number
  /**
   * Whether this refund reflects a physical return, as best the recorded
   * `refund_reason` can tell (see `REFUND_REASONS_COUNTED_AS_RETURNS`) —
   * distinct from "refunds", which counts every refund regardless of
   * reason. This is a documented heuristic, not a claim of certainty.
   */
  isReturn: boolean
  createdAt: string
}

/** `pricing_error` and `goodwill` refunds never involved the product coming back; every other reason plausibly does. */
export const REFUND_REASONS_COUNTED_AS_RETURNS = new Set([
  'customer_changed_mind', 'damaged', 'not_as_described', 'not_delivered', 'late_delivery', 'faulty',
])

export interface SalesWindowMetrics {
  unitsSold: number
  ordersCount: number
  grossRevenueMinor: number
  refundsMinor: number
  refundsCount: number
  returnsCount: number
  netRevenueMinor: number
  averageOrderValueMinor: number | null
  /** Units sold per day across the window — comparable across windows of different lengths. */
  salesVelocityPerDay: number
  /** No live advertising-spend data source exists in this codebase yet — always 0, never guessed. Kept for `PerformanceWindow` compatibility. */
  adSpendMinor: number
  windowStart: string
  windowEnd: string
}

/**
 * Aggregates pre-fetched, already-scoped (one product, one channel, one
 * org) rows into the window metrics the performance monitor compares.
 * `windowStart`/`windowEnd` bound which `lines`/`refunds` are included by
 * `placedAt`/`createdAt` respectively — the caller decides the window
 * length (24h/7d/30d/custom); this function only does the arithmetic.
 */
export function aggregateSalesWindow(
  lines: readonly OrderLineFact[],
  refunds: readonly RefundFact[],
  windowStart: Date,
  windowEnd: Date,
): SalesWindowMetrics {
  const startMs = windowStart.getTime()
  const endMs = windowEnd.getTime()

  const linesInWindow = lines.filter((l) => {
    const t = new Date(l.placedAt).getTime()
    return t >= startMs && t < endMs && COUNTED_ORDER_STATUSES.has(l.orderStatus)
  })
  const refundsInWindow = refunds.filter((r) => {
    const t = new Date(r.createdAt).getTime()
    return t >= startMs && t < endMs
  })

  const unitsSold = linesInWindow.reduce((sum, l) => sum + l.quantity, 0)
  const grossRevenueMinor = linesInWindow.reduce((sum, l) => sum + l.lineTotalMinor, 0)
  const orderIds = new Set(linesInWindow.map((l) => l.orderId))
  const ordersCount = orderIds.size

  const refundsMinor = refundsInWindow.reduce((sum, r) => sum + r.amountMinor, 0)
  const refundsCount = refundsInWindow.length
  const returnsCount = refundsInWindow.filter((r) => r.isReturn).length

  const netRevenueMinor = grossRevenueMinor - refundsMinor
  const averageOrderValueMinor = ordersCount === 0 ? null : Math.round(grossRevenueMinor / ordersCount)

  const windowDays = Math.max((endMs - startMs) / (1000 * 60 * 60 * 24), 1 / 24) // Floor at one hour to avoid division by a near-zero window.
  const salesVelocityPerDay = Math.round((unitsSold / windowDays) * 100) / 100

  return {
    unitsSold, ordersCount, grossRevenueMinor, refundsMinor, refundsCount, returnsCount, netRevenueMinor,
    averageOrderValueMinor, salesVelocityPerDay, adSpendMinor: 0,
    windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(),
  }
}

export type SalesWindowLength = '24h' | '7d' | '30d'

/** Named presets for the common cases the brief calls out; `computeWindowBounds` itself takes a raw hour count so a configured custom window works identically. */
export const SALES_WINDOW_HOURS: Record<SalesWindowLength, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }

/** The current window is [now - windowHours, now); the previous is the same length immediately before it — a genuine period-over-period comparison, not an arbitrary pair of dates. */
export function computeWindowBounds(now: Date, windowHours: number): { current: { start: Date; end: Date }; previous: { start: Date; end: Date } } {
  const windowMs = windowHours * 60 * 60 * 1000
  const currentEnd = now
  const currentStart = new Date(now.getTime() - windowMs)
  const previousEnd = currentStart
  const previousStart = new Date(currentStart.getTime() - windowMs)
  return { current: { start: currentStart, end: currentEnd }, previous: { start: previousStart, end: previousEnd } }
}
