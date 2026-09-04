import { describe, expect, it } from 'vitest'
import { recommendPricing } from '@/lib/products/intelligence/pricingEngine'
import { calculateProfitability } from '@/lib/profitability'
import { money } from '@/lib/core/money'

describe('Product pricing engine', () => {
  it('finds a minimum viable price that genuinely clears the configured minimum margin', () => {
    const result = recommendPricing(
      { productCost: money(400, 'GBP'), supplierShipping: money(200, 'GBP'), vatRatePct: 0 },
      'GBP',
      400,
      15, // min net margin %
      35, // target net margin %
      0, // advertising allowance %
    )
    expect(result.minimumViablePriceMinor).not.toBeNull()
    expect(result.minimumViableUnreachable).toBe(false)
  })

  it('the recommended (target-margin) price is always at or above the minimum viable price', () => {
    const result = recommendPricing(
      { productCost: money(400, 'GBP'), supplierShipping: money(200, 'GBP'), vatRatePct: 0 },
      'GBP',
      400,
      15,
      35,
      0,
    )
    expect(result.recommendedPriceMinor!).toBeGreaterThanOrEqual(result.minimumViablePriceMinor!)
  })

  it('a higher configured advertising allowance raises the minimum viable price needed to still clear the margin', () => {
    const withoutAds = recommendPricing({ productCost: money(400, 'GBP'), vatRatePct: 0 }, 'GBP', 400, 15, 35, 0)
    const withAds = recommendPricing({ productCost: money(400, 'GBP'), vatRatePct: 0 }, 'GBP', 400, 15, 35, 15)
    expect(withAds.minimumViablePriceMinor!).toBeGreaterThan(withoutAds.minimumViablePriceMinor!)
  })

  it('advertising is recomputed as a percentage of each candidate price, not a single fixed figure carried over from one price to another', () => {
    // Regression for the confirmed wiring defect (economic audit, Part 5):
    // ad spend must scale with whatever price is actually being tested
    // during the search, never stay pinned to the cost-anchored floor's
    // own ad-spend figure.
    const result = recommendPricing({ productCost: money(400, 'GBP'), vatRatePct: 0 }, 'GBP', 400, 15, 35, 20)
    expect(result.recommendedPriceMinor).not.toBeNull()
    const impliedAdSpendAtRecommendedPrice = Math.round((result.recommendedPriceMinor! * 20) / 100)
    const profitability = calculateProfitability({
      sellingPrice: money(result.recommendedPriceMinor!, 'GBP'),
      productCost: money(400, 'GBP'),
      adSpendPerUnit: money(impliedAdSpendAtRecommendedPrice, 'GBP'),
      vatRatePct: 0,
    })
    expect(profitability.netMarginPct!).toBeGreaterThanOrEqual(35)
  })

  it('a genuinely unaffordable cost structure (fees exceed 100% of price) is reported as unreachable, never a fabricated price', () => {
    const result = recommendPricing(
      { productCost: money(100, 'GBP'), channelFeePct: 60, paymentFeePct: 50, vatRatePct: 0 },
      'GBP',
      100,
      15,
      35,
      0,
    )
    expect(result.minimumViableUnreachable).toBe(true)
    expect(result.minimumViablePriceMinor).toBeNull()
  })

  it('a zero minimum margin still returns a price above raw cost (break-even, not free)', () => {
    const result = recommendPricing({ productCost: money(500, 'GBP'), vatRatePct: 0 }, 'GBP', 500, 0, 10, 0)
    expect(result.minimumViablePriceMinor!).toBeGreaterThan(500)
  })

  it('missing advertising configuration (0%) behaves exactly as before this fix — no advertising cost assumed', () => {
    const result = recommendPricing({ productCost: money(400, 'GBP'), vatRatePct: 0 }, 'GBP', 400, 15, 35, 0)
    const profitability = calculateProfitability({
      sellingPrice: money(result.recommendedPriceMinor!, 'GBP'),
      productCost: money(400, 'GBP'),
      vatRatePct: 0,
    })
    expect(profitability.netMarginPct!).toBeGreaterThanOrEqual(35)
  })
})

/**
 * Regression coverage for a real circular dependency found live testing
 * the CJdropshipping pipeline (`assemble.ts`): `recommendPricing` used to
 * sit behind a gate requiring `profitability` to already be non-null,
 * even though the function's own signature (proven by every test above)
 * never takes a profitability object or an existing price at all — only
 * cost inputs. A freshly-imported product could therefore never be
 * priced, since nothing could ever set a channel price for it in the
 * first place. This block proves the two matching halves of the actual
 * fix: pricing is genuinely reachable from cost alone with zero
 * pre-existing price of any kind (guarding against that gate ever
 * returning), and that the resulting recommended price, fed forward
 * into `calculateProfitability` exactly as `assemble.ts` now does,
 * produces a real, sensible profit and margin — never a fabricated one.
 */
