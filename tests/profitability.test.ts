import { describe, expect, it } from 'vitest'
import { fromMajor, toMajor } from '@/lib/core/money'
import { assessProfitabilityGate, calculateProfitability } from '@/lib/profitability'

/** A representative Amazon UK dropship unit. */
const amazonUnit = {
  sellingPrice: fromMajor(24.99),
  productCost: fromMajor(6.4),
  supplierShipping: fromMajor(2.1),
  fulfilment: fromMajor(0),
  packaging: fromMajor(0.35),
  channelFeePct: 15,
  paymentFeePct: 0,
  adSpendPerUnit: fromMajor(3.2),
  returnRatePct: 4,
  returnLossPct: 60,
  refundRatePct: 1,
  vatRatePct: 20,
  vatInclusive: true,
}

describe('profitability', () => {
  it('strips VAT before calculating any margin', () => {
    const result = calculateProfitability(amazonUnit)
    // £24.99 inclusive of 20% VAT is £20.83 net, £4.17 VAT.
    expect(result.vat.minor).toBe(417)
    expect(result.netRevenue.minor).toBe(2082)
  })

  it('never counts VAT as revenue', () => {
    const withVat = calculateProfitability(amazonUnit)
    const withoutVat = calculateProfitability({ ...amazonUnit, vatRatePct: 0 })
    expect(withoutVat.netRevenue.minor).toBeGreaterThan(withVat.netRevenue.minor)
    expect(withoutVat.netProfit.minor).toBeGreaterThan(withVat.netProfit.minor)
  })

  it('subtracts every cost line from net revenue', () => {
    const r = calculateProfitability(amazonUnit)
    const expected = r.netRevenue.minor - r.cogs.minor - r.variableCosts.minor - r.adSpend.minor
    expect(r.netProfit.minor).toBe(expected)
  })

  it('charges marketplace fees on the gross price, not the net', () => {
    const r = calculateProfitability(amazonUnit)
    const channelFee = r.breakdown.find((l) => l.label === 'Channel fees')!
    // 15% of £24.99, not 15% of £20.83.
    expect(channelFee.amount.minor).toBe(375)
  })

  it('treats a loss-making product as failing the gate', () => {
    const r = calculateProfitability({ ...amazonUnit, productCost: fromMajor(18) })
    const gate = assessProfitabilityGate(r, { minGrossMarginPct: 25, minNetMarginPct: 10 })
    expect(r.netProfit.minor).toBeLessThan(0)
    expect(gate.passes).toBe(false)
    expect(gate.failures.join(' ')).toMatch(/loses money/)
  })

  it('fails the gate on thin margin even when profitable', () => {
    // £10 cost leaves £0.91 net: healthy 41.9% gross margin, but only 4.4%
    // net margin, which is below the configured 10% floor.
    const r = calculateProfitability({ ...amazonUnit, productCost: fromMajor(10) })
    const gate = assessProfitabilityGate(r, { minGrossMarginPct: 25, minNetMarginPct: 10 })
    expect(r.netProfit.minor).toBeGreaterThan(0)
    expect(gate.passes).toBe(false)
  })

  it('gives every failure a reason the owner can act on', () => {
    const r = calculateProfitability({ ...amazonUnit, productCost: fromMajor(18) })
    const gate = assessProfitabilityGate(r, { minGrossMarginPct: 25, minNetMarginPct: 10 })
    expect(gate.failures.length).toBeGreaterThan(0)
    for (const failure of gate.failures) {
      expect(failure.length).toBeGreaterThan(20)
    }
  })

  it('break-even price yields approximately zero profit when applied', () => {
    const r = calculateProfitability(amazonUnit)
    const atBreakEven = calculateProfitability({ ...amazonUnit, sellingPrice: r.breakEvenPrice })
    // Within a penny, allowing for rounding up to whole pence.
    expect(Math.abs(toMajor(atBreakEven.netProfit))).toBeLessThan(0.02)
  })

  it('break-even ad spend equals contribution before advertising', () => {
    const r = calculateProfitability(amazonUnit)
    expect(r.breakEvenAdSpend.minor).toBe(r.contribution.minor)
  })

  it('counts advertising in the cash needed up front', () => {
    const r = calculateProfitability(amazonUnit)
    expect(r.cashRequiredPerUnit.minor).toBe(
      r.cogs.minor + fromMajor(0.35).minor + r.adSpend.minor,
    )
  })

  it('prices returns by how often they happen', () => {
    const low = calculateProfitability({ ...amazonUnit, returnRatePct: 0 })
    const high = calculateProfitability({ ...amazonUnit, returnRatePct: 20 })
    expect(high.netProfit.minor).toBeLessThan(low.netProfit.minor)
  })
})
