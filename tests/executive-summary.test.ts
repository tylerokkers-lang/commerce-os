import { describe, expect, it } from 'vitest'
import { buildExecutiveSummary } from '@/lib/analytics/executiveSummary'
import { emptySalesAnalytics } from '@/lib/analytics/salesAnalytics'
import { resolvePeriod } from '@/lib/orders/salesAggregation'
import { zero } from '@/lib/core/money'
import type { AnalyticsDashboard } from '@/lib/analytics/repository'
import type { ChannelAnalytics } from '@/lib/analytics/channelAnalytics'
import type { Metric } from '@/lib/analytics/types'

/**
 * Milestone 24 testability follow-up — `buildExecutiveSummary` was moved
 * out of `analytics/repository.ts` (`server-only`, cannot be imported
 * into Vitest at all — confirmed empirically: the `server-only` package
 * is not even installed as a real dependency here, so Node's own module
 * resolution fails immediately) into its own pure module
 * (`analytics/executiveSummary.ts`) specifically so this function's real
 * decision logic — the "best-known net margin across every channel with
 * a calculated projection" average, and when profit data counts as
 * "complete" — can be exercised directly, the same way every other
 * shared pure builder in this codebase already is. No business logic was
 * changed to make this possible.
 */

const NOW = '2026-08-26T09:00:00.000Z'
const PERIOD = resolvePeriod('last_30_days', new Date(NOW))
const CURRENCY = 'GBP'

function metric<T>(value: T | null, overrides: Partial<Metric<T>> = {}): Metric<T> {
  return { value, status: value === null ? 'unavailable' : 'calculated', source: 'test', ...overrides }
}

interface ChannelOverrides {
  channel?: ChannelAnalytics['channel']
  label?: string
  sales?: ChannelAnalytics['sales']
  profit?: Partial<ChannelAnalytics['profit']>
}

function channel(overrides: ChannelOverrides = {}): ChannelAnalytics {
  const { profit, ...rest } = overrides
  return {
    channel: 'amazon_uk',
    label: 'Amazon UK',
    sales: emptySalesAnalytics(PERIOD, CURRENCY),
    profit: {
      knownNetProfit: metric(zero(CURRENCY)),
      productsWithKnownProfit: 0,
      productsWithUnknownProfit: 0,
      averageNetMarginPct: metric<number>(null),
      ...profit,
    },
    ...rest,
  }
}

function dashboard(channels: readonly ChannelAnalytics[], salesOverrides: Partial<AnalyticsDashboard['sales']> = {}): AnalyticsDashboard {
  return {
    isDemo: false,
    period: PERIOD,
    sales: { ...emptySalesAnalytics(PERIOD, CURRENCY), ...salesOverrides },
    channels,
    topRevenueProducts: [], topProfitProducts: [], lossMakingProducts: [],
    supplierHealth: [], fulfilment: {} as never, advertising: {} as never,
    dataQuality: {} as never, alerts: [], marketReadiness: [],
    complianceRechecksRequired: 0, automationHealthKnown: false, demoScenarios: [],
  } as unknown as AnalyticsDashboard
}

describe('buildExecutiveSummary: known net margin averaging', () => {
  it('no channels at all -> knownNetMarginPct null, profitDataComplete false', () => {
    const summary = buildExecutiveSummary(dashboard([]))
    expect(summary.knownNetMarginPct).toBeNull()
    expect(summary.profitDataComplete).toBe(false)
  })

  it('a single channel with a fully known margin and no unknown products -> that margin, complete', () => {
    const summary = buildExecutiveSummary(dashboard([
      channel({ profit: { averageNetMarginPct: metric(20), productsWithUnknownProfit: 0 } }),
    ]))
    expect(summary.knownNetMarginPct).toBe(20)
    expect(summary.profitDataComplete).toBe(true)
  })

  it('a single channel with an unavailable margin -> null, never coerced to zero', () => {
    const summary = buildExecutiveSummary(dashboard([
      channel({ profit: { averageNetMarginPct: metric<number>(null, { status: 'unavailable' }) } }),
    ]))
    expect(summary.knownNetMarginPct).toBeNull()
    expect(summary.profitDataComplete).toBe(false)
  })

  it('two channels, both known -> the plain average, never a revenue-weighted one', () => {
    const summary = buildExecutiveSummary(dashboard([
      channel({ channel: 'amazon_uk', profit: { averageNetMarginPct: metric(10), productsWithUnknownProfit: 0 } }),
      channel({ channel: 'shopify', profit: { averageNetMarginPct: metric(30), productsWithUnknownProfit: 0 } }),
    ]))
    expect(summary.knownNetMarginPct).toBe(20)
    expect(summary.profitDataComplete).toBe(true)
  })

  it('one known, one unavailable channel -> averages only the known one, and profitDataComplete is false', () => {
    const summary = buildExecutiveSummary(dashboard([
      channel({ channel: 'amazon_uk', profit: { averageNetMarginPct: metric(20), productsWithUnknownProfit: 0 } }),
      channel({ channel: 'shopify', profit: { averageNetMarginPct: metric<number>(null), productsWithUnknownProfit: 3 } }),
    ]))
    expect(summary.knownNetMarginPct).toBe(20)
    expect(summary.profitDataComplete).toBe(false)
  })

  it('a channel with a known average margin but at least one product still unknown -> not complete', () => {
    const summary = buildExecutiveSummary(dashboard([
      channel({ profit: { averageNetMarginPct: metric(20), productsWithUnknownProfit: 2 } }),
    ]))
    expect(summary.knownNetMarginPct).toBe(20)
    expect(summary.profitDataComplete).toBe(false)
  })

  it('rounds the average to two decimal places, never a long float', () => {
    const summary = buildExecutiveSummary(dashboard([
      channel({ channel: 'amazon_uk', profit: { averageNetMarginPct: metric(10.111), productsWithUnknownProfit: 0 } }),
      channel({ channel: 'shopify', profit: { averageNetMarginPct: metric(10.116), productsWithUnknownProfit: 0 } }),
    ]))
    // (10.111 + 10.116) / 2 = 10.1135 -> rounded to 10.11 or 10.12 depending on float precision; must be exactly 2dp either way.
    expect(summary.knownNetMarginPct).toBe(Math.round(summary.knownNetMarginPct! * 100) / 100)
    expect(String(summary.knownNetMarginPct).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2)
  })
})

describe('buildExecutiveSummary: real fields pass through, never re-derived', () => {
  it('isDemo/periodLabel come straight from the dashboard, never guessed', () => {
    const analytics = dashboard([])
    const summary = buildExecutiveSummary(analytics)
    expect(summary.isDemo).toBe(analytics.isDemo)
    expect(summary.periodLabel).toBe(analytics.period.label)
  })

  it('sales figures (revenue/netRevenue/orders/averageOrderValue/refundsValue/refundRatePct/returnRatePct) are the exact same Metric objects, never rebuilt', () => {
    const analytics = dashboard([])
    const summary = buildExecutiveSummary(analytics)
    expect(summary.revenue).toBe(analytics.sales.revenue)
    expect(summary.netRevenue).toBe(analytics.sales.netRevenue)
    expect(summary.orders).toBe(analytics.sales.orders)
    expect(summary.averageOrderValue).toBe(analytics.sales.averageOrderValue)
    expect(summary.refundsValue).toBe(analytics.sales.refundsValue)
    expect(summary.refundRatePct).toBe(analytics.sales.refundRatePct)
    expect(summary.returnRatePct).toBe(analytics.sales.returnRatePct)
  })
})