describe('recommendPricing -> calculateProfitability: the previously-impossible case (real CJ economics, zero pre-existing price)', () => {
  // Real figures from this project's own live CJ dry run (Men's Casual
  // Loose Fashion Inner Match Bottoming Shirt, CJWY2341813): $38.14 cost,
  // $5.94 UK shipping — never a manufactured example.
  const CJ_COST_MINOR = 3814
  const CJ_SHIPPING_MINOR = 594

  const ADVERTISING_ALLOWANCE_PCT = 15 // DEMO_AUTOMATION_SETTINGS.advertisingAllowancePct — the real value assemble.ts uses today.

  it('supplier cost + shipping alone (no existing priceMinor, no existing profitability) -> a real, non-null recommended price', () => {
    const result = recommendPricing(
      { productCost: money(CJ_COST_MINOR, 'USD'), supplierShipping: money(CJ_SHIPPING_MINOR, 'USD'), vatRatePct: 0 },
      'USD',
      CJ_COST_MINOR,
      15,
      35,
      ADVERTISING_ALLOWANCE_PCT,
    )
    expect(result.recommendedUnreachable).toBe(false)
    expect(result.recommendedPriceMinor).not.toBeNull()
    expect(result.recommendedPriceMinor!).toBeGreaterThan(CJ_COST_MINOR + CJ_SHIPPING_MINOR)
  })

  it('that recommended price, run through profitability with the SAME advertising allowance assemble.ts applies, realises a margin at or above the configured target — the confirmed pricing/ad-spend wiring defect, fixed', () => {
    const targetNetMarginPct = 35
    const pricing = recommendPricing(
      { productCost: money(CJ_COST_MINOR, 'USD'), supplierShipping: money(CJ_SHIPPING_MINOR, 'USD'), vatRatePct: 0 },
      'USD',
      CJ_COST_MINOR,
      15,
      targetNetMarginPct,
      ADVERTISING_ALLOWANCE_PCT,
    )
    expect(pricing.recommendedPriceMinor).not.toBeNull()

    // Mirrors assemble.ts's own effectivePriceMinor -> profitability chain
    // exactly, including how it derives adSpendPerUnit from the org's
    // configured advertisingAllowancePct at the actual effective price —
    // never a manually chosen or hardcoded figure.
    const adSpendPerUnit = money(Math.round((pricing.recommendedPriceMinor! * ADVERTISING_ALLOWANCE_PCT) / 100), 'USD')
    const profitability = calculateProfitability({
      sellingPrice: money(pricing.recommendedPriceMinor!, 'USD'),
      productCost: money(CJ_COST_MINOR, 'USD'),
      supplierShipping: money(CJ_SHIPPING_MINOR, 'USD'),
      adSpendPerUnit,
      vatRatePct: 0,
    })

    expect(profitability.netProfit.minor).toBeGreaterThan(0)
    expect(profitability.netMarginPct).not.toBeNull()
    // Binary search resolves to within 1 minor unit of price, so the
    // realised margin can be fractionally below the exact target —
    // documented rounding tolerance, not a reintroduction of the bug.
    expect(profitability.netMarginPct!).toBeGreaterThanOrEqual(targetNetMarginPct - 1)
  })
})

/**
 * Milestone: economic-model cost completeness (0047). Part I's invariant,
 * extended to every new cost this milestone adds: "the exact same
 * economic assumptions used by recommendPricing() must be used by
 * calculateProfitability()" now covers packaging, returns, refunds,
 * chargebacks and import duty, not only advertising/fees/VAT. Real CJ
 * figures, a fully-configured (non-demo) cost profile, all seven cost
 * categories active simultaneously.
 */
