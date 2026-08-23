import { fromMajor, money, zero, type Money } from '@/lib/core/money'
import {
  assessProfitabilityGate,
  calculateProfitability,
  type CostInputs,
  type Profitability,
  type ProfitabilityGate,
} from '@/lib/profitability'
import type { ChannelKey } from '@/lib/core/domain'

/**
 * Channel-aware profitability (§25).
 *
 * This module does not calculate margin. It assembles the cost assumptions
 * that differ between Shopify and Amazon and hands them to the one
 * profitability engine in `@/lib/profitability`. There is exactly one place in
 * this system where revenue turns into profit, and this is not it.
 *
 * The point of separating the two is that the same product frequently passes
 * on one channel and fails on the other: Amazon takes a referral fee on the
 * gross price where Shopify takes a much smaller payment fee, but Shopify
 * carries the traffic cost that Amazon partly supplies.
 */

/** Version stamped onto stored projections so old ones can be identified. */
export const ENGINE_VERSION = 'channel-profitability@1'

/**
 * Amazon UK referral fee percentages by category.
 *
 * Seed values only. Amazon changes these, so they are written into
 * `config_values` for a live business and read from there. Never treat this
 * object as authoritative for a real fee calculation once the SP-API is
 * connected and the actual fee preview is available.
 */
export const AMAZON_REFERRAL_PCT_BY_CATEGORY: Readonly<Record<string, number>> = {
  'Home Office': 15,
  Kitchen: 15,
  Storage: 15,
  Bedroom: 15,
  Cleaning: 15,
  Laundry: 15,
  Electronics: 8,
  'Computers': 7,
  'Personal Care': 15,
  Toys: 15,
  default: 15,
}

/** Amazon UK applies a minimum referral fee per item in most categories. */
export const AMAZON_MINIMUM_REFERRAL = fromMajor(0.25)

export interface ChannelCostProfile {
  channel: ChannelKey
  label: string
  channelFeePct: number
  channelFeeFixed: Money
  paymentFeePct: number
  paymentFeeFixed: Money
  /** Pick, pack and dispatch cost per unit on this channel. */
  fulfilment: Money
  /** Advertising we expect to attribute to one unit sold on this channel. */
  adSpendPerUnit: Money
  /** How the numbers above were arrived at, shown beside the projection. */
  notes: readonly string[]
}

export interface ChannelProfileInput {
  category: string | null
  sellingPrice: Money
  /** True when the product would be fulfilled by Amazon rather than by us. */
  amazonFba?: boolean
  /**
   * Expected advertising cost per unit. Defaults are deliberately pessimistic:
   * a new product buys most of its early traffic.
   */
  shopifyAdSpendPerUnit?: Money
  amazonAdSpendPerUnit?: Money
}

/**
 * Builds the cost profile for each channel.
 *
 * Amazon's referral fee is category-dependent and subject to a per-item
 * minimum; Shopify's cost is payment processing plus the traffic we buy
 * ourselves.
 */
export function buildChannelProfiles(input: ChannelProfileInput): readonly ChannelCostProfile[] {
  const currency = input.sellingPrice.currency
  const referralPct =
    AMAZON_REFERRAL_PCT_BY_CATEGORY[input.category ?? 'default'] ??
    AMAZON_REFERRAL_PCT_BY_CATEGORY.default

  // Where the percentage fee would fall below Amazon's per-item minimum, the
  // minimum applies instead. Expressing the shortfall as a fixed fee keeps the
  // single engine's inputs honest rather than fudging the percentage.
  const percentageFee = Math.round((input.sellingPrice.minor * referralPct) / 100)
  const referralShortfall = Math.max(0, AMAZON_MINIMUM_REFERRAL.minor - percentageFee)

  const amazon: ChannelCostProfile = {
    channel: 'amazon_uk',
    label: 'Amazon UK',
    channelFeePct: referralPct,
    channelFeeFixed: money(referralShortfall, currency),
    // Amazon settles net of its own fees, so there is no separate card cost.
    paymentFeePct: 0,
    paymentFeeFixed: zero(currency),
    fulfilment: input.amazonFba ? fromMajor(2.9) : fromMajor(0),
    adSpendPerUnit: input.amazonAdSpendPerUnit ?? fromMajor(2.5),
    notes: [
      `${referralPct}% referral fee for ${input.category ?? 'the default category'}.`,
      referralShortfall > 0
        ? `Referral fee raised to Amazon's ${'£0.25'} per-item minimum.`
        : 'Referral fee is above the per-item minimum.',
      input.amazonFba
        ? 'Fulfilled by Amazon: pick, pack and ship charged per unit.'
        : 'Merchant fulfilled: no Amazon fulfilment fee, but delivery promise is ours to meet.',
      'Amazon settles net of fees, so no separate payment processing cost applies.',
    ],
  }

  const shopify: ChannelCostProfile = {
    channel: 'shopify',
    label: 'Shopify',
    channelFeePct: 0,
    channelFeeFixed: zero(currency),
    // Shopify Payments UK standard online rate.
    paymentFeePct: 1.75,
    paymentFeeFixed: fromMajor(0.25),
    fulfilment: fromMajor(0),
    // Shopify sends no traffic of its own, so the advertising assumption is
    // materially higher than Amazon's by default.
    adSpendPerUnit: input.shopifyAdSpendPerUnit ?? fromMajor(4.5),
    notes: [
      'Shopify Payments: 1.75% plus £0.25 per transaction.',
      'No marketplace referral fee.',
      'All traffic is bought or earned, so the advertising assumption is higher than Amazon.',
      'Dropshipped by the supplier, so no separate fulfilment charge.',
    ],
  }

  return [shopify, amazon]
}

