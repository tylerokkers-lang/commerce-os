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

/**
 * Milestone: economic-model cost completeness (0047). Import duty and
 * chargebacks were genuinely absent from this engine before this
 * milestone — `CostInputs` had no field for either. These prove the new
 * arithmetic is correct in isolation, independent of how `assemble.ts`
 * wires the org's settings into it.
 */
describe('import duty', () => {
  it('is calculated on the landed supplier cost (product + inbound shipping), never on the resale price', () => {
    // Returns/refunds isolated to 0 here so the assertion tests duty alone —
    // duty legitimately also raises the returns allowance slightly (a
    // returned unit now cost more to land too), covered by its own test below.
    const isolated = { ...amazonUnit, returnRatePct: 0, refundRatePct: 0 }
    const withDuty = calculateProfitability({ ...isolated, importDutyPct: 10 })
    const withoutDuty = calculateProfitability({ ...isolated, importDutyPct: 0 })
    // Landed cost is £6.40 + £2.10 = £8.50; 10% of that is £0.85.
    const dutyLine = withDuty.breakdown.find((l) => l.label === 'Import duty')!
    expect(dutyLine.amount.minor).toBe(85)
    expect(withDuty.netProfit.minor).toBe(withoutDuty.netProfit.minor - 85)
  })

  it('a real duty cost also, correctly, raises the returns allowance slightly — a returned unit now cost more to land too', () => {
    const withDuty = calculateProfitability({ ...amazonUnit, importDutyPct: 10 })
    const withoutDuty = calculateProfitability({ ...amazonUnit, importDutyPct: 0 })
    // 85 minor extra COGS * 60% return-loss * 4% return rate ≈ 2 minor extra returns cost.
    const dutyDelta = 85
    const extraReturnsCost = Math.round(85 * 0.6 * 0.04)
    expect(withoutDuty.netProfit.minor - withDuty.netProfit.minor).toBe(dutyDelta + extraReturnsCost)
  })

  it('omitted entirely (undefined) reports "not configured" in the breakdown basis, never a silent confirmed 0', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured off only to omit it from the rest
    const { importDutyPct: _omit, ...withoutDuty } = amazonUnit as typeof amazonUnit & { importDutyPct?: number }
    const r = calculateProfitability(withoutDuty)
    const dutyLine = r.breakdown.find((l) => l.label === 'Import duty')!
    expect(dutyLine.amount.minor).toBe(0)
    expect(dutyLine.basis).toMatch(/not configured/i)
  })

  it('an explicit 0% is a confirmed decision, not "not configured", in the breakdown basis', () => {
    const r = calculateProfitability({ ...amazonUnit, importDutyPct: 0 })
    const dutyLine = r.breakdown.find((l) => l.label === 'Import duty')!
    expect(dutyLine.basis).not.toMatch(/not configured/i)
  })

  it('duty reduces cash required per unit and cogs, since it is a real landed-cost component', () => {
    const withDuty = calculateProfitability({ ...amazonUnit, importDutyPct: 10 })
    const withoutDuty = calculateProfitability({ ...amazonUnit, importDutyPct: 0 })
    expect(withDuty.cogs.minor).toBe(withoutDuty.cogs.minor + 85)
    expect(withDuty.cashRequiredPerUnit.minor).toBe(withoutDuty.cashRequiredPerUnit.minor + 85)
  })
})

describe('chargebacks', () => {
  it('cost scales with both the rate and the fixed per-dispute fee', () => {
    const r = calculateProfitability({ ...amazonUnit, chargebackRatePct: 1, chargebackFeeFixed: fromMajor(15) })
    const chargebackLine = r.breakdown.find((l) => l.label === 'Chargebacks')!
    // 1% of £20.83 net revenue (208 minor, rounding) + 1% of £15.00 fixed fee (15 minor).
    const expectedPctPortion = Math.round(2082 * 0.01)
    const expectedFixedPortion = Math.round(1500 * 0.01)
    expect(chargebackLine.amount.minor).toBe(expectedPctPortion + expectedFixedPortion)
  })

  it('a higher chargeback rate reduces net profit', () => {
    const low = calculateProfitability({ ...amazonUnit, chargebackRatePct: 0, chargebackFeeFixed: fromMajor(15) })
    const high = calculateProfitability({ ...amazonUnit, chargebackRatePct: 2, chargebackFeeFixed: fromMajor(15) })
    expect(high.netProfit.minor).toBeLessThan(low.netProfit.minor)
  })

  it('omitted entirely (undefined) reports "not configured" in the breakdown basis, never a silent confirmed 0', () => {
    const r = calculateProfitability(amazonUnit) // amazonUnit never sets chargebackRatePct
    const chargebackLine = r.breakdown.find((l) => l.label === 'Chargebacks')!
    expect(chargebackLine.amount.minor).toBe(0)
    expect(chargebackLine.basis).toMatch(/not configured/i)
  })

  it('an explicit 0% is a confirmed decision, not "not configured", in the breakdown basis', () => {
    const r = calculateProfitability({ ...amazonUnit, chargebackRatePct: 0, chargebackFeeFixed: fromMajor(15) })
    const chargebackLine = r.breakdown.find((l) => l.label === 'Chargebacks')!
    expect(chargebackLine.basis).not.toMatch(/not configured/i)
  })

  it('the fixed per-dispute fee alone (rate 0) contributes nothing — a fee no one will ever incur is genuinely £0 cost, not a bug', () => {
    const r = calculateProfitability({ ...amazonUnit, chargebackRatePct: 0, chargebackFeeFixed: fromMajor(15) })
    const chargebackLine = r.breakdown.find((l) => l.label === 'Chargebacks')!
    expect(chargebackLine.amount.minor).toBe(0)
  })
})

