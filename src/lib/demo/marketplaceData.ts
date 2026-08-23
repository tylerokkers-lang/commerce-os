import { fromMajor, money } from '@/lib/core/money'
import { PRODUCT_SEEDS, type DemoProductSeed } from './dataset'
import type {
  MarketplaceFeeSnapshot,
  MarketplaceInventorySnapshot,
  MarketplaceListingSnapshot,
  MarketplaceOrderSnapshot,
} from '@/lib/marketplaces/connectors/types'

/**
 * Simulated marketplace-side data for the demo Shopify and Amazon connectors.
 *
 * Derived from the same `PRODUCT_SEEDS` the rest of the demo business uses,
 * so a listing's price and status here agree with what the products and
 * opportunities pages already show — with exactly one deliberate exception.
 *
 * CMO-1001 has sold 8 units on Shopify that have not yet reached this
 * system's own inventory count (our side still shows 41, from
 * `demoStockAlerts`). This is a genuine, realistic reconciliation case: a
 * sync delay of a few hours between a sale happening and Commerce OS hearing
 * about it, exactly the "Commerce OS says 12, Shopify says 7" example from
 * the brief. The reconciliation engine is expected to find this and record
 * it, not silently trust either number.
 */

const CHECKED_AT = '2026-08-23T09:00:00.000Z'

const LIVE_ON = (seed: DemoProductSeed, channel: 'shopify' | 'amazon_uk') =>
  seed.channels[channel] === 'live'

/** Our own recorded stock, mirroring `demoStockAlerts` where it exists. */
const OUR_STOCK: ReadonlyMap<string, number> = new Map([
  ['CMO-1001', 41],
  ['CMO-1005', 18],
])

/** What the marketplace itself would report — deliberately different for one SKU. */
const MARKETPLACE_STOCK_OVERRIDE: ReadonlyMap<string, number> = new Map([
  ['CMO-1001', 33], // 8 units sold on Shopify since our last inventory sync.
])

function marketplaceStockFor(seed: DemoProductSeed): number {
  return MARKETPLACE_STOCK_OVERRIDE.get(seed.sku) ?? OUR_STOCK.get(seed.sku) ?? Math.max(seed.daysOfStock ?? 30, 0)
}

export function demoShopifyListings(): readonly MarketplaceListingSnapshot[] {
  return PRODUCT_SEEDS.filter((seed) => LIVE_ON(seed, 'shopify')).map((seed) => ({
    externalId: `shopify-${seed.sku}`,
    channelProductRef: seed.sku,
    title: seed.title,
    status: 'active',
    priceMinor: fromMajor(seed.price).minor,
    currency: 'GBP',
    stockQty: marketplaceStockFor(seed),
    reportedAt: CHECKED_AT,
    raw: { sku: seed.sku },
  }))
}

export function demoShopifyInventory(): readonly MarketplaceInventorySnapshot[] {
  return demoShopifyListings().map((listing) => ({
    externalId: listing.externalId,
    channelProductRef: listing.channelProductRef,
    stockQty: listing.stockQty ?? 0,
    reportedAt: listing.reportedAt,
  }))
}

export function demoShopifyOrders(): readonly MarketplaceOrderSnapshot[] {
  const active = PRODUCT_SEEDS.filter((seed) => LIVE_ON(seed, 'shopify') && seed.unitsSold > 0)
  return active.slice(0, 3).map((seed, index) => ({
    externalId: `shopify-order-${1000 + index}`,
    placedAt: new Date(Date.parse(CHECKED_AT) - index * 3_600_000).toISOString(),
    status: 'paid',
    totalMinor: fromMajor(seed.price).minor,
    currency: 'GBP',
    lineItemRefs: [seed.sku],
    raw: { sku: seed.sku },
  }))
}

export function demoShopifyFees(): readonly MarketplaceFeeSnapshot[] {
  return demoShopifyOrders().map((order) => ({
    externalOrderId: order.externalId,
    feeType: 'payment_processing',
    // Shopify Payments UK online rate: 1.75% + 25p.
    amount: money(Math.round(order.totalMinor * 0.0175) + 25, 'GBP'),
    chargedAt: order.placedAt,
  }))
}

export function demoAmazonListings(): readonly MarketplaceListingSnapshot[] {
  return PRODUCT_SEEDS.filter((seed) => LIVE_ON(seed, 'amazon_uk')).map((seed) => ({
    externalId: `AMZ${seed.sku.replace('-', '')}`,
    channelProductRef: seed.sku,
    title: seed.title,
    status: 'active',
    priceMinor: fromMajor(seed.price).minor,
    currency: 'GBP',
    stockQty: OUR_STOCK.get(seed.sku) ?? Math.max(seed.daysOfStock ?? 30, 0),
    reportedAt: CHECKED_AT,
    raw: { sku: seed.sku },
  }))
}

export function demoAmazonOrders(): readonly MarketplaceOrderSnapshot[] {
  const active = PRODUCT_SEEDS.filter((seed) => LIVE_ON(seed, 'amazon_uk') && seed.unitsSold > 0)
  return active.slice(0, 3).map((seed, index) => ({
    externalId: `205-${1000000 + index}-${7654321 + index}`,
    placedAt: new Date(Date.parse(CHECKED_AT) - index * 5_400_000).toISOString(),
    status: 'paid',
    totalMinor: fromMajor(seed.price).minor,
    currency: 'GBP',
    lineItemRefs: [seed.sku],
    raw: { sku: seed.sku },
  }))
}

export function demoAmazonFees(): readonly MarketplaceFeeSnapshot[] {
  return demoAmazonOrders().map((order) => {
    const seed = PRODUCT_SEEDS.find((s) => s.sku === order.lineItemRefs[0])
    const referralPct = seed?.category === 'Electronics' ? 8 : 15
    return {
      externalOrderId: order.externalId,
      feeType: 'referral_fee',
      amount: money(Math.round(order.totalMinor * (referralPct / 100)), 'GBP'),
      chargedAt: order.placedAt,
    }
  })
}
