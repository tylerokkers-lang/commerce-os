import { add, zero, type CurrencyCode, type Money } from '@/lib/core/money'
import type { ChannelKey } from '@/lib/core/domain'
import type { SalesAnalytics } from './salesAnalytics'
import type { ProductChannelProfitAnalytics } from './profitAnalytics'
import { calculatedMetric, unknownMetric, type Metric } from './types'

/**
 * Channel / marketplace analytics (Milestone 10 §5). Composes
 * `salesAnalytics.ts` (realized sales, already channel-scoped by the live
 * loader via `orders.channel`) with `profitAnalytics.ts`'s per-product
 * projections — the point being to make a channel's genuinely different
 * economics visible (§5's "PRODUCT X: Amazon profitable, Shopify
 * unprofitable" example), never collapsed into one blended figure.
 */

export interface ChannelProfitRollup {
  /** Sum of every product's projected net profit on this channel, but ONLY over products whose projection is actually known. */
  knownNetProfit: Metric<Money>
  productsWithKnownProfit: number
  productsWithUnknownProfit: number
  averageNetMarginPct: Metric<number>
}

export interface ChannelAnalytics {
  channel: ChannelKey
  label: string
  sales: SalesAnalytics
  profit: ChannelProfitRollup
}

export function buildChannelProfitRollup(currency: CurrencyCode, productProjections: readonly ProductChannelProfitAnalytics[]): ChannelProfitRollup {
  const calculated = productProjections.filter((p) => p.projection.status === 'calculated' && p.projection.value !== null)
  // A product genuinely priced/costed in a different currency than the
  // rest of this channel (a data-entry mistake, or a channel that
  // genuinely sells in more than one currency) is never silently added in
  // — `money.ts`'s own `add` would throw `CurrencyMismatchError` if it
  // were, and even catching that would still be combining figures the
  // brief's currency-safety rule forbids combining. It is excluded from
  // the sum and counted separately, never crashing the whole rollup.
  const known = calculated.filter((p) => p.projection.value!.profitability.netProfit.currency === currency)
  const mismatchedCurrencyCount = calculated.length - known.length
  const unknownCount = productProjections.length - calculated.length + mismatchedCurrencyCount

  if (known.length === 0) {
    return {
      knownNetProfit: unknownMetric(
        productProjections.length === 0
          ? 'no products listed on this channel'
          : mismatchedCurrencyCount > 0
            ? `every priced product on this channel is in a different currency than ${currency} — never combined without an explicit FX conversion`
            : 'no product on this channel has both a known price and a known cost',
      ),
      productsWithKnownProfit: 0, productsWithUnknownProfit: unknownCount,
      averageNetMarginPct: unknownMetric('no product on this channel has a known, same-currency projection'),
    }
  }

  const totalProfit = known.reduce((sum, p) => add(sum, p.projection.value!.profitability.netProfit), zero(currency))
  const marginSum = known.reduce((sum, p) => sum + (p.projection.value!.profitability.netMarginPct ?? 0), 0)

  return {
    knownNetProfit: calculatedMetric(totalProfit, `sum of projected net profit across ${known.length} of ${productProjections.length} products with known, same-currency price and cost`),
    productsWithKnownProfit: known.length,
    productsWithUnknownProfit: unknownCount,
    averageNetMarginPct: calculatedMetric(Math.round((marginSum / known.length) * 100) / 100, `average across the same ${known.length} products`),
  }
}

export function buildChannelAnalytics(channel: ChannelKey, label: string, sales: SalesAnalytics, productProjections: readonly ProductChannelProfitAnalytics[]): ChannelAnalytics {
  return { channel, label, sales, profit: buildChannelProfitRollup(sales.currency, productProjections) }
}
