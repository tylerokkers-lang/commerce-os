import type { ChannelKey } from '@/lib/core/domain'

/**
 * Product intelligence (Milestone 10 §4) — deterministic classification
 * from facts already computed elsewhere (sales analytics, profit
 * analytics, and the existing Milestone 8/8.5 monitoring intelligence
 * drill-downs), never an invented score. A product can carry several tags
 * at once (a product can be both `high_margin` and `declining_sales`), and
 * every tag is only ever set from a concrete threshold crossing or a real
 * open event — nothing here guesses.
 */

export type ProductClassificationTag =
  | 'top_revenue' | 'top_profit' | 'high_margin' | 'low_margin' | 'loss_making'
  | 'declining_sales' | 'growing_sales' | 'high_refund_rate'
  | 'supplier_risk' | 'stock_risk' | 'compliance_risk' | 'channel_opportunity'

export interface ProductClassificationThresholds {
  topRankCount: number
  highMarginPct: number
  lowMarginPct: number
  growingSalesPct: number
  decliningSalesPct: number
  highRefundRatePct: number
}

export const DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS: ProductClassificationThresholds = {
  topRankCount: 5, highMarginPct: 30, lowMarginPct: 10, growingSalesPct: 25, decliningSalesPct: -25, highRefundRatePct: 8,
}

export interface ProductClassificationInput {
  productId: string
  /** 1-based rank by revenue/profit this period, only when the caller has ranked the whole catalogue — undefined means "not ranked," never treated as rank 0. */
  revenueRank?: number
  profitRank?: number
  /** The best-performing channel's net margin, when at least one channel's projection is known. */
  bestKnownNetMarginPct: number | null
  /** Whether EVERY channel this product is listed on is currently loss-making — distinct from "we don't know," which never sets this tag. */
  lossMakingOnAllKnownChannels: boolean
  revenueChangePct: number | null
  refundRatePct: number | null
  hasSupplierRiskEvent: boolean
  hasStockRiskEvent: boolean
  hasComplianceRiskEvent: boolean
  /** True when at least one listed channel is profitable and at least one other real market/channel the catalogue knows about is not yet listed — a genuine, evidence-backed expansion candidate, never a guess. */
  hasUnexploitedProfitableChannel: boolean
}

export function classifyProduct(
  input: ProductClassificationInput,
  thresholds: ProductClassificationThresholds = DEFAULT_PRODUCT_CLASSIFICATION_THRESHOLDS,
): readonly ProductClassificationTag[] {
  const tags: ProductClassificationTag[] = []

  if (input.revenueRank !== undefined && input.revenueRank <= thresholds.topRankCount) tags.push('top_revenue')
  if (input.profitRank !== undefined && input.profitRank <= thresholds.topRankCount) tags.push('top_profit')

  if (input.bestKnownNetMarginPct !== null) {
    if (input.bestKnownNetMarginPct >= thresholds.highMarginPct) tags.push('high_margin')
    else if (input.bestKnownNetMarginPct < thresholds.lowMarginPct) tags.push('low_margin')
  }
  if (input.lossMakingOnAllKnownChannels) tags.push('loss_making')

  if (input.revenueChangePct !== null) {
    if (input.revenueChangePct >= thresholds.growingSalesPct) tags.push('growing_sales')
    else if (input.revenueChangePct <= thresholds.decliningSalesPct) tags.push('declining_sales')
  }

  if (input.refundRatePct !== null && input.refundRatePct >= thresholds.highRefundRatePct) tags.push('high_refund_rate')

  if (input.hasSupplierRiskEvent) tags.push('supplier_risk')
  if (input.hasStockRiskEvent) tags.push('stock_risk')
  if (input.hasComplianceRiskEvent) tags.push('compliance_risk')
  if (input.hasUnexploitedProfitableChannel) tags.push('channel_opportunity')

  return tags
}

/** True only when a product's profitability projection is known and unprofitable on every channel it was checked against — never true from an empty or all-unknown list. */
export function isLossMakingOnAllKnownChannels(channelResults: readonly { channel: ChannelKey; knownNetProfitMinor: number | null }[]): boolean {
  const known = channelResults.filter((r) => r.knownNetProfitMinor !== null)
  if (known.length === 0) return false
  return known.every((r) => (r.knownNetProfitMinor as number) <= 0)
}
