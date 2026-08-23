import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import {
  AMAZON_REFERRAL_PCT_BY_CATEGORY,
  buildChannelProfiles,
  compareChannels,
  projectChannel,
  type ChannelProjectionInput,
} from '@/lib/profitability/channels'
import { calculateProfitability } from '@/lib/profitability'

const thresholds = { minGrossMarginPct: 25, minNetMarginPct: 10 }

const input: ChannelProjectionInput = {
  sellingPrice: fromMajor(30),
  productCost: fromMajor(8),
  supplierShipping: fromMajor(2.2),
  returnRatePct: 3,
  vatRatePct: 20,
  vatInclusive: true,
}

describe('channel cost profiles', () => {
  it('builds one profile per channel', () => {
    const profiles = buildChannelProfiles({ category: 'Kitchen', sellingPrice: fromMajor(30) })
    expect(profiles.map((p) => p.channel).sort()).toEqual(['amazon_uk', 'shopify'])
  })

  it('charges Amazon a category referral fee and Shopify none', () => {
    const [shopify, amazon] = buildChannelProfiles({
      category: 'Kitchen',
      sellingPrice: fromMajor(30),
    })
    expect(amazon.channelFeePct).toBe(AMAZON_REFERRAL_PCT_BY_CATEGORY.Kitchen)
    expect(shopify.channelFeePct).toBe(0)
  })

  it('charges Shopify a payment fee and Amazon none', () => {
    const [shopify, amazon] = buildChannelProfiles({
      category: 'Kitchen',
      sellingPrice: fromMajor(30),
    })
    expect(shopify.paymentFeePct).toBeGreaterThan(0)
    // Amazon settles net of its own fees, so a second card cost would be
    // double counting.
    expect(amazon.paymentFeePct).toBe(0)
  })

  it('varies the referral fee by category', () => {
    const [, kitchen] = buildChannelProfiles({ category: 'Kitchen', sellingPrice: fromMajor(30) })
    const [, electronics] = buildChannelProfiles({
      category: 'Electronics',
      sellingPrice: fromMajor(30),
    })
    expect(electronics.channelFeePct).toBeLessThan(kitchen.channelFeePct)
  })

  it('falls back to the default rate for an unknown category', () => {
    const [, amazon] = buildChannelProfiles({ category: 'Nonsense', sellingPrice: fromMajor(30) })
    expect(amazon.channelFeePct).toBe(AMAZON_REFERRAL_PCT_BY_CATEGORY.default)
  })

  it('applies the per-item minimum referral fee on a cheap product', () => {
    // 15% of £1 is 15p, below Amazon's 25p minimum, so the shortfall is added
    // as a fixed fee rather than by distorting the percentage.
    const [, amazon] = buildChannelProfiles({ category: 'Kitchen', sellingPrice: fromMajor(1) })
    expect(amazon.channelFeeFixed.minor).toBe(10)
    expect(amazon.notes.join(' ')).toMatch(/per-item minimum/)
  })

  it('adds no shortfall when the percentage fee already exceeds the minimum', () => {
    const [, amazon] = buildChannelProfiles({ category: 'Kitchen', sellingPrice: fromMajor(30) })
    expect(amazon.channelFeeFixed.minor).toBe(0)
  })

  it('assumes more advertising on Shopify than on Amazon', () => {
    const [shopify, amazon] = buildChannelProfiles({
      category: 'Kitchen',
      sellingPrice: fromMajor(30),
    })
    // Shopify sends no traffic of its own.
    expect(shopify.adSpendPerUnit.minor).toBeGreaterThan(amazon.adSpendPerUnit.minor)
  })

  it('charges an FBA fulfilment fee only when FBA is selected', () => {
    const [, mfn] = buildChannelProfiles({ category: 'Kitchen', sellingPrice: fromMajor(30) })
    const [, fba] = buildChannelProfiles({
      category: 'Kitchen',
      sellingPrice: fromMajor(30),
      amazonFba: true,
    })
    expect(mfn.fulfilment.minor).toBe(0)
    expect(fba.fulfilment.minor).toBeGreaterThan(0)
  })
})

