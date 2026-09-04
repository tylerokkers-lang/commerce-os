import { describe, expect, it } from 'vitest'
import { deriveChannelCurrencyLandedCost, type SupplierEconomicsFacts } from '@/lib/products/intelligence/currency'
import { recommendPricing } from '@/lib/products/intelligence/pricingEngine'
import { calculateProfitability } from '@/lib/profitability'
import { money } from '@/lib/core/money'
import type { ExchangeRateFact } from '@/lib/fx/types'

/**
 * Currency correctness for the product intelligence pipeline — a real
 * bug found live testing the CJdropshipping pipeline: CJ quotes in USD,
 * this org's channel currency is GBP, and `assemble.ts` used to treat
 * the raw USD minor units as if they were already GBP (a silent 1:1
 * conflation, never a real conversion, never caught because every Money
 * value it built shared the same wrong currency label).
 */

const NOW = new Date('2026-09-03T12:00:00.000Z')

function usdCjOffer(): SupplierEconomicsFacts {
  // Real figures from this project's own live CJ dry run.
  return { unitCostMinor: 3814, shippingCostMinor: 594, currency: 'USD' }
}

const FRESH_USD_GBP_RATE: ExchangeRateFact = {
  base: 'USD',
  quote: 'GBP',
  rate: 0.79,
  source: 'test-fixture',
  observedAt: '2026-09-03T06:00:00.000Z', // 6h old — well inside the 24h productEvaluation window
  retrievedAt: '2026-09-03T06:00:05.000Z',
}

const STALE_USD_GBP_RATE: ExchangeRateFact = {
  ...FRESH_USD_GBP_RATE,
  observedAt: '2026-08-01T06:00:00.000Z', // over a month old — well outside the 24h window
}

describe('deriveChannelCurrencyLandedCost: USD supplier + GBP channel, with a real rate on file', () => {
  it('converts both cost and shipping into the channel currency using the real rate — never a 1:1 assumption', () => {
    const result = deriveChannelCurrencyLandedCost(usdCjOffer(), 'GBP', FRESH_USD_GBP_RATE, 'productEvaluation', NOW)
    expect(result.available).toBe(true)
    expect(result.currency).toBe('GBP')
    // 3814 * 0.79 = 3013.06 -> rounds to 3013; 594 * 0.79 = 469.26 -> rounds to 469
    expect(result.unitCostMinor).toBe(3013)
    expect(result.shippingCostMinor).toBe(469)
    // Never equal to the raw USD figures — the exact bug being fixed.
    expect(result.unitCostMinor).not.toBe(3814)
    expect(result.shippingCostMinor).not.toBe(594)
    expect(result.rateUsed).toEqual(FRESH_USD_GBP_RATE)
  })

  it('a stale-but-real rate is still used (never treated the same as unavailable), and is flagged in the detail', () => {
    const result = deriveChannelCurrencyLandedCost(usdCjOffer(), 'GBP', STALE_USD_GBP_RATE, 'productEvaluation', NOW)
    expect(result.available).toBe(true)
    expect(result.unitCostMinor).toBe(3013)
    expect(result.detail).toMatch(/older than the productEvaluation freshness window/)
  })
})

describe('deriveChannelCurrencyLandedCost: never mutates the original supplier facts', () => {
  it('the input object is unchanged after conversion — the original USD cost/shipping/currency remain exactly as supplied', () => {
    const original = usdCjOffer()
    const snapshot = { ...original }
    deriveChannelCurrencyLandedCost(original, 'GBP', FRESH_USD_GBP_RATE, 'productEvaluation', NOW)
    expect(original).toEqual(snapshot)
    expect(original.currency).toBe('USD')
    expect(original.unitCostMinor).toBe(3814)
  })
})

describe('deriveChannelCurrencyLandedCost: no unnecessary conversion when currencies already match', () => {
  it('GBP supplier + GBP channel -> the original figures pass straight through, no rate consulted, no rate needed', () => {
    const gbpOffer: SupplierEconomicsFacts = { unitCostMinor: 800, shippingCostMinor: 200, currency: 'GBP' }
    const result = deriveChannelCurrencyLandedCost(gbpOffer, 'GBP', null, 'productEvaluation', NOW)
    expect(result.available).toBe(true)
    expect(result.unitCostMinor).toBe(800)
    expect(result.shippingCostMinor).toBe(200)
    expect(result.rateUsed).toBeNull()
    expect(result.detail).toBeNull()
  })

  it('supplier currency equal to channel currency preserves existing behaviour exactly, even when a rate happens to exist', () => {
    // A rate being on file for some other reason must never be consulted
    // when no conversion is needed in the first place.
    const gbpOffer: SupplierEconomicsFacts = { unitCostMinor: 800, shippingCostMinor: 200, currency: 'GBP' }
    const result = deriveChannelCurrencyLandedCost(gbpOffer, 'GBP', FRESH_USD_GBP_RATE, 'productEvaluation', NOW)
    expect(result.available).toBe(true)
    expect(result.unitCostMinor).toBe(800)
    expect(result.rateUsed).toBeNull()
  })
})

/**
 * Milestone: business-settings audit. "Unknown ≠ zero" cuts both ways: a
 * genuinely configured zero (free shipping, a real supplier fact) must
 * never be treated the same as "no figure is on file" — `available` must
 * stay `true` and the figure must stay exactly 0, both same-currency and
 * cross-currency (0 converted at any real rate is still, correctly, 0).
 */
