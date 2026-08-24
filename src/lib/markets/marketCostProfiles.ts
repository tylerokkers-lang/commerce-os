import { fromMajor, zero, type Money } from '@/lib/core/money'

/**
 * Market-specific cost assumptions (Milestone 9 §5) — the same role
 * `profitability/channels.ts`'s `ChannelCostProfile` already plays for the
 * two live UK channels, extended to markets that have no channel yet.
 *
 * Seed values only, exactly like `AMAZON_REFERRAL_PCT_BY_CATEGORY` already
 * documents itself: publicly published fee structures at the time this was
 * written, not a live fee lookup, and never a legal or tax authority. A
 * live business operating in these markets would override these via
 * `config_values`, the same escape hatch the existing UK profiles note.
 */

export interface MarketCostProfile {
  marketKey: string
  channelFeePct: number
  channelFeeFixed: Money
  paymentFeePct: number
  paymentFeeFixed: Money
  fulfilment: Money
  adSpendPerUnit: Money
  /** International shipping the supplier or the business bears reaching this market's customers — separate from `supplierShipping` in `CostInputs`, which is the inbound domestic leg. */
  internationalShipping: Money
  /** VAT/sales-tax rate assumption for this market — a seed, never a live tax-authority read. 0 where genuinely not applicable (e.g. US sales tax varies by state and is not modelled here). */
  taxRatePct: number
  notes: readonly string[]
}

const MARKET_COST_PROFILES: Readonly<Record<string, MarketCostProfile>> = {
  amazon_uk: {
    marketKey: 'amazon_uk', channelFeePct: 15, channelFeeFixed: zero('GBP'), paymentFeePct: 0, paymentFeeFixed: zero('GBP'),
    fulfilment: fromMajor(2.9, 'GBP'), adSpendPerUnit: fromMajor(2.5, 'GBP'), internationalShipping: zero('GBP'), taxRatePct: 20,
    notes: ['Same seed profile as the existing Amazon UK channel default (15% referral, FBA fulfilment).', 'No international shipping — this is the domestic market.'],
  },
  shopify_uk: {
    marketKey: 'shopify_uk', channelFeePct: 0, channelFeeFixed: zero('GBP'), paymentFeePct: 1.75, paymentFeeFixed: fromMajor(0.25, 'GBP'),
    fulfilment: zero('GBP'), adSpendPerUnit: fromMajor(4.5, 'GBP'), internationalShipping: zero('GBP'), taxRatePct: 20,
    notes: ['Same seed profile as the existing Shopify UK channel default.'],
  },
  amazon_us: {
    marketKey: 'amazon_us', channelFeePct: 15, channelFeeFixed: zero('USD'), paymentFeePct: 0, paymentFeeFixed: zero('USD'),
    fulfilment: fromMajor(3.5, 'USD'), adSpendPerUnit: fromMajor(3, 'USD'), internationalShipping: fromMajor(4.5, 'USD'), taxRatePct: 0,
    notes: [
      '15% referral fee assumed (Amazon\'s typical published default across many categories) — a seed, not a category-specific lookup.',
      'US sales tax is collected and remitted by Amazon in most states (marketplace facilitator law) and is modelled as 0% here rather than guessed per state.',
      'International shipping assumed for cross-border fulfilment from a UK/EU supplier — a real US-based supplier leg would be materially cheaper; see supplier market capability facts.',
    ],
  },
  amazon_de: {
    marketKey: 'amazon_de', channelFeePct: 15, channelFeeFixed: zero('EUR'), paymentFeePct: 0, paymentFeeFixed: zero('EUR'),
    fulfilment: fromMajor(3.2, 'EUR'), adSpendPerUnit: fromMajor(2.8, 'EUR'), internationalShipping: fromMajor(3.5, 'EUR'), taxRatePct: 19,
    notes: [
      '15% referral fee assumed (Amazon\'s typical published default) — a seed, not a category-specific lookup.',
      '19% German standard VAT rate assumed — a seed; the actual rate depends on product category and this business\'s VAT registration status in Germany, which is a compliance fact, not a profitability one.',
    ],
  },
  shopify_us: {
    marketKey: 'shopify_us', channelFeePct: 0, channelFeeFixed: zero('USD'), paymentFeePct: 2.9, paymentFeeFixed: fromMajor(0.30, 'USD'),
    fulfilment: zero('USD'), adSpendPerUnit: fromMajor(5, 'USD'), internationalShipping: fromMajor(4.5, 'USD'), taxRatePct: 0,
    notes: ['Shopify Payments US standard online rate (2.9% + $0.30) assumed.', 'US sales tax varies by state/nexus and is not modelled — assumed 0% rather than guessed.'],
  },
}

export function getMarketCostProfile(marketKey: string): MarketCostProfile | undefined {
  return MARKET_COST_PROFILES[marketKey]
}
