import { buildChannelProfiles, projectChannel, type ChannelProjection } from '@/lib/profitability/channels'
import type { Money } from '@/lib/core/money'
import type { ChannelKey } from '@/lib/core/domain'
import { unavailableMetric, unknownMetric, type Metric } from './types'

/**
 * Profit analytics (Milestone 10 §3) — never a second margin calculator.
 * Every figure here comes from `calculateProfitability` (via
 * `profitability/channels.ts`'s existing channel-cost-profile assembly),
 * the exact function `/opportunities/[id]`'s "Profitability by channel"
 * section and `profitabilityMonitor.ts`'s real-margin check both already
 * call. This module's only job is deciding whether there is enough real
 * price/cost data to call it at all, and labelling the result honestly
 * when there is not.
 *
 * This is a *current* projection (today's price and cost run through the
 * engine), not a reconstructed historical P&L — the same convention every
 * other profitability view in this codebase already follows, because
 * `order_items.unit_cost_minor` is only populated where a sale's real cost
 * was actually captured, and inventing one where it was not would be
 * exactly the failure mode `docs/PRINCIPLES.md` §1 forbids. Where realized
 * figures ARE wanted (revenue actually taken, refunds actually issued),
 * `salesAnalytics.ts` already supplies them as their own, separately
 * labelled facts — this module does not duplicate them.
 */

export interface ProductChannelProfitAnalytics {
  productId: string
  channel: ChannelKey
  sellingPrice: Metric<Money>
  productCost: Metric<Money>
  /** The full engine output — every cost line, margins, break-even — never recomputed here. */
  projection: Metric<ChannelProjection>
}

export interface PriceCostInput {
  category: string | null
  sellingPriceMinor: number | null
  sellingPriceCurrency: Money['currency']
  productCostMinor: number | null
  /** `supplier_products.currency` — checked against `sellingPriceCurrency` below; the two are never assumed to match just because both default to GBP in the schema. */
  productCostCurrency: Money['currency']
  supplierShippingMinor: number | null
  returnRatePct: number
  minNetMarginPct: number
}

/** Builds one channel's profit analytics from already-loaded facts — the live loader decides whether those facts are fresh enough to pass in at all. */
export function buildProductChannelProfitAnalytics(
  productId: string,
  channel: ChannelKey,
  input: PriceCostInput | null,
): ProductChannelProfitAnalytics {
  if (!input || input.sellingPriceMinor === null) {
    return {
      productId, channel,
      sellingPrice: unavailableMetric('no live channel listing price on file'),
      productCost: input?.productCostMinor === null || input?.productCostMinor === undefined ? unavailableMetric('no live supplier cost on file') : { value: { minor: input.productCostMinor, currency: input.sellingPriceCurrency }, status: 'fact', source: 'supplier_products.unit_cost_minor', asOf: null },
      projection: unavailableMetric('cannot project profitability without a listing price'),
    }
  }

  const sellingPrice: Money = { minor: input.sellingPriceMinor, currency: input.sellingPriceCurrency }
  const sellingPriceMetric: Metric<Money> = { value: sellingPrice, status: 'fact', source: 'channel_products.price_minor', asOf: null }

  if (input.productCostMinor === null) {
    return {
      productId, channel, sellingPrice: sellingPriceMetric,
      productCost: unavailableMetric('no live supplier cost on file'),
      projection: unknownMetric('cannot project profitability without a known product cost — showing it as zero would understate every cost line below it'),
    }
  }

  // The supplier's cost currency and the channel's listing currency are
  // never assumed to match — a market/channel priced in USD against a
  // GBP-quoted supplier cost is exactly the currency-mixing failure
  // `docs/PRINCIPLES.md`'s money rules (and Milestone 9's FX safety work)
  // forbid. Where they genuinely differ, this module reports the mismatch
  // rather than silently combining them or crashing on `money.ts`'s own
  // `CurrencyMismatchError`.
  if (input.productCostCurrency !== input.sellingPriceCurrency) {
    return {
      productId, channel, sellingPrice: sellingPriceMetric,
      productCost: { value: { minor: input.productCostMinor, currency: input.productCostCurrency }, status: 'fact', source: 'supplier_products.unit_cost_minor', asOf: null },
      projection: unavailableMetric(`supplier cost is in ${input.productCostCurrency} but the channel lists in ${input.sellingPriceCurrency} — an explicit FX conversion is required and none was supplied here`),
    }
  }

  const productCost: Money = { minor: input.productCostMinor, currency: input.sellingPriceCurrency }
  const supplierShipping: Money = { minor: input.supplierShippingMinor ?? 0, currency: input.sellingPriceCurrency }

  const profile = buildChannelProfiles({ category: input.category, sellingPrice }).find((p) => p.channel === channel)
  if (!profile) {
    return {
      productId, channel, sellingPrice: sellingPriceMetric,
      productCost: { value: productCost, status: 'fact', source: 'supplier_products.unit_cost_minor', asOf: null },
      projection: unavailableMetric(`no cost profile exists for channel "${channel}"`),
    }
  }

  const projection = projectChannel(
    { sellingPrice, productCost, supplierShipping, returnRatePct: input.returnRatePct, vatRatePct: 20 },
    profile,
    { minGrossMarginPct: 0, minNetMarginPct: input.minNetMarginPct },
  )
  // `projectChannel` already calls `assessProfitabilityGate` internally
  // (its `.gate` field) — this module never reimplements that check either.
  return {
    productId, channel,
    sellingPrice: sellingPriceMetric,
    productCost: { value: productCost, status: 'fact', source: 'supplier_products.unit_cost_minor', asOf: null },
    projection: { value: projection, status: 'calculated', source: 'profitability/channels.ts projectChannel (the one profitability engine)', asOf: null },
  }
}
