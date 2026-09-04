import {
  add,
  formatMoney,
  marginPct,
  money,
  multiply,
  percentOf,
  subtract,
  vatFromGross,
  zero,
  type CurrencyCode,
  type Money,
} from '@/lib/core/money'

/**
 * Profitability (§3).
 *
 * The whole system is built so that no product can be called profitable
 * because it sold well. Revenue is the starting point and everything that
 * erodes it is subtracted explicitly, including the costs that are easy to
 * forget: returns, refunds, packaging, payment processing, and VAT that was
 * collected on the customer's behalf and was never ours.
 */

export interface CostInputs {
  /** What the customer pays, VAT inclusive where VAT applies. */
  sellingPrice: Money
  /** Unit cost from the supplier. */
  productCost: Money
  /** What the supplier charges to ship it. */
  supplierShipping?: Money
  /** Pick, pack, FBA or third-party fulfilment. */
  fulfilment?: Money
  /** Packaging and inserts we pay for ourselves. */
  packaging?: Money
  /** Marketplace referral / closing fees, as a percentage of selling price. */
  channelFeePct?: number
  /** Fixed per-order marketplace fee, if any. */
  channelFeeFixed?: Money
  /** Payment processing percentage. */
  paymentFeePct?: number
  /** Payment processing fixed component. */
  paymentFeeFixed?: Money
  /** Advertising attributed to one unit sold. */
  adSpendPerUnit?: Money
  /** Expected returns as a percentage of units sold. */
  returnRatePct?: number
  /** Portion of a returned unit's cost that is unrecoverable, 0-100. */
  returnLossPct?: number
  /** Expected refunds as a percentage of revenue, beyond returns. */
  refundRatePct?: number
  /**
   * Import duty as a percentage of landed supplier cost (product cost +
   * supplier shipping) — the customary duty basis, not the resale price.
   * Pass 0 only when the business has explicitly decided duty does not
   * apply (already-duty-paid stock, a domestic supplier, etc.); never a
   * default for "we don't know."
   */
  importDutyPct?: number
  /** Expected chargebacks as a percentage of orders. */
  chargebackRatePct?: number
  /** The card network/processor's fixed dispute fee, charged per chargeback event regardless of order value — separate from the revenue itself being reversed. */
  chargebackFeeFixed?: Money
  /**
   * VAT rate applied to the sale. Pass 0 when not VAT registered or when the
   * supply is outside scope. Never assume 20.
   */
  vatRatePct?: number
  /** True when VAT is included in `sellingPrice` (the normal UK retail case). */
  vatInclusive?: boolean
}

export interface Profitability {
  currency: CurrencyCode
  /** Revenue excluding VAT: what the business actually keeps from the sale. */
  netRevenue: Money
  vat: Money
  cogs: Money
  /** Revenue less cost of goods and inbound shipping. */
  grossProfit: Money
  variableCosts: Money
  /** Gross profit less all variable selling costs, before advertising. */
  contribution: Money
  adSpend: Money
  /** Contribution after advertising. The figure that decides scale or kill. */
  netProfit: Money

  grossMarginPct: number | null
  contributionMarginPct: number | null
  netMarginPct: number | null

  /** Selling price at which net profit reaches zero, all else equal. */
  breakEvenPrice: Money
  /** Maximum advertising per unit before the product stops making money. */
  breakEvenAdSpend: Money
  /** Advertising cost of sale at break-even, as a percentage. */
  breakEvenAcosPct: number | null
  /** Cash needed up front per unit, before any marketplace payout arrives. */
  cashRequiredPerUnit: Money

  breakdown: readonly CostLine[]
}

export interface CostLine {
  label: string
  amount: Money
  /** How this line was derived, shown in the UI so no number is unexplained. */
  basis: string
}

const orZero = (m: Money | undefined, currency: CurrencyCode): Money => m ?? zero(currency)

