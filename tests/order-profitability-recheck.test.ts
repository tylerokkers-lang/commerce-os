import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { calculateProfitability } from '@/lib/profitability'
import { recheckOrderLineProfitability, summariseOrderProfitability, type OrderLineEconomics } from '@/lib/orders/profitabilityRecheck'

function economics(over: Partial<OrderLineEconomics> = {}): OrderLineEconomics {
  return {
    sellingPrice: fromMajor(30),
    supplierUnitCost: fromMajor(8),
    supplierShipping: fromMajor(2),
    channelFee: fromMajor(4.5),
    paymentFee: fromMajor(0.5),
    quantity: 2,
    vatRatePct: 20,
    ...over,
  }
}

describe('order profitability re-check', () => {
  it('delegates entirely to the single profitability engine, never recalculating', () => {
    const input = economics()
    const result = recheckOrderLineProfitability(input, { minNetMarginPct: 10 })

    const direct = calculateProfitability({
      sellingPrice: input.sellingPrice,
      productCost: input.supplierUnitCost,
      supplierShipping: input.supplierShipping,
      channelFeeFixed: input.channelFee,
      paymentFeeFixed: input.paymentFee,
      vatRatePct: input.vatRatePct,
      vatInclusive: true,
    })

    expect(result.perUnit.netProfit.minor).toBe(direct.netProfit.minor)
    expect(result.perUnit.netMarginPct).toBe(direct.netMarginPct)
  })

  it('multiplies per-unit results by quantity for the line total', () => {
    const result = recheckOrderLineProfitability(economics({ quantity: 3 }), { minNetMarginPct: 10 })
    expect(result.lineNetProfit.minor).toBe(result.perUnit.netProfit.minor * 3)
  })

  it('passes when the actual margin clears the threshold', () => {
    const result = recheckOrderLineProfitability(economics(), { minNetMarginPct: 10 })
    expect(result.passesMinimumMargin).toBe(true)
    expect(result.failureReason).toBeNull()
  })

  it('fails when the order\'s real costs erode margin below the threshold', () => {
    const result = recheckOrderLineProfitability(
      economics({ supplierUnitCost: fromMajor(20) }), // real cost much higher than assumed
      { minNetMarginPct: 10 },
    )
    expect(result.passesMinimumMargin).toBe(false)
    expect(result.failureReason).toMatch(/below the 10% minimum/)
  })

  it('a compliant-but-unprofitable order line: fails purely on margin with no other issue', () => {
    const result = recheckOrderLineProfitability(economics({ supplierUnitCost: fromMajor(25) }), { minNetMarginPct: 10 })
    expect(result.passesMinimumMargin).toBe(false)
    expect(result.perUnit.netRevenue.minor).toBeGreaterThan(0) // the order itself is perfectly valid
  })

  it('summarises multiple lines into an order-level total', () => {
    const lineA = recheckOrderLineProfitability(economics({ quantity: 1 }), { minNetMarginPct: 10 })
    const lineB = recheckOrderLineProfitability(economics({ quantity: 1, supplierUnitCost: fromMajor(25) }), { minNetMarginPct: 10 })
    const summary = summariseOrderProfitability([lineA, lineB])
    expect(summary.anyLineFailsMargin).toBe(true)
    expect(summary.totalNetProfit.minor).toBe(lineA.lineNetProfit.minor + lineB.lineNetProfit.minor)
  })
})
