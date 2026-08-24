import { comparePeriods } from '@/lib/core/compare'
import { money, type CurrencyCode, type Money } from '@/lib/core/money'
import type { Period, SalesWindowMetrics } from '@/lib/orders/salesAggregation'
import { unavailableMetric, type Metric, type PeriodMetric } from './types'

/**
 * Sales analytics (Milestone 10 §2) — a thin, fact-first wrapper around
 * `orders/salesAggregation.ts`'s existing `aggregateSalesWindow`, never a
 * second aggregation engine. The live loader (`analytics/liveAnalyticsFacts.ts`)
 * calls `aggregateSalesWindow` twice — once for the requested period, once
 * for `previousEquivalentPeriod`'s bounds — and this module only wraps
 * those two already-real results into the labelled, comparison-bearing
 * shape the dashboard renders.
 */

export interface SalesAnalytics {
  period: Period
  currency: CurrencyCode
  revenue: PeriodMetric<Money>
  netRevenue: PeriodMetric<Money>
  orders: PeriodMetric<number>
  units: PeriodMetric<number>
  averageOrderValue: PeriodMetric<Money>
  refundsValue: PeriodMetric<Money>
  refundsCount: PeriodMetric<number>
  returnsCount: PeriodMetric<number>
  /** Incidents per unit sold, the same "returns per unit" shape `performanceMonitor.ts` already uses — a derived rate, not a directly observed fact. */
  returnRatePct: PeriodMetric<number>
  refundRatePct: PeriodMetric<number>
  salesVelocityPerDay: Metric<number>
}

function periodMetric<T>(current: T, previousComparable: number | null, currentComparable: number, period: Period, source: string, status: PeriodMetric<T>['status'] = 'fact'): PeriodMetric<T> {
  return {
    value: current, status, source, asOf: period.end,
    period, comparison: previousComparable === null ? null : comparePeriods(currentComparable, previousComparable),
  }
}

/** No sales activity in a window is a genuine fact ("nothing sold"), never treated as missing data — see `docs/PRINCIPLES.md` §1's "empty is not the same as unknown." */
export function buildSalesAnalytics(
  current: SalesWindowMetrics,
  previous: SalesWindowMetrics | null,
  period: Period,
  currency: CurrencyCode,
): SalesAnalytics {
  const currentReturnRatePct = current.unitsSold > 0 ? (current.returnsCount / current.unitsSold) * 100 : 0
  const previousReturnRatePct = previous && previous.unitsSold > 0 ? (previous.returnsCount / previous.unitsSold) * 100 : previous ? 0 : null
  const currentRefundRatePct = current.unitsSold > 0 ? (current.refundsCount / current.unitsSold) * 100 : 0
  const previousRefundRatePct = previous && previous.unitsSold > 0 ? (previous.refundsCount / previous.unitsSold) * 100 : previous ? 0 : null

  return {
    period,
    currency,
    revenue: periodMetric(money(current.grossRevenueMinor, currency), previous?.grossRevenueMinor ?? null, current.grossRevenueMinor, period, 'orders/order_items, gross of refunds'),
    netRevenue: periodMetric(money(current.netRevenueMinor, currency), previous?.netRevenueMinor ?? null, current.netRevenueMinor, period, 'orders/order_items less refunds recorded in this window'),
    orders: periodMetric(current.ordersCount, previous?.ordersCount ?? null, current.ordersCount, period, 'distinct orders with at least one counted line item'),
    units: periodMetric(current.unitsSold, previous?.unitsSold ?? null, current.unitsSold, period, 'order_items.quantity, counted-status orders only'),
    averageOrderValue: periodMetric(
      money(current.averageOrderValueMinor ?? 0, currency),
      previous?.averageOrderValueMinor ?? null,
      current.averageOrderValueMinor ?? 0,
      period,
      current.ordersCount === 0 ? 'no orders in this period' : 'gross revenue / order count',
    ),
    refundsValue: periodMetric(money(current.refundsMinor, currency), previous?.refundsMinor ?? null, current.refundsMinor, period, 'refunds.amount_minor recorded in this window'),
    refundsCount: periodMetric(current.refundsCount, previous?.refundsCount ?? null, current.refundsCount, period, 'refunds rows recorded in this window'),
    returnsCount: periodMetric(current.returnsCount, previous?.returnsCount ?? null, current.returnsCount, period, 'refunds whose reason plausibly reflects a physical return — see REFUND_REASONS_COUNTED_AS_RETURNS'),
    returnRatePct: periodMetric(currentReturnRatePct, previousReturnRatePct, currentReturnRatePct, period, 'returns / units sold — a documented heuristic, not every refund reason implies a return', 'derived'),
    refundRatePct: periodMetric(currentRefundRatePct, previousRefundRatePct, currentRefundRatePct, period, 'refunds / units sold', 'derived'),
    salesVelocityPerDay: { value: current.salesVelocityPerDay, status: 'calculated', source: 'units sold / period length in days', asOf: period.end },
  }
}

/** The honest empty state for an org with genuinely no order data yet — zeros are a fact here, not a fallback. */
export function emptySalesAnalytics(period: Period, currency: CurrencyCode): SalesAnalytics {
  const empty: SalesWindowMetrics = {
    unitsSold: 0, ordersCount: 0, grossRevenueMinor: 0, refundsMinor: 0, refundsCount: 0, returnsCount: 0,
    netRevenueMinor: 0, averageOrderValueMinor: null, salesVelocityPerDay: 0, adSpendMinor: 0, windowStart: period.start, windowEnd: period.end,
  }
  return buildSalesAnalytics(empty, null, period, currency)
}

export function unavailableSalesAnalytics(period: Period, currency: CurrencyCode, reason: string): SalesAnalytics {
  const base = emptySalesAnalytics(period, currency)
  const asUnavailable = <T>(m: PeriodMetric<T>): PeriodMetric<T> => ({ ...m, status: 'unavailable', value: null, source: reason })
  return {
    ...base,
    revenue: asUnavailable(base.revenue), netRevenue: asUnavailable(base.netRevenue), orders: asUnavailable(base.orders),
    units: asUnavailable(base.units), averageOrderValue: asUnavailable(base.averageOrderValue), refundsValue: asUnavailable(base.refundsValue),
    refundsCount: asUnavailable(base.refundsCount), returnsCount: asUnavailable(base.returnsCount),
    returnRatePct: asUnavailable(base.returnRatePct), refundRatePct: asUnavailable(base.refundRatePct), salesVelocityPerDay: unavailableMetric(reason),
  }
}

/**
 * The one currency-safety gate every sales-analytics call site goes
 * through (Milestone 11 §5/§8's explicit "never silently mix currencies"
 * requirement) — `aggregateSalesWindow` itself has no currency awareness
 * at all, so a caller that observed more than one currency in the same
 * window (a real fact from `orders.currency`, never assumed) must report
 * `unavailable` rather than sum. Pure and exported specifically so this
 * decision is unit-testable without a live database, unlike the
 * `server-only` repository code that calls it.
 */
export function resolveSalesAnalyticsSafely(
  current: SalesWindowMetrics,
  previous: SalesWindowMetrics | null,
  period: Period,
  currency: CurrencyCode,
  otherCurrenciesObserved: readonly CurrencyCode[],
): SalesAnalytics {
  if (otherCurrenciesObserved.length === 0) return buildSalesAnalytics(current, previous, period, currency)
  const reason = `Unavailable — mixed currencies cannot be safely aggregated (found ${[currency, ...otherCurrenciesObserved].join(', ')}).`
  return unavailableSalesAnalytics(period, currency, reason)
}