export interface ChannelProjectionInput {
  sellingPrice: Money
  productCost: Money
  supplierShipping: Money
  packaging?: Money
  returnRatePct: number
  returnLossPct?: number
  refundRatePct?: number
  vatRatePct: number
  vatInclusive?: boolean
}

export interface ChannelProjection {
  channel: ChannelKey
  label: string
  profile: ChannelCostProfile
  profitability: Profitability
  gate: ProfitabilityGate
  /** Total cash cost of one unit landed and sold on this channel. */
  landedCost: Money
  assumptions: Record<string, unknown>
}

export interface MarginThresholds {
  minGrossMarginPct: number
  minNetMarginPct: number
}

/**
 * Projects one channel. The arithmetic all happens inside
 * `calculateProfitability`; this function only decides what to feed it.
 */
export function projectChannel(
  input: ChannelProjectionInput,
  profile: ChannelCostProfile,
  thresholds: MarginThresholds,
): ChannelProjection {
  const costs: CostInputs = {
    sellingPrice: input.sellingPrice,
    productCost: input.productCost,
    supplierShipping: input.supplierShipping,
    fulfilment: profile.fulfilment,
    packaging: input.packaging ?? fromMajor(0.35),
    channelFeePct: profile.channelFeePct,
    channelFeeFixed: profile.channelFeeFixed,
    paymentFeePct: profile.paymentFeePct,
    paymentFeeFixed: profile.paymentFeeFixed,
    adSpendPerUnit: profile.adSpendPerUnit,
    returnRatePct: input.returnRatePct,
    returnLossPct: input.returnLossPct ?? 65,
    refundRatePct: input.refundRatePct ?? 1,
    vatRatePct: input.vatRatePct,
    vatInclusive: input.vatInclusive ?? true,
  }

  const profitability = calculateProfitability(costs)
  const gate = assessProfitabilityGate(profitability, thresholds)

  return {
    channel: profile.channel,
    label: profile.label,
    profile,
    profitability,
    gate,
    landedCost: profitability.cashRequiredPerUnit,
    assumptions: {
      channelFeePct: profile.channelFeePct,
      channelFeeFixedMinor: profile.channelFeeFixed.minor,
      paymentFeePct: profile.paymentFeePct,
      paymentFeeFixedMinor: profile.paymentFeeFixed.minor,
      fulfilmentMinor: profile.fulfilment.minor,
      adSpendPerUnitMinor: profile.adSpendPerUnit.minor,
      returnRatePct: input.returnRatePct,
      returnLossPct: costs.returnLossPct,
      refundRatePct: costs.refundRatePct,
      vatRatePct: input.vatRatePct,
      vatInclusive: costs.vatInclusive,
      engineVersion: ENGINE_VERSION,
    },
  }
}

export interface ChannelComparison {
  projections: readonly ChannelProjection[]
  /** True when at least one channel clears the profitability gate. */
  viableOnAnyChannel: boolean
  bestChannel: ChannelKey | null
  /** Written for the owner: which channel works, which does not, and why. */
  summary: string
}

/**
 * Projects every channel and compares them.
 *
 * A product viable on one channel and not the other is a normal, useful
 * result, and the summary says so in words rather than leaving the reader to
 * compare two tables.
 */
export function compareChannels(
  input: ChannelProjectionInput,
  profileInput: ChannelProfileInput,
  thresholds: MarginThresholds,
): ChannelComparison {
  const profiles = buildChannelProfiles(profileInput)
  const projections = profiles.map((profile) => projectChannel(input, profile, thresholds))

  const passing = projections.filter((p) => p.gate.passes)
  const best = [...projections].sort(
    (a, b) => b.profitability.netProfit.minor - a.profitability.netProfit.minor,
  )[0]

  let summary: string
  if (passing.length === projections.length) {
    summary = `Clears the profitability gate on both channels. ${best.label} returns the most per unit.`
  } else if (passing.length === 0) {
    summary = 'Fails the profitability gate on every channel at the assumed price and cost.'
  } else {
    const failed = projections.filter((p) => !p.gate.passes)
    summary = `Viable on ${passing.map((p) => p.label).join(' and ')}, but not on ${failed
      .map((p) => p.label)
      .join(' or ')}: ${failed[0].gate.failures[0]}`
  }

  return {
    projections,
    viableOnAnyChannel: passing.length > 0,
    bestChannel: passing.length > 0 ? passing.sort((a, b) => b.profitability.netProfit.minor - a.profitability.netProfit.minor)[0].channel : null,
    summary,
  }
}
