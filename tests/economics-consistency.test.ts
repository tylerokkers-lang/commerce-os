import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculateProfitability, assessProfitabilityGate } from '@/lib/profitability'
import { fromMajor } from '@/lib/core/money'

/**
 * Milestone: production autonomy proof.
 *
 * Two engines compute the same product's profitability: the intelligence
 * assembler (`products/intelligence/assemble.ts`, which produces the
 * `recommendation`) and the channel readiness assembler
 * (`marketplaces/channelReadiness.ts`, which since the previous milestone
 * produces the persisted `profitability_records` verdict that gates
 * `compliance_review -> approved`).
 *
 * They had genuinely diverged, and every difference flattered the result:
 * readiness hardcoded `vatRatePct: 0` and `minGrossMarginPct: 0`, and passed
 * none of the configured return/refund/chargeback/duty/packaging
 * assumptions. The practical effect was that six of the seven business
 * settings an operator is asked to configure had no influence at all on the
 * gate that authorises approval — so configuring them would have been
 * theatre. These tests pin the two engines to the same inputs.
 */

const READINESS = readFileSync('src/lib/marketplaces/channelReadiness.ts', 'utf8')

/** The profitability block inside `getChannelReadiness`. */
function readinessProfitabilityBlock(): string {
  const start = READINESS.indexOf('const result = calculateProfitability({')
  expect(start, 'the readiness profitability call should exist').toBeGreaterThan(-1)
  return READINESS.slice(start, READINESS.indexOf('const gate = assessProfitabilityGate', start) + 200)
}

describe('profitability economics are consistent across engines', () => {
  it('channel readiness uses the configured VAT rate, never a hardcoded zero', () => {
    const block = readinessProfitabilityBlock()
    expect(block).toMatch(/vatRatePct:\s*businessConfiguration\.effectiveVatRatePct/)
    expect(block, 'a hardcoded vatRatePct: 0 silently treats VAT-inclusive revenue as margin').not.toMatch(/vatRatePct:\s*0\b/)
  })

  it('channel readiness enforces the configured minimum gross margin, never a hardcoded zero', () => {
    const block = readinessProfitabilityBlock()
    expect(block).toMatch(/minGrossMarginPct:\s*settings\.minGrossMarginPct/)
    expect(block).toMatch(/minNetMarginPct:\s*settings\.minNetMarginPct/)
  })

  it('channel readiness passes every configured cost assumption the intelligence engine passes', () => {
    const block = readinessProfitabilityBlock()
    for (const field of ['packaging', 'importDutyPct', 'returnRatePct', 'returnLossPct', 'refundRatePct', 'chargebackRatePct', 'chargebackFeeFixed']) {
      expect(block, `${field} must reach the profitability calculation, or configuring it changes nothing`).toContain(field)
    }
  })

  it('an unset assumption is passed as undefined, never coerced to a confirmed zero', () => {
    const block = readinessProfitabilityBlock()
    // `?? undefined` (not `?? 0`) is what lets the breakdown report
    // "not configured" instead of asserting a real zero.
    expect(block).toMatch(/returnRatePct:\s*settings\.returnRatePct \?\? undefined/)
    expect(block).not.toMatch(/returnRatePct:\s*settings\.returnRatePct \?\? 0/)
  })

  /**
   * The reason the above matters, demonstrated on the real engine rather
   * than asserted: the same product flips from passing to failing once the
   * configured economics are actually applied.
   */
  it('applying VAT and the configured assumptions materially changes the verdict', () => {
    const base = {
      sellingPrice: fromMajor(24),
      productCost: fromMajor(12),
      supplierShipping: fromMajor(3),
      channelFeePct: 2,
      paymentFeePct: 1.75,
    }
    const thresholds = { minGrossMarginPct: 25, minNetMarginPct: 10 }

    const flattering = calculateProfitability({ ...base, vatRatePct: 0 })
    const honest = calculateProfitability({
      ...base,
      vatRatePct: 20,
      returnRatePct: 4,
      returnLossPct: 65,
      refundRatePct: 1,
      chargebackRatePct: 0.3,
      chargebackFeeFixed: fromMajor(15),
      importDutyPct: 2,
    })

    // Real figures from the engine: 37.5% gross / 33.8% net flattered,
    // against 23.5% gross / 15.4% net once VAT and the configured
    // assumptions are applied. The gross margin is what tips it below the
    // floor — and the gross floor is precisely what the hardcoded
    // `minGrossMarginPct: 0` used to discard.
    expect(honest.netMarginPct).not.toBeNull()
    expect(flattering.netMarginPct).not.toBeNull()
    expect(honest.netMarginPct!).toBeLessThan(flattering.netMarginPct!)
    expect(honest.grossMarginPct!).toBeLessThan(flattering.grossMarginPct!)
    expect(assessProfitabilityGate(flattering, thresholds).passes).toBe(true)
    expect(
      assessProfitabilityGate(honest, thresholds).passes,
      'this is the product that would previously have been approved on flattered economics',
    ).toBe(false)
  })
})
