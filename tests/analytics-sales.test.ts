import { describe, expect, it } from 'vitest'
import { aggregateSalesWindow, resolvePeriod, type OrderLineFact } from '@/lib/orders/salesAggregation'
import { buildSalesAnalytics, emptySalesAnalytics, unavailableSalesAnalytics, resolveSalesAnalyticsSafely } from '@/lib/analytics/salesAnalytics'

const NOW = new Date('2026-08-24T09:00:00.000Z')

function line(orderId: string, placedAt: string, quantity: number, lineTotalMinor: number): OrderLineFact {
  return { orderId, orderStatus: 'fulfilled', orderSubtotalMinor: lineTotalMinor, placedAt, quantity, lineTotalMinor }
}

describe('buildSalesAnalytics', () => {
  it('wraps real aggregateSalesWindow output with a genuine previous-period comparison', () => {
    const period = resolvePeriod('last_7_days', NOW)
    const lines: OrderLineFact[] = [line('o1', '2026-08-20T00:00:00Z', 2, 4000), line('o2', '2026-08-21T00:00:00Z', 1, 1500)]
    const current = aggregateSalesWindow(lines, [], new Date(period.start), new Date(period.end))

    const prevPeriod = { key: period.key, label: 'previous', start: '2026-08-10T09:00:00.000Z', end: '2026-08-17T09:00:00.000Z' }
    const prevLines: OrderLineFact[] = [line('o0', '2026-08-11T00:00:00Z', 1, 1000)]
    const previous = aggregateSalesWindow(prevLines, [], new Date(prevPeriod.start), new Date(prevPeriod.end))

    const analytics = buildSalesAnalytics(current, previous, period, 'GBP')

    expect(analytics.revenue.value).toEqual({ minor: 5500, currency: 'GBP' })
    expect(analytics.revenue.status).toBe('fact')
    expect(analytics.revenue.comparison).toEqual({ current: 5500, previous: 1000, absoluteChange: 4500, percentChange: 450, direction: 'up' })
    expect(analytics.orders.value).toBe(2)
    expect(analytics.units.value).toBe(3)
  })

  it('a genuine zero-sales window is reported as a real fact, never as missing data', () => {
    const period = resolvePeriod('today', NOW)
    const analytics = emptySalesAnalytics(period, 'GBP')
    expect(analytics.revenue.value).toEqual({ minor: 0, currency: 'GBP' })
    expect(analytics.revenue.status).toBe('fact') // Not 'unknown' or 'unavailable' — this is a known zero.
    expect(analytics.orders.value).toBe(0)
  })

  it('unavailableSalesAnalytics marks every figure unavailable, distinct from a real zero', () => {
    const period = resolvePeriod('today', NOW)
    const analytics = unavailableSalesAnalytics(period, 'GBP', 'no live order data source configured')
    expect(analytics.revenue.status).toBe('unavailable')
    expect(analytics.revenue.value).toBeNull()
    expect(analytics.returnRatePct.status).toBe('unavailable')
  })

  it('an average order value with zero orders is not division by zero — reported as a real, explained figure', () => {
    const period = resolvePeriod('today', NOW)
    const analytics = emptySalesAnalytics(period, 'GBP')
    expect(analytics.averageOrderValue.value).toEqual({ minor: 0, currency: 'GBP' })
    expect(analytics.averageOrderValue.source).toContain('no orders')
  })

  it('return rate and refund rate are labelled derived, not fact — they depend on the documented refund-reason heuristic', () => {
    const period = resolvePeriod('today', NOW)
    const analytics = emptySalesAnalytics(period, 'GBP')
    expect(analytics.returnRatePct.status).toBe('derived')
    expect(analytics.refundRatePct.status).toBe('derived')
  })
})

describe('resolveSalesAnalyticsSafely (Milestone 11 currency-mixing gate)', () => {
  const period = resolvePeriod('last_30_days', NOW)
  const window = aggregateSalesWindow([line('o1', '2026-08-10T00:00:00Z', 5, 10000)], [], new Date(period.start), new Date(period.end))

  it('aggregates normally when no other currency was observed', () => {
    const result = resolveSalesAnalyticsSafely(window, null, period, 'GBP', [])
    expect(result.revenue.status).toBe('fact')
    expect(result.revenue.value).toEqual({ minor: 10000, currency: 'GBP' })
  })

  it('BUG-HUNT: never silently sums GBP and USD — every figure becomes unavailable, with both currencies named in the reason', () => {
    const result = resolveSalesAnalyticsSafely(window, null, period, 'GBP', ['USD'])
    expect(result.revenue.status).toBe('unavailable')
    expect(result.revenue.value).toBeNull()
    expect(result.revenue.source).toContain('GBP')
    expect(result.revenue.source).toContain('USD')
    expect(result.revenue.source).toContain('mixed currencies cannot be safely aggregated')
  })

  it('three or more currencies observed at once are all named, never silently dropped to one pair', () => {
    const result = resolveSalesAnalyticsSafely(window, null, period, 'GBP', ['USD', 'EUR'])
    expect(result.revenue.source).toContain('GBP')
    expect(result.revenue.source).toContain('USD')
    expect(result.revenue.source).toContain('EUR')
  })

  it('every figure — not just revenue — becomes unavailable on a currency mismatch, so nothing downstream can treat one metric as trustworthy while another silently is not', () => {
    const result = resolveSalesAnalyticsSafely(window, null, period, 'GBP', ['USD'])
    for (const metric of [result.revenue, result.netRevenue, result.orders, result.units, result.averageOrderValue, result.refundsValue, result.refundsCount, result.returnsCount, result.returnRatePct, result.refundRatePct, result.salesVelocityPerDay]) {
      expect(metric.status).toBe('unavailable')
      expect(metric.value).toBeNull()
    }
  })
})