describe('deriveChannelCurrencyLandedCost: a genuinely configured zero cost is preserved, never conflated with unavailable', () => {
  it('same-currency: zero shipping cost (free shipping) passes through as a real, available 0 — not unavailable', () => {
    const offer: SupplierEconomicsFacts = { unitCostMinor: 800, shippingCostMinor: 0, currency: 'GBP' }
    const result = deriveChannelCurrencyLandedCost(offer, 'GBP', null, 'productEvaluation', NOW)
    expect(result.available).toBe(true)
    expect(result.shippingCostMinor).toBe(0)
  })

  it('cross-currency: zero shipping cost converts to a real, available 0 in the channel currency, using the real rate', () => {
    const offer: SupplierEconomicsFacts = { unitCostMinor: 3814, shippingCostMinor: 0, currency: 'USD' }
    const result = deriveChannelCurrencyLandedCost(offer, 'GBP', FRESH_USD_GBP_RATE, 'productEvaluation', NOW)
    expect(result.available).toBe(true)
    expect(result.shippingCostMinor).toBe(0)
    expect(result.rateUsed).not.toBeNull() // the rate genuinely was consulted, unlike the same-currency case above
  })
})

describe('deriveChannelCurrencyLandedCost: missing FX rate -> genuinely unknown, never a fabricated 1:1 conversion', () => {
  it('no rate has ever been recorded for the pair -> available: false, with an explicit, honest reason', () => {
    const result = deriveChannelCurrencyLandedCost(usdCjOffer(), 'GBP', null, 'productEvaluation', NOW)
    expect(result.available).toBe(false)
    expect(result.unitCostMinor).toBeNull()
    expect(result.shippingCostMinor).toBeNull()
    expect(result.rateUsed).toBeNull()
    expect(result.detail).toMatch(/No exchange rate is on file for USD->GBP/)
  })

  it('never silently falls back to treating $1 as £1 when unavailable', () => {
    const result = deriveChannelCurrencyLandedCost(usdCjOffer(), 'GBP', null, 'productEvaluation', NOW)
    expect(result.unitCostMinor).not.toBe(usdCjOffer().unitCostMinor)
    expect(result.available).toBe(false)
  })
})

describe('the converted landed cost feeds the existing pricing engine correctly', () => {
  it('a real converted GBP landed cost produces a real, deterministic recommended GBP price', () => {
    const landed = deriveChannelCurrencyLandedCost(usdCjOffer(), 'GBP', FRESH_USD_GBP_RATE, 'productEvaluation', NOW)
    expect(landed.available).toBe(true)

    const pricing = recommendPricing(
      { productCost: money(landed.unitCostMinor!, 'GBP'), supplierShipping: money(landed.shippingCostMinor!, 'GBP'), vatRatePct: 0 },
      'GBP',
      landed.unitCostMinor!,
      15,
      35,
      0,
    )
    expect(pricing.recommendedUnreachable).toBe(false)
    expect(pricing.recommendedPriceMinor).not.toBeNull()
    // The GBP-converted landed cost (3013 + 469 = 3482) is well below the
    // uncorrected USD-as-GBP figure (3814 + 594 = 4408) would have implied
    // -> the recommended price must reflect the real, smaller GBP cost.
    expect(pricing.recommendedPriceMinor!).toBeGreaterThan(3013 + 469)
  })

  it('the recommended GBP price, fed into GBP profitability, produces a real, currency-consistent margin (no CurrencyMismatchError)', () => {
    const landed = deriveChannelCurrencyLandedCost(usdCjOffer(), 'GBP', FRESH_USD_GBP_RATE, 'productEvaluation', NOW)
    const targetNetMarginPct = 35
    const pricing = recommendPricing(
      { productCost: money(landed.unitCostMinor!, 'GBP'), supplierShipping: money(landed.shippingCostMinor!, 'GBP'), vatRatePct: 0 },
      'GBP',
      landed.unitCostMinor!,
      15,
      targetNetMarginPct,
      0,
    )

    expect(() =>
      calculateProfitability({
        sellingPrice: money(pricing.recommendedPriceMinor!, 'GBP'),
        productCost: money(landed.unitCostMinor!, 'GBP'),
        supplierShipping: money(landed.shippingCostMinor!, 'GBP'),
        vatRatePct: 0,
      }),
    ).not.toThrow()

    const profitability = calculateProfitability({
      sellingPrice: money(pricing.recommendedPriceMinor!, 'GBP'),
      productCost: money(landed.unitCostMinor!, 'GBP'),
      supplierShipping: money(landed.shippingCostMinor!, 'GBP'),
      vatRatePct: 0,
    })
    expect(profitability.netProfit.minor).toBeGreaterThan(0)
    expect(profitability.netMarginPct!).toBeGreaterThanOrEqual(targetNetMarginPct)
  })

  it('mixing an unconverted USD cost with a GBP selling price throws — proving the currency-mismatch guard is real, not bypassed', () => {
    const rawUsd = usdCjOffer()
    expect(() =>
      calculateProfitability({
        sellingPrice: money(6969, 'GBP'),
        productCost: money(rawUsd.unitCostMinor, 'USD'), // deliberately NOT converted
        supplierShipping: money(rawUsd.shippingCostMinor, 'USD'),
        vatRatePct: 0,
      }),
    ).toThrow()
  })
})