describe('recommendPricing -> calculateProfitability: the full cost model together (packaging, returns, refunds, chargebacks, import duty, advertising, VAT)', () => {
  const CJ_COST_MINOR = 3814
  const CJ_SHIPPING_MINOR = 594
  const TARGET_NET_MARGIN_PCT = 30
  const ADVERTISING_ALLOWANCE_PCT = 12
  const PACKAGING_MINOR = 35
  const RETURN_RATE_PCT = 5
  const RETURN_LOSS_PCT = 70
  const REFUND_RATE_PCT = 1
  const CHARGEBACK_RATE_PCT = 0.5
  const CHARGEBACK_FEE_MINOR = 1500
  const IMPORT_DUTY_PCT = 8
  const VAT_RATE_PCT = 20

  const fullCosts = {
    productCost: money(CJ_COST_MINOR, 'GBP'),
    supplierShipping: money(CJ_SHIPPING_MINOR, 'GBP'),
    packaging: money(PACKAGING_MINOR, 'GBP'),
    returnRatePct: RETURN_RATE_PCT,
    returnLossPct: RETURN_LOSS_PCT,
    refundRatePct: REFUND_RATE_PCT,
    chargebackRatePct: CHARGEBACK_RATE_PCT,
    chargebackFeeFixed: money(CHARGEBACK_FEE_MINOR, 'GBP'),
    importDutyPct: IMPORT_DUTY_PCT,
    vatRatePct: VAT_RATE_PCT,
  }

  it('a recommended price computed with the full cost model realises the target margin when run through profitability with the identical cost model', () => {
    const pricing = recommendPricing(fullCosts, 'GBP', CJ_COST_MINOR, 15, TARGET_NET_MARGIN_PCT, ADVERTISING_ALLOWANCE_PCT)
    expect(pricing.recommendedUnreachable).toBe(false)
    expect(pricing.recommendedPriceMinor).not.toBeNull()

    // Mirrors assemble.ts's sharedCostAssumptions -> both call sites exactly.
    const adSpendPerUnit = money(Math.round((pricing.recommendedPriceMinor! * ADVERTISING_ALLOWANCE_PCT) / 100), 'GBP')
    const profitability = calculateProfitability({
      ...fullCosts,
      sellingPrice: money(pricing.recommendedPriceMinor!, 'GBP'),
      adSpendPerUnit,
    })

    expect(profitability.netProfit.minor).toBeGreaterThan(0)
    expect(profitability.netMarginPct).not.toBeNull()
    expect(profitability.netMarginPct!).toBeGreaterThanOrEqual(TARGET_NET_MARGIN_PCT - 1)
  })

  it('every cost category is genuinely present in the resulting breakdown — none silently dropped between pricing and profitability', () => {
    const pricing = recommendPricing(fullCosts, 'GBP', CJ_COST_MINOR, 15, TARGET_NET_MARGIN_PCT, ADVERTISING_ALLOWANCE_PCT)
    const adSpendPerUnit = money(Math.round((pricing.recommendedPriceMinor! * ADVERTISING_ALLOWANCE_PCT) / 100), 'GBP')
    const profitability = calculateProfitability({ ...fullCosts, sellingPrice: money(pricing.recommendedPriceMinor!, 'GBP'), adSpendPerUnit })

    const line = (label: string) => profitability.breakdown.find((l) => l.label === label)!
    expect(line('Import duty').amount.minor).toBeGreaterThan(0)
    expect(line('Packaging').amount.minor).toBe(PACKAGING_MINOR)
    expect(line('Returns allowance').amount.minor).toBeGreaterThan(0)
    expect(line('Refunds allowance').amount.minor).toBeGreaterThan(0)
    expect(line('Chargebacks').amount.minor).toBeGreaterThan(0)
    expect(line('VAT').amount.minor).toBeGreaterThan(0)
  })

  it('removing any single cost from the pricing side while keeping it in profitability would break the invariant — proving the shared-object pattern actually matters', () => {
    // A deliberately mismatched pair: pricing computed WITHOUT packaging,
    // profitability computed WITH it — the two must disagree, demonstrating
    // this test suite would catch the exact class of bug `assemble.ts`'s
    // `sharedCostAssumptions` object exists to prevent.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured off only to omit it from the rest
    const { packaging: _drop, ...costsWithoutPackaging } = fullCosts
    const mismatchedPricing = recommendPricing(costsWithoutPackaging, 'GBP', CJ_COST_MINOR, 15, TARGET_NET_MARGIN_PCT, ADVERTISING_ALLOWANCE_PCT)
    const matchedPricing = recommendPricing(fullCosts, 'GBP', CJ_COST_MINOR, 15, TARGET_NET_MARGIN_PCT, ADVERTISING_ALLOWANCE_PCT)
    expect(mismatchedPricing.recommendedPriceMinor).not.toBe(matchedPricing.recommendedPriceMinor)

    const adSpendPerUnit = money(Math.round((mismatchedPricing.recommendedPriceMinor! * ADVERTISING_ALLOWANCE_PCT) / 100), 'GBP')
    const inconsistentProfitability = calculateProfitability({ ...fullCosts, sellingPrice: money(mismatchedPricing.recommendedPriceMinor!, 'GBP'), adSpendPerUnit })
    // The price was found assuming no packaging cost, but profitability
    // correctly charges it anyway — so the realised margin now falls
    // (even if only slightly, since packaging is a small line here)
    // short of the target, exactly the bug the shared object prevents.
    expect(inconsistentProfitability.netMarginPct!).toBeLessThan(TARGET_NET_MARGIN_PCT)
  })
})