describe('packaging: unknown vs configured zero vs configured non-zero (in the raw engine, independent of business-settings wiring)', () => {
  it('omitted entirely reports "not configured", never a silent confirmed £0', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured off only to omit it from the rest
    const { packaging: _omit, ...withoutPackaging } = amazonUnit as typeof amazonUnit & { packaging?: ReturnType<typeof fromMajor> }
    const r = calculateProfitability(withoutPackaging)
    const packagingLine = r.breakdown.find((l) => l.label === 'Packaging')!
    expect(packagingLine.amount.minor).toBe(0)
    expect(packagingLine.basis).toMatch(/not configured/i)
  })

  it('an explicit £0 is a confirmed decision, not "not configured"', () => {
    const r = calculateProfitability({ ...amazonUnit, packaging: fromMajor(0) })
    const packagingLine = r.breakdown.find((l) => l.label === 'Packaging')!
    expect(packagingLine.amount.minor).toBe(0)
    expect(packagingLine.basis).not.toMatch(/not configured/i)
  })

  it('a real positive packaging cost reduces contribution and net profit by exactly that amount', () => {
    // Returns/refunds isolated to 0 — packaging cost is also, correctly, one
    // of the costs a returned unit's allowance is computed from, so
    // changing it shifts returns cost too unless isolated here.
    const isolated = { ...amazonUnit, returnRatePct: 0, refundRatePct: 0 }
    const withoutPackaging = calculateProfitability({ ...isolated, packaging: fromMajor(0) })
    const withPackaging = calculateProfitability({ ...isolated, packaging: fromMajor(0.5) })
    expect(withoutPackaging.contribution.minor - withPackaging.contribution.minor).toBe(50)
    expect(withoutPackaging.netProfit.minor - withPackaging.netProfit.minor).toBe(50)
  })
})

describe('returns/refunds: unknown vs configured zero vs configured non-zero (in the raw engine)', () => {
  it('return rate omitted entirely reports "not configured", never a silent confirmed 0%', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured off only to omit it from the rest
    const { returnRatePct: _omit, ...withoutReturns } = amazonUnit as typeof amazonUnit & { returnRatePct?: number }
    const r = calculateProfitability(withoutReturns)
    const returnsLine = r.breakdown.find((l) => l.label === 'Returns allowance')!
    expect(returnsLine.amount.minor).toBe(0)
    expect(returnsLine.basis).toMatch(/not configured/i)
  })

  it('an explicit 0% return rate is a confirmed decision, not "not configured"', () => {
    const r = calculateProfitability({ ...amazonUnit, returnRatePct: 0 })
    const returnsLine = r.breakdown.find((l) => l.label === 'Returns allowance')!
    expect(returnsLine.basis).not.toMatch(/not configured/i)
  })

  it('refund rate omitted entirely reports "not configured"', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured off only to omit it from the rest
    const { refundRatePct: _omit, ...withoutRefunds } = amazonUnit as typeof amazonUnit & { refundRatePct?: number }
    const r = calculateProfitability(withoutRefunds)
    const refundsLine = r.breakdown.find((l) => l.label === 'Refunds allowance')!
    expect(refundsLine.amount.minor).toBe(0)
    expect(refundsLine.basis).toMatch(/not configured/i)
  })

  it('an explicit 0% refund rate is a confirmed decision, not "not configured"', () => {
    const r = calculateProfitability({ ...amazonUnit, refundRatePct: 0 })
    const refundsLine = r.breakdown.find((l) => l.label === 'Refunds allowance')!
    expect(refundsLine.basis).not.toMatch(/not configured/i)
  })
})

describe('break-even price stays mathematically correct with import duty and chargebacks active', () => {
  it('applying the break-even price back through the same cost structure yields approximately zero profit', () => {
    const unit = { ...amazonUnit, importDutyPct: 8, chargebackRatePct: 0.5, chargebackFeeFixed: fromMajor(15) }
    const r = calculateProfitability(unit)
    const atBreakEven = calculateProfitability({ ...unit, sellingPrice: r.breakEvenPrice })
    expect(Math.abs(toMajor(atBreakEven.netProfit))).toBeLessThan(0.02)
  })
})
