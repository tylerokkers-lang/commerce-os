import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Static regression guard for the business-settings configuration layer
 * (Milestone: business-settings configuration layer). `assemble.ts` is
 * `server-only` and cannot be imported directly here — same technique
 * `product-intelligence-pricing-dependency.test.ts` already uses for this
 * exact file. What matters is that `assemble.ts` never goes back to a
 * hardcoded `vatRatePct: 0` and never calls `recommendProduct` without the
 * real, resolved configuration status — both silent regressions a normal
 * unit test cannot catch here.
 */

const ASSEMBLE_PATH = 'src/lib/products/intelligence/assemble.ts'

describe('assemble.ts: business-settings configuration status reaches both VAT and the recommendation gate', () => {
  const source = readFileSync(ASSEMBLE_PATH, 'utf8')

  it('VAT rate is resolved via resolveBusinessConfiguration, never a bare hardcoded 0', () => {
    expect(source).toContain('resolveBusinessConfiguration(settings)')
    expect(source).not.toMatch(/vatRatePct:\s*0[,\s]/)
  })

  it('both the pricing call and the profitability call use the same resolved effectiveVatRatePct', () => {
    const occurrences = source.match(/vatRatePct:\s*effectiveVatRatePct/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('recommendProduct receives the resolved businessSettingsConfigured status', () => {
    const recommendProductCall = source.match(/recommendProduct\(\{([\s\S]*?)\n\s*\}\)/)
    expect(recommendProductCall).not.toBeNull()
    expect(recommendProductCall![1]).toContain('businessSettingsConfigured')
  })

  it('resolveBusinessConfiguration is called before recommendProduct, so a stale/default status can never reach the ladder', () => {
    const resolveIndex = source.indexOf('resolveBusinessConfiguration(settings)')
    const recommendIndex = source.indexOf('recommendProduct({')
    expect(resolveIndex).toBeGreaterThan(-1)
    expect(recommendIndex).toBeGreaterThan(-1)
    expect(resolveIndex).toBeLessThan(recommendIndex)
  })

  it('recommendProduct receives the resolved missingRequiredSettings list, not a hardcoded empty array', () => {
    const recommendProductCall = source.match(/recommendProduct\(\{([\s\S]*?)\n\s*\}\)/)
    expect(recommendProductCall).not.toBeNull()
    expect(recommendProductCall![1]).toContain('missingRequiredSettings: businessConfiguration.missingRequired')
  })
})

/**
 * Milestone: economic-model cost completeness (0047). Part I's invariant —
 * "the exact same economic assumptions used by recommendPricing() must be
 * used by calculateProfitability()" — extended to packaging, returns,
 * refunds, chargebacks and import duty. `sharedCostAssumptions` is the one
 * object built from the org's real settings and spread into both calls;
 * this guards against a future edit adding a cost to one call site
 * without the other, the exact class of bug the pricing/ad-spend mismatch
 * (an earlier milestone) already proved can happen silently.
 */
describe('assemble.ts: packaging/returns/refunds/chargebacks/import duty reach pricing and profitability identically', () => {
  const source = readFileSync(ASSEMBLE_PATH, 'utf8')

  it('a single sharedCostAssumptions object is built once from the real settings, never a fixed/hardcoded 0', () => {
    expect(source).toContain('const sharedCostAssumptions = {')
    expect(source).toMatch(/packaging:\s*settings\.packagingCostMinor\s*!==\s*null/)
    expect(source).toMatch(/importDutyPct:\s*settings\.importDutyPct\s*\?\?\s*undefined/)
    expect(source).toMatch(/returnRatePct:\s*settings\.returnRatePct\s*\?\?\s*undefined/)
    expect(source).toMatch(/returnLossPct:\s*settings\.returnLossPct\s*\?\?\s*undefined/)
    expect(source).toMatch(/refundRatePct:\s*settings\.refundRatePct\s*\?\?\s*undefined/)
    expect(source).toMatch(/chargebackRatePct:\s*settings\.chargebackRatePct\s*\?\?\s*undefined/)
    expect(source).toMatch(/chargebackFeeFixed:\s*settings\.chargebackFeeMinor\s*!==\s*null/)
  })

  it('sharedCostAssumptions is declared before both the pricing call and the profitability call', () => {
    const sharedIndex = source.indexOf('const sharedCostAssumptions = {')
    const pricingIndex = source.indexOf('const pricing =')
    const profitabilityIndex = source.indexOf('let profitability: ReturnType<typeof calculateProfitability>')
    expect(sharedIndex).toBeGreaterThan(-1)
    expect(sharedIndex).toBeLessThan(pricingIndex)
    expect(sharedIndex).toBeLessThan(profitabilityIndex)
  })

  it('sharedCostAssumptions is spread into both the pricing costs object and the profitability costs object — exactly twice', () => {
    const occurrences = source.match(/\.\.\.sharedCostAssumptions/g) ?? []
    expect(occurrences).toHaveLength(2)
  })
})
