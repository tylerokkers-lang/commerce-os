import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { money } from '@/lib/core/money'
import type { Money } from '@/lib/core/money'
import {
  FRESHNESS_WINDOW_HOURS,
  factFrom,
  type ChannelProductFacts,
  type FactsLoader,
  type ProductFacts,
  type SupplierFacts,
} from './factsTypes'

export type { Fact, Freshness, ProductFacts, SupplierFacts, ChannelProductFacts, FactsLoader } from './factsTypes'
export { allFactsFresh, describeFactState, FRESHNESS_WINDOW_HOURS } from './factsTypes'

/**
 * The production `FactsLoader`: real queries against `products`, `suppliers`,
 * `supplier_products` and `channel_products`. This module only *reads*. It
 * composes nothing new — the values it assembles feed straight into the
 * existing, unchanged engines (`calculateProfitability`, `assessCompliance`,
 * `evaluateSupplierRedundancy`, the automation modules), which is the whole
 * point: the engines do not change, only what feeds them becomes real
 * instead of a hand-built payload.
 */
export function getSupabaseFactsLoader(): FactsLoader {
  return {
    async loadProductFacts(orgId: string, productId: string, now: Date = new Date()): Promise<ProductFacts> {
      const supabase = createServiceSupabase()
      const { data } = await supabase.from('products').select('title, category, stage, updated_at').eq('org_id', orgId).eq('id', productId).maybeSingle()

      return {
        productId,
        title: factFrom(data?.title, data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
        category: factFrom(data?.category ?? null, data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
        stage: factFrom(data?.stage, data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
      }
    },

    /** The live facts a supplier decision (redundancy, price-change detection) needs for one product. */
    async loadSupplierFactsForProduct(orgId: string, supplierId: string, productId: string, now: Date = new Date()): Promise<SupplierFacts> {
      const supabase = createServiceSupabase()

      const [{ data: supplier }, { data: offer }] = await Promise.all([
        supabase.from('suppliers').select('shopify_status, amazon_status, last_assessed_at').eq('org_id', orgId).eq('id', supplierId).maybeSingle(),
        supabase
          .from('supplier_products')
          .select('unit_cost_minor, shipping_cost_minor, currency, stock_qty, in_stock, last_verified_at')
          .eq('org_id', orgId)
          .eq('supplier_id', supplierId)
          .eq('product_id', productId)
          .maybeSingle(),
      ])

      const currency = (offer?.currency ?? 'GBP') as Money['currency']

      return {
        supplierId,
        unitCost: factFrom(
          offer ? money(offer.unit_cost_minor, currency) : null,
          offer?.last_verified_at ?? null,
          FRESHNESS_WINDOW_HOURS.supplierPricing,
          now,
        ),
        shippingCost: factFrom(
          offer ? money(offer.shipping_cost_minor, currency) : null,
          offer?.last_verified_at ?? null,
          FRESHNESS_WINDOW_HOURS.supplierPricing,
          now,
        ),
        stockQty: factFrom(offer?.stock_qty ?? null, offer?.last_verified_at ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        inStock: factFrom(offer?.in_stock, offer?.last_verified_at ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        shopifyStatus: factFrom(supplier?.shopify_status, supplier?.last_assessed_at ?? null, FRESHNESS_WINDOW_HOURS.supplierCompliance, now),
        amazonStatus: factFrom(supplier?.amazon_status, supplier?.last_assessed_at ?? null, FRESHNESS_WINDOW_HOURS.supplierCompliance, now),
      }
    },

    async loadChannelProductFacts(orgId: string, channelProductId: string, now: Date = new Date()): Promise<ChannelProductFacts> {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('channel_products')
        .select('status, price_minor, fulfilment_supplier_id, external_id, last_synced_at, updated_at')
        .eq('org_id', orgId)
        .eq('id', channelProductId)
        .maybeSingle()

      // A listing's own price/status only means something as of the last
      // time it was actually synced with the marketplace — `updated_at`
      // reflects our own edits, not the marketplace's, so freshness is
      // judged by `last_synced_at`.
      const asOf = data?.last_synced_at ?? null

      return {
        channelProductId,
        status: factFrom(data?.status, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
        priceMinor: factFrom(data?.price_minor ?? null, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
        fulfilmentSupplierId: factFrom(data?.fulfilment_supplier_id ?? null, asOf ?? data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.channelListing, now),
        externalId: factFrom(data?.external_id ?? null, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
      }
    },
  }
}