describe('single source of truth for profitability', () => {
  it('delegates entirely to calculateProfitability', () => {
    const [shopify] = buildChannelProfiles({ category: 'Kitchen', sellingPrice: input.sellingPrice })
    const projection = projectChannel(input, shopify, thresholds)

    // Recomputing with the same inputs through the base engine must give
    // exactly the same answer: this module assembles assumptions, it does not
    // do arithmetic of its own.
    const direct = calculateProfitability({
      sellingPrice: input.sellingPrice,
      productCost: input.productCost,
      supplierShipping: input.supplierShipping,
      fulfilment: shopify.fulfilment,
      packaging: fromMajor(0.35),
      channelFeePct: shopify.channelFeePct,
      channelFeeFixed: shopify.channelFeeFixed,
      paymentFeePct: shopify.paymentFeePct,
      paymentFeeFixed: shopify.paymentFeeFixed,
      adSpendPerUnit: shopify.adSpendPerUnit,
      returnRatePct: input.returnRatePct,
      returnLossPct: 65,
      refundRatePct: 1,
      vatRatePct: input.vatRatePct,
      vatInclusive: true,
    })

    expect(projection.profitability.netProfit.minor).toBe(direct.netProfit.minor)
    expect(projection.profitability.netMarginPct).toBe(direct.netMarginPct)
    expect(projection.profitability.breakEvenPrice.minor).toBe(direct.breakEvenPrice.minor)
  })

  it('records the exact assumptions used, so a projection can be re-run', () => {
    const [shopify] = buildChannelProfiles({ category: 'Kitchen', sellingPrice: input.sellingPrice })
    const projection = projectChannel(input, shopify, thresholds)
    expect(projection.assumptions.engineVersion).toBe('channel-profitability@1')
    expect(projection.assumptions.channelFeePct).toBe(shopify.channelFeePct)
    expect(projection.assumptions.vatRatePct).toBe(20)
  })

  it('does not assume a 20% VAT rate', () => {
    const withVat = projectChannel(
      input,
      buildChannelProfiles({ category: 'Kitchen', sellingPrice: input.sellingPrice })[0],
      thresholds,
    )
    const notRegistered = projectChannel(
      { ...input, vatRatePct: 0 },
      buildChannelProfiles({ category: 'Kitchen', sellingPrice: input.sellingPrice })[0],
      thresholds,
    )
    expect(notRegistered.profitability.vat.minor).toBe(0)
    expect(notRegistered.profitability.netProfit.minor).toBeGreaterThan(
      withVat.profitability.netProfit.minor,
    )
  })
})

describe('channels are assessed independently', () => {
  it('produces a different answer per channel for the same product', () => {
    const comparison = compareChannels(
      input,
      { category: 'Kitchen', sellingPrice: input.sellingPrice },
      thresholds,
    )
    const shopify = comparison.projections.find((p) => p.channel === 'shopify')!
    const amazon = comparison.projections.find((p) => p.channel === 'amazon_uk')!
    expect(shopify.profitability.netProfit.minor).not.toBe(amazon.profitability.netProfit.minor)
  })

  it('can pass on one channel and fail on the other', () => {
    // A high referral fee category with a thin margin: Amazon's 15% bites in a
    // way Shopify's 1.75% does not.
    const thin: ChannelProjectionInput = {
      ...input,
      productCost: fromMajor(13),
      supplierShipping: fromMajor(2.5),
    }
    const comparison = compareChannels(
      thin,
      { category: 'Kitchen', sellingPrice: thin.sellingPrice },
      thresholds,
    )
    const passing = comparison.projections.filter((p) => p.gate.passes)
    expect(passing.length).toBe(1)
    expect(passing[0].channel).toBe('shopify')
    expect(comparison.viableOnAnyChannel).toBe(true)
    expect(comparison.summary).toMatch(/Viable on Shopify, but not on Amazon UK/)
  })

  it('names the best channel when both pass', () => {
    const comparison = compareChannels(
      input,
      { category: 'Kitchen', sellingPrice: input.sellingPrice },
      thresholds,
    )
    expect(comparison.projections.every((p) => p.gate.passes)).toBe(true)
    expect(comparison.bestChannel).not.toBeNull()
    expect(comparison.summary).toMatch(/both channels/)
  })

  it('reports no viable channel when the economics do not work anywhere', () => {
    const hopeless: ChannelProjectionInput = { ...input, productCost: fromMajor(26) }
    const comparison = compareChannels(
      hopeless,
      { category: 'Kitchen', sellingPrice: hopeless.sellingPrice },
      thresholds,
    )
    expect(comparison.viableOnAnyChannel).toBe(false)
    expect(comparison.bestChannel).toBeNull()
    expect(comparison.summary).toMatch(/Fails the profitability gate on every channel/)
  })

  it('gives a reason for every gate failure', () => {
    const hopeless: ChannelProjectionInput = { ...input, productCost: fromMajor(26) }
    const comparison = compareChannels(
      hopeless,
      { category: 'Kitchen', sellingPrice: hopeless.sellingPrice },
      thresholds,
    )
    for (const projection of comparison.projections) {
      expect(projection.gate.failures.length).toBeGreaterThan(0)
      for (const failure of projection.gate.failures) {
        expect(failure.length).toBeGreaterThan(20)
      }
    }
  })
})