export function calculateProfitability(input: CostInputs): Profitability {
  const currency = input.sellingPrice.currency
  const price = input.sellingPrice

  const vatRate = input.vatRatePct ?? 0
  const vatInclusive = input.vatInclusive ?? true

  // VAT was never ours. Strip it before anything else so every margin below
  // is calculated on money the business actually keeps.
  const vat = vatRate === 0
    ? zero(currency)
    : vatInclusive
      ? vatFromGross(price, vatRate)
      : percentOf(price, vatRate)
  const netRevenue = vatInclusive ? subtract(price, vat) : price

  const productCost = input.productCost
  const supplierShipping = orZero(input.supplierShipping, currency)
  // Duty is levied on the landed supplier cost (product + inbound
  // shipping), never on the resale price — the customary customs basis,
  // and a genuinely different number from the selling price this function
  // is also given.
  const importDuty = percentOf(add(productCost, supplierShipping), input.importDutyPct ?? 0)
  const cogs = add(productCost, supplierShipping, importDuty)
  const grossProfit = subtract(netRevenue, cogs)

  const fulfilment = orZero(input.fulfilment, currency)
  const packaging = orZero(input.packaging, currency)

  // Marketplace fees are charged on the gross amount the customer paid.
  const channelFee = add(
    percentOf(price, input.channelFeePct ?? 0),
    orZero(input.channelFeeFixed, currency),
  )
  const paymentFee = add(
    percentOf(price, input.paymentFeePct ?? 0),
    orZero(input.paymentFeeFixed, currency),
  )

  // A return costs the unrecoverable part of the goods plus the shipping and
  // fulfilment already spent, weighted by how often it happens.
  const returnRate = (input.returnRatePct ?? 0) / 100
  const returnLoss = (input.returnLossPct ?? 100) / 100
  const perReturnCost = add(multiply(cogs, returnLoss), fulfilment, packaging)
  const returnsCost = multiply(perReturnCost, returnRate)

  const refundsCost = percentOf(netRevenue, input.refundRatePct ?? 0)

  // A chargeback reverses the transaction (the same "share of net revenue
  // lost" convention refunds already use above) AND carries the card
  // network/processor's own fixed dispute fee — a real cost regardless of
  // the order's value, weighted by how often a chargeback happens.
  const chargebackRate = (input.chargebackRatePct ?? 0) / 100
  const chargebackFeeFixed = orZero(input.chargebackFeeFixed, currency)
  const chargebackCost = add(
    percentOf(netRevenue, input.chargebackRatePct ?? 0),
    multiply(chargebackFeeFixed, chargebackRate),
  )

  const variableCosts = add(
    fulfilment,
    packaging,
    channelFee,
    paymentFee,
    returnsCost,
    refundsCost,
    chargebackCost,
  )
  const contribution = subtract(grossProfit, variableCosts)

  const adSpend = orZero(input.adSpendPerUnit, currency)
  const netProfit = subtract(contribution, adSpend)

  // Break-even price: the price at which net profit is zero. Percentage-based
  // costs scale with price, so solve rather than simply adding costs up.
  //   net = price*(1 - vatShare) - fixed - price*pctCosts = 0
  const vatShare = vatRate === 0 ? 0 : vatInclusive ? vatRate / (100 + vatRate) : 0
  const pctCosts = ((input.channelFeePct ?? 0) + (input.paymentFeePct ?? 0)) / 100
  const refundShare = ((input.refundRatePct ?? 0) / 100) * (1 - vatShare)
  // Only the percentage-of-revenue share of the chargeback cost scales
  // with price; its fixed per-event fee (below) does not, exactly the
  // same split channel/payment fees already get between their `Pct` and
  // `Fixed` components.
  const chargebackShare = chargebackRate * (1 - vatShare)
  const fixedCosts = add(
    cogs, // already includes import duty
    fulfilment,
    packaging,
    orZero(input.channelFeeFixed, currency),
    orZero(input.paymentFeeFixed, currency),
    returnsCost,
    multiply(chargebackFeeFixed, chargebackRate),
    adSpend,
  )
  const denominator = 1 - vatShare - pctCosts - refundShare - chargebackShare
  const breakEvenPrice = denominator > 0
    ? money(Math.ceil(fixedCosts.minor / denominator), currency)
    : money(0, currency)

  const breakEvenAdSpend = contribution.minor > 0 ? contribution : zero(currency)
  const breakEvenAcosPct = price.minor > 0 && breakEvenAdSpend.minor > 0
    ? Math.round((breakEvenAdSpend.minor / price.minor) * 10000) / 100
    : null

  // Cash out of the door before the marketplace pays out (§48).
  const cashRequiredPerUnit = add(cogs, fulfilment, packaging, adSpend)

  const breakdown: CostLine[] = [
    { label: 'Selling price', amount: price, basis: vatInclusive && vatRate > 0 ? `Customer pays, VAT inclusive at ${vatRate}%` : 'Customer pays' },
    { label: 'VAT', amount: vat, basis: vatRate === 0 ? 'No VAT applied' : `${vatRate}% ${vatInclusive ? 'extracted from gross' : 'added to net'}` },
    { label: 'Net revenue', amount: netRevenue, basis: 'Selling price less VAT' },
    { label: 'Product cost', amount: productCost, basis: 'Supplier unit cost' },
    { label: 'Supplier shipping', amount: supplierShipping, basis: 'Inbound / dropship shipping' },
    { label: 'Import duty', amount: importDuty, basis: input.importDutyPct === undefined ? 'Not configured — treated as 0 for this calculation, not a confirmed business decision' : `${input.importDutyPct}% of landed supplier cost` },
    { label: 'Fulfilment', amount: fulfilment, basis: 'Pick, pack and dispatch' },
    { label: 'Packaging', amount: packaging, basis: input.packaging === undefined ? 'Not configured — treated as 0 for this calculation, not a confirmed business decision' : 'Boxes, inserts, labels' },
    { label: 'Channel fees', amount: channelFee, basis: `${input.channelFeePct ?? 0}% of gross${input.channelFeeFixed ? ' plus fixed fee' : ''}` },
    { label: 'Payment fees', amount: paymentFee, basis: `${input.paymentFeePct ?? 0}% of gross${input.paymentFeeFixed ? ' plus fixed fee' : ''}` },
    { label: 'Returns allowance', amount: returnsCost, basis: input.returnRatePct === undefined ? 'Not configured — treated as 0 for this calculation, not a confirmed business decision' : `${input.returnRatePct}% return rate, ${input.returnLossPct ?? 100}% unrecoverable` },
    { label: 'Refunds allowance', amount: refundsCost, basis: input.refundRatePct === undefined ? 'Not configured — treated as 0 for this calculation, not a confirmed business decision' : `${input.refundRatePct}% of net revenue` },
    { label: 'Chargebacks', amount: chargebackCost, basis: input.chargebackRatePct === undefined ? 'Not configured — treated as 0 for this calculation, not a confirmed business decision' : `${input.chargebackRatePct}% of orders, plus the fixed dispute fee` },
    { label: 'Advertising', amount: adSpend, basis: 'Attributed spend per unit' },
  ]

  return {
    currency,
    netRevenue,
    vat,
    cogs,
    grossProfit,
    variableCosts,
    contribution,
    adSpend,
    netProfit,
    grossMarginPct: marginPct(grossProfit, netRevenue),
    contributionMarginPct: marginPct(contribution, netRevenue),
    netMarginPct: marginPct(netProfit, netRevenue),
    breakEvenPrice,
    breakEvenAdSpend,
    breakEvenAcosPct,
    cashRequiredPerUnit,
    breakdown,
  }
}

