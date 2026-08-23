import { calculateProfitability, type CostInputs, type Profitability } from '@/lib/profitability'
import { add, type Money } from '@/lib/core/money'

/**
 * Profitability re-check against live order economics (Milestone 5).
 *
 * A candidate's profitability is projected before it ever sells, from
 * estimated cost and an assumed return rate (Milestone 2). Once a real order
 * exists, its actual selling price, actual supplier cost, and actual channel
 * fees are known — this re-runs the exact same profitability engine
 * (`calculateProfitability`, never a second implementation of the arithmetic)
 * with those real figures, so a stale projection can never be mistaken for
 * what an order actually earned.
 *
 * This is deliberately narrow: it recomputes contribution for one order line,
 * using whatever real inputs the order and its fulfilment already carry. It
 * does not re-run demand or scoring — those questions do not apply to an
 * order that has already been placed.
 */

export interface OrderLineEconomics {
  sellingPrice: Money
  supplierUnitCost: Money
  supplierShipping: Money
  channelFee: Money
  paymentFee: Money
  quantity: number
  vatRatePct: number
}

export interface OrderProfitabilityResult {
  perUnit: Profitability
  /** perUnit figures multiplied by quantity, for the order line as a whole. */
  lineNetProfit: Money
  lineContribution: Money
  passesMinimumMargin: boolean
  failureReason: string | null
}

/**
 * Recomputes profitability for one order line from its real, observed costs.
 *
 * Channel and payment fees are passed as already-known fixed amounts here
 * (Milestone 4's fee snapshot, once available, or the marketplace's own
 * reported deduction) rather than as percentages, because a real order's fee
 * is a fact, not an estimate to be derived from a rate.
 */
export function recheckOrderLineProfitability(
  economics: OrderLineEconomics,
  thresholds: { minNetMarginPct: number },
): OrderProfitabilityResult {
  const costs: CostInputs = {
    sellingPrice: economics.sellingPrice,
    productCost: economics.supplierUnitCost,
    supplierShipping: economics.supplierShipping,
    channelFeeFixed: economics.channelFee,
    paymentFeeFixed: economics.paymentFee,
    vatRatePct: economics.vatRatePct,
    vatInclusive: true,
  }

  const perUnit = calculateProfitability(costs)
  const lineNetProfit = { minor: perUnit.netProfit.minor * economics.quantity, currency: perUnit.netProfit.currency }
  const lineContribution = { minor: perUnit.contribution.minor * economics.quantity, currency: perUnit.contribution.currency }

  const passes = perUnit.netMarginPct !== null && perUnit.netMarginPct >= thresholds.minNetMarginPct

  return {
    perUnit,
    lineNetProfit,
    lineContribution,
    passesMinimumMargin: passes,
    failureReason: passes
      ? null
      : perUnit.netMarginPct === null
        ? 'Net revenue is zero or negative on this order line.'
        : `Actual net margin ${perUnit.netMarginPct.toFixed(1)}% is below the ${thresholds.minNetMarginPct}% minimum once this order's real costs are applied.`,
  }
}

/** Sums per-line results into an order-level total, for the order's own record. */
export function summariseOrderProfitability(
  lines: readonly OrderProfitabilityResult[],
): { totalNetProfit: Money; totalContribution: Money; anyLineFailsMargin: boolean } {
  const totalNetProfit = lines.reduce((sum, line) => add(sum, line.lineNetProfit), { minor: 0, currency: 'GBP' } as Money)
  const totalContribution = lines.reduce((sum, line) => add(sum, line.lineContribution), { minor: 0, currency: 'GBP' } as Money)
  return {
    totalNetProfit,
    totalContribution,
    anyLineFailsMargin: lines.some((line) => !line.passesMinimumMargin),
  }
}
