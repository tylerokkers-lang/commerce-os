import { describe, expect, it } from 'vitest'
import { aggregateSalesWindow, computeWindowBounds, SALES_WINDOW_HOURS, type OrderLineFact, type RefundFact } from '@/lib/orders/salesAggregation'

const WINDOW_START = new Date('2026-08-17T00:00:00Z')
const WINDOW_END = new Date('2026-08-24T00:00:00Z') // 7 days

function line(overrides: Partial<OrderLineFact> = {}): OrderLineFact {
  return { orderId: 'order-1', orderStatus: 'fulfilled', orderSubtotalMinor: 1000, placedAt: '2026-08-20T00:00:00Z', quantity: 1, lineTotalMinor: 1000, ...overrides }
}

function refund(overrides: Partial<RefundFact> = {}): RefundFact {
  return { orderId: 'order-1', amountMinor: 200, isReturn: true, createdAt: '2026-08-20T00:00:00Z', ...overrides }
}

describe('aggregateSalesWindow', () => {
  it('zero sales aggregates to honest zeros, not a gap', () => {
    const result = aggregateSalesWindow([], [], WINDOW_START, WINDOW_END)
    expect(result).toMatchObject({ unitsSold: 0, ordersCount: 0, grossRevenueMinor: 0, refundsMinor: 0, refundsCount: 0, returnsCount: 0, netRevenueMinor: 0, averageOrderValueMinor: null, salesVelocityPerDay: 0 })
  })

  it('a single sale aggregates correctly', () => {
    const result = aggregateSalesWindow([line({ quantity: 3, lineTotalMinor: 3000 })], [], WINDOW_START, WINDOW_END)
    expect(result.unitsSold).toBe(3)
    expect(result.ordersCount).toBe(1)
    expect(result.grossRevenueMinor).toBe(3000)
    expect(result.netRevenueMinor).toBe(3000)
    expect(result.averageOrderValueMinor).toBe(3000)
    expect(result.salesVelocityPerDay).toBeCloseTo(3 / 7, 2)
  })

  it('multiple sales across multiple orders aggregate units and revenue correctly, one order counted once', () => {
    const result = aggregateSalesWindow(
      [line({ orderId: 'o1', quantity: 2, lineTotalMinor: 2000 }), line({ orderId: 'o1', quantity: 1, lineTotalMinor: 500 }), line({ orderId: 'o2', quantity: 5, lineTotalMinor: 5000 })],
      [], WINDOW_START, WINDOW_END,
    )
    expect(result.unitsSold).toBe(8)
    expect(result.ordersCount).toBe(2) // Two order items in o1 count as one order.
    expect(result.grossRevenueMinor).toBe(7500)
    expect(result.averageOrderValueMinor).toBe(3750)
  })

  it('a full refund reduces net revenue but never the gross figure or units sold', () => {
    const result = aggregateSalesWindow([line({ lineTotalMinor: 1000 })], [refund({ amountMinor: 1000 })], WINDOW_START, WINDOW_END)
    expect(result.unitsSold).toBe(1) // The sale genuinely happened.
    expect(result.grossRevenueMinor).toBe(1000)
    expect(result.netRevenueMinor).toBe(0)
    expect(result.refundsMinor).toBe(1000)
    expect(result.refundsCount).toBe(1)
  })

  it('distinguishes returns from non-return refunds (pricing_error is not counted as a return)', () => {
    const result = aggregateSalesWindow(
      [line()],
      [refund({ isReturn: true }), refund({ isReturn: false })], // e.g. a faulty-item refund and a pricing_error refund.
      WINDOW_START, WINDOW_END,
    )
    expect(result.refundsCount).toBe(2)
    expect(result.returnsCount).toBe(1)
  })

  it('an order outside the window is excluded even if it matches every other criterion', () => {
    const result = aggregateSalesWindow([line({ placedAt: '2026-08-01T00:00:00Z' })], [], WINDOW_START, WINDOW_END)
    expect(result.unitsSold).toBe(0)
  })

  it('a refund outside the window is excluded even when its order is inside the window', () => {
    const result = aggregateSalesWindow([line()], [refund({ createdAt: '2026-09-01T00:00:00Z' })], WINDOW_START, WINDOW_END)
    expect(result.refundsMinor).toBe(0)
  })

  it('pending and failed orders are never counted as sales', () => {
    const result = aggregateSalesWindow([line({ orderStatus: 'pending' }), line({ orderId: 'o2', orderStatus: 'failed' }), line({ orderId: 'o3', orderStatus: 'cancelled' })], [], WINDOW_START, WINDOW_END)
    expect(result.unitsSold).toBe(0)
    expect(result.ordersCount).toBe(0)
  })

  it('a refunded order still counts its original units and revenue as a genuine sale', () => {
    const result = aggregateSalesWindow([line({ orderStatus: 'refunded', lineTotalMinor: 1000 })], [], WINDOW_START, WINDOW_END)
    expect(result.unitsSold).toBe(1)
    expect(result.grossRevenueMinor).toBe(1000)
  })
})

describe('computeWindowBounds', () => {
  it('the current and previous windows are equal-length and adjacent, never overlapping', () => {
    const now = new Date('2026-08-24T00:00:00Z')
    const { current, previous } = computeWindowBounds(now, SALES_WINDOW_HOURS['7d'])
    expect(current.end.getTime()).toBe(now.getTime())
    expect(current.start.getTime()).toBe(previous.end.getTime()) // Adjacent, not overlapping.
    expect(current.end.getTime() - current.start.getTime()).toBe(previous.end.getTime() - previous.start.getTime())
    expect(current.end.getTime() - current.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('supports 24h, 30d, and arbitrary custom-hour windows with the correct lengths', () => {
    const now = new Date('2026-08-24T00:00:00Z')
    expect(computeWindowBounds(now, SALES_WINDOW_HOURS['24h']).current.end.getTime() - computeWindowBounds(now, SALES_WINDOW_HOURS['24h']).current.start.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(computeWindowBounds(now, SALES_WINDOW_HOURS['30d']).current.end.getTime() - computeWindowBounds(now, SALES_WINDOW_HOURS['30d']).current.start.getTime()).toBe(30 * 24 * 60 * 60 * 1000)
    expect(computeWindowBounds(now, 72).current.end.getTime() - computeWindowBounds(now, 72).current.start.getTime()).toBe(72 * 60 * 60 * 1000) // A configured custom window (e.g. 3 days) works identically.
  })
})