export interface ProfitabilityGate {
  passes: boolean
  failures: readonly string[]
  warnings: readonly string[]
}

/**
 * The hard gate a product must clear before launch (§3).
 *
 * Returns reasons rather than a bare boolean: a blocked product must always be
 * able to tell the owner exactly why.
 */
export function assessProfitabilityGate(
  result: Profitability,
  thresholds: { minGrossMarginPct: number; minNetMarginPct: number },
): ProfitabilityGate {
  const failures: string[] = []
  const warnings: string[] = []

  if (result.netRevenue.minor <= 0) {
    failures.push('Net revenue is zero or negative, so no margin can be earned.')
  }
  if (result.netProfit.minor <= 0) {
    failures.push(
      `Net profit is ${formatMoney(result.netProfit)} per unit. The product loses money on every sale.`,
    )
  }
  if (result.grossMarginPct !== null && result.grossMarginPct < thresholds.minGrossMarginPct) {
    failures.push(
      `Gross margin ${result.grossMarginPct}% is below the ${thresholds.minGrossMarginPct}% minimum.`,
    )
  }
  if (result.netMarginPct !== null && result.netMarginPct < thresholds.minNetMarginPct) {
    failures.push(
      `Net margin ${result.netMarginPct}% is below the ${thresholds.minNetMarginPct}% minimum.`,
    )
  }
  if (result.netMarginPct !== null && result.netMarginPct < thresholds.minNetMarginPct + 5) {
    warnings.push('Net margin leaves very little room for fee changes or a bad return month.')
  }
  if (result.breakEvenAcosPct !== null && result.breakEvenAcosPct < 10) {
    warnings.push(
      `Break-even ACOS is only ${result.breakEvenAcosPct}%, so there is almost no advertising headroom.`,
    )
  }

  return { passes: failures.length === 0, failures, warnings }
}
